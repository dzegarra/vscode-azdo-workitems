import { describe, expect, it } from 'vitest';
import {
  AuthoredPullRequest,
  AuthoredPullRequestData,
  CompletedPeriod,
  completedWindowMs,
  countUnresolvedThreads,
  feedbackReviewers,
  feedbackWarnings,
  formatAge,
  isCompletedWithin,
  isReadyToMerge,
  nextTone,
  pendingRequiredReviewers,
  plainDescription,
  nextStep,
  phaseTotals,
  PolicyEvaluation,
  PullRequestExtras,
  PullRequestWarning,
  pullRequestWarnings,
  retargetWarnings,
  toMyPullRequestModels,
  toPolicyEvaluation,
  voteKind,
} from './myPullRequests';
import type { ThreadResponse } from './reviewThreads';

const ME = 'me';
const NO_RULES = { minimumRequiredReviewers: 0 };
const NOW = new Date('2026-10-07T12:00:00Z');

function pr(overrides: Partial<AuthoredPullRequest> = {}): AuthoredPullRequest {
  return {
    pullRequestId: 1,
    title: '[1] Feature: Title',
    description: 'Changes of the feature',
    status: 'active',
    isDraft: false,
    mergeStatus: 'succeeded',
    creationDate: '2026-10-06T10:00:00Z',
    createdBy: { id: ME },
    targetRefName: 'refs/heads/develop',
    sourceRefName: 'refs/heads/feature/x',
    repository: { id: 'repo', name: 'User_Interface', project: { id: 'project' } },
    webUrl: 'https://example/pr/1',
    reviewers: [],
    ...overrides,
  };
}

const evaluation = (type: string, status: string, isBlocking = true, extra: Partial<PolicyEvaluation> = {}) => ({
  type,
  status,
  isBlocking,
  ...extra,
});

/** Policies of the PR 13713 */
const POLICIES_13713: PolicyEvaluation[] = [
  evaluation('Minimum number of reviewers', 'queued', true, { minimumApproverCount: 2, creatorVoteCounts: false }),
  evaluation('Work item linking', 'approved'),
  evaluation('Comment requirements', 'approved'),
  evaluation('Require a merge strategy', 'rejected'),
  evaluation('Build', 'approved', true, { displayName: 'Pull Request Build' }),
  evaluation('Required reviewers', 'queued', false),
  evaluation('Status', 'approved', false),
];

/** A PR somebody (not the author) approved: without any approval a PR is never ready (Rule PR-READY-7) */
const approvedPr = (overrides: Partial<AuthoredPullRequest> = {}) =>
  pr({ reviewers: [{ id: 'approver', displayName: 'Approver', vote: 10 }], ...overrides });

const extras = (overrides: Partial<PullRequestExtras> = {}): PullRequestExtras => ({ runs: [], ...overrides });

describe('nextStep', () => {
  it('lists what blocks the PR 13713', () => {
    const pull = pr({
      reviewers: [
        { id: 'a', displayName: 'A', vote: 10, isRequired: true },
        { id: 'team', displayName: 'Team', vote: 10, isContainer: true },
        { id: ME, displayName: 'Me', vote: 10 },
      ],
    });
    // One approval of a person: the group and the author do not count
    expect(nextStep(pull, extras({ evaluations: POLICIES_13713 }))).toBe(
      '1 more approval needed · Choose an allowed merge strategy'
    );
  });

  it('counts the author when the policy allows it', () => {
    const pull = pr({ reviewers: [{ id: ME, displayName: 'Me', vote: 5 }] });
    const policies = [
      evaluation('Minimum number of reviewers', 'queued', true, { minimumApproverCount: 2, creatorVoteCounts: true }),
    ];
    expect(nextStep(pull, extras({ evaluations: policies }))).toBe('1 more approval needed');
  });

  it('asks for the approvals still missing', () => {
    const policies = [evaluation('Minimum number of reviewers', 'queued', true, { minimumApproverCount: 2 })];
    expect(nextStep(pr(), extras({ evaluations: policies }))).toBe('2 more approvals needed');
  });

  it('puts the draft and the conflicts first', () => {
    const pull = pr({ isDraft: true, mergeStatus: 'conflicts' });
    expect(nextStep(pull, extras({ evaluations: [evaluation('Work item linking', 'rejected')] }))).toBe(
      'Publish the draft · Resolve the conflicts · Link a work item'
    );
  });

  it.each([
    ['running', 'Pull Request Build running'],
    ['queued', 'Pull Request Build queued'],
    ['rejected', 'Pull Request Build failed'],
    ['broken', 'Pull Request Build failed'],
  ])('describes a build that is %s', (status, expected) => {
    const policies = [evaluation('Build', status, true, { displayName: 'Pull Request Build' })];
    expect(nextStep(pr(), extras({ evaluations: policies }))).toBe(expected);
  });

  it('counts the comments to resolve', () => {
    const policies = [evaluation('Comment requirements', 'rejected')];
    expect(nextStep(pr(), extras({ evaluations: policies, unresolvedThreads: 2 }))).toBe('Resolve 2 comments');
    expect(nextStep(pr(), extras({ evaluations: policies, unresolvedThreads: 1 }))).toBe('Resolve 1 comment');
    expect(nextStep(pr(), extras({ evaluations: policies }))).toBe('Resolve the comments');
  });

  it('asks for the approval of a required reviewer only when the policy blocks', () => {
    expect(nextStep(pr(), extras({ evaluations: [evaluation('Required reviewers', 'queued')] }))).toBe(
      'Approval of a required reviewer missing'
    );
  });

  it('names the other blocking policies with their status', () => {
    expect(nextStep(pr(), extras({ evaluations: [evaluation('Status', 'rejected')] }))).toBe('Status: rejected');
    // A merge strategy that is not rejected yet
    expect(nextStep(pr(), extras({ evaluations: [evaluation('Require a merge strategy', 'queued')] }))).toBe(
      'Require a merge strategy: queued'
    );
  });

  it('ignores the policies that are optional, approved or not applicable', () => {
    const policies = [
      evaluation('Status', 'rejected', false),
      evaluation('Build', 'notApplicable'),
      evaluation('Work item linking', 'approved'),
    ];
    expect(nextStep(approvedPr(), extras({ evaluations: policies }))).toBe('Ready to merge');
  });

  it('is ready, or completes by itself, when nothing blocks', () => {
    expect(nextStep(approvedPr(), extras({ evaluations: [] }))).toBe('Ready to merge');
    expect(nextStep(approvedPr({ autoCompleteSetBy: { id: ME } }), extras({ evaluations: [] }))).toBe(
      'Will complete automatically'
    );
  });

  it('knows less when the policies could not be fetched', () => {
    expect(nextStep(pr(), extras())).toBeUndefined();
    expect(nextStep(pr({ isDraft: true }), extras())).toBe('Publish the draft');
  });
});

