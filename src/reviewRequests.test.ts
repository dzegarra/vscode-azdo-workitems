import { describe, expect, it } from 'vitest';
import {
  describeReviewEvent,
  detectReviewEvents,
  formatWait,
  lastPublishedFromDraft,
  PullRequestThread,
  countLate,
  describeReviews,
  describeReviewStatusBar,
  reviewUrgency,
  ReviewRules,
  toReviewModels,
  ReviewerPullRequest,
  ReviewRequest,
  splitOptional,
  toReviewRequests,
  withPublishedDates,
} from './reviewRequests';

const ME = 'me';
const WEEK = [1, 2, 3, 4, 5];

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
    repository: { id: 'repo', name: 'User_Interface', project: { id: 'project' } },
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
    const requests = toReviewRequests([pr(3), pr(1), pr(2)], ME);
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
    expect(toReviewRequests(pullRequests, ME).map((r) => [r.id, r.isRequired])).toEqual([[5, false]]);
  });

  it('lists the required reviews first, then the optional ones, oldest first in each group', () => {
    const optional = (id: number, creationDate: string) =>
      pr(id, { creationDate, reviewers: [{ id: ME, displayName: 'Me', vote: 0, isRequired: false }] });
    const requests = toReviewRequests(
      [
        optional(1, '2026-10-01T10:00:00Z'),
        pr(2, { creationDate: '2026-10-05T10:00:00Z' }),
        optional(3, '2026-10-02T10:00:00Z'),
        pr(4, { creationDate: '2026-10-04T10:00:00Z' }),
      ],
      ME
    );
    expect(requests.map((r) => [r.id, r.isRequired])).toEqual([
      [4, true],
      [2, true],
      [1, false],
      [3, false],
    ]);
    // The publication dates found in the threads keep the same order
    const resorted = withPublishedDates(requests, new Map([[2, '2026-09-01T10:00:00Z']]));
    expect(resorted.map((r) => r.id)).toEqual([2, 4, 1, 3]);
  });

  it('shows the optional reviews only when asked, and counts the hidden ones', () => {
    const items = [
      { id: 1, isRequired: true },
      { id: 2, isRequired: false },
      { id: 3, isRequired: false },
    ];
    expect(splitOptional(items, true)).toEqual({ shown: items, hiddenOptional: 0 });
    expect(splitOptional(items, false)).toEqual({ shown: [items[0]], hiddenOptional: 2 });
  });

  it('counts overdue and due soon requests among the required ones only', () => {
    const late = [
      { isRequired: true, urgency: 'overdue' as const },
      { isRequired: false, urgency: 'overdue' as const },
      { isRequired: true, urgency: 'dueSoon' as const },
      { isRequired: false, urgency: 'dueSoon' as const },
      { isRequired: true, urgency: 'fresh' as const },
    ];
    expect(countLate(late)).toEqual({ overdue: 1, dueSoon: 1 });
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
    const rules = { maxWaitHours: 24, workingDays: WEEK, dueSoonHours: 6, remindOverdueEveryHours: 4 };
    expect(reviewUrgency(request(1, '2026-10-05T10:00:00Z'), now, rules)).toBe('overdue');
    expect(reviewUrgency(request(1, '2026-10-05T16:00:00Z'), now, rules)).toBe('dueSoon');
    expect(reviewUrgency(request(1, '2026-10-05T16:00:01Z'), now, rules)).toBe('fresh');
    const models = toReviewModels(
      [request(1, '2026-10-05T07:00:00Z'), request(2, '2026-10-05T15:00:00Z'), request(3, '2026-10-06T04:00:00Z')],
      now,
      rules,
      'UTC'
    );
    expect(models.map((m) => [m.dueText, m.barCaption, m.barValueText, m.waitedHours])).toEqual([
      ['was due today 07:00', '27 h of 24 h', 'Overdue by 3 hours', 24],
      ['due today 15:00', '19 h of 24 h', 'Waited 19 hours of 24; due today at 15:00', 19],
      ['due tomorrow 04:00', '6 h of 24 h', 'Waited 6 hours of 24; due tomorrow at 04:00', 6],
    ]);
    expect(models.map((m) => [m.urgency, m.timeLeft, m.waited, m.elapsed])).toEqual([
      ['overdue', 'overdue by 3 h', '1 d 3 h', 1],
      ['dueSoon', '5 h left', '19 h', 19 / 24],
      ['fresh', '18 h left', '6 h', 0.25],
    ]);
    expect(describeReviews(models)).toBe('3 pull requests are waiting for your review: 1 overdue, 1 due soon');
    expect(describeReviews(models.slice(2))).toBe('1 pull request is waiting for your review');
  });

  it('counts the overdue and due soon reviews in the status bar text, with the time left of the most urgent unless overdue', () => {
    const now = new Date('2026-10-06T10:00:00Z');
    const rules = { maxWaitHours: 24, workingDays: WEEK, dueSoonHours: 6, remindOverdueEveryHours: 4 };
    const models = toReviewModels(
      [
        request(1, '2026-10-05T05:00:00Z'),
        request(2, '2026-10-05T07:00:00Z'),
        request(3, '2026-10-05T15:00:00Z'),
        request(4, '2026-10-06T04:00:00Z'),
      ],
      now,
      rules
    );
    expect(describeReviewStatusBar(models)).toBe('4 to review · 2 overdue · 1 due soon');
    expect(describeReviewStatusBar(models.slice(2))).toBe('2 to review · 1 due soon · 5 h left');
    expect(describeReviewStatusBar(models.slice(3))).toBe('1 to review · 18 h left');
    expect(describeReviewStatusBar([{ ...models[0], isRequired: false }])).toBe('1 to review');
    expect(describeReviewStatusBar([])).toBe('');
  });
});

