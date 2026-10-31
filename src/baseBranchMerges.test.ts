import { describe, expect, it } from 'vitest';
import { mergedPullRequestOfMessage, mergesBetween, mergesOfCommits, type BaseMerge } from './baseBranchMerges';

describe('merges of the base branch (TIMELINE-38)', () => {
  it('reads the PR of a squash merge message', () => {
    expect(mergedPullRequestOfMessage('Merged PR 14002: [67560] Fix the thing')).toBe(14002);
    expect(mergedPullRequestOfMessage('Merge branch develop into feature')).toBeUndefined();
    expect(mergedPullRequestOfMessage('Revert "Merged PR 14002: x"')).toBeUndefined();
    expect(mergedPullRequestOfMessage(undefined)).toBeUndefined();
  });

  it('keeps the merges among the commits, with the committer date', () => {
    expect(
      mergesOfCommits([
        { commitId: 'c3', comment: 'Merged PR 14054: b', committer: { date: '2026-10-28T10:00:00Z' } },
        { commitId: 'c2', comment: 'Some other commit', committer: { date: '2026-10-27T10:00:00Z' } },
        { commitId: 'c1', comment: 'Merged PR 14002: a', author: { date: '2026-10-26T10:00:00Z' } },
        { commitId: 'c0', comment: 'Merged PR 1: no date' },
      ])
    ).toEqual([
      { pullRequestId: 14054, at: '2026-10-28T10:00:00Z', commit: 'c3' },
      { pullRequestId: 14002, at: '2026-10-26T10:00:00Z', commit: 'c1' },
    ]);
  });

  describe('mergesBetween', () => {
    const merges: BaseMerge[] = ['d', 'c', 'b', 'a'].map((commit, i) => ({
      pullRequestId: 4 - i,
      at: '2026-10-28T10:00:00Z',
      commit,
    }));

    it('is after the previous head up to the head, newest first', () => {
      expect(mergesBetween(merges, 'a', 'd')?.map((merge) => merge.pullRequestId)).toEqual([4, 3, 2]);
      expect(mergesBetween(merges, 'c', 'd')?.map((merge) => merge.pullRequestId)).toEqual([4]);
    });

    it('is empty for the same head, and undefined when it cannot be told', () => {
      expect(mergesBetween(merges, 'c', 'c')).toEqual([]);
      expect(mergesBetween(merges, 'zz', 'd')).toBeUndefined();
      expect(mergesBetween(merges, 'a', 'zz')).toBeUndefined();
      expect(mergesBetween(merges, 'd', 'a')).toBeUndefined();
    });
  });
});