describe('pullRequestWarnings', () => {
  const autoComplete = { autoCompleteSetBy: { id: ME } };
  const bug = { workItems: [{ id: 1, type: 'Bug' }] };
  const backlogItem = { workItems: [{ id: 2, type: 'Product Backlog Item' }] };

  it('warns when auto-complete will not delete the branch', () => {
    const warnings = pullRequestWarnings(
      pr({ ...autoComplete, completionOptions: { mergeStrategy: 'squash' } }),
      backlogItem,
      NO_RULES
    );
    expect(warnings).toEqual([
      {
        text: 'Auto-complete will not delete the branch (team rule: delete branches after merging)',
        severity: 'warning',
      },
    ]);
  });

  it('does not warn when the branch is deleted', () => {
    expect(
      pullRequestWarnings(pr({ ...autoComplete, completionOptions: { deleteSourceBranch: true } }), bug, NO_RULES)
    ).toEqual([]);
  });

  it('warns when auto-complete will complete a linked Bug', () => {
    const pull = pr({ ...autoComplete, completionOptions: { deleteSourceBranch: true, transitionWorkItems: true } });
    expect(pullRequestWarnings(pull, bug, NO_RULES)).toEqual([
      {
        text: "Auto-complete shouldn't complete the linked Bug: Only testers have that prerogative.",
        severity: 'error',
      },
    ]);
    // The most serious one first
    const both = pr({ ...autoComplete, completionOptions: { transitionWorkItems: true } });
    expect(pullRequestWarnings(both, bug, NO_RULES).map((warning) => warning.severity)).toEqual(['error', 'warning']);
  });

  it('does not warn about work items that are not Bugs, or when they cannot be told', () => {
    const pull = pr({ ...autoComplete, completionOptions: { deleteSourceBranch: true, transitionWorkItems: true } });
    expect(pullRequestWarnings(pull, backlogItem, NO_RULES)).toEqual([]);
    expect(pullRequestWarnings(pull, {}, NO_RULES)).toEqual([]);
  });

  it('does not warn about a Bug when work items are not transitioned', () => {
    const pull = pr({ ...autoComplete, completionOptions: { deleteSourceBranch: true, transitionWorkItems: false } });
    expect(pullRequestWarnings(pull, bug, NO_RULES)).toEqual([]);
  });

  it('does not warn without auto-complete', () => {
    expect(pullRequestWarnings(pr({ completionOptions: { transitionWorkItems: true } }), bug, NO_RULES)).toEqual([]);
  });
});

