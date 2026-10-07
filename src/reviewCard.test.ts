import { describe, expect, it } from 'vitest';
import type { PolicyEvaluation, PullRequestExtras } from './myPullRequests';
import { BUG_AUTOCOMPLETE_WARNING } from './myPullRequests';
import {
  approvalCompletes,
  countChangedFiles,
  AUTO_COMPLETE_REVIEWER_NOTE,
  describeFilesChanged,
  describeTeamRules,
  myCommentsLine,
  toReviewDetails,
} from './reviewCard';
import type { ReviewerPullRequest } from './reviewRequests';
import type { ThreadResponse } from './reviewThreads';

const ME = 'me';
const OPTIONS = { baseBranch: 'develop', minimumRequiredReviewers: 0 };

function pr(overrides: Partial<ReviewerPullRequest> = {}): ReviewerPullRequest {
  return {
    pullRequestId: 1,
    title: '[66068] FUI Common: Created a hook',
    description: 'Adds the hook to handle the scenarios.',
    status: 'active',
    isDraft: false,
    mergeStatus: 'succeeded',
    creationDate: '2026-10-06T08:00:00Z',
    createdBy: { id: 'ana', displayName: 'Ana' },
    targetRefName: 'refs/heads/develop',
    sourceRefName: 'refs/heads/feature/x',
    repository: { id: 'repo', name: 'User_Interface', project: { id: 'project' } },
    webUrl: 'https://example.com/pr/1',
    reviewers: [
      { id: 'team', displayName: '[UI]\\UI Team', vote: 0, isContainer: true },
      { id: 'bob', displayName: 'Bob', vote: 10, isRequired: true },
      { id: ME, displayName: 'Me', vote: 0 },
    ],
    ...overrides,
  };
}

const evaluation = (type: string, status: string, extra: Partial<PolicyEvaluation> = {}): PolicyEvaluation => ({
  type,
  status,
  isBlocking: true,
  ...extra,
});
const minReviewers = (status: string, minimumApproverCount = 2) =>
  evaluation('Minimum number of reviewers', status, { minimumApproverCount, creatorVoteCounts: false });

