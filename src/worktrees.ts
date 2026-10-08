/** Git worktrees: parsing, locations and decisions. Pure: no "vscode" import */
import * as path from 'node:path';

export interface Worktree {
  /** Absolute path of the working directory */
  path: string;
  /** Branch checked out, without "refs/heads/"; undefined when detached or bare */
  branch?: string;
  /** Commit checked out (HEAD) */
  head?: string;
  bare: boolean;
  detached: boolean;
  /** The directory is gone: `git worktree prune` removes the entry */
  prunable: boolean;
  locked: boolean;
}

const HEADS = 'refs/heads/';

/** Parses the output of `git worktree list --porcelain` (entries separated by blank lines) */
export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];
  for (const block of output.split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    const first = lines.find((line) => line.startsWith('worktree '));
    if (!first) {
      continue;
    }
    const entry: Worktree = {
      path: first.slice('worktree '.length),
      bare: false,
      detached: false,
      prunable: false,
      locked: false,
    };
    for (const line of lines) {
      if (line.startsWith('HEAD ')) {
        entry.head = line.slice('HEAD '.length);
      } else if (line.startsWith('branch ')) {
        const ref = line.slice('branch '.length);
        entry.branch = ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref;
      } else if (line === 'bare') {
        entry.bare = true;
      } else if (line === 'detached') {
        entry.detached = true;
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        entry.prunable = true;
      } else if (line === 'locked' || line.startsWith('locked ')) {
        entry.locked = true;
      }
    }
    worktrees.push(entry);
  }
  return worktrees;
}

/** Compares two paths ignoring separators, a trailing slash and (on Windows) the case */
export function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  return normalize(a) === normalize(b);
}

/**
 * Worktree where the branch is checked out, ignoring the folders in `exclude` (the one open in this window) and the
 * entries whose directory is gone
 */
export function findWorktree(worktrees: Worktree[], branch: string, exclude: string[] = []): Worktree | undefined {
  return worktrees.find(
    (worktree) =>
      worktree.branch === branch && !worktree.prunable && !exclude.some((folder) => samePath(folder, worktree.path))
  );
}

/** Branches checked out in the worktrees other than the folders open in this window */
export function otherWorktreeBranches(worktrees: Worktree[], openFolders: string[]): string[] {
  return worktrees
    .filter(
      (worktree) =>
        worktree.branch &&
        !worktree.bare &&
        !worktree.prunable &&
        !openFolders.some((folder) => samePath(folder, worktree.path))
    )
    .map((worktree) => worktree.branch as string);
}

/**
 * Where the worktree of a branch is created: next to the repository, in "<repository folder>.worktrees", with the
 * slashes of the branch name as subfolders: /dev/app + feature/x/12-y -> /dev/app.worktrees/feature/x/12-y
 */
export function worktreePath(repositoryRoot: string, branch: string): string {
  const segments = branch.split('/');
  if (!branch || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`The branch name "${branch}" cannot be used as a folder name.`);
  }
  const root = path.resolve(repositoryRoot);
  return path.join(path.dirname(root), `${path.basename(root)}.worktrees`, ...segments);
}

/** Relative paths of the untracked env files copied to a new worktree, given the subfolders of apps, packages and tools */
export const ENV_FILE_NAME = '.env.local';
export const ENV_PARENT_FOLDERS = ['apps', 'packages', 'tools'] as const;

export function envFileCandidates(
  subfolders: Partial<Record<(typeof ENV_PARENT_FOLDERS)[number], string[]>>
): string[] {
  const nested = ENV_PARENT_FOLDERS.flatMap((parent) =>
    (subfolders[parent] ?? [])
      .filter((name) => name && name !== '.' && name !== '..' && !/[\\/]/.test(name))
      .map((name) => `${parent}/${name}/${ENV_FILE_NAME}`)
  );
  return [ENV_FILE_NAME, ...nested];
}

/** What git reports about the working directory of the repository (vscode.git API) */
export interface ChangeCounts {
  workingTree: number;
  index: number;
  untracked?: number;
  merge?: number;
}

/** Uncommitted changes, including untracked files */
export function hasUncommittedChanges(counts: ChangeCounts): boolean {
  return counts.workingTree + counts.index + (counts.untracked ?? 0) + (counts.merge ?? 0) > 0;
}

/** azdoWorkItems.checkout.mode */
export type CheckoutMode = 'ask' | 'branch' | 'worktree';
export type CheckoutChoice = 'here' | 'worktree';