describe('pullRequestWarnings: team rules of the published PRs', () => {
  const required = (id: string, extra: object = {}) => ({ id, displayName: id, vote: 0, isRequired: true, ...extra });
  const backlog = { workItems: [{ id: 2, type: 'Product Backlog Item' }] };
  const good = pr({ reviewers: [required('a'), required('b')] });
  const texts = (pull: AuthoredPullRequest, e: Pick<PullRequestExtras, 'workItems'>, min = 2) =>
    pullRequestWarnings(pull, e, { minimumRequiredReviewers: min }).map((warning) => warning.text);

  it('does not warn when every rule is followed', () => {
    expect(texts(good, backlog)).toEqual([]);
  });

  it('warns with every rule broken, as warnings, after the auto-complete ones', () => {
    const bad = pr({ title: 'Fix stuff', description: ' ', autoCompleteSetBy: { id: ME } });
    const warnings = pullRequestWarnings(bad, { workItems: [{ id: 3, type: 'Task' }] });
    expect(warnings.map((warning) => warning.text)).toEqual([
      'Auto-complete will not delete the branch (team rule: delete branches after merging)',
      'The title does not follow "[<IDs>] <Feature Name>: <description>"',
      'Add a short description of the changes',
      'Add 2 more required reviewers (team rule: at least 2)',
      'Link the Backlog Item or Bug of this PR',
    ]);
    expect(new Set(warnings.map((warning) => warning.severity))).toEqual(new Set(['warning']));
  });

  it('never warns about drafts, completed or abandoned PRs', () => {
    const bad = { title: 'Fix', description: '' };
    expect(texts(pr({ ...bad, isDraft: true }), { workItems: [] })).toEqual([]);
    expect(texts(pr({ ...bad, status: 'completed' }), { workItems: [] })).toEqual([]);
    expect(texts(pr({ ...bad, status: 'abandoned' }), { workItems: [] })).toEqual([]);
  });

  it('requires a description of at least 10 characters of text', () => {
    const warn = (description?: string) => texts(pr({ ...good, description }), backlog);
    expect(warn(undefined)).toEqual(['Add a short description of the changes']);
    expect(warn('')).toEqual(['Add a short description of the changes']);
    expect(warn('## \n\n- \n')).toEqual(['Add a short description of the changes']);
    expect(warn('Fixes it')).toEqual(['Add a short description of the changes']);
    expect(warn('[a](https://example.com/very/long/link)')).toEqual(['Add a short description of the changes']);
    expect(warn('Fixes the network restart')).toEqual([]);
    expect(warn('- Fixes the thing')).toEqual([]);
  });

  it('counts only the required people: not groups, the author nor those who declined', () => {
    const missing = (reviewers: AuthoredPullRequest['reviewers'], min = 2) =>
      texts(pr({ reviewers }), backlog, min).filter((text) => text.startsWith('Add '));
    expect(missing([required('a')])).toEqual(['Add 1 more required reviewer (team rule: at least 2)']);
    expect(missing([required('a'), { id: 'b', displayName: 'b', vote: 0 }])).toHaveLength(1);
    expect(missing([required('a'), required('team', { isContainer: true })])).toHaveLength(1);
    expect(missing([required('a'), required(ME)])).toHaveLength(1);
    expect(missing([required('a'), required('b', { hasDeclined: true })])).toHaveLength(1);
    expect(missing([required('a'), required('b'), required('c')])).toEqual([]);
    expect(missing([required('a')], 3)).toEqual(['Add 2 more required reviewers (team rule: at least 3)']);
  });

  it('is disabled by a minimum of 0', () => {
    expect(texts(pr({ reviewers: [] }), backlog, 0)).toEqual([]);
  });

  it('wants a Backlog Item, User Story or Bug linked: a Task alone does not count', () => {
    const link = (...types: string[]) => texts(good, { workItems: types.map((type, id) => ({ id, type })) });
    const warning = ['Link the Backlog Item or Bug of this PR'];
    expect(link()).toEqual(warning);
    expect(link('Task')).toEqual(warning);
    expect(link('Task', 'Bug')).toEqual([]);
    expect(link('User Story')).toEqual([]);
    expect(link('Product Backlog Item', 'Task')).toEqual([]);
  });

  it('does not warn about the links when the work items are unknown', () => {
    expect(texts(good, {})).toEqual([]);
  });
});

/** The PR 13847: the target is a feature branch, so no policies; two required people and a required group at 0 */
const PR_13847 = () =>
  pr({
    reviewers: [
      { id: 'kamil', displayName: 'Kamil Borecki EXT', vote: 0, isRequired: true },
      { id: 'krzysztof', displayName: 'Krzysztof Siwak EXT', vote: 0, isRequired: true },
      { id: 'team', displayName: 'UI Development Team', vote: 0, isRequired: true, isContainer: true },
      { id: 'optional', displayName: 'Optional', vote: 0 },
    ],
  });

describe('required reviewers (Rules PR-REVIEWERS-1..2, PR-READY-6..7, PR-NEXT-5)', () => {
  const none = extras({ evaluations: [] });

  it('lists the pending required people; a required group only while nobody approved', () => {
    expect(pendingRequiredReviewers(PR_13847())).toEqual(['Kamil Borecki EXT', 'Krzysztof Siwak EXT']);
    const groupOnly = pr({
      reviewers: [{ id: 'team', displayName: 'Team', vote: 0, isRequired: true, isContainer: true }],
    });
    expect(pendingRequiredReviewers(groupOnly)).toEqual(['Team']);
    const approvedMember = pr({
      reviewers: [...groupOnly.reviewers, { id: 'member', displayName: 'Member', vote: 10 }],
    });
    expect(pendingRequiredReviewers(approvedMember)).toEqual([]);
  });

  it('does not count the author, the declined, the approved nor those who sent the PR back', () => {
    const reviewers = [
      { id: ME, displayName: 'Me', vote: 0, isRequired: true },
      { id: 'd', displayName: 'Declined', vote: 0, isRequired: true, hasDeclined: true },
      { id: 'a', displayName: 'Approved', vote: 5, isRequired: true },
      { id: 'w', displayName: 'Waiting', vote: -5, isRequired: true },
      { id: 'r', displayName: 'Rejected', vote: -10, isRequired: true },
    ];
    expect(pendingRequiredReviewers(pr({ reviewers }))).toEqual([]);
  });

  it('keeps the PR 13847 (no policies, required reviewers at 0) from being ready', () => {
    expect(nextStep(PR_13847(), none)).toBe('Approval of Kamil Borecki EXT, Krzysztof Siwak EXT missing');
    expect(isReadyToMerge(PR_13847(), none, [])).toBe(false);
  });

  it('is ready once the required reviewers approved, with no policies', () => {
    const reviewers = [
      { id: 'kamil', displayName: 'Kamil', vote: 10, isRequired: true },
      { id: 'krzysztof', displayName: 'Krzysztof', vote: 5, isRequired: true },
    ];
    expect(nextStep(pr({ reviewers }), none)).toBe('Ready to merge');
    expect(isReadyToMerge(pr({ reviewers }), none, [])).toBe(true);
  });

  it('says "No approvals yet" when nobody approved and no policy asks for reviewers', () => {
    expect(nextStep(pr(), none)).toBe('No approvals yet');
    expect(isReadyToMerge(pr(), none, [])).toBe(false);
    // The author's own vote and a group do not count
    const reviewers = [
      { id: ME, displayName: 'Me', vote: 10 },
      { id: 'team', displayName: 'Team', vote: 10, isContainer: true },
    ];
    expect(nextStep(pr({ reviewers }), none)).toBe('No approvals yet');
    // Only when nothing else is missing
    expect(nextStep(pr(), extras({ evaluations: [evaluation('Build', 'running', true, { displayName: 'CI' })] }))).toBe(
      'CI running'
    );
  });

  it('does not repeat the approval step when a reviewer policy already says it', () => {
    const policies = [evaluation('Required reviewers', 'queued')];
    expect(nextStep(PR_13847(), extras({ evaluations: policies }))).toBe('Approval of a required reviewer missing');
    const minimum = [evaluation('Minimum number of reviewers', 'queued', true, { minimumApproverCount: 2 })];
    expect(nextStep(PR_13847(), extras({ evaluations: minimum }))).toBe('2 more approvals needed');
    // An approved or optional reviewer policy does not say it
    const optional = [evaluation('Required reviewers', 'queued', false)];
    expect(nextStep(PR_13847(), extras({ evaluations: optional }))).toBe(
      'Approval of Kamil Borecki EXT, Krzysztof Siwak EXT missing'
    );
  });

  it('names the waiting reviewers once (feedback), not as pending approval', () => {
    const reviewers = [{ id: 'w', displayName: 'Waiting', vote: -5, isRequired: true }];
    expect(nextStep(pr({ reviewers }), none)).toBe('Address the feedback of Waiting');
  });
});