describe('approvalCompletes', () => {
  it('is true when mine is the only approval missing of the minimum number of reviewers', () => {
    expect(approvalCompletes(pr(), [minReviewers('running'), evaluation('Build', 'approved')], ME)).toBe(true);
  });

  it('is false when more than one approval is missing', () => {
    const other = pr({ reviewers: [{ id: ME, displayName: 'Me', vote: 0 }] });
    expect(approvalCompletes(other, [minReviewers('running')], ME)).toBe(false);
  });

  it('is false when another blocking policy is not satisfied', () => {
    expect(approvalCompletes(pr(), [minReviewers('running'), evaluation('Build', 'running')], ME)).toBe(false);
    expect(approvalCompletes(pr(), [minReviewers('running'), evaluation('Comment requirements', 'rejected')], ME)).toBe(
      false
    );
  });

  it('ignores the policies that are not blocking or not applicable', () => {
    const policies = [
      minReviewers('running'),
      evaluation('Build', 'running', { isBlocking: false }),
      evaluation('Work item linking', 'notApplicable'),
    ];
    expect(approvalCompletes(pr(), policies, ME)).toBe(true);
  });

  it('ignores the merge strategy policy: it is rejected until whoever completes the PR picks one', () => {
    const policies = [minReviewers('running'), evaluation('Require a merge strategy', 'rejected')];
    expect(approvalCompletes(pr(), policies, ME)).toBe(true);
    expect(approvalCompletes(pr(), [evaluation('Require a merge strategy', 'rejected')], ME)).toBe(false);
  });

  it('is false when nothing blocks the PR: it does not need my approval', () => {
    expect(approvalCompletes(pr(), [minReviewers('approved')], ME)).toBe(false);
  });

  it('is false when the policies are unknown', () => {
    expect(approvalCompletes(pr(), undefined, ME)).toBe(false);
  });

  it('is false when my approval would not count', () => {
    const declined = pr({
      reviewers: [
        { id: 'bob', displayName: 'Bob', vote: 10 },
        { id: ME, displayName: 'Me', vote: 0, hasDeclined: true },
      ],
    });
    const notReviewer = pr({ reviewers: [{ id: 'bob', displayName: 'Bob', vote: 10 }] });
    const policies = [minReviewers('running')];
    expect(approvalCompletes(declined, policies, ME)).toBe(false);
    expect(approvalCompletes(notReviewer, policies, ME)).toBe(false);
  });

  it('does not count the vote of the author unless the policy says so', () => {
    const withAuthor = pr({
      reviewers: [
        { id: 'ana', displayName: 'Ana', vote: 10 },
        { id: ME, displayName: 'Me', vote: 0 },
      ],
    });
    // Ana does not count: two approvals are missing
    expect(approvalCompletes(withAuthor, [minReviewers('running')], ME)).toBe(false);
    const authorCounts = [
      evaluation('Minimum number of reviewers', 'running', { minimumApproverCount: 2, creatorVoteCounts: true }),
    ];
    expect(approvalCompletes(withAuthor, authorCounts, ME)).toBe(true);
  });

  it('is false for drafts, conflicts and PRs that are not active', () => {
    const policies = [minReviewers('running')];
    expect(approvalCompletes(pr({ isDraft: true }), policies, ME)).toBe(false);
    expect(approvalCompletes(pr({ mergeStatus: 'conflicts' }), policies, ME)).toBe(false);
    expect(approvalCompletes(pr({ status: 'completed' }), policies, ME)).toBe(false);
  });

  it('is false when a policy is broken', () => {
    expect(approvalCompletes(pr(), [minReviewers('broken')], ME)).toBe(false);
  });

  describe('required reviewers', () => {
    const required = (overrides: Partial<ReviewerPullRequest['reviewers'][number]>[]) =>
      pr({
        reviewers: [
          { id: ME, displayName: 'Me', vote: 0, isRequired: true },
          ...overrides.map((o) => ({ displayName: 'Other', vote: 0, ...o })),
        ],
      });

    it('is true when I am the only required reviewer who has not approved', () => {
      const request = required([
        { id: 'bob', vote: 10, isRequired: true },
        { id: 'cy', vote: 10 },
      ]);
      expect(approvalCompletes(request, [evaluation('Required reviewers', 'rejected')], ME)).toBe(true);
    });

    it('is false when other required reviewers are pending', () => {
      const request = required([{ id: 'bob', vote: 0, isRequired: true }]);
      expect(approvalCompletes(request, [evaluation('Required reviewers', 'rejected')], ME)).toBe(false);
    });

    it('is false when a required group has not voted', () => {
      const request = required([{ id: 'team', vote: 0, isRequired: true, isContainer: true }]);
      expect(approvalCompletes(request, [evaluation('Required reviewers', 'rejected')], ME)).toBe(false);
    });

    it('is false when I am not the required one', () => {
      const request = pr({
        reviewers: [
          { id: ME, displayName: 'Me', vote: 0 },
          { id: 'bob', displayName: 'Bob', vote: 0, isRequired: true },
        ],
      });
      expect(approvalCompletes(request, [evaluation('Required reviewers', 'rejected')], ME)).toBe(false);
    });

    it('needs both reviewer policies to be fixed by my approval', () => {
      const request = required([{ id: 'bob', vote: 10 }]);
      const policies = [evaluation('Required reviewers', 'rejected'), minReviewers('running')];
      expect(approvalCompletes(request, policies, ME)).toBe(true);
      const notEnough = required([]);
      expect(approvalCompletes(notEnough, policies, ME)).toBe(false);
    });
  });
});

describe('myCommentsLine', () => {
  it('is empty without open comments', () => {
    expect(myCommentsLine({ open: 0, answered: false })).toBeUndefined();
  });

  it('counts them, in singular and plural', () => {
    expect(myCommentsLine({ open: 1, answered: false })).toBe('1 of your comments is still open');
    expect(myCommentsLine({ open: 2, answered: false })).toBe('2 of your comments are still open');
  });

  it('adds that there are replies', () => {
    expect(myCommentsLine({ open: 2, answered: true })).toBe(
      '2 of your comments are still open · replies since your last comment'
    );
  });
});

describe('countChangedFiles', () => {
  it('counts what came when there is no other page', () => {
    expect(countChangedFiles(9, false)).toEqual({ count: 9, capped: false });
    expect(countChangedFiles(0, false)).toEqual({ count: 0, capped: false });
  });

  it('caps at the limit: one more than it, or another page, means there are more', () => {
    expect(countChangedFiles(101, false)).toEqual({ count: 100, capped: true });
    expect(countChangedFiles(100, true)).toEqual({ count: 100, capped: true });
    expect(countChangedFiles(100, false)).toEqual({ count: 100, capped: false });
    expect(countChangedFiles(5, true, 3)).toEqual({ count: 3, capped: true });
  });
});

describe('describeFilesChanged', () => {
  it('counts the files', () => {
    expect(describeFilesChanged({ count: 12, capped: false })).toBe('12 files changed');
    expect(describeFilesChanged({ count: 1, capped: false })).toBe('1 file changed');
  });

  it('shows the cap', () => {
    expect(describeFilesChanged({ count: 100, capped: true })).toBe('100+ files changed');
  });
});

describe('describeTeamRules', () => {
  it('is empty when no rule is broken', () => {
    expect(describeTeamRules([])).toBeUndefined();
  });

  it('counts the rules', () => {
    expect(describeTeamRules(['a'])).toBe('1 team rule not met — remind the author');
    expect(describeTeamRules(['a', 'b'])).toBe('2 team rules not met — remind the author');
  });
});