export function parseCheckoutMode(value: unknown): CheckoutMode {
  return value === 'branch' || value === 'worktree' ? value : 'ask';
}

/**
 * What a Checkout does: "here" (switch the branch of this window), "worktree" or "ask" the user.
 * An explicit choice (the ▾ menu) skips the mode and the question
 */
export function decideCheckout(options: {
  mode: CheckoutMode;
  dirty: boolean;
  choice?: CheckoutChoice;
}): CheckoutChoice | 'ask' {
  if (options.choice) {
    return options.choice;
  }
  switch (options.mode) {
    case 'branch':
      return 'here';
    case 'worktree':
      return 'worktree';
    case 'ask':
      return options.dirty ? 'ask' : 'here';
  }
}

/** Marker written in the private git directory of a new worktree: the window that opens it runs `npm ci` once */
export const SETUP_MARKER_FILE = 'azdo-workitems-setup.json';

export interface SetupMarker {
  npmCi: boolean;
  createdAt?: string;
}

export function serializeSetupMarker(marker: SetupMarker): string {
  return JSON.stringify(marker, undefined, 2);
}

/** Undefined when the text is not a valid marker */
export function parseSetupMarker(text: string): SetupMarker | undefined {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const { npmCi, createdAt } = value as Record<string, unknown>;
    return {
      npmCi: npmCi === true,
      createdAt: typeof createdAt === 'string' ? createdAt : undefined,
    };
  } catch {
    return undefined;
  }
}

export function stashMessage(branch: string): string {
  return `azdo-workitems: before checking out ${branch}`;
}

/** The "<repository folder>.worktrees" folder that holds the worktrees created by this extension */
export function worktreesRoot(mainWorktreePath: string): string {
  const root = path.resolve(mainWorktreePath);
  return path.join(path.dirname(root), `${path.basename(root)}.worktrees`);
}

/** The main working tree is the first entry that `git worktree list` prints */
export function isMainWorktree(worktrees: Worktree[], target: Worktree): boolean {
  const main = worktrees[0];
  return !!main && samePath(main.path, target.path);
}

/** Why a worktree cannot be removed, or undefined when it can */
export function removalBlocker(
  worktrees: Worktree[],
  target: Worktree,
  currentFolders: string[]
): 'main' | 'current' | 'bare' | undefined {
  if (isMainWorktree(worktrees, target)) {
    return 'main';
  }
  if (target.bare) {
    return 'bare';
  }
  return currentFolders.some((folder) => samePath(folder, target.path)) ? 'current' : undefined;
}

/** All the worktrees except the main one, bare entries and the folders open in this window */
export function removableWorktrees(worktrees: Worktree[], currentFolders: string[]): Worktree[] {
  return worktrees.filter((worktree) => !removalBlocker(worktrees, worktree, currentFolders));
}

export function worktreeLabel(worktree: Worktree): string {
  if (worktree.branch) {
    return worktree.branch;
  }
  return `detached${worktree.head ? ` at ${worktree.head.slice(0, 7)}` : ''}`;
}

/** Path relative to the folder that contains the repository (shows "<repo>.worktrees/feature/x") */
export function worktreeDescription(mainWorktreePath: string, worktree: Worktree): string {
  const relative = path.relative(path.dirname(path.resolve(mainWorktreePath)), worktree.path);
  return relative.split(path.sep).join('/');
}

/** Detail line of the removal QuickPick: "uncommitted changes", "prunable (folder missing)", "locked" */
export function worktreeDetail(worktree: Worktree, dirty: boolean): string {
  const parts = [
    ...(dirty ? ['uncommitted changes'] : []),
    ...(worktree.prunable ? ['prunable (folder missing)'] : []),
    ...(worktree.locked ? ['locked'] : []),
  ];
  return parts.join(', ');
}

/**
 * Folders that may be empty after removing a worktree: its parents up to, and not including, `root`, deepest first.
 * Empty when the worktree is not inside `root`
 */
export function emptyParentCandidates(worktreeFolder: string, root: string): string[] {
  const boundary = path.resolve(root);
  const candidates: string[] = [];
  let folder = path.dirname(path.resolve(worktreeFolder));
  while (folder !== boundary && folder.startsWith(boundary + path.sep)) {
    candidates.push(folder);
    folder = path.dirname(folder);
  }
  return folder === boundary ? candidates : [];
}
