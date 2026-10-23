import { describe, expect, it } from 'vitest';
import {
  branchActionOrder,
  decideCheckout,
  emptyParentCandidates,
  envFileCandidates,
  findWorktree,
  hasUncommittedChanges,
  mainWorktreeFolder,
  worktreeOpenAction,
  parseCheckoutMode,
  parseSetupMarker,
  parseWorktreeList,
  removableWorktrees,
  removalBlocker,
  samePath,
  serializeSetupMarker,
  stashMessage,
  windowWorktree,
  Worktree,
  worktreeDescription,
  worktreeStatusBarView,
  worktreeDetail,
  worktreeLabel,
  worktreePath,
  worktreesRoot,
} from './worktrees';

const PORCELAIN = `worktree /home/dev/ABB/User_Interface
HEAD 1111111111111111111111111111111111111111
branch refs/heads/develop

worktree /home/dev/ABB/User_Interface.worktrees/feature/fui-apps-artificial-lift/59260-adjust-rest-dialogs
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feature/fui-apps-artificial-lift/59260-adjust-rest-dialogs

worktree /home/dev/ABB/detached
HEAD 3333333333333333333333333333333333333333
detached

worktree /home/dev/ABB/bare.git
bare

worktree /home/dev/ABB/gone
HEAD 4444444444444444444444444444444444444444
branch refs/heads/feature/gone
locked reason here
prunable gitdir file points to non-existent location
`;

describe('parseWorktreeList', () => {
  const list = parseWorktreeList(PORCELAIN);

  it('reads the path and branch of a normal entry', () => {
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ path: '/home/dev/ABB/User_Interface', branch: 'develop', bare: false });
    expect(list[1].branch).toBe('feature/fui-apps-artificial-lift/59260-adjust-rest-dialogs');
  });

  it('flags detached, bare, locked and prunable entries', () => {
    expect(list[2].detached).toBe(true);
    expect(list[2].branch).toBeUndefined();
    expect(list[3].bare).toBe(true);
    expect(list[3].branch).toBeUndefined();
    expect(list[4]).toMatchObject({ prunable: true, locked: true, branch: 'feature/gone' });
  });

  it('handles CRLF, paths with spaces and empty output', () => {
    expect(parseWorktreeList('worktree C:/my repo\r\nHEAD abc\r\nbranch refs/heads/x\r\n\r\n')).toEqual([
      { path: 'C:/my repo', head: 'abc', branch: 'x', bare: false, detached: false, prunable: false, locked: false },
    ]);
    expect(parseWorktreeList('')).toEqual([]);
  });
});

describe('findWorktree', () => {
  const list = parseWorktreeList(PORCELAIN);

  it('finds the worktree of a branch', () => {
    expect(findWorktree(list, 'develop')?.path).toBe('/home/dev/ABB/User_Interface');
  });

  it('ignores the folder open in this window and prunable entries', () => {
    expect(findWorktree(list, 'develop', ['/home/dev/ABB/User_Interface/'])).toBeUndefined();
    expect(findWorktree(list, 'feature/gone')).toBeUndefined();
    expect(findWorktree(list, 'nope')).toBeUndefined();
  });
});

describe('samePath', () => {
  it('ignores trailing slashes and dot segments', () => {
    expect(samePath('/a/b/', '/a/b')).toBe(true);
    expect(samePath('/a/b/../b', '/a/b')).toBe(true);
    expect(samePath('/a/b', '/a/c')).toBe(false);
  });
});

describe('worktreePath', () => {
  it('goes next to the repository, with the slashes of the branch as subfolders', () => {
    expect(worktreePath('/home/dev/ABB/User_Interface', 'feature/fui-admin/5641-x')).toBe(
      '/home/dev/ABB/User_Interface.worktrees/feature/fui-admin/5641-x'
    );
  });

  it('supports branches without slashes and trailing slashes of the root', () => {
    expect(worktreePath('/work/app/', 'hotfix')).toBe('/work/app.worktrees/hotfix');
  });

  it('rejects names that escape the folder', () => {
    expect(() => worktreePath('/a/b', '../x')).toThrow();
    expect(() => worktreePath('/a/b', 'a//b')).toThrow();
    expect(() => worktreePath('/a/b', '')).toThrow();
  });
});