describe('Next agrees with Ready (Rules PR-NEXT-6, PR-TONE-2)', () => {
  const warning: PullRequestWarning = { text: 'x', severity: 'warning' };
  const error: PullRequestWarning = { text: 'x', severity: 'error' };

  it('asks to fix the warnings instead of saying "Ready to merge"', () => {
    const data = extras({ evaluations: [] });
    expect(nextStep(approvedPr(), data, [warning])).toBe('Fix the warnings');
    expect(nextTone('Fix the warnings', [warning])).toBe('pending');
    expect(nextTone('Fix the warnings', [error])).toBe('danger');
    expect(nextStep(approvedPr({ autoCompleteSetBy: { id: ME } }), data, [warning])).toBe('Fix the warnings');
    expect(nextStep(approvedPr(), data, [])).toBe('Ready to merge');
  });

  it('never has the ready tone and no ready flag disagree on the card model', () => {
    const options = { now: NOW, baseBranch: 'develop', showDrafts: true, minimumRequiredReviewers: 0 };
    const card = (pull: AuthoredPullRequest) =>
      toMyPullRequestModels([{ pr: pull, extras: extras({ evaluations: [] }) }], options).items[0];
    // Auto-complete that does not delete the branch: a warning, nothing else missing
    const warned = card(
      approvedPr({ autoCompleteSetBy: { id: ME }, completionOptions: { deleteSourceBranch: false } })
    );
    expect(warned).toMatchObject({ readyToMerge: false, next: 'Fix the warnings', nextTone: 'pending' });
    expect(card(approvedPr())).toMatchObject({ readyToMerge: true, next: 'Ready to merge', nextTone: 'ready' });
  });
});

describe('isReadyToMerge', () => {
  const approved = POLICIES_13713.map((p) => ({ ...p, status: 'approved' }));
  const waitingApprovals = [
    evaluation('Minimum number of reviewers', 'queued', true, { minimumApproverCount: 2 }),
    evaluation('Work item linking', 'approved'),
    evaluation('Build', 'approved', true, { displayName: 'Pull Request Build' }),
  ];
  const ready = (
    pull: AuthoredPullRequest,
    evaluations: PolicyEvaluation[] | undefined,
    warnings: PullRequestWarning[] = []
  ) => isReadyToMerge(pull, { evaluations }, warnings);

  it('is true when everything is approved and nothing warns', () => {
    expect(ready(pr(), approved)).toBe(true);
    expect(ready(pr({ autoCompleteSetBy: { id: ME } }), approved)).toBe(true);
    expect(ready(approvedPr(), [])).toBe(true);
  });

  it('ignores the optional policies that are not satisfied', () => {
    expect(ready(pr(), [...approved, evaluation('Required reviewers', 'queued', false)])).toBe(true);
  });

  it('is false while an approval or another blocking policy is missing', () => {
    expect(ready(pr(), waitingApprovals)).toBe(false);
    expect(ready(pr(), [evaluation('Build', 'running', true, { displayName: 'CI' })])).toBe(false);
    expect(ready(pr(), POLICIES_13713)).toBe(false);
  });

  it('is false with any warning, conflicts, draft, completed or unknown policies', () => {
    expect(ready(pr(), approved, [{ text: 'x', severity: 'warning' }])).toBe(false);
    expect(ready(pr(), approved, [{ text: 'x', severity: 'error' }])).toBe(false);
    expect(ready(pr({ mergeStatus: 'conflicts' }), approved)).toBe(false);
    expect(ready(pr({ isDraft: true }), approved)).toBe(false);
    expect(ready(pr({ status: 'completed' }), approved)).toBe(false);
    expect(ready(pr(), undefined)).toBe(false);
  });

  it('is set on the card model together with the tone of the next line', () => {
    const options = { now: NOW, baseBranch: 'develop', showDrafts: true, minimumRequiredReviewers: 2 };
    const reviewers = [
      { id: 'a', displayName: 'A', vote: 10, isRequired: true },
      { id: 'b', displayName: 'B', vote: 10, isRequired: true },
    ];
    const card = (overrides: Partial<AuthoredPullRequest>, evaluations: PolicyEvaluation[], workItems = ['Bug']) =>
      toMyPullRequestModels(
        [
          {
            pr: pr({ reviewers, ...overrides }),
            extras: extras({ evaluations, workItems: workItems.map((type, id) => ({ id, type })) }),
          },
        ],
        options
      ).items[0];
    expect(card({}, approved)).toMatchObject({
      readyToMerge: true,
      warnings: [],
      next: 'Ready to merge',
      nextTone: 'ready',
    });
    expect(card({}, waitingApprovals)).toMatchObject({ readyToMerge: false, nextTone: 'pending' });
    expect(card({ title: 'Fix' }, approved).readyToMerge).toBe(false);
    expect(card({ status: 'completed', closedDate: '2026-10-07T10:00:00Z' }, approved).readyToMerge).toBe(false);
  });

  it('colours the next line as danger when a warning is an error', () => {
    expect(nextTone('Will complete automatically', [{ text: 'x', severity: 'error' }])).toBe('danger');
    expect(nextTone('Ready to merge', [{ text: 'x', severity: 'error' }])).toBe('danger');
    expect(nextTone('Will complete automatically', [{ text: 'x', severity: 'warning' }])).toBe('pending');
    expect(nextTone('Fix the warnings', [{ text: 'x', severity: 'warning' }])).toBe('pending');
    expect(nextTone('Fix the warnings', [{ text: 'x', severity: 'error' }])).toBe('danger');
    expect(nextTone('Ready to merge', [])).toBe('ready');
    expect(nextTone('1 more approval needed', [])).toBe('pending');
    expect(nextTone(undefined, [])).toBe('pending');
  });
});

