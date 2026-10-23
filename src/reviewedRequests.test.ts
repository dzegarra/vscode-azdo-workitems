import { describe, expect, it } from 'vitest';
import { describeReviews, ReviewerPullRequest, toReviewModels, toReviewRequests } from './reviewRequests';
import {
  listsClosedReviews,
  ReviewedRef,
  reviewedIdsToDrop,
  reviewedIdsToFetch,
  reviewedPeriodSetting,
  reviewBranchTarget,
  toReviewedDetails,
  toReviewedRequests,
  votedPullRequestIds,
} from './reviewedRequests';

const ME = 'me';
const NOW = new Date('2026-10-13T12:00:00Z');
const HOUR = 3_600_000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOUR).toISOString();

function pr(id: number, myVote: number, overrides: Partial<ReviewerPullRequest> = {}): ReviewerPullRequest {
  return {
    pullRequestId: id,
    title: `PR title ${id}`,
    status: 'active',
    isDraft: false,
    creationDate: ago(100 + id),
    createdBy: { id: 'ana', displayName: 'Ana' },
    targetRefName: 'refs/heads/develop',
    sourceRefName: `refs/heads/feature/${id}`,
    repository: { id: 'repo', name: 'User_Interface', project: { id: 'project' } },
    webUrl: `https://dev.azure.com/org/project/_git/User_Interface/pullrequest/${id}`,
    reviewers: [{ id: ME, displayName: 'Me', vote: myVote, isRequired: true }],
    ...overrides,
  };
}

const ids = (list: { id: number }[]) => list.map((item) => item.id);

describe('reviewBranchTarget', () => {
  it('finds the branch of an active PR, waiting for the vote or already voted', () => {
    const list = [pr(1, 0), pr(2, 10)];
    expect(reviewBranchTarget(list, 1)).toEqual({
      id: 1,
      title: 'PR title 1',
      repository: 'User_Interface',
      sourceBranch: 'feature/1',
    });
    expect(reviewBranchTarget(list, 2)?.sourceBranch).toBe('feature/2');
    expect(toReviewedRequests(list, ME, NOW, 'active').map(({ sourceBranch }) => sourceBranch)).toEqual(['feature/2']);
  });

  it('offers nothing for a closed or unknown PR', () => {
    const list = [pr(1, 10, { status: 'completed', closedDate: ago(1) })];
    expect(reviewBranchTarget(list, 1)).toBeUndefined();
    expect(reviewBranchTarget(list, 9)).toBeUndefined();
  });
});

describe('toReviewedRequests', () => {
  it('lists nothing while the period is hidden', () => {
    expect(toReviewedRequests([pr(1, 10)], ME, NOW, 'hidden')).toEqual([]);
  });

  it('lists the active PRs the user voted on, with their vote, and not the ones still waiting', () => {
    const list = [pr(1, 10), pr(2, 0), pr(3, 5), pr(4, -5), pr(5, -10)];
    const reviewed = toReviewedRequests(list, ME, NOW, 'active');
    expect(reviewed.map(({ id, vote }) => [id, vote])).toEqual([
      [1, 'approved'],
      [3, 'suggestions'],
      [4, 'waiting'],
      [5, 'rejected'],
    ]);
  });

  it('leaves out declined reviews, own PRs, drafts and PRs where the user is not a reviewer', () => {
    const declined = pr(1, -10, { reviewers: [{ id: ME, displayName: 'Me', vote: -10, hasDeclined: true }] });
    const own = pr(2, 10, { createdBy: { id: ME, displayName: 'Me' } });
    const draft = pr(3, 10, { isDraft: true });
    const other = pr(4, 10, { reviewers: [{ id: 'bob', displayName: 'Bob', vote: 10 }] });
    expect(toReviewedRequests([declined, own, draft, other], ME, NOW, 'month')).toEqual([]);
  });

  it('adds the PRs closed within the window only when the period has one', () => {
    const completed = pr(1, 10, { status: 'completed', closedDate: ago(30) });
    const abandoned = pr(2, 5, { status: 'abandoned', closedDate: ago(3 * 24) });
    const old = pr(3, 10, { status: 'completed', closedDate: ago(10 * 24) });
    const list = [completed, abandoned, old, pr(4, 10)];
    expect(ids(toReviewedRequests(list, ME, NOW, 'active'))).toEqual([4]);
    expect(ids(toReviewedRequests(list, ME, NOW, 'day'))).toEqual([4]);
    expect(ids(toReviewedRequests(list, ME, NOW, 'week'))).toEqual([4, 1, 2]);
    expect(ids(toReviewedRequests(list, ME, NOW, 'month'))).toEqual([4, 1, 2, 3]);
  });

  it('describes the closed ones and sorts: active newest first, then closed by closing date', () => {
    const list = [
      pr(1, 10, { status: 'completed', closedDate: ago(50) }),
      pr(2, 10, { status: 'abandoned', closedDate: ago(5) }),
      pr(3, 10, { creationDate: ago(40) }),
      pr(4, 10, { creationDate: ago(20) }),
    ];
    const reviewed = toReviewedRequests(list, ME, NOW, 'week');
    expect(reviewed.map(({ id, status, closedAgo }) => [id, status, closedAgo])).toEqual([
      [4, 'active', undefined],
      [3, 'active', undefined],
      [2, 'abandoned', '5 h'],
      [1, 'completed', '2 d 2 h'],
    ]);
  });

  it('ignores a closed PR without closing date and repeated PRs', () => {
    const noDate = pr(1, 10, { status: 'completed' });
    expect(toReviewedRequests([noDate, pr(2, 10), pr(2, 10)], ME, NOW, 'month').map(({ id }) => id)).toEqual([2]);
  });
});

