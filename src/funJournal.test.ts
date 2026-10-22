import { describe, expect, it } from 'vitest';
import {
  EMPTY_JOURNAL,
  FunJournal,
  markRecapOffered,
  MAX_JOURNAL_ENTRIES,
  minutesBetween,
  normalizeJournal,
  recordApproval,
  recordMerge,
  recordOpened,
  recordPullRequestEvents,
  recordReviewed,
  recordRuns,
} from './funJournal';
import type { PullRequestEvent, PullRequestSnapshot } from './pullRequestEvents';

const NOW = new Date('2026-10-21T10:00:00Z');

describe('normalizeJournal', () => {
  it('fills the lists missing from a stored journal', () => {
    expect(normalizeJournal(undefined)).toEqual(EMPTY_JOURNAL);
    expect(normalizeJournal({ runs: [{ id: 1, ok: true, at: 'x' }] })).toEqual({
      ...EMPTY_JOURNAL,
      runs: [{ id: 1, ok: true, at: 'x' }],
    });
  });
});

describe('recordRuns', () => {
  it('records finished runs, ok when they succeeded', () => {
    const journal = recordRuns(
      EMPTY_JOURNAL,
      [
        { id: 1, state: 'succeeded', finishTime: '2026-10-21T09:00:00Z' },
        { id: 2, state: 'failed' },
        { id: 3, state: 'partial' },
      ],
      NOW
    );
    expect(journal.runs).toEqual([
      { id: 1, ok: true, at: '2026-10-21T09:00:00Z' },
      { id: 2, ok: false, at: NOW.toISOString() },
      { id: 3, ok: false, at: NOW.toISOString() },
    ]);
  });

  it('leaves out the active and the canceled runs', () => {
    const runs = [
      { id: 1, state: 'queued' as const },
      { id: 2, state: 'running' as const },
      { id: 3, state: 'canceled' as const },
    ];
    expect(recordRuns(EMPTY_JOURNAL, runs, NOW)).toBe(EMPTY_JOURNAL);
  });

  it('is idempotent: a run already known changes nothing (another window recorded it)', () => {
    const journal = recordRuns(EMPTY_JOURNAL, [{ id: 1, state: 'succeeded' }], NOW);
    expect(recordRuns(journal, [{ id: 1, state: 'succeeded' }], NOW)).toBe(journal);
  });

  it('replaces the outcome of a re-run build, keeping its place', () => {
    const journal = recordRuns(
      EMPTY_JOURNAL,
      [
        { id: 1, state: 'failed' },
        { id: 2, state: 'succeeded' },
      ],
      NOW
    );
    expect(recordRuns(journal, [{ id: 1, state: 'succeeded' }], NOW).runs.map((run) => [run.id, run.ok])).toEqual([
      [1, true],
      [2, true],
    ]);
  });

  it('keeps only the latest entries', () => {
    const runs = Array.from({ length: MAX_JOURNAL_ENTRIES + 5 }, (_, i) => ({ id: i, state: 'succeeded' as const }));
    const journal = recordRuns(EMPTY_JOURNAL, runs, NOW);
    expect(journal.runs).toHaveLength(MAX_JOURNAL_ENTRIES);
    expect(journal.runs.at(0)?.id).toBe(5);
  });
});

describe('the other recorders', () => {
  it('record each PR once', () => {
    const merge = { id: 7, title: 'T', mergedAt: 'x' };
    const merged = recordMerge(EMPTY_JOURNAL, merge);
    expect(recordMerge(merged, merge)).toBe(merged);

    const opened = recordOpened(EMPTY_JOURNAL, [
      { id: 1, at: 'a' },
      { id: 1, at: 'b' },
    ]);
    expect(opened.opened).toEqual([{ id: 1, at: 'a' }]);
    expect(recordOpened(opened, [{ id: 1, at: 'c' }])).toBe(opened);

    const reviewed = recordReviewed(EMPTY_JOURNAL, [{ id: 2, at: 'first seen' }]);
    expect(recordReviewed(reviewed, [{ id: 2, at: 'later' }]).reviewed).toEqual([{ id: 2, at: 'first seen' }]);

    const approved = recordApproval(EMPTY_JOURNAL, { pullRequestId: 3, by: 'Ana', minutes: 5, at: 'x' });
    expect(recordApproval(approved, { pullRequestId: 3, by: 'Bo', minutes: 1, at: 'y' })).toBe(approved);

    const offered = markRecapOffered(EMPTY_JOURNAL, 'P\\S1');
    expect(markRecapOffered(offered, 'P\\S1')).toBe(offered);
  });
});

describe('minutesBetween', () => {
  it('counts whole minutes, undefined when a date is missing or the order is wrong', () => {
    expect(minutesBetween('2026-10-21T09:00:00Z', '2026-10-21T09:12:59Z')).toBe(12);
    expect(minutesBetween(undefined, '2026-10-21T09:00:00Z')).toBeUndefined();
    expect(minutesBetween('2026-10-21T10:00:00Z', '2026-10-21T09:00:00Z')).toBeUndefined();
  });
});

describe('recordPullRequestEvents', () => {
  const pr: PullRequestSnapshot = {
    id: 12,
    title: 'Add the thing',
    status: 'active',
    url: 'u',
    reviewers: [],
    publishedAt: '2026-10-21T09:50:00Z',
  };
  const vote = (vote: number, name = 'Ana'): PullRequestEvent => ({
    kind: 'vote',
    pullRequest: pr,
    reviewer: { id: name, name, vote, required: true, declined: false },
  });

  it('records the merges, with their publication and completion dates', () => {
    const merged = { kind: 'merged' as const, pullRequest: { ...pr, closedAt: '2026-10-21T09:58:00Z' } };
    const { journal } = recordPullRequestEvents(EMPTY_JOURNAL, [merged], NOW);
    expect(journal.merged).toEqual([
      { id: 12, title: 'Add the thing', publishedAt: '2026-10-21T09:50:00Z', mergedAt: '2026-10-21T09:58:00Z' },
    ]);
  });

  it('records the first approval only, with the minutes since publication', () => {
    const first = recordPullRequestEvents(EMPTY_JOURNAL, [vote(-5, 'Bo'), vote(10), vote(5, 'Cy')], NOW);
    expect(first.journal.approvals).toEqual([{ pullRequestId: 12, by: 'Ana', minutes: 10, at: NOW.toISOString() }]);
    expect(first.firstApprovals).toEqual(new Map([[12, 10]]));

    const again = recordPullRequestEvents(first.journal, [vote(10, 'Dee')], NOW);
    expect(again.journal).toBe(first.journal);
    expect(again.firstApprovals.size).toBe(0);
  });

  it('records an approval without minutes when the publication is unknown', () => {
    const unknown: PullRequestEvent = { ...vote(10), pullRequest: { ...pr, publishedAt: undefined } };
    const { journal }: { journal: FunJournal } = recordPullRequestEvents(EMPTY_JOURNAL, [unknown], NOW);
    expect(journal.approvals.at(0)?.minutes).toBeUndefined();
  });
});