describe('plainDescription', () => {
  it('drops the markdown syntax and the whitespace', () => {
    expect(plainDescription('## Title\n- [link](http://x.y) *bold*')).toBe('Titlelinkbold');
  });
});

describe('toMyPullRequestModels', () => {
  const data = (
    overrides: Partial<AuthoredPullRequest>,
    e: Partial<PullRequestExtras> = {}
  ): AuthoredPullRequestData => ({
    pr: pr(overrides),
    extras: extras(e),
  });
  const options = { now: NOW, baseBranch: 'develop', showDrafts: true, ...NO_RULES };

  it('shows the target only when it is not the base branch', () => {
    const { items } = toMyPullRequestModels(
      [data({ pullRequestId: 1 }), data({ pullRequestId: 2, targetRefName: 'refs/heads/release/x' })],
      options
    );
    expect(items.map((item) => [item.id, item.target])).toEqual([
      [1, undefined],
      [2, 'release/x'],
    ]);
    const other = toMyPullRequestModels([data({ targetRefName: 'refs/heads/develop' })], {
      ...options,
      baseBranch: 'main',
    });
    expect(other.items[0].target).toBe('develop');
  });

  it('sorts the active PRs (oldest first), the drafts, then the completed ones (latest first)', () => {
    const { items } = toMyPullRequestModels(
      [
        data({ pullRequestId: 1, status: 'completed', closedDate: '2026-10-07T01:00:00Z' }),
        data({ pullRequestId: 2, isDraft: true, creationDate: '2026-10-01T00:00:00Z' }),
        data({ pullRequestId: 3, creationDate: '2026-10-05T00:00:00Z' }),
        data({ pullRequestId: 4, status: 'completed', closedDate: '2026-10-07T09:00:00Z' }),
        data({ pullRequestId: 5, creationDate: '2026-10-03T00:00:00Z' }),
      ],
      options
    );
    expect(items.map((item) => item.id)).toEqual([5, 3, 2, 4, 1]);
  });

  it('sorts the active PRs by publication, not by creation', () => {
    const published = (at: string): ThreadResponse[] => [
      {
        id: 1,
        publishedDate: at,
        properties: { CodeReviewThreadType: { $value: 'IsDraftUpdate' }, CodeReviewIsDraftNowSet: { $value: '0' } },
      },
    ];
    const { items } = toMyPullRequestModels(
      [
        // Created first, published last
        data(
          { pullRequestId: 1, creationDate: '2026-10-01T00:00:00Z' },
          { threads: published('2026-10-06T00:00:00Z') }
        ),
        data({ pullRequestId: 2, creationDate: '2026-10-03T00:00:00Z' }, { threads: [] }),
        data(
          { pullRequestId: 3, creationDate: '2026-10-02T00:00:00Z' },
          { threads: published('2026-10-04T00:00:00Z') }
        ),
        // Threads not read: the creation counts
        data({ pullRequestId: 4, creationDate: '2026-10-05T00:00:00Z' }),
      ],
      options
    );
    expect(items.map((item) => item.id)).toEqual([2, 3, 4, 1]);
  });

  it('shows the time since the publication, since the creation when it was never a draft or for the drafts', () => {
    const published: ThreadResponse = {
      id: 1,
      publishedDate: '2026-10-07T09:00:00Z',
      properties: { CodeReviewThreadType: { $value: 'IsDraftUpdate' }, CodeReviewIsDraftNowSet: { $value: '0' } },
    };
    const time = (pr: Partial<AuthoredPullRequest>, threads?: ThreadResponse[]) =>
      toMyPullRequestModels([data({ creationDate: '2026-10-01T12:00:00Z', ...pr }, { threads })], options).items[0]
        .time;
    expect(time({}, [published])).toBe('3 h');
    // Published PRs count working days only: the weekend of 3-4 October is left out
    expect(time({})).toBe('4 d 0 h');
    expect(time({}, [])).toBe('4 d 0 h');
    // Drafts: calendar time
    expect(time({ isDraft: true }, [])).toBe('6 d 0 h');
    // Back to draft after being published: still the creation
    expect(time({ isDraft: true }, [published])).toBe('6 d 0 h');
  });

  it('gives the timeline of the active and the recently completed PRs, with the injected date format', () => {
    const { items } = toMyPullRequestModels(
      [
        data({ pullRequestId: 1, createdBy: { id: ME, displayName: 'Me' } }),
        data({ pullRequestId: 2, status: 'completed', closedDate: '2026-10-07T01:00:00Z' }),
      ],
      { ...options, formatDate: (iso) => `<${iso}>` }
    );
    expect(items[0].timeline).toEqual({
      events: [{ when: '<2026-10-06T10:00:00Z>', text: 'Me created the pull request' }],
      earlier: 0,
    });
    // Latest first: the completion opens the list
    expect(items[1].timeline.events[0]).toEqual({ when: '<2026-10-07T01:00:00Z>', text: 'Pull request completed' });
  });

  it('lists the PRs completed in the last 24 hours and never the abandoned ones', () => {
    const { items } = toMyPullRequestModels(
      [
        data({ pullRequestId: 1, status: 'completed', closedDate: '2026-10-06T12:30:00Z' }),
        data({ pullRequestId: 2, status: 'completed', closedDate: '2026-10-06T11:59:00Z' }),
        data({ pullRequestId: 3, status: 'completed' }),
        data({ pullRequestId: 4, status: 'abandoned', closedDate: '2026-10-07T11:00:00Z' }),
      ],
      options
    );
    expect(items.map((item) => item.id)).toEqual([1]);
    expect(items[0]).toMatchObject({
      isCompleted: true,
      status: 'Completed',
      time: 'completed 23 h ago · took 2 h',
    });
    expect(items[0].next).toBeUndefined();
  });

  it('gives the completed PRs the time they took, their phases and a summary of the listed ones', () => {
    const { items, completedSummary } = toMyPullRequestModels(
      [
        data({ pullRequestId: 1, status: 'completed', closedDate: '2026-10-06T12:30:00Z' }),
        data({ pullRequestId: 2, status: 'completed', closedDate: '2026-10-06T13:30:00Z' }),
      ],
      { ...options, formatDate: (iso) => `<${iso}>` }
    );
    expect(items[0]).toMatchObject({ id: 2, took: '3 h', time: 'completed 22 h ago · took 3 h' });
    expect(items[1].phases?.map((phase) => [phase.kind, phase.label, phase.duration])).toEqual([
      ['review', 'In review', '2 h'],
      ['merge', 'Ready to merge', '0 min'],
    ]);
    expect(items[1].phases?.[0]).toMatchObject({ startText: '<2026-10-06T10:00:00.000Z>', share: 1 });
    expect(completedSummary).toBe('Completed PRs: median 3 h, mostly waiting for review');
    expect(
      toMyPullRequestModels(
        [data({ pullRequestId: 1, status: 'completed', closedDate: '2026-10-06T12:30:00Z' })],
        options
      ).completedSummary
    ).toBeUndefined();
  });

  it('hides the drafts and counts them', () => {
    const list = [
      data({ pullRequestId: 1 }),
      data({ pullRequestId: 2, isDraft: true }),
      data({ pullRequestId: 3, isDraft: true }),
    ];
    expect(toMyPullRequestModels(list, { ...options, showDrafts: false })).toMatchObject({
      items: [{ id: 1 }],
      hiddenDrafts: 2,
    });
    expect(toMyPullRequestModels(list, options)).toMatchObject({ hiddenDrafts: 0 });
    expect(toMyPullRequestModels(list, options).items).toHaveLength(3);
  });

  describe('completed period', () => {
    const HOUR = 3600 * 1000;
    const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();
    const list = [
      data({ pullRequestId: 1 }),
      data({ pullRequestId: 2, status: 'completed', closedDate: ago(2) }),
      data({ pullRequestId: 3, status: 'completed', closedDate: ago(24 * 3) }),
      data({ pullRequestId: 4, status: 'completed', closedDate: ago(24 * 20) }),
      data({ pullRequestId: 5, status: 'completed', closedDate: ago(24 * 60) }),
      data({ pullRequestId: 6, status: 'abandoned', closedDate: ago(1) }),
    ];
    const ids = (completedPeriod?: CompletedPeriod) =>
      toMyPullRequestModels(list, { ...options, completedPeriod }).items.map((item) => item.id);

    it('lists the completed PRs of the period, latest first', () => {
      expect(ids('day')).toEqual([1, 2]);
      expect(ids('week')).toEqual([1, 2, 3]);
      expect(ids('month')).toEqual([1, 2, 3, 4]);
      // The last 24 hours by default
      expect(ids()).toEqual([1, 2]);
    });

    it('does not list the completed PRs when hidden, and counts those of the last 24 hours', () => {
      const result = toMyPullRequestModels(list, { ...options, completedPeriod: 'hidden' });
      expect(result.items.map((item) => item.id)).toEqual([1]);
      expect(result.hiddenCompleted).toBe(1);
      expect(toMyPullRequestModels(list, { ...options, completedPeriod: 'week' }).hiddenCompleted).toBe(0);
    });

    it('includes the PR completed exactly at the limit and excludes the next millisecond', () => {
      const pr = (closedDate: string) => data({ pullRequestId: 9, status: 'completed', closedDate });
      const at = (closedDate: string) =>
        toMyPullRequestModels([pr(closedDate)], { ...options, completedPeriod: 'week' }).items.length;
      expect(at(ago(24 * 7))).toBe(1);
      expect(at(new Date(NOW.getTime() - 24 * 7 * HOUR - 1).toISOString())).toBe(0);
    });

    it('gives the window of each period', () => {
      expect([completedWindowMs('hidden'), completedWindowMs('day'), completedWindowMs('week')]).toEqual([
        0,
        24 * HOUR,
        7 * 24 * HOUR,
      ]);
      expect(completedWindowMs('month')).toBe(30 * 24 * HOUR);
    });

    it('matches nothing with a window of 0', () => {
      const completed = data({ pullRequestId: 1, status: 'completed', closedDate: NOW.toISOString() }).pr;
      expect(isCompletedWithin(completed, NOW, 0)).toBe(false);
      expect(isCompletedWithin(completed, NOW, HOUR)).toBe(true);
    });
  });

  it('builds the card of an active PR', () => {
    const { items } = toMyPullRequestModels(
      [
        data(
          {
            pullRequestId: 13713,
            mergeStatus: 'conflicts',
            autoCompleteSetBy: { id: ME },
            completionOptions: { deleteSourceBranch: false },
            reviewers: [
              { id: ME, displayName: 'Me', vote: 0 },
              { id: 'team', displayName: 'Team', vote: 0, isContainer: true },
              { id: 'b', displayName: 'B', vote: -5 },
              { id: 'a', displayName: 'A', vote: 10, isRequired: true },
            ],
          },
          {
            unresolvedThreads: 2,
            workItems: [{ id: 66280, type: 'Product Backlog Item' }],
            evaluations: POLICIES_13713,
          }
        ),
      ],
      options
    );
    expect(items[0]).toMatchObject({
      time: '1 d 2 h',
      workItems: [{ id: 66280, type: 'Product Backlog Item' }],
      status: 'Conflicts',
      conflicts: true,
      unresolved: 2,
      autoComplete: true,
      // B voted "Waiting for author": the author has to act
      warnings: [
        { text: 'B is waiting for you: address their comments, then ask for a new review', severity: 'warning' },
        {
          text: 'Auto-complete will not delete the branch (team rule: delete branches after merging)',
          severity: 'warning',
        },
      ],
      next: 'Resolve the conflicts · Address the feedback of B · 1 more approval needed · Choose an allowed merge strategy',
    });
    // The author is left out; required first, groups last
    expect(items[0].reviewers.map((r) => [r.name, r.vote])).toEqual([
      ['A', 'approved'],
      ['B', 'waiting'],
      ['Team', 'none'],
    ]);
  });
});

