import { describe, expect, it } from 'vitest';
import {
  ageText,
  ClassifiedWorktree,
  classifyWorktrees,
  HygieneInput,
  hygieneReasonText,
  newlyStale,
  originOf,
  ownerText,
  parseBranchFacts,
  pruneOrigins,
  recordOrigin,
  worktreesToNotify,
  sortClassified,
  staleKey,
  WorktreeOrigin,
} from './worktreeHygiene';
import { Worktree } from './worktrees';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-22T12:00:00Z');
const MAIN = '/dev/app';
const ROOT = '/dev/app.worktrees';

const worktree = (branch: string, over: Partial<Worktree> = {}): Worktree => ({
  path: `${ROOT}/${branch}`,
  branch,
  bare: false,
  detached: false,
  prunable: false,
  locked: false,
  ...over,
});
const main = worktree('develop', { path: MAIN });

const origin = (branch: string, over: Partial<WorktreeOrigin> = {}): WorktreeOrigin => ({
  path: `${ROOT}/${branch}`,
  branch,
  kind: 'workItem',
  id: 1,
  createdAt: new Date(NOW - DAY).toISOString(),
  ...over,
});

const input = (over: Partial<HygieneInput> = {}): HygieneInput => ({
  worktrees: [main],
  openFolders: [MAIN],
  origins: [],
  branchFacts: new Map(),
  pullRequests: [],
  activeReviews: [],
  workItems: [],
  now: NOW,
  idleDays: 14,
  ...over,
});

const only = (over: Partial<HygieneInput>): ClassifiedWorktree => {
  const [first] = classifyWorktrees(input(over));
  return first;
};

describe('origins (Rule WORKTREE-ORIGIN-1)', () => {
  it('replaces the origin of the same folder', () => {
    const first = origin('feature/a', { id: 1 });
    const second = origin('feature/a', { id: 2 });
    expect(recordOrigin([first], second)).toEqual([second]);
    expect(recordOrigin([first], origin('feature/b'))).toHaveLength(2);
  });

  it('forgets the origins of the removed worktrees of this repository only', () => {
    const kept = origin('feature/a');
    const gone = origin('feature/gone');
    const otherRepository = origin('x', { path: '/dev/other.worktrees/x' });
    expect(pruneOrigins([kept, gone, otherRepository], [main, worktree('feature/a')])).toEqual([kept, otherRepository]);
  });

  it('forgets nothing when git could not be read', () => {
    expect(pruneOrigins([origin('feature/a')], [])).toHaveLength(1);
  });

  it('needs the same folder and the same branch', () => {
    expect(originOf([origin('feature/a')], worktree('feature/a'))).toBeDefined();
    expect(originOf([origin('feature/a')], worktree('feature/a', { branch: 'feature/b' }))).toBeUndefined();
  });
});

describe('parseBranchFacts', () => {
  it('reads the upstream tracking and the commit date', () => {
    const facts = parseBranchFacts('feature/a\t[gone]\t1700000000\nfeature/b\t[ahead 1]\t1700000100\nfeature/c\t\t\n');
    expect(facts.get('feature/a')).toEqual({ upstreamGone: true, lastCommitAt: 1700000000000 });
    expect(facts.get('feature/b')).toEqual({ upstreamGone: false, lastCommitAt: 1700000100000 });
    expect(facts.get('feature/c')).toEqual({ upstreamGone: false, lastCommitAt: undefined });
  });
});