describe('mainWorktreeFolder', () => {
  const entry = (folder: string, extra: Partial<Worktree> = {}): Worktree => ({
    path: folder,
    bare: false,
    detached: false,
    prunable: false,
    locked: false,
    ...extra,
  });
  const current = '/dev/app.worktrees/feature/x/1-a';
  const list = [entry('/dev/app', { branch: 'develop' }), entry(current, { branch: 'feature/x/1-a' })];

  it('is the main working tree, also from a worktree', () => {
    expect(mainWorktreeFolder(list, current)).toBe('/dev/app');
  });

  it('keeps new worktrees next to the main repository instead of nesting them', () => {
    expect(worktreePath(mainWorktreeFolder(list, current), 'feature/y/2-b')).toBe('/dev/app.worktrees/feature/y/2-b');
  });

  it('falls back to the open folder without a list or with a bare main entry', () => {
    expect(mainWorktreeFolder([], current)).toBe(current);
    expect(mainWorktreeFolder([entry('/dev/app.git', { bare: true }), ...list.slice(1)], current)).toBe(current);
  });
});

describe('envFileCandidates', () => {
  it('lists the root and the first-level subfolders of apps, packages and tools', () => {
    expect(envFileCandidates({ apps: ['fui-e2e', 'web'], packages: ['ui'], tools: [] })).toEqual([
      '.env.local',
      'apps/fui-e2e/.env.local',
      'apps/web/.env.local',
      'packages/ui/.env.local',
    ]);
  });

  it('only has the root file without subfolders and drops unsafe names', () => {
    expect(envFileCandidates({})).toEqual(['.env.local']);
    expect(envFileCandidates({ apps: ['..', 'a/b', 'c\\d', ''] })).toEqual(['.env.local']);
  });
});

describe('hasUncommittedChanges', () => {
  it('counts working tree, index and untracked changes', () => {
    expect(hasUncommittedChanges({ workingTree: 0, index: 0 })).toBe(false);
    expect(hasUncommittedChanges({ workingTree: 1, index: 0 })).toBe(true);
    expect(hasUncommittedChanges({ workingTree: 0, index: 2 })).toBe(true);
    expect(hasUncommittedChanges({ workingTree: 0, index: 0, untracked: 3 })).toBe(true);
    expect(hasUncommittedChanges({ workingTree: 0, index: 0, merge: 1 })).toBe(true);
  });
});

describe('decideCheckout', () => {
  it('ask: checks out when clean and asks when dirty', () => {
    expect(decideCheckout({ mode: 'ask', dirty: false })).toBe('here');
    expect(decideCheckout({ mode: 'ask', dirty: true })).toBe('ask');
  });

  it('branch and worktree modes never ask', () => {
    expect(decideCheckout({ mode: 'branch', dirty: true })).toBe('here');
    expect(decideCheckout({ mode: 'worktree', dirty: true })).toBe('worktree');
    expect(decideCheckout({ mode: 'worktree', dirty: false })).toBe('worktree');
  });

  it('an explicit choice wins over the mode', () => {
    expect(decideCheckout({ mode: 'branch', dirty: true, choice: 'worktree' })).toBe('worktree');
    expect(decideCheckout({ mode: 'worktree', dirty: false, choice: 'here' })).toBe('here');
    expect(decideCheckout({ mode: 'ask', dirty: true, choice: 'here' })).toBe('here');
  });
});

describe('parseCheckoutMode', () => {
  it('falls back to ask', () => {
    expect(parseCheckoutMode('worktree')).toBe('worktree');
    expect(parseCheckoutMode('branch')).toBe('branch');
    expect(parseCheckoutMode('ask')).toBe('ask');
    expect(parseCheckoutMode('other')).toBe('ask');
    expect(parseCheckoutMode(undefined)).toBe('ask');
  });
});

