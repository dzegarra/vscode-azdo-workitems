import { describe, expect, it } from 'vitest';
import {
  describeReviewEvent,
  detectReviewEvents,
  formatWait,
  lastPublishedFromDraft,
  PullRequestThread,
  describeReviews,
  reviewUrgency,
  ReviewRules,
  toReviewModels,
  ReviewerPullRequest,
  ReviewRequest,
  toReviewRequests,
  withPublishedDates,
} from './reviewRequests';

const ME = 'me';

function pr(id: number, overrides: Partial<ReviewerPullRequest> = {}, myVote = 0): ReviewerPullRequest {
  return {
    pullRequestId: id,
    title: `PR title ${id}`,
    status: 'active',
    isDraft: false,
    creationDate: `2026-10-0${id}T08:00:00Z`,
    createdBy: { id: 'ana', displayName: 'Ana' },
    targetRefName: 'refs/heads/develop',
    sourceRefName: `refs/heads/feature/fui-admin/${id}-change`,
    repository: { id: 'repo', name: 'User_Interface' },
    webUrl: `https://dev.azure.com/org/project/_git/User_Interface/pullrequest/${id}`,
    reviewers: [
      { id: 'team', displayName: '[UI]\\Reviewers', vote: 0, isRequired: true },
      { id: ME, displayName: 'Me', vote: myVote, isRequired: true },
    ],
    ...overrides,
  };
}

function request(id: number, publishedAt: string): ReviewRequest {
  return {
    id,
    title: `PR title ${id}`,
    url: '',
    repository: 'User_Interface',
    repositoryId: 'repo',
    author: 'Ana',
    targetBranch: 'develop',
    sourceBranch: 'feature/x',
    publishedAt,
    isRequired: true,
  };
}

describe('review requests', () => {
  it('lists the active PRs of others where I am a required reviewer without a vote, oldest first', () => {
    const requests = toReviewRequests([pr(3), pr(1), pr(2)], ME, false);
    expect(requests.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(requests[0]).toMatchObject({
      author: 'Ana',
      targetBranch: 'develop',
      sourceBranch: 'feature/fui-admin/1-change',
      isRequired: true,
    });
  });

  it('skips PRs that are not waiting for me', () => {
    const optional = pr(5, {
      reviewers: [{ id: ME, displayName: 'Me', vote: 0, isRequired: false }],
    });
    const declined = pr(6, {
      reviewers: [{ id: ME, displayName: 'Me', vote: 0, isRequired: true, hasDeclined: true }],
    });
    const pullRequests = [
      pr(1, {}, 10), // approved
      pr(2, {}, -5), // waiting for the author
      pr(3, { isDraft: true }),
      pr(4, { createdBy: { id: ME, displayName: 'Me' } }),
      optional,
      declined,
      pr(7, { status: 'completed' }),
      pr(8, { reviewers: [{ id: 'team', displayName: 'Team', vote: 0, isRequired: true }] }),
    ];
    expect(toReviewRequests(pullRequests, ME, false)).toEqual([]);
    expect(toReviewRequests(pullRequests, ME, true).map((r) => [r.id, r.isRequired])).toEqual([[5, false]]);
  });

  it('formats the waiting time and tells when it is over the maximum', () => {
    const minute = 60 * 1000;
    const hour = 60 * minute;
    expect(formatWait(12 * minute)).toBe('12 min');
    expect(formatWait(5 * hour + 10 * minute)).toBe('5 h');
    expect(formatWait(48 * hour)).toBe('2 d');
    expect(formatWait(51 * hour)).toBe('2 d 3 h');
  });

  it('tells how urgent each PR is and how much time is left', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    const rules = { maxWaitHours: 24, dueSoonHours: 6, remindOverdueEveryHours: 4 };
    expect(reviewUrgency(request(1, '2026-10-05T10:00:00Z'), now, rules)).toBe('overdue');
    expect(reviewUrgency(request(1, '2026-10-05T16:00:00Z'), now, rules)).toBe('dueSoon');
    expect(reviewUrgency(request(1, '2026-10-05T16:00:01Z'), now, rules)).toBe('fresh');
    const models = toReviewModels(
      [request(1, '2026-10-05T07:00:00Z'), request(2, '2026-10-05T15:00:00Z'), request(3, '2026-10-06T04:00:00Z')],
      now,
      rules
    );
    expect(models.map((m) => [m.urgency, m.timeLeft, m.waited, m.elapsed])).toEqual([
      ['overdue', 'overdue by 3 h', '1 d 3 h', 1],
      ['dueSoon', '5 h left', '19 h', 19 / 24],
      ['fresh', '18 h left', '6 h', 0.25],
    ]);
    expect(describeReviews(models)).toBe('3 pull requests are waiting for your review: 1 overdue, 1 due soon');
    expect(describeReviews(models.slice(2))).toBe('1 pull request is waiting for your review');
  });
});