describe('waiting time over a weekend', () => {
  const rules: ReviewRules = { maxWaitHours: 24, workingDays: WEEK, dueSoonHours: 6, remindOverdueEveryHours: 4 };
  // Local dates: Friday 9 October 2026, 15:00
  const published = new Date(2026, 9, 9, 15).toISOString();

  it('does not count the weekend: published Friday 15:00, on Monday 12:00 it has waited 21 h', () => {
    const [model] = toReviewModels([request(1, published)], new Date(2026, 9, 12, 12), rules);
    expect(model).toMatchObject({
      urgency: 'dueSoon',
      timeLeft: '3 h left',
      waited: '21 h',
      barCaption: '21 h of 24 h',
      waitedHours: 21,
    });
    expect(model.dueText).toContain('15:00');
  });

  it('is overdue from Monday 15:00', () => {
    expect(reviewUrgency(request(1, published), new Date(2026, 9, 12, 15), rules)).toBe('overdue');
    expect(reviewUrgency(request(1, published), new Date(2026, 9, 12, 14, 59), rules)).toBe('dueSoon');
  });

  it('is the calendar time when every day is a working day', () => {
    const allDays = { ...rules, workingDays: [0, 1, 2, 3, 4, 5, 6] };
    expect(reviewUrgency(request(1, published), new Date(2026, 9, 12, 12), allDays)).toBe('overdue');
  });

  it('does not remind about an overdue PR over the weekend', () => {
    const overdue = request(1, new Date(2026, 9, 8, 10).toISOString());
    const friday = new Date(2026, 9, 9, 22);
    const { stored } = detectReviewEvents(undefined, [overdue], friday, rules);
    const sunday = new Date(2026, 9, 11, 20);
    expect(detectReviewEvents(stored, [overdue], sunday, rules).events).toEqual([]);
    // 2 h of Friday evening count, then 2 more on Monday morning make the 4 h
    expect(detectReviewEvents(stored, [overdue], new Date(2026, 9, 12, 1, 59), rules).events).toEqual([]);
    expect(detectReviewEvents(stored, [overdue], new Date(2026, 9, 12, 2), rules).events).toEqual([
      { kind: 'overdue', request: overdue },
    ]);
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
  const rules: ReviewRules = { maxWaitHours: 24, workingDays: WEEK, dueSoonHours: 6, remindOverdueEveryHours: 4 };
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
    expect(
      describeReviewEvent({ kind: 'requested', request: fresh }, now, { maxWaitHours: 24, workingDays: WEEK })
    ).toBe('You are a required reviewer of PR 1 by Ana: PR title 1');
    expect(
      describeReviewEvent({ kind: 'dueSoon', request: dueSoon }, now, { maxWaitHours: 24, workingDays: WEEK })
    ).toBe('PR 2 by Ana is due in 5 h: PR title 2');
    expect(
      describeReviewEvent({ kind: 'overdue', request: overdue }, now, { maxWaitHours: 24, workingDays: WEEK })
    ).toBe('PR 3 by Ana is overdue by 2 h (waiting for your review for 1 d 2 h): PR title 3');
  });
});