describe('classifyWorktrees', () => {
  it('never lists the main working tree, bare entries or the folders open in this window (Rule WORKTREE-STALE-7)', () => {
    const here = worktree('feature/here');
    const bare = worktree('x', { path: '/dev/bare.git', bare: true, branch: undefined });
    const result = classifyWorktrees(
      input({ worktrees: [main, here, bare, worktree('feature/a')], openFolders: [here.path] })
    );
    expect(result.map((item) => item.worktree.branch)).toEqual(['feature/a']);
  });

  it('a locked worktree is never stale (Rule WORKTREE-STALE-7)', () => {
    const locked = worktree('feature/a', { locked: true });
    const result = only({
      worktrees: [main, locked],
      pullRequests: [{ id: 5, sourceBranch: 'feature/a', status: 'completed' }],
    });
    expect(result.status).toBe('inUse');
  });

  it('a folder that is gone is stale (Rule WORKTREE-STALE-1)', () => {
    const result = only({ worktrees: [main, worktree('feature/a', { prunable: true })] });
    expect(result).toMatchObject({ status: 'stale', reasons: [{ kind: 'missing' }] });
  });

  it('a merged PR makes it stale, unless another PR of the branch is active (Rule WORKTREE-STALE-2)', () => {
    const merged = { id: 5, sourceBranch: 'feature/a', status: 'completed' };
    expect(only({ worktrees: [main, worktree('feature/a')], pullRequests: [merged] })).toMatchObject({
      status: 'stale',
      reasons: [{ kind: 'merged', pullRequestId: 5 }],
    });
    const active = { id: 6, sourceBranch: 'feature/a', status: 'active' };
    expect(only({ worktrees: [main, worktree('feature/a')], pullRequests: [merged, active] }).status).toBe('inUse');
  });

  it('never takes a base branch as merged', () => {
    const release = worktree('release/1.0');
    const result = only({
      worktrees: [main, release],
      pullRequests: [{ id: 5, sourceBranch: 'release/1.0', status: 'completed' }],
    });
    expect(result.status).toBe('inUse');
  });

  it('an abandoned PR makes it stale when no PR of the branch was merged (Rule WORKTREE-STALE-3)', () => {
    expect(
      only({
        worktrees: [main, worktree('feature/a')],
        pullRequests: [{ id: 5, sourceBranch: 'feature/a', status: 'abandoned' }],
      }).reasons
    ).toEqual([{ kind: 'abandoned', pullRequestId: 5 }]);
  });

  it('a review is over when its PR is no longer active for the user (Rule WORKTREE-STALE-4)', () => {
    const reviewOrigin = origin('feature/a', { kind: 'review', id: 9 });
    const base = { worktrees: [main, worktree('feature/a')], origins: [reviewOrigin] };
    expect(only({ ...base, activeReviews: [] }).reasons).toEqual([{ kind: 'reviewOver', pullRequestId: 9 }]);
    expect(only({ ...base, activeReviews: [{ id: 9, sourceBranch: 'feature/a', myVote: 0 }] }).status).toBe('inUse');
    // Not loaded yet: nothing is concluded
    expect(only({ ...base, activeReviews: undefined }).status).toBe('inUse');
    // Known as merged: the merge says it better
    expect(
      only({ ...base, activeReviews: [], pullRequests: [{ id: 9, sourceBranch: 'feature/a', status: 'completed' }] })
        .reasons
    ).toEqual([{ kind: 'merged', pullRequestId: 9 }]);
  });

  it('a PR of the user that is no longer active makes its worktree stale (Rule WORKTREE-STALE-8)', () => {
    const base = {
      worktrees: [main, worktree('feature/a')],
      origins: [origin('feature/a', { kind: 'myPullRequest', id: 7 })],
    };
    expect(only({ ...base, activeOwnPullRequests: [] }).reasons).toEqual([
      { kind: 'pullRequestClosed', pullRequestId: 7 },
    ]);
    expect(only({ ...base, activeOwnPullRequests: [7] }).status).toBe('inUse');
    expect(only({ ...base, activeOwnPullRequests: undefined }).status).toBe('inUse');
  });

  it('a branch deleted in the remote makes it stale (Rule WORKTREE-STALE-5)', () => {
    expect(
      only({
        worktrees: [main, worktree('feature/a')],
        branchFacts: new Map([['feature/a', { upstreamGone: true, lastCommitAt: NOW }]]),
      }).reasons
    ).toEqual([{ kind: 'upstreamGone' }]);
  });

  it('a closed work item makes it stale: the origin, or all the work items of the branch (Rule WORKTREE-STALE-6)', () => {
    const workItems = [
      { id: 1, title: 'A', state: 'Done', branches: ['feature/a'] },
      { id: 2, title: 'B', state: 'In Progress', branches: ['feature/a'] },
    ];
    const base = { worktrees: [main, worktree('feature/a')], workItems };
    expect(only({ ...base, origins: [origin('feature/a', { id: 1 })] }).reasons).toEqual([
      { kind: 'workItemClosed', workItemId: 1, state: 'Done' },
    ]);
    // Without origin, one of its work items is still in progress
    expect(only(base).status).toBe('inUse');
    expect(only({ ...base, workItems: [workItems[0]] }).status).toBe('stale');
    expect(only({ ...base, workItems: undefined }).status).toBe('inUse');
  });

  it('is idle after idleDays without commits, counted from its creation when later (Rule WORKTREE-IDLE-1)', () => {
    const old = new Map([['feature/a', { upstreamGone: false, lastCommitAt: NOW - 20 * DAY }]]);
    const base = { worktrees: [main, worktree('feature/a')], branchFacts: old };
    expect(only(base)).toMatchObject({ status: 'idle', reasons: [{ kind: 'idle', days: 20 }] });
    expect(only({ ...base, idleDays: 0 }).status).toBe('inUse');
    expect(
      only({ ...base, origins: [origin('feature/a', { createdAt: new Date(NOW - DAY).toISOString() })] }).status
    ).toBe('inUse');
  });

  it('a review the user approved is idle (Rule WORKTREE-IDLE-2)', () => {
    const base = { worktrees: [main, worktree('feature/a')] };
    expect(only({ ...base, activeReviews: [{ id: 9, sourceBranch: 'feature/a', myVote: 10 }] }).reasons).toEqual([
      { kind: 'approved', pullRequestId: 9 },
    ]);
    expect(only({ ...base, activeReviews: [{ id: 9, sourceBranch: 'feature/a', myVote: -5 }] }).status).toBe('inUse');
  });

  it('flags the uncommitted changes without changing the status', () => {
    const result = only({
      worktrees: [main, worktree('feature/a', { prunable: false })],
      pullRequests: [{ id: 5, sourceBranch: 'feature/a', status: 'completed' }],
      dirtyFolders: [`${ROOT}/feature/a`],
    });
    expect(result).toMatchObject({ status: 'stale', dirty: true });
  });
});

