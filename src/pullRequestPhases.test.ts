import { describe, expect, it } from 'vitest';
import { PhasesSource, pullRequestPhases, summarizeCompleted } from './pullRequestPhases';
import type { ThreadResponse } from './reviewThreads';

const HOUR = 60 * 60 * 1000;
const WEEK = [1, 2, 3, 4, 5];
// Local dates (month is 0-based): Wednesday 7 October 2026 is (2026, 9, 7)
const at = (day: number, hour: number): string => new Date(2026, 9, day, hour).toISOString();

const system = (
  id: number,
  publishedDate: string,
  type: string,
  properties: Record<string, unknown> = {},
  identity?: string
): ThreadResponse => ({
  id,
  publishedDate,
  properties: {
    CodeReviewThreadType: { $value: type },
    ...Object.fromEntries(Object.entries(properties).map(([key, $value]) => [key, { $value }])),
  },
  identities: identity ? { '1': { id: identity, displayName: identity } } : undefined,
  comments: [{ id: 1, author: { id: 'u', displayName: 'x' }, content: '', commentType: 'system' }],
});
const vote = (id: number, when: string, who: string, value: number) =>
  system(id, when, 'VoteUpdate', { CodeReviewVoteResult: String(value), CodeReviewVotedByIdentity: '1' }, who);
const push = (id: number, when: string) => system(id, when, 'RefUpdate', { CodeReviewRefNewCommitsCount: 2 });
const draftUpdate = (id: number, when: string, published: boolean) =>
  system(id, when, 'IsDraftUpdate', { CodeReviewIsDraftNowSet: published ? '0' : '1' });

const pr = (creation: string, closed: string, reviewers: PhasesSource['reviewers'] = []): PhasesSource => ({
  creationDate: creation,
  closedDate: closed,
  isDraft: false,
  createdBy: { id: 'a', displayName: 'Ann' },
  reviewers,
});
const kinds = (result: ReturnType<typeof pullRequestPhases>) => result?.segments.map((s) => s.kind);