describe('helpers', () => {
  it('formats the age', () => {
    expect(formatAge(20 * 60 * 1000)).toBe('20 min');
    expect(formatAge(5 * 3600 * 1000)).toBe('5 h');
    expect(formatAge(26 * 3600 * 1000)).toBe('1 d 2 h');
    expect(formatAge(-5)).toBe('0 min');
  });

  it('interprets the votes', () => {
    expect([10, 5, 0, -5, -10].map((vote) => voteKind({ vote }))).toEqual([
      'approved',
      'suggestions',
      'none',
      'waiting',
      'rejected',
    ]);
    expect(voteKind({ vote: 0, hasDeclined: true })).toBe('declined');
  });

  it('counts the text threads still open', () => {
    const thread = (status: string | undefined, type = 'text', isDeleted = false) => ({
      id: 1,
      status,
      publishedDate: '',
      comments: [{ id: 1, author: { id: 'a', displayName: 'A' }, commentType: type, isDeleted }],
    });
    expect(
      countUnresolvedThreads([
        thread('active'),
        thread('pending'),
        thread('fixed'),
        thread('closed'),
        thread('active', 'system'),
        thread('active', 'text', true),
        thread(undefined),
        { id: 2, status: 'active', publishedDate: '' },
      ])
    ).toBe(2);
  });

  it('ignores disabled policies and flattens the others', () => {
    const raw = (configuration: object) => ({
      status: 'queued',
      configuration: { type: { displayName: 'Build' }, ...configuration },
    });
    expect(toPolicyEvaluation(raw({ isEnabled: false }))).toBeUndefined();
    expect(toPolicyEvaluation(raw({ isDeleted: true }))).toBeUndefined();
    expect(
      toPolicyEvaluation(raw({ isBlocking: true, isEnabled: true, settings: { displayName: 'Pull Request Build' } }))
    ).toMatchObject({ status: 'queued', isBlocking: true, type: 'Build', displayName: 'Pull Request Build' });
  });
});