describe('setup marker', () => {
  it('round-trips', () => {
    const text = serializeSetupMarker({ npmCi: true, createdAt: '2026-01-02T03:04:05.000Z' });
    expect(parseSetupMarker(text)).toEqual({ npmCi: true, createdAt: '2026-01-02T03:04:05.000Z' });
  });

  it('is strict about npmCi and tolerant of missing fields', () => {
    expect(parseSetupMarker('{"npmCi":"yes"}')).toEqual({ npmCi: false, createdAt: undefined });
    expect(parseSetupMarker('{}')).toEqual({ npmCi: false, createdAt: undefined });
  });

  it('rejects text that is not a marker', () => {
    expect(parseSetupMarker('')).toBeUndefined();
    expect(parseSetupMarker('not json')).toBeUndefined();
    expect(parseSetupMarker('null')).toBeUndefined();
    expect(parseSetupMarker('42')).toBeUndefined();
  });
});

describe('stashMessage', () => {
  it('names the branch being checked out', () => {
    expect(stashMessage('feature/x')).toBe('azdo-workitems: before checking out feature/x');
  });
});

const entry = (path: string, extra: Partial<Worktree> = {}): Worktree => ({
  path,
  bare: false,
  detached: false,
  prunable: false,
  locked: false,
  ...extra,
});

const MAIN = '/dev/app';
const LIST: Worktree[] = [
  entry(MAIN, { branch: 'develop' }),
  entry('/dev/app.worktrees/feature/a/1-x', { branch: 'feature/a/1-x' }),
  entry('/dev/app.worktrees/feature/a/2-y', { branch: 'feature/a/2-y', locked: true }),
  entry('/dev/app.worktrees/detached', { detached: true, head: 'abcdef0123456789' }),
];

describe('removableWorktrees', () => {
  it('excludes the main working tree and the folder of this window', () => {
    const paths = removableWorktrees(LIST, [MAIN, '/dev/app.worktrees/feature/a/1-x']).map((w) => w.path);
    expect(paths).toEqual(['/dev/app.worktrees/feature/a/2-y', '/dev/app.worktrees/detached']);
  });

  it('never offers the main tree, even when this window is a worktree', () => {
    const paths = removableWorktrees(LIST, ['/dev/app.worktrees/detached']).map((w) => w.path);
    expect(paths).not.toContain(MAIN);
    expect(paths).toHaveLength(2);
  });

  it('excludes bare entries', () => {
    const list = [entry('/dev/app.git', { bare: true }), entry('/dev/other', { branch: 'x' })];
    expect(removableWorktrees(list, [])).toEqual([list[1]]);
  });
});

describe('removalBlocker', () => {
  it('tells why a worktree is not removed', () => {
    expect(removalBlocker(LIST, LIST[0], [])).toBe('main');
    expect(removalBlocker(LIST, LIST[1], ['/dev/app.worktrees/feature/a/1-x/'])).toBe('current');
    expect(removalBlocker(LIST, LIST[1], [])).toBeUndefined();
  });
});

describe('windowWorktree (Rule WORKTREE-WINDOW-1)', () => {
  it('tells the main folder, counting the other worktrees', () => {
    expect(windowWorktree(LIST, [MAIN])).toEqual({ kind: 'main', main: LIST[0], current: LIST[0], others: 3 });
  });

  it('tells a linked worktree, also through a path written differently', () => {
    expect(windowWorktree(LIST, ['/somewhere/else', '/dev/app.worktrees/feature/a/1-x/'])).toEqual({
      kind: 'worktree',
      main: LIST[0],
      current: LIST[1],
      others: 2,
    });
  });

  it('does not count the worktrees whose folder is gone', () => {
    const list = [...LIST, entry('/dev/app.worktrees/gone', { branch: 'gone', prunable: true })];
    expect(windowWorktree(list, [MAIN])?.others).toBe(3);
  });

  it('is unknown when the folder is not listed or the main entry is bare', () => {
    expect(windowWorktree(LIST, ['/elsewhere'])).toBeUndefined();
    expect(windowWorktree([], [MAIN])).toBeUndefined();
    const bare = [entry('/dev/app.git', { bare: true }), entry('/dev/app', { branch: 'develop' })];
    expect(windowWorktree(bare, ['/dev/app'])).toBeUndefined();
  });
});