describe('publication from draft', () => {
  // System threads of PR 13713: created on 30 Sep as a draft, published on 5 Oct
  const thread = (publishedDate: string, type: string, extra: Record<string, string> = {}): PullRequestThread => ({
    publishedDate,
    properties: Object.fromEntries(
      Object.entries({ CodeReviewThreadType: type, ...extra }).map(([key, value]) => [
        key,
        { $type: 'System.String', $value: value },
      ])
    ),
  });
  const refUpdate = thread('2026-09-30T18:48:10.22Z', 'RefUpdate');
  const published = thread('2026-10-05T21:24:39.75Z', 'IsDraftUpdate', { CodeReviewIsDraftNowSet: '0' });

  it('finds when the PR was last published', () => {
    expect(lastPublishedFromDraft([refUpdate, published, thread('2026-10-05T21:25:22.933Z', 'ReviewersUpdate')])).toBe(
      '2026-10-05T21:24:39.75Z'
    );
    const backToDraft = thread('2026-10-06T08:00:00Z', 'IsDraftUpdate', { CodeReviewIsDraftNowSet: '1' });
    const republished = thread('2026-10-06T09:00:00Z', 'IsDraftUpdate', { CodeReviewIsDraftNowSet: '0' });
    expect(lastPublishedFromDraft([published, backToDraft, republished])).toBe('2026-10-06T09:00:00Z');
    expect(lastPublishedFromDraft([refUpdate, { publishedDate: '2026-10-01T00:00:00Z' }])).toBeUndefined();
  });

  it('counts the wait from the publication, falling back to the creation', () => {
    const requests = [request(1, '2026-09-30T17:44:29Z'), request(2, '2026-10-02T10:00:00Z')];
    const dated = withPublishedDates(
      requests,
      new Map([
        [1, '2026-10-05T21:24:39.75Z'],
        [2, undefined],
      ])
    );
    expect(dated.map((r) => [r.id, r.publishedAt])).toEqual([
      [2, '2026-10-02T10:00:00Z'],
      [1, '2026-10-05T21:24:39.75Z'],
    ]);
  });
});

describe('review events', () => {
  const rules: ReviewRules = { maxWaitHours: 24, dueSoonHours: 6, remindOverdueEveryHours: 4 };
  const now = new Date('2026-10-06T10:00:00Z');
  const fresh = request(1, '2026-10-06T09:00:00Z');
  const dueSoon = request(2, '2026-10-05T15:00:00Z');
  const overdue = request(3, '2026-10-05T08:00:00Z');
  const kinds = (events: { kind: string; request: { id: number } }[]) => events.map((e) => [e.kind, e.request.id]);

  it('only establishes a baseline on the first check, with the digest', () => {
    const { events, digest, stored } = detectReviewEvents(undefined, [fresh, dueSoon, overdue], now, rules);
    expect(events).toEqual([]);
    expect(digest).toBe(true);
    expect(detectReviewEvents(stored, [fresh, dueSoon, overdue], now, rules)).toMatchObject({
      events: [],
      digest: false,
    });
  });

  it('notifies new requests, PRs getting due soon and overdue ones once', () => {
    const previous = { known: [2, 3], dueSoonNotified: [], overdueNotified: {}, digestDay: '2026-10-6' };
    const later = new Date('2026-10-06T10:00:00');
    const { events, digest, stored } = detectReviewEvents(
      { ...previous, digestDay: `${later.getFullYear()}-${later.getMonth() + 1}-${later.getDate()}` },
      [fresh, dueSoon, overdue],
      now,
      rules
    );
    expect(kinds(events)).toEqual([
      ['requested', 1],
      ['dueSoon', 2],
      ['overdue', 3],
    ]);
    expect(digest).toBe(false);
    expect(detectReviewEvents(stored, [fresh, dueSoon, overdue], now, rules).events).toEqual([]);
  });

  it('reminds overdue PRs every few hours, or only once', () => {
    const { stored } = detectReviewEvents(undefined, [overdue], now, rules);
    const inThreeHours = new Date(now.getTime() + 3 * 3600e3);
    const inFourHours = new Date(now.getTime() + 4 * 3600e3);
    expect(detectReviewEvents(stored, [overdue], inThreeHours, rules).events).toEqual([]);
    const reminded = detectReviewEvents(stored, [overdue], inFourHours, rules);
    expect(kinds(reminded.events)).toEqual([['overdue', 3]]);
    expect(detectReviewEvents(reminded.stored, [overdue], inFourHours, rules).events).toEqual([]);
    expect(detectReviewEvents(stored, [overdue], inFourHours, { ...rules, remindOverdueEveryHours: 0 }).events).toEqual(
      []
    );
  });

  it('notifies an urgent new request only as new, and forgets reviewed PRs', () => {
    const { events, stored } = detectReviewEvents(
      { known: [1], dueSoonNotified: [], overdueNotified: {} },
      [overdue],
      now,
      rules
    );
    expect(kinds(events)).toEqual([['requested', 3]]);
    expect(stored).toMatchObject({ known: [3], dueSoonNotified: [3] });
    expect(stored.overdueNotified[3]).toBe(now.toISOString());
  });

  it('shows the digest on the first check of each day', () => {
    const { stored } = detectReviewEvents(undefined, [fresh], now, rules);
    const tomorrow = new Date(now.getTime() + 24 * 3600e3);
    expect(detectReviewEvents(stored, [fresh], tomorrow, rules).digest).toBe(true);
    expect(detectReviewEvents(stored, [], tomorrow, rules).digest).toBe(false);
  });

  it('describes the events', () => {
    expect(describeReviewEvent({ kind: 'requested', request: fresh }, now, 24)).toBe(
      'You are a required reviewer of PR 1 by Ana: PR title 1'
    );
    expect(describeReviewEvent({ kind: 'dueSoon', request: dueSoon }, now, 24)).toBe(
      '5 h left to review PR 2 by Ana: PR title 2'
    );
    expect(describeReviewEvent({ kind: 'overdue', request: overdue }, now, 24)).toBe(
      'PR 3 by Ana is overdue by 2 h (waiting for your review for 1 d 2 h): PR title 3'
    );
  });
});