describe('reviewed PRs are not review requests', () => {
  it('are not counted by the requests, models or digest that feed the badge and notifications', () => {
    const list = [pr(1, 0), pr(2, 10), pr(3, 5, { status: 'completed', closedDate: ago(2) })];
    const requests = toReviewRequests(list, ME);
    expect(ids(requests)).toEqual([1]);
    const rules = { maxWaitHours: 24, workingDays: [0, 1, 2, 3, 4, 5, 6], dueSoonHours: 6, remindOverdueEveryHours: 4 };
    expect(toReviewModels(requests, NOW, rules)).toHaveLength(1);
    expect(describeReviews(toReviewModels(requests, NOW, rules))).toMatch(/^1 /);
    expect(ids(toReviewedRequests(list, ME, NOW, 'week'))).toEqual([2, 3]);
  });
});

describe('period setting', () => {
  it('falls back to hidden and tells which periods need the closed PRs', () => {
    expect(reviewedPeriodSetting('week')).toBe('week');
    expect(reviewedPeriodSetting('nonsense')).toBe('hidden');
    expect(
      ['hidden', 'active', 'day', 'week', 'month'].map((p) => listsClosedReviews(reviewedPeriodSetting(p)))
    ).toEqual([false, false, true, true, true]);
  });
});

describe('toReviewedDetails', () => {
  const options = { baseBranch: 'develop', minimumRequiredReviewers: 2 };
  const extras = { runs: [], unresolvedThreads: 2, workItems: [{ id: 7, type: 'Task' }] };

  it('has the details of the waiting cards but no waiting-time part', () => {
    const details = toReviewedDetails(
      { pr: pr(1, 10), myId: ME, extras, filesChanged: { count: 3, capped: false } },
      options
    );
    expect(details).not.toHaveProperty('timeline');
    expect(details.status).toBe('Approved');
    expect(details.unresolved).toBe(2);
    expect(details.workItems).toEqual([{ id: 7, type: 'Task' }]);
    expect(details.filesChangedText).toBe('3 files changed');
    expect(details.reviewers[0]).toMatchObject({ isMe: true, vote: 'approved' });
    expect(details.approvalCompletes).toBe(false);
  });

  it('tells a completed PR from an active one', () => {
    const closed = pr(2, 10, { status: 'completed', closedDate: ago(2) });
    expect(toReviewedDetails({ pr: closed, myId: ME, extras }, options)).toMatchObject({
      status: 'Completed',
      tone: 'completed',
    });
  });
});

describe('reviewed details fetch policy', () => {
  const listed: ReviewedRef[] = [
    { id: 1, status: 'active' },
    { id: 2, status: 'active' },
    { id: 3, status: 'completed' },
    { id: 4, status: 'abandoned' },
  ];
  const none = () => false;

  it('fetches nothing while nothing is unfolded', () => {
    expect(reviewedIdsToFetch(listed, new Set(), none, true)).toEqual([]);
  });

  it('fetches only the unfolded and listed PRs without details', () => {
    expect(reviewedIdsToFetch(listed, new Set([1, 3, 99]), none, false)).toEqual([1, 3]);
    expect(reviewedIdsToFetch(listed, new Set([1, 3]), (id) => id === 1, false)).toEqual([3]);
  });

  it('never fetches a closed PR again once cached, but refreshes the unfolded active ones at each check', () => {
    const expanded = new Set([1, 2, 3, 4]);
    const has = (id: number) => id !== 2;
    expect(reviewedIdsToFetch(listed, expanded, has, true)).toEqual([1, 2]);
    expect(reviewedIdsToFetch(listed, expanded, has, false)).toEqual([2]);
  });

  it('drops the details of active PRs that were folded or are gone, and keeps the closed ones', () => {
    const known: ReviewedRef[] = [
      { id: 1, status: 'active' },
      { id: 2, status: 'active' },
      { id: 5, status: 'active' },
      { id: 3, status: 'completed' },
    ];
    expect(reviewedIdsToDrop(known, listed, new Set([1, 5]))).toEqual([2, 5]);
  });

  it('drops the details of an active PR that has been completed since, so they are fetched again as closed', () => {
    const now: ReviewedRef[] = [{ id: 1, status: 'completed' }];
    expect(reviewedIdsToDrop([{ id: 1, status: 'active' }], now, new Set([1]))).toEqual([1]);
    expect(reviewedIdsToFetch(now, new Set([1]), none, false)).toEqual([1]);
  });
});

describe('votedPullRequestIds', () => {
  it('lists the published PRs of others the user voted on, for the fun journal', () => {
    const prs = [
      pr(1, 10),
      pr(2, 0),
      pr(3, -5),
      pr(4, 10, { isDraft: true }),
      pr(5, 10, { createdBy: { id: ME, displayName: 'Me' } }),
    ];
    expect(votedPullRequestIds(prs, ME)).toEqual([1, 3]);
  });
});