describe('toReviewDetails', () => {
  const extras = (overrides: Partial<PullRequestExtras> = {}): PullRequestExtras => ({ runs: [], ...overrides });
  const details = (request: ReviewerPullRequest, more: Partial<PullRequestExtras> = {}, options = OPTIONS) =>
    toReviewDetails({ pr: request, myId: ME, extras: extras(more) }, options);

  it('labels my chip and puts it first', () => {
    const { reviewers } = details(pr());
    expect(reviewers[0]).toMatchObject({ name: 'Me', isMe: true });
    expect(reviewers.filter(({ isMe }) => isMe)).toHaveLength(1);
    expect(reviewers.map(({ name }) => name)).toEqual(['Me', 'Bob', '[UI]\\UI Team']);
  });

  it('gives the status and the target branch only when it is not the base branch', () => {
    expect(details(pr())).toMatchObject({ status: 'Approved', target: undefined, conflicts: false });
    expect(details(pr({ targetRefName: 'refs/heads/release/x', mergeStatus: 'conflicts' }))).toMatchObject({
      status: 'Conflicts',
      target: 'release/x',
      conflicts: true,
    });
  });

  it('warns that my approval may merge the PR when auto-complete is set', () => {
    const request = pr({ autoCompleteSetBy: { id: 'ana' }, completionOptions: { deleteSourceBranch: true } });
    expect(details(request, { workItems: [{ id: 1, type: 'Product Backlog Item' }] })).toMatchObject({
      autoComplete: true,
      autoCompleteNote: { text: AUTO_COMPLETE_REVIEWER_NOTE, severity: 'warning' },
    });
    expect(details(pr()).autoCompleteNote).toBeUndefined();
  });

  it('shows the error when auto-complete would complete a linked Bug', () => {
    const request = pr({
      autoCompleteSetBy: { id: 'ana' },
      completionOptions: { deleteSourceBranch: true, transitionWorkItems: true },
    });
    expect(details(request, { workItems: [{ id: 1, type: 'Bug' }] }).autoCompleteNote).toEqual({
      text: BUG_AUTOCOMPLETE_WARNING,
      severity: 'error',
    });
    // Without transitioning the work items, or without the Bug, the note is the usual one
    const keepsItems = pr({ autoCompleteSetBy: { id: 'ana' }, completionOptions: { transitionWorkItems: false } });
    expect(details(keepsItems, { workItems: [{ id: 1, type: 'Bug' }] }).autoCompleteNote?.severity).toBe('warning');
  });

  it('counts the team rules, never the auto-complete warnings', () => {
    const request = pr({
      title: 'no format',
      description: '',
      // Auto-complete would not delete the branch: a warning for the author, not a team rule here
      autoCompleteSetBy: { id: 'ana' },
      completionOptions: { deleteSourceBranch: false },
      reviewers: [
        { id: 'bob', displayName: 'Bob', vote: 0, isRequired: true },
        { id: ME, displayName: 'Me', vote: 0 },
      ],
    });
    const { teamRules } = details(request, { workItems: [] }, { ...OPTIONS, minimumRequiredReviewers: 2 });
    expect(teamRules).toHaveLength(4);
    expect(teamRules.some((rule) => rule.startsWith('Auto-complete'))).toBe(false);
    expect(details(pr(), { workItems: [{ id: 1, type: 'Bug' }] }).teamRules).toEqual([]);
  });

  it('describes my open comments from the threads', () => {
    const text = (id: number, author: string): NonNullable<ThreadResponse['comments']>[number] => ({
      id,
      author: { id: author, displayName: author },
      commentType: 'text',
      content: 'x',
    });
    const threads: ThreadResponse[] = [
      { id: 1, status: 'active', publishedDate: '2026-10-06T09:00:00Z', comments: [text(1, ME), text(2, 'ana')] },
      { id: 2, status: 'pending', publishedDate: '2026-10-06T09:00:00Z', comments: [text(1, ME)] },
      { id: 3, status: 'fixed', publishedDate: '2026-10-06T09:00:00Z', comments: [text(1, ME)] },
    ];
    expect(details(pr(), { threads }).myComments).toBe(
      '2 of your comments are still open · replies since your last comment'
    );
    expect(details(pr(), { threads: [] }).myComments).toBeUndefined();
    expect(details(pr()).myComments).toBeUndefined();
  });

  it('passes the unresolved comments, the runs and the files changed', () => {
    const result = toReviewDetails(
      { pr: pr(), myId: ME, extras: extras({ unresolvedThreads: 3 }), filesChanged: { count: 100, capped: true } },
      OPTIONS
    );
    expect(result).toMatchObject({ unresolved: 3, filesChangedText: '100+ files changed' });
  });
});