describe('build notes warning', () => {
  const buildNotes = { enabled: true, path: 'build-notes/developer-notes.md', skipTag: 'no-build-notes' };
  const options = { minimumRequiredReviewers: 0, buildNotes };
  const extras = { buildNotes: { localRepo: true, fileExists: true, changed: false } };

  it('comes last, with the quick fix', () => {
    const warnings = pullRequestWarnings(pr({ description: '' }), extras, options);
    expect(warnings.at(-1)).toEqual({
      text: 'Explain the changes for testers in build-notes/developer-notes.md, or tag the PR "no-build-notes"',
      severity: 'warning',
      action: 'addSkipTag',
      actionLabel: 'Add tag no-build-notes',
    });
    expect(warnings).toHaveLength(2);
  });

  it('is not shown for drafts, tagged PRs, changed or unknown results', () => {
    expect(pullRequestWarnings(pr({ isDraft: true }), extras, options)).toEqual([]);
    expect(pullRequestWarnings(pr({ labels: [{ name: 'No-Build-Notes', active: true }] }), extras, options)).toEqual(
      []
    );
    expect(pullRequestWarnings(pr(), { buildNotes: { ...extras.buildNotes, changed: true } }, options)).toEqual([]);
    expect(pullRequestWarnings(pr(), { buildNotes: { ...extras.buildNotes, changed: undefined } }, options)).toEqual(
      []
    );
    expect(pullRequestWarnings(pr(), {}, options)).toEqual([]);
  });

  it('prevents ready to merge', () => {
    const warnings = pullRequestWarnings(pr(), extras, options);
    expect(isReadyToMerge(pr(), { evaluations: [] }, warnings)).toBe(false);
  });
});

