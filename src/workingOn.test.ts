import { describe, expect, it } from 'vitest';
import {
  linkCandidates,
  normalizeWorkingOnAnimation,
  splitWorkingOn,
  taskWorkingOn,
  WorkingOnEntry,
  workingOnAnimationClasses,
  workingOnBadge,
  workingOnLevels,
} from './workingOn';
import { otherWorktreeBranches, Worktree } from './worktrees';

function entry(
  id: number,
  overrides: Partial<Omit<WorkingOnEntry, 'workItem'>> & { links?: string[] } = {}
): WorkingOnEntry {
  const { links = [], ...rest } = overrides;
  return { workItem: { id, links: { branches: links.map((name) => ({ name })) } }, pullRequests: [], ...rest };
}

const pr = (branch: string, status = 'active') => ({ status, sourceRefName: `refs/heads/${branch}` });

const BRANCH = 'feature/common/100-the-work';

describe('workingOnLevels', () => {
  it('marks the work item of the checked out branch', () => {
    const entries = [entry(100, { branch: BRANCH }), entry(101, { branch: 'feature/common/101-other' }), entry(102)];
    const levels = workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: true });
    expect([...levels]).toEqual([[100, 'here']]);
  });

  it('marks the work item whose ID is in the branch name even when its own branch is another one', () => {
    const entries = [entry(100, { branch: 'feature/common/100-old-name' })];
    expect(
      workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: true }).get(100)
    ).toBe('here');
  });

  it('marks the work items linked to the PR of the branch', () => {
    const entries = [
      entry(100, { branch: BRANCH, pullRequests: [pr(BRANCH)] }),
      entry(200, { pullRequests: [pr(BRANCH)] }),
      entry(300, { pullRequests: [pr(BRANCH, 'completed')] }),
      entry(400, { pullRequests: [pr('feature/common/400-x')] }),
    ];
    const levels = workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: true });
    expect([...levels.keys()]).toEqual([100, 200]);
  });

  it('marks the work items whose Development section links to the branch', () => {
    const entries = [entry(500, { links: [BRANCH] }), entry(501, { links: ['feature/common/501-x'] })];
    const levels = workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: true });
    expect([...levels.keys()]).toEqual([500]);
  });

  it('only marks the work item of the branch when the linked ones are off', () => {
    const entries = [
      entry(100, { branch: BRANCH }),
      entry(200, { pullRequests: [pr(BRANCH)] }),
      entry(500, { links: [BRANCH] }),
      entry(600, { branch: 'feature/common/600-x' }),
    ];
    const levels = workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: false });
    expect([...levels]).toEqual([[100, 'here']]);
  });

  it('marks the work items of the branches of other worktrees as worktree', () => {
    const other = 'feature/common/101-other';
    const entries = [
      entry(100, { branch: BRANCH }),
      entry(101, { branch: other }),
      entry(201, { pullRequests: [pr(other)] }),
    ];
    const levels = workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [other], entries, includeLinked: true });
    expect([...levels]).toEqual([
      [101, 'worktree'],
      [201, 'worktree'],
      [100, 'here'],
    ]);
  });

  it('prefers here over worktree', () => {
    const entries = [
      entry(100, { branch: BRANCH, pullRequests: [pr(BRANCH)] }),
      entry(200, { pullRequests: [pr(BRANCH)] }),
    ];
    const levels = workingOnLevels({
      currentBranch: BRANCH,
      worktreeBranches: [BRANCH, 'feature/common/200-x'],
      entries,
      includeLinked: true,
    });
    expect(levels.get(100)).toBe('here');
    expect(levels.get(200)).toBe('here');
  });

  it('marks nothing without a branch or on a branch that belongs to no work item', () => {
    const entries = [entry(100, { branch: BRANCH, pullRequests: [pr(BRANCH)] }), entry(500, { links: [BRANCH] })];
    expect(workingOnLevels({ currentBranch: undefined, worktreeBranches: [], entries, includeLinked: true }).size).toBe(
      0
    );
    expect(workingOnLevels({ currentBranch: 'develop', worktreeBranches: [], entries, includeLinked: true }).size).toBe(
      0
    );
    expect(
      workingOnLevels({ currentBranch: 'develop', worktreeBranches: ['main'], entries, includeLinked: false }).size
    ).toBe(0);
  });

  it('matches the Development links written as full refs', () => {
    const entries = [entry(500, { links: [`refs/heads/${BRANCH}`] })];
    expect(
      workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: true }).get(500)
    ).toBe('here');
  });
});

describe('otherWorktreeBranches', () => {
  const worktree = (path: string, overrides: Partial<Worktree> = {}): Worktree => ({
    path,
    bare: false,
    detached: false,
    prunable: false,
    locked: false,
    ...overrides,
  });

  it('skips this window, bare, detached and prunable worktrees', () => {
    const worktrees = [
      worktree('/dev/app', { branch: 'develop' }),
      worktree('/dev/app.worktrees/a', { branch: 'feature/a' }),
      worktree('/dev/app.worktrees/b', { branch: 'feature/b', prunable: true }),
      worktree('/dev/app.worktrees/c', { detached: true }),
      worktree('/dev/app.git', { bare: true, branch: 'x' }),
    ];
    expect(otherWorktreeBranches(worktrees, ['/dev/app'])).toEqual(['feature/a']);
  });

  it('also skips the worktree this window has open', () => {
    const worktrees = [
      worktree('/dev/app', { branch: 'develop' }),
      worktree('/dev/app.worktrees/a', { branch: 'feature/a' }),
    ];
    expect(otherWorktreeBranches(worktrees, ['/dev/app.worktrees/a'])).toEqual(['develop']);
  });
});

