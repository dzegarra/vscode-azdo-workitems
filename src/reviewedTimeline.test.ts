import { describe, expect, it } from 'vitest';
import type { ThreadResponse } from './reviewThreads';
import {
  reviewedRows,
  reviewedThreadsWanted,
  reviewMoments,
  type ReviewedInput,
  type ReviewedPullRequestInfo,
} from './reviewedTimeline';
import { buildAxis } from './timelineAxis';

const at = (day: number, hour = 10): number => new Date(2026, 9, day, hour).getTime();
const iso = (day: number, hour = 10): string => new Date(at(day, hour)).toISOString();
const NOW = new Date(2026, 9, 22, 14);
const days = buildAxis('2026-10-12', '2026-10-23', [1, 2, 3, 4, 5], NOW, 2);

const published = (when: string): ThreadResponse => ({
  id: 1,
  publishedDate: when,
  properties: { CodeReviewThreadType: { $value: 'IsDraftUpdate' }, CodeReviewIsDraftNowSet: { $value: '0' } },
});
const vote = (when: string, voter: string, result: string): ThreadResponse => ({
  id: 2,
  publishedDate: when,
  properties: {
    CodeReviewThreadType: { $value: 'VoteUpdate' },
    CodeReviewVoteResult: { $value: result },
    CodeReviewVotedByIdentity: { $value: '1' },
  },
  identities: { '1': { id: voter, displayName: voter } },
});

const pr = (overrides: Partial<ReviewedPullRequestInfo> = {}): ReviewedPullRequestInfo => ({
  id: 70,
  title: '[66280] Retry the handshake',
  url: 'https://pr/70',
  author: 'Marta Nowak',
  repositoryId: 'r',
  createdAt: iso(14, 9),
  status: 'active',
  myVote: 10,
  ...overrides,
});

const input = (overrides: Partial<ReviewedInput> = {}): ReviewedInput => ({
  pullRequests: [pr()],
  threads: new Map(),
  loading: new Set(),
  myId: 'me',
  myName: 'Dario Zegarra',
  days,
  now: NOW.getTime(),
  ...overrides,
});

describe('reviewMoments (Rule TIMELINE-37)', () => {
  it('finds the first vote of the user and the publication before it', () => {
    const moments = reviewMoments(
      [vote(iso(16), 'ana', '10'), published(iso(15)), vote(iso(17), 'me', '-5'), vote(iso(19), 'me', '10')],
      'me'
    );
    expect(moments).toEqual({ vote: { at: at(17), value: -5 }, published: at(15) });
  });
});

describe('reviewedRows (Rule TIMELINE-37)', () => {
  it('waits from the publication to the vote, then a thin line until now, with the vote as its mark', () => {
    const [row] = reviewedRows(
      input({ threads: new Map([[70, [published(iso(15, 9)), vote(iso(16, 15), 'me', '10')]]]) })
    );
    expect(row.segments.map((segment) => segment.kind)).toEqual(['wait', 'afterVote']);
    expect(row.segments[0].start).toBeCloseTo(3 + 9 / 24);
    expect(row.vote).toMatchObject({ kind: 'approve', text: 'DZ' });
    expect(row.vote?.at).toBeCloseTo(4 + 15 / 24);
    expect(row).toMatchObject({ faded: true, title: 'Retry the handshake', section: 'review' });
  });

  it('ends a merged PR at its closing, with its mark', () => {
    const [row] = reviewedRows(
      input({
        pullRequests: [pr({ status: 'completed', closedAt: iso(19, 16), myVote: -5 })],
        threads: new Map([[70, [vote(iso(16, 15), 'me', '-5')]]]),
      })
    );
    expect(row.vote?.kind).toBe('wait');
    expect(row.merged?.text).toBe('✓ merged Mo 19');
    expect(row.segments.at(-1)?.end).toBeCloseTo(5 + 16 / 24);
  });

  it('leaves out the votes before the sprint, and draws a guess until the threads are read', () => {
    expect(reviewedRows(input({ threads: new Map([[70, [vote(iso(5), 'me', '10')]]]) }))).toEqual([]);
    const [guess] = reviewedRows(input({ loading: new Set([70]) }));
    expect(guess.vote).toBeUndefined();
    expect(guess.segments[0].approximate).toBe(true);
    expect(guess.loading).toBe(true);
    expect(reviewedRows(input({ pullRequests: [pr({ myVote: 0 })] }))).toEqual([]);
  });

  it('asks the threads of a closed PR once and of an open one again when the vote changes', () => {
    expect(
      reviewedThreadsWanted(
        [
          pr(),
          pr({ id: 71, status: 'completed', closedAt: iso(20) }),
          pr({ id: 72, status: 'completed', closedAt: iso(2) }),
        ],
        at(12, 0)
      )
    ).toEqual([
      { id: 70, key: 'active:10' },
      { id: 71, key: 'closed' },
    ]);
  });
});