describe('worktreeStatusBarView', () => {
  it('shows the main folder without highlight', () => {
    const view = worktreeStatusBarView({ kind: 'main', main: LIST[0], current: LIST[0], others: 1 });
    expect(view).toMatchObject({ text: '$(repo) main', highlight: false, title: 'Main folder of app' });
    expect(view.lines).toContain('1 worktree');
  });

  it('highlights a worktree and names the main folder', () => {
    const view = worktreeStatusBarView({ kind: 'worktree', main: LIST[0], current: LIST[1], others: 0 });
    expect(view).toMatchObject({ text: '$(list-tree) worktree', highlight: true, title: 'Worktree of app' });
    expect(view.lines).toEqual([
      'app.worktrees/feature/a/1-x',
      'Main folder: /dev/app',
      'No other worktrees',
      'Click to open the main folder in a new window',
    ]);
  });
});

describe('worktree texts', () => {
  it('labels with the branch or the short sha', () => {
    expect(worktreeLabel(LIST[1])).toBe('feature/a/1-x');
    expect(worktreeLabel(LIST[3])).toBe('detached at abcdef0');
    expect(worktreeLabel(entry('/x', { detached: true }))).toBe('detached');
  });

  it('describes the path relative to the parent of the repository', () => {
    expect(worktreeDescription(MAIN, LIST[1])).toBe('app.worktrees/feature/a/1-x');
  });

  it('lists what the user should know', () => {
    expect(worktreeDetail(LIST[1], false)).toBe('');
    expect(worktreeDetail(LIST[2], true)).toBe('uncommitted changes, locked');
    expect(worktreeDetail(entry('/x', { prunable: true }), false)).toBe('prunable (folder missing)');
  });
});

describe('worktreesRoot', () => {
  it('is next to the repository', () => {
    expect(worktreesRoot('/dev/app')).toBe('/dev/app.worktrees');
  });
});

describe('emptyParentCandidates', () => {
  it('lists the folders between the worktree and the root, deepest first', () => {
    expect(emptyParentCandidates('/dev/app.worktrees/bugfix/fui-admin/66280-x', '/dev/app.worktrees')).toEqual([
      '/dev/app.worktrees/bugfix/fui-admin',
      '/dev/app.worktrees/bugfix',
    ]);
  });

  it('has none for a worktree directly in the root', () => {
    expect(emptyParentCandidates('/dev/app.worktrees/x', '/dev/app.worktrees/')).toEqual([]);
  });

  it('has none when the worktree is outside the root (never walks up to unrelated folders)', () => {
    expect(emptyParentCandidates('/elsewhere/a/b', '/dev/app.worktrees')).toEqual([]);
    expect(emptyParentCandidates('/dev/app.worktrees-other/a/b', '/dev/app.worktrees')).toEqual([]);
  });
});

describe('branchActionOrder', () => {
  it('puts the worktree first in worktree mode', () => {
    expect(branchActionOrder('worktree')).toEqual(['worktree', 'here']);
  });

  it('puts the checkout first in the other modes', () => {
    expect(branchActionOrder('ask')).toEqual(['here', 'worktree']);
    expect(branchActionOrder('branch')).toEqual(['here', 'worktree']);
  });
});

describe('worktreeOpenAction (Rules WORKTREE-OPEN-1, WORKTREE-OPEN-2)', () => {
  it('opens the worktree that exists and creates it otherwise', () => {
    expect(worktreeOpenAction(true)).toBe('open');
    expect(worktreeOpenAction(false)).toBe('create');
  });
});