describe('owner (Rule WORKTREE-OWNER-1)', () => {
  const base = { worktrees: [main, worktree('feature/a')] };

  it('is the recorded origin first', () => {
    expect(
      only({
        ...base,
        origins: [origin('feature/a', { kind: 'task', id: 3 })],
        workItems: [{ id: 3, title: 'Task', state: 'To Do', branches: [] }],
      }).owner
    ).toEqual({ kind: 'task', id: 3, title: 'Task' });
  });

  it('then the PR of the user, a review, a work item', () => {
    expect(
      only({ ...base, pullRequests: [{ id: 5, sourceBranch: 'feature/a', status: 'active', mine: true, title: 'T' }] })
        .owner
    ).toEqual({ kind: 'myPullRequest', id: 5, title: 'T' });
    expect(only({ ...base, activeReviews: [{ id: 9, sourceBranch: 'feature/a', myVote: 0 }] }).owner).toEqual({
      kind: 'review',
      id: 9,
      title: undefined,
    });
    expect(only({ ...base, workItems: [{ id: 1, title: 'A', state: 'New', branches: ['feature/a'] }] }).owner).toEqual({
      kind: 'workItem',
      id: 1,
      title: 'A',
    });
    expect(only(base).owner).toBeUndefined();
  });
});

describe('texts', () => {
  it('describes the reasons and the owners', () => {
    expect(hygieneReasonText({ kind: 'merged', pullRequestId: 5 })).toBe('PR 5 merged');
    expect(hygieneReasonText({ kind: 'workItemClosed', workItemId: 1, state: 'Done' })).toBe('work item 1 is Done');
    expect(hygieneReasonText({ kind: 'idle', days: 20 })).toBe('no commits for 20 days');
    expect(ownerText({ kind: 'review', id: 9, title: 'Fix' })).toBe('PR 9 (review) Fix');
    expect(ownerText({ kind: 'workItem', id: 1 })).toBe('#1');
  });

  it('tells the age in days', () => {
    expect(ageText(undefined, NOW)).toBeUndefined();
    expect(ageText(NOW - 1000, NOW)).toBe('today');
    expect(ageText(NOW - DAY, NOW)).toBe('1 day ago');
    expect(ageText(NOW - 3 * DAY, NOW)).toBe('3 days ago');
  });
});