describe('retargetWarnings', () => {
  const stacked = pr({
    pullRequestId: 13765,
    targetRefName: 'refs/heads/feature/base',
    sourceRefName: 'refs/heads/feature/task',
  });
  const basePr = pr({
    pullRequestId: 13770,
    status: 'completed',
    sourceRefName: 'refs/heads/feature/base',
    targetRefName: 'refs/heads/develop',
  });
  const context = { baseBranch: 'develop', pullRequests: [stacked, basePr] };

  it('warns and offers the retarget when the PR of the target branch was completed', () => {
    expect(retargetWarnings(stacked, context)).toEqual([
      {
        text: 'Its base PR 13770 was completed: retarget to develop',
        severity: 'warning',
        action: 'retarget',
        actionLabel: 'Retarget to develop',
      },
    ]);
  });

  it('does not warn while the PR of the target branch is active', () => {
    expect(retargetWarnings(stacked, { ...context, pullRequests: [stacked, { ...basePr, status: 'active' }] })).toEqual(
      []
    );
  });

  it('ignores a completed PR of another repository', () => {
    const other = { ...basePr, repository: { id: 'other', name: 'Other', project: { id: 'project' } } };
    expect(retargetWarnings(stacked, { ...context, pullRequests: [stacked, other] })).toEqual([]);
  });

  it('warns when the target branch no longer exists, only if the branches are known', () => {
    const alone = { baseBranch: 'develop', pullRequests: [stacked] };
    expect(retargetWarnings(stacked, alone)).toEqual([]);
    expect(retargetWarnings(stacked, { ...alone, remoteBranches: new Set(['develop']) })[0].text).toBe(
      'Its base branch feature/base no longer exists: retarget to develop'
    );
    expect(retargetWarnings(stacked, { ...alone, remoteBranches: new Set(['develop', 'feature/base']) })).toEqual([]);
  });

  it('never warns for a PR that targets the base branch or is not active', () => {
    expect(retargetWarnings(pr(), context)).toEqual([]);
    expect(retargetWarnings({ ...stacked, status: 'completed' }, context)).toEqual([]);
  });

  it('shows up in the model of the card and keeps it from being ready to merge', () => {
    const { items } = toMyPullRequestModels(
      [
        { pr: stacked, extras: { runs: [], evaluations: [] } },
        { pr: basePr, extras: { runs: [] } },
      ],
      { now: NOW, baseBranch: 'develop', showDrafts: true, minimumRequiredReviewers: 0 }
    );
    const card = items.find((item) => item.id === 13765);
    expect(card?.warnings.map((w) => w.action)).toEqual(['retarget']);
    expect(card?.readyToMerge).toBe(false);
  });
});

describe('phaseTotals', () => {
  it('sums the segments of each phase, in order of first appearance', () => {
    const hour = 3600 * 1000;
    const segment = (kind: 'author' | 'draft' | 'merge' | 'review', hours: number) => ({
      kind,
      start: '2026-10-08T09:00:00.000Z',
      end: '2026-10-08T10:00:00.000Z',
      ms: hours * hour,
      share: 0,
    });
    expect(
      phaseTotals([
        segment('draft', 2),
        segment('review', 3),
        segment('author', 19),
        segment('review', 2),
        segment('merge', 18),
      ])
    ).toEqual([
      { kind: 'draft', label: 'Draft', duration: '2 h' },
      { kind: 'review', label: 'In review', duration: '5 h' },
      { kind: 'author', label: 'Waiting for author', duration: '19 h' },
      { kind: 'merge', label: 'Ready to merge', duration: '18 h' },
    ]);
  });
});

describe('reviewer feedback (Waiting for author / Rejected)', () => {
  // PR 13765: a required reviewer waits for the author, the other approved; the team mirrors the waiting vote
  const sentBack = pr({
    reviewers: [
      { id: 'team', displayName: 'UI Development Team', vote: -5, isContainer: true },
      { id: 'p', displayName: 'Paulina Hudziak EXT', vote: -5, isRequired: true },
      { id: 's', displayName: 'Szymon Kwasek EXT', vote: 10, isRequired: true },
      { id: ME, displayName: 'Me', vote: 0 },
    ],
  });
  const allApproved = [evaluation('Minimum number of reviewers', 'approved')];

  it('names the people who sent the PR back, not the group that mirrors their vote', () => {
    expect(feedbackReviewers(sentBack)).toEqual({ waiting: ['Paulina Hudziak EXT'], rejected: [] });
  });

  it('names the group when no member of it is listed with that vote', () => {
    const groupOnly = pr({ reviewers: [{ id: 'team', displayName: 'Team', vote: -5, isContainer: true }] });
    expect(feedbackReviewers(groupOnly).waiting).toEqual(['Team']);
  });

  it('warns about "Waiting for author" and is an error for "Rejected"', () => {
    expect(feedbackWarnings(sentBack)).toEqual([
      expect.objectContaining({
        severity: 'warning',
        text: expect.stringContaining('Paulina Hudziak EXT is waiting for you'),
      }),
    ]);
    const rejected = pr({ reviewers: [{ id: 'r', displayName: 'R', vote: -10 }] });
    expect(feedbackWarnings(rejected)).toEqual([expect.objectContaining({ severity: 'error' })]);
  });

  it('is not "Ready to merge" even when every policy is satisfied', () => {
    const warnings = pullRequestWarnings(sentBack, extras());
    expect(isReadyToMerge(sentBack, extras({ evaluations: allApproved }), warnings)).toBe(false);
    expect(nextStep(sentBack, extras({ evaluations: allApproved }))).toBe(
      'Address the feedback of Paulina Hudziak EXT'
    );
  });

  it('says nothing for completed PRs or when nobody sent it back', () => {
    expect(feedbackWarnings({ ...sentBack, status: 'completed' })).toEqual([]);
    expect(feedbackWarnings(pr({ reviewers: [{ id: 's', displayName: 'S', vote: 10 }] }))).toEqual([]);
  });
});