describe('workingOnBadge', () => {
  it('has a text and a glyph per level', () => {
    expect(workingOnBadge('here')).toMatchObject({ glyph: '●', label: 'Working on' });
    expect(workingOnBadge('worktree')).toMatchObject({ glyph: '⧉', label: 'In worktree' });
  });

  it('tells the worktree when it is known', () => {
    expect(workingOnBadge('worktree', '/dev/app.worktrees/a').title).toContain('/dev/app.worktrees/a');
    expect(workingOnBadge('worktree').title).toContain('another worktree');
  });
});

describe('splitWorkingOn', () => {
  const items = [
    { id: 1 },
    { id: 2, workingOn: 'worktree' as const },
    { id: 3 },
    { id: 4, workingOn: 'here' as const },
    { id: 5, workingOn: 'worktree' as const },
  ];

  it('moves the work items being worked on to the section: here first, then worktree', () => {
    const { workingOn, rest } = splitWorkingOn(items, true);
    expect(workingOn.map((item) => item.id)).toEqual([4, 2, 5]);
    expect(rest.map((item) => item.id)).toEqual([1, 3]);
  });

  it('does not duplicate any work item', () => {
    const { workingOn, rest } = splitWorkingOn(items, true);
    expect([...workingOn, ...rest].map((item) => item.id).sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps everything in place without a section', () => {
    expect(splitWorkingOn(items, false)).toEqual({ workingOn: [], rest: items });
  });
});

describe('linkCandidates', () => {
  const titled = (base: WorkingOnEntry, type = 'Product Backlog Item') => ({
    ...base,
    workItem: { ...base.workItem, title: `Item ${base.workItem.id}`, type },
  });

  it('puts first, as likely, the other work items that use the branch, and leaves out the primary one', () => {
    const entries = [
      titled(entry(300)),
      titled(entry(100, { branch: BRANCH })),
      titled(entry(200, { links: [`refs/heads/${BRANCH}`] }), 'Bug'),
      titled(entry(400, { branch: BRANCH })),
      titled(entry(500, { branch: 'feature/common/500-other' })),
    ];
    expect(linkCandidates(entries, 100, BRANCH)).toEqual([
      { id: 200, title: 'Item 200', type: 'Bug', likely: true },
      { id: 400, title: 'Item 400', type: 'Product Backlog Item', likely: true },
      { id: 300, title: 'Item 300', type: 'Product Backlog Item', likely: false },
      { id: 500, title: 'Item 500', type: 'Product Backlog Item', likely: false },
    ]);
  });

  it('marks the work item whose ID is in the branch name when it is not the primary one', () => {
    expect(
      linkCandidates([titled(entry(100)), titled(entry(7))], undefined, BRANCH).map((c) => [c.id, c.likely])
    ).toEqual([
      [100, true],
      [7, false],
    ]);
  });

  it('pre-selects nothing when no other work item uses the branch', () => {
    expect(linkCandidates([titled(entry(1)), titled(entry(2))], 1, BRANCH)).toEqual([
      { id: 2, title: 'Item 2', type: 'Product Backlog Item', likely: false },
    ]);
  });
});

describe('working on animation', () => {
  it('maps the settings to CSS classes', () => {
    expect(workingOnAnimationClasses('none', false)).toEqual([]);
    expect(workingOnAnimationClasses('none', true)).toEqual(['pulse-badge']);
    expect(workingOnAnimationClasses('borderLight', false)).toEqual(['anim-borderLight']);
    expect(workingOnAnimationClasses('stripes', true)).toEqual(['anim-stripes', 'pulse-badge']);
  });

  it('falls back to no animation for unknown values', () => {
    expect(normalizeWorkingOnAnimation('glow')).toBe('glow');
    expect(normalizeWorkingOnAnimation('runningBorder')).toBe('runningBorder');
    expect(normalizeWorkingOnAnimation('disco')).toBe('none');
    expect(normalizeWorkingOnAnimation(undefined)).toBe('none');
  });
});

describe('branches of the tasks', () => {
  it('marks the work item through the branch of one of its tasks', () => {
    const entries = [entry(100, { taskBranches: [BRANCH] }), entry(101, { taskBranches: ['feature/x/101-y'] })];
    const levels = workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: true });
    expect([...levels]).toEqual([[100, 'here']]);
  });

  it('marks it as worktree when another worktree has the branch of the task', () => {
    const entries = [entry(100, { taskBranches: [BRANCH] })];
    const levels = workingOnLevels({
      currentBranch: undefined,
      worktreeBranches: [BRANCH],
      entries,
      includeLinked: true,
    });
    expect(levels.get(100)).toBe('worktree');
  });

  it('does not mark it when the linked work items are off', () => {
    const entries = [entry(100, { taskBranches: [BRANCH] })];
    const levels = workingOnLevels({ currentBranch: BRANCH, worktreeBranches: [], entries, includeLinked: false });
    expect(levels.size).toBe(0);
  });
});

describe('taskWorkingOn', () => {
  it('is "here" when a branch of the task is the checked out one', () => {
    expect(taskWorkingOn(['a', BRANCH], BRANCH, [])).toBe('here');
  });

  it('is "worktree" when another worktree has a branch of the task', () => {
    expect(taskWorkingOn([BRANCH], 'main', [BRANCH])).toBe('worktree');
  });

  it('is none otherwise', () => {
    expect(taskWorkingOn([BRANCH], 'main', ['other'])).toBeUndefined();
    expect(taskWorkingOn([], BRANCH, [BRANCH])).toBeUndefined();
    expect(taskWorkingOn([BRANCH], undefined, [])).toBeUndefined();
  });

  it('"here" wins over "worktree"', () => {
    expect(taskWorkingOn([BRANCH, 'b'], BRANCH, ['b'])).toBe('here');
  });
});