describe('sortClassified', () => {
  it('puts the stale ones first, then the idle ones', () => {
    const item = (branch: string, status: ClassifiedWorktree['status']): ClassifiedWorktree => ({
      worktree: worktree(branch),
      status,
      reasons: [],
      dirty: false,
    });
    expect(
      sortClassified([item('c', 'inUse'), item('b', 'idle'), item('z', 'stale'), item('a', 'stale')]).map(
        (entry) => entry.worktree.branch
      )
    ).toEqual(['a', 'z', 'b', 'c']);
  });
});

describe('newlyStale (Rule WORKTREE-NUDGE-1)', () => {
  const stale = (branch: string): ClassifiedWorktree => ({
    worktree: worktree(branch),
    status: 'stale',
    reasons: [{ kind: 'missing' }],
    dirty: false,
  });

  it('notifies nothing the first time, then only the new stale worktrees', () => {
    const first = newlyStale(undefined, [stale('a')]);
    expect(first.notify).toEqual([]);
    expect(first.baseline).toEqual([staleKey(worktree('a'))]);
    const second = newlyStale(first.baseline, [stale('a'), stale('b')]);
    expect(second.notify.map((item) => item.worktree.branch)).toEqual(['b']);
    expect(second.baseline).toHaveLength(2);
  });

  it('ignores the idle and in-use worktrees', () => {
    const idle: ClassifiedWorktree = { ...stale('a'), status: 'idle' };
    expect(newlyStale([], [idle]).notify).toEqual([]);
  });

  it('does not notify again a worktree that looked in use for a while, and forgets the removed ones', () => {
    const first = newlyStale(undefined, [stale('a'), stale('gone')]);
    const flicker = newlyStale(first.baseline, [{ ...stale('a'), status: 'inUse' }]);
    expect(flicker.baseline).toEqual([staleKey(worktree('a'))]);
    expect(newlyStale(flicker.baseline, [stale('a')]).notify).toEqual([]);
  });
});

describe('worktreesToNotify (Rule WORKTREE-NUDGE-2)', () => {
  const item = (reasons: ClassifiedWorktree['reasons']): ClassifiedWorktree => ({
    worktree: worktree('a'),
    status: 'stale',
    reasons,
    dirty: false,
  });

  it('leaves the merges of own PRs to the notifier, when it offers them', () => {
    const merged = item([{ kind: 'merged', pullRequestId: 5 }]);
    expect(worktreesToNotify([merged], (id) => id === 5)).toEqual([]);
    expect(worktreesToNotify([merged], () => false)).toEqual([merged]);
    const alsoGone = item([{ kind: 'merged', pullRequestId: 5 }, { kind: 'upstreamGone' }]);
    expect(worktreesToNotify([alsoGone], () => true)).toEqual([alsoGone]);
  });
});