function expectContiguous(result: NonNullable<ReturnType<typeof pullRequestPhases>>, start: string, end: string) {
  expect(result.segments[0].start).toBe(start);
  expect(result.segments.at(-1)?.end).toBe(end);
  result.segments.slice(1).forEach((segment, index) => expect(segment.start).toBe(result.segments[index].end));
  expect(result.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
}

describe('pullRequestPhases', () => {
  it('draft, published, approved, completed', () => {
    const threads = [
      draftUpdate(1, at(7, 12), true),
      push(2, at(7, 14)),
      vote(3, at(8, 10), 'Bob', 10),
      system(4, at(8, 11), 'AutoCompleteUpdate', { CodeReviewAutoCompleteNowSet: '1' }),
    ];
    const source = { ...pr(at(7, 9), at(8, 16)), isDraft: false };
    const result = pullRequestPhases(source, threads, WEEK);
    expect(kinds(result)).toEqual(['draft', 'review', 'merge']);
    expect(result?.segments.map((s) => s.ms / HOUR)).toEqual([3, 22, 6]);
    expect(result?.totalMs).toBe(31 * HOUR);
    expect(result?.events.map((e) => e.kind)).toEqual(['published', 'push', 'approve', 'autoComplete']);
    expect(result?.events[2].text).toBe('Bob approved');
    expectContiguous(result!, at(7, 9), at(8, 16));
  });

  it('waiting for the author, push, approval', () => {
    const threads = [vote(1, at(7, 11), 'Bob', -5), push(2, at(7, 15)), vote(3, at(8, 9), 'Bob', 10)];
    const result = pullRequestPhases(pr(at(7, 9), at(8, 12)), threads, WEEK);
    expect(kinds(result)).toEqual(['review', 'author', 'review', 'merge']);
    expect(result?.segments.map((s) => s.ms / HOUR)).toEqual([2, 4, 18, 3]);
    expect(result?.events.map((e) => e.kind)).toEqual(['wait', 'push', 'approve']);
  });

  it('a rejection answered by the approval, without a push, ends the author phase', () => {
    const threads = [vote(1, at(7, 10), 'Bob', -10), vote(2, at(7, 12), 'Bob', 10)];
    const result = pullRequestPhases(pr(at(7, 9), at(7, 14)), threads, WEEK);
    expect(kinds(result)).toEqual(['review', 'author', 'merge']);
    expect(result?.events[0].kind).toBe('reject');
  });

  it('prefers the votes of the required reviewers', () => {
    const threads = [vote(1, at(7, 10), 'Optional', -5), vote(2, at(7, 12), 'Req', 10)];
    const reviewers = [{ displayName: 'Req', isRequired: true }, { displayName: 'Optional' }];
    const result = pullRequestPhases(pr(at(7, 9), at(7, 14), reviewers), threads, WEEK);
    expect(kinds(result)).toEqual(['review', 'merge']);
    expect(result?.segments[0].ms).toBe(3 * HOUR);
  });

  it('a negative vote after the approval means there is no merge start before the later approval', () => {
    const threads = [vote(1, at(7, 10), 'Bob', 10), vote(2, at(7, 11), 'Bob', -5), vote(3, at(7, 13), 'Bob', 10)];
    const result = pullRequestPhases(pr(at(7, 9), at(7, 14)), threads, WEEK);
    expect(kinds(result)).toEqual(['review', 'author', 'merge']);
    expect(result?.segments.at(-1)?.ms).toBe(HOUR);
  });

  it('without threads: review until the completion and an empty merge', () => {
    const result = pullRequestPhases(pr(at(7, 9), at(7, 15)), undefined, WEEK);
    expect(kinds(result)).toEqual(['review', 'merge']);
    expect(result?.segments.map((s) => s.share)).toEqual([1, 0]);
    expect(result?.events).toEqual([]);
    expectContiguous(result!, at(7, 9), at(7, 15));
  });

  it('does not count the weekend', () => {
    // Friday 9 Oct 15:00 to Monday 12 Oct 12:00: 9 h + 12 h
    const threads = [vote(1, at(12, 6), 'Bob', 10)];
    const result = pullRequestPhases(pr(at(9, 15), at(12, 12)), threads, WEEK);
    expect(result?.totalMs).toBe(21 * HOUR);
    expect(result?.segments.map((s) => s.ms / HOUR)).toEqual([15, 6]);
    expect(result?.events[0].share).toBeCloseTo(15 / 21);
  });

  it('re-drafting counts as draft', () => {
    const threads = [draftUpdate(1, at(7, 10), false), draftUpdate(2, at(7, 12), true), vote(3, at(7, 14), 'Bob', 10)];
    expect(kinds(pullRequestPhases(pr(at(7, 9), at(7, 15)), threads, WEEK))).toEqual([
      'review',
      'draft',
      'review',
      'merge',
    ]);
  });

  it('has no phases without a completion date', () => {
    expect(pullRequestPhases({ ...pr(at(7, 9), ''), closedDate: undefined }, [], WEEK)).toBeUndefined();
  });
});

describe('summarizeCompleted', () => {
  const phases = (reviewHours: number, mergeHours: number) =>
    pullRequestPhases(pr(at(7, 0), at(7, reviewHours + mergeHours)), [vote(1, at(7, reviewHours), 'Bob', 10)], WEEK);
  const format = (ms: number) => `${ms / HOUR} h`;

  it('gives the median and the phase that takes most', () => {
    expect(summarizeCompleted([phases(8, 2), phases(10, 4), phases(6, 6)], format)).toBe(
      'Completed PRs: median 12 h, mostly waiting for review'
    );
  });

  it('is omitted with fewer than two completed PRs', () => {
    expect(summarizeCompleted([phases(8, 2), undefined], format)).toBeUndefined();
  });
});
