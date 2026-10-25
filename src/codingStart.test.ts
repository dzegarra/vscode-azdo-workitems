import { describe, expect, it } from 'vitest';
import {
  codingStartOf,
  firstCommitsToAsk,
  needsFirstCommit,
  normalizeCodingStart,
  oldestCommitDate,
  type FirstCommitCandidate,
  type FirstCommitEntry,
} from './codingStart';

const at = (day: number, hour = 12): number => new Date(2026, 9, day, hour).getTime();
const created = at(21, 9);
const both = {
  prCreated: created,
  firstCommit: at(20, 10),
  task: { id: 67210, activated: at(14, 9) },
  workItemActivated: at(13, 9),
};

describe('codingStartOf (TIMELINE-20)', () => {
  it('earliest: the earlier of the first commit and the task', () => {
    expect(codingStartOf({ setting: 'earliest', ...both })).toMatchObject({
      at: at(14, 9),
      source: 'task',
      taskId: 67210,
    });
    expect(codingStartOf({ setting: 'earliest', ...both, firstCommit: at(13, 15) })).toMatchObject({
      at: at(13, 15),
      source: 'firstCommit',
    });
  });

  it('firstCommit: the commit, else the task', () => {
    expect(codingStartOf({ setting: 'firstCommit', ...both })).toMatchObject({ at: at(20, 10), source: 'firstCommit' });
    expect(codingStartOf({ setting: 'firstCommit', ...both, firstCommit: undefined })).toMatchObject({
      source: 'task',
    });
  });

  it('taskActivated: the task, else the commit', () => {
    expect(codingStartOf({ setting: 'taskActivated', ...both })).toMatchObject({ at: at(14, 9), source: 'task' });
    expect(codingStartOf({ setting: 'taskActivated', ...both, task: undefined })).toMatchObject({
      source: 'firstCommit',
    });
  });

  it('earliest with one source uses it', () => {
    expect(codingStartOf({ setting: 'earliest', ...both, task: undefined })).toMatchObject({ source: 'firstCommit' });
    expect(codingStartOf({ setting: 'earliest', ...both, firstCommit: undefined })).toMatchObject({ source: 'task' });
  });

  it('falls back to the work item (approximate), then to nothing', () => {
    for (const setting of ['earliest', 'firstCommit', 'taskActivated'] as const) {
      expect(codingStartOf({ setting, prCreated: created, workItemActivated: at(13, 9) })).toEqual({
        at: at(13, 9),
        source: 'workItem',
        approximate: true,
      });
      expect(codingStartOf({ setting, prCreated: created })).toBeUndefined();
    }
  });

  it('ignores a source after the creation of the PR', () => {
    expect(codingStartOf({ setting: 'firstCommit', ...both, firstCommit: at(22, 9) })).toMatchObject({
      source: 'task',
    });
    expect(
      codingStartOf({
        setting: 'earliest',
        prCreated: created,
        firstCommit: at(22, 9),
        task: { id: 1, activated: at(23, 9) },
      })
    ).toBeUndefined();
  });
});

describe('settings helpers', () => {
  it('normalizes the value and knows when commits are read', () => {
    expect(normalizeCodingStart('firstCommit')).toBe('firstCommit');
    expect(normalizeCodingStart('nonsense')).toBe('earliest');
    expect(needsFirstCommit('earliest')).toBe(true);
    expect(needsFirstCommit('firstCommit')).toBe(true);
    expect(needsFirstCommit('taskActivated')).toBe(false);
  });
});

describe('oldestCommitDate', () => {
  // The shape of GET pullRequests/{id}/commits (newest first), verified on a PR of User_Interface
  const page = [
    { commitId: 'a', author: { date: '2026-10-23T11:31:39Z' }, committer: { date: '2026-10-23T11:31:39Z' } },
    { commitId: 'b', author: { date: '2026-10-23T07:42:32Z' }, committer: { date: '2026-10-23T09:00:00Z' } },
  ];

  it('takes the oldest author date, whatever the order', () => {
    expect(oldestCommitDate(page)).toBe('2026-10-23T07:42:32Z');
    expect(oldestCommitDate([...page].reverse())).toBe('2026-10-23T07:42:32Z');
  });

  it('falls back to the committer date, ignores bad dates and has nothing for no commit', () => {
    expect(oldestCommitDate([{ committer: { date: '2026-10-20T08:00:00Z' } }, { author: { date: 'x' } }])).toBe(
      '2026-10-20T08:00:00Z'
    );
    expect(oldestCommitDate([])).toBeUndefined();
  });
});

describe('firstCommitsToAsk (TIMELINE-14)', () => {
  const known: FirstCommitCandidate[] = [
    { id: 1, completed: true },
    { id: 2, completed: false, commit: 'new' },
    { id: 3, completed: false, commit: 'c3' },
  ];
  const cache = new Map<number, FirstCommitEntry>([
    [1, { date: 'd' }],
    [2, { commit: 'old', date: 'd' }],
    [3, { commit: 'c3', date: 'd' }],
  ]);

  it('asks again only an open PR that was pushed to, never a merged one, and not the unknown ones', () => {
    expect(firstCommitsToAsk([1, 2, 3, 9], known, cache, new Map(), 0, 10).map((pr) => pr.id)).toEqual([2]);
    expect(firstCommitsToAsk([4], [{ id: 4, completed: true }], new Map(), new Map(), 0, 10)).toHaveLength(1);
  });

  it('retries a failure only after the delay and de-duplicates', () => {
    const only = [{ id: 4, completed: true }];
    expect(firstCommitsToAsk([4], only, new Map(), new Map([[4, 100]]), 105, 10)).toEqual([]);
    expect(firstCommitsToAsk([4, 4], only, new Map(), new Map([[4, 100]]), 110, 10)).toHaveLength(1);
  });
});
