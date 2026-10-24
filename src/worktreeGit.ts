/** Git commands for worktrees and stashes, run with the git CLI (no shell). No "vscode" import */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { copyFile, readdir, readFile, rmdir, rm, stat, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { BranchFacts, parseBranchFacts } from './worktreeHygiene';
import {
  ENV_PARENT_FOLDERS,
  envFileCandidates,
  parseSetupMarker,
  emptyParentCandidates,
  parseWorktreeList,
  removalBlocker,
  serializeSetupMarker,
  SETUP_MARKER_FILE,
  SetupMarker,
  Worktree,
  worktreesRoot,
} from './worktrees';

const MAX_BUFFER = 16 * 1024 * 1024;

/** Runs git in `cwd` and returns its output. The error carries what git printed */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: MAX_BUFFER, windowsHide: true }, (error, stdout, stderr) => {
      if (!error) {
        resolve(stdout);
        return;
      }
      const output = (stderr || stdout || error.message).trim();
      reject(new Error(`git ${args.slice(0, 2).join(' ')} failed: ${output}`));
    });
  });
}

export async function listWorktrees(cwd: string): Promise<Worktree[]> {
  return parseWorktreeList(await git(cwd, ['worktree', 'list', '--porcelain']));
}

/** Upstream tracking and last commit date of every local branch, with one git call (no fetch) */
export async function readBranchFacts(cwd: string): Promise<Map<string, BranchFacts>> {
  return parseBranchFacts(
    await git(cwd, [
      'for-each-ref',
      '--format=%(refname:short)%09%(upstream:track)%09%(committerdate:unix)',
      'refs/heads',
    ])
  );
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ['show-ref', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

export interface CreatedWorktree {
  path: string;
  /** "local": the local branch existed; "tracking": a local branch was created from the remote one */
  source: 'local' | 'tracking';
}

/**
 * Creates the worktree of a branch. The branch is fetched from the remote first (a failed fetch is only fatal when
 * there is no local branch). With a local branch it is checked out in the worktree; otherwise a local branch tracking
 * the remote one is created
 */
export async function createWorktree(
  cwd: string,
  remote: string,
  branch: string,
  target: string
): Promise<CreatedWorktree> {
  let fetchError: Error | undefined;
  try {
    await git(cwd, ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  } catch (error) {
    fetchError = error as Error;
  }
  if (await refExists(cwd, `refs/heads/${branch}`)) {
    await git(cwd, ['worktree', 'add', target, branch]);
    return { path: target, source: 'local' };
  }
  if (!(await refExists(cwd, `refs/remotes/${remote}/${branch}`))) {
    throw new Error(
      fetchError
        ? `The branch ${branch} is not available locally and could not be fetched from ${remote}: ${fetchError.message}`
        : `The branch ${branch} does not exist locally or in ${remote}.`
    );
  }
  await git(cwd, ['worktree', 'add', '--track', '-b', branch, target, `${remote}/${branch}`]);
  return { path: target, source: 'tracking' };
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function subfolders(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Copies the untracked env files (.env.local at the root and in the first-level subfolders of apps, packages and
 * tools) to the same place in the worktree. Only the ones that exist, whose destination folder exists (the branch
 * has that app) and whose destination file does not. Returns the relative paths copied
 */
export async function copyEnvFiles(repositoryRoot: string, worktreeRoot: string): Promise<string[]> {
  const found = Object.fromEntries(
    await Promise.all(
      ENV_PARENT_FOLDERS.map(async (parent) => [parent, await subfolders(path.join(repositoryRoot, parent))] as const)
    )
  );
  const copied: string[] = [];
  for (const relative of envFileCandidates(found)) {
    const source = path.join(repositoryRoot, relative);
    const destination = path.join(worktreeRoot, relative);
    if (!(await exists(source)) || !(await exists(path.dirname(destination)))) {
      continue;
    }
    try {
      await copyFile(source, destination, constants.COPYFILE_EXCL);
      copied.push(relative);
    } catch {
      // The destination exists: never overwritten
    }
  }
  return copied;
}

/** Private git directory of a working directory: for a worktree, <repository>/.git/worktrees/<name> */
async function gitDirectory(folder: string): Promise<string> {
  return (await git(folder, ['rev-parse', '--absolute-git-dir'])).trim();
}

/** Asks the window that opens the worktree to run `npm ci`. Written inside the git directory: never in the working tree */
export async function writeSetupMarker(worktreeRoot: string, marker: SetupMarker): Promise<string> {
  const file = path.join(await gitDirectory(worktreeRoot), SETUP_MARKER_FILE);
  await writeFile(file, serializeSetupMarker(marker), 'utf8');
  return file;
}

/**
 * Asks the window that opens the worktree to open Work Item Details panels, keeping a pending `npm ci` (the marker of
 * a worktree just created). Fails silently: the panels are a convenience
 */
export async function addDetailsToSetupMarker(worktreeRoot: string, ids: number[]): Promise<void> {
  try {
    const file = path.join(await gitDirectory(worktreeRoot), SETUP_MARKER_FILE);
    const existing = await readFile(file, 'utf8').then(parseSetupMarker, () => undefined);
    const marker = { npmCi: existing?.npmCi ?? false, createdAt: new Date().toISOString(), openDetails: ids };
    await writeFile(file, serializeSetupMarker(marker), 'utf8');
  } catch {
    // Without the marker the panels are simply not opened
  }
}

/** Reads and deletes the marker of a folder, so the setup runs once. Undefined when there is none (or not a git folder) */
export async function takeSetupMarker(folder: string): Promise<SetupMarker | undefined> {
  let file: string;
  try {
    file = path.join(await gitDirectory(folder), SETUP_MARKER_FILE);
  } catch {
    return undefined;
  }
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    return undefined;
  }
  await rm(file, { force: true });
  return parseSetupMarker(text);
}

export async function worktreeHasChanges(worktreeRoot: string): Promise<boolean> {
  return (await git(worktreeRoot, ['status', '--porcelain'])).trim().length > 0;
}

/**
 * Same, for background checks: `--no-optional-locks` keeps git from refreshing the index, so it never takes the
 * index.lock that a commit in the worktree's own window may need at that moment
 */
export async function worktreeHasChangesInBackground(worktreeRoot: string): Promise<boolean> {
  return (await git(worktreeRoot, ['--no-optional-locks', 'status', '--porcelain'])).trim().length > 0;
}

/** Removes the worktree; without `force` git refuses when it has uncommitted changes */
export async function removeWorktree(cwd: string, target: string, force = false): Promise<void> {
  await git(cwd, ['worktree', 'remove', ...(force ? ['--force'] : []), target]);
}

async function stashTop(cwd: string): Promise<string | undefined> {
  try {
    return (await git(cwd, ['rev-parse', '-q', '--verify', 'refs/stash'])).trim();
  } catch {
    return undefined;
  }
}

/** Stashes the changes, including the untracked files. Returns false when there was nothing to stash */
export async function stashPush(cwd: string, message: string): Promise<boolean> {
  const before = await stashTop(cwd);
  await git(cwd, ['stash', 'push', '--include-untracked', '-m', message]);
  return (await stashTop(cwd)) !== before;
}

/** Brings back the last stash (used when the checkout fails after stashing) */
export async function stashPop(cwd: string): Promise<void> {
  await git(cwd, ['stash', 'pop']);
}

/** Removes the entries of the worktrees whose folder is gone */
export async function pruneWorktrees(cwd: string): Promise<void> {
  await git(cwd, ['worktree', 'prune']);
}

/**
 * Removes the empty folders that a removed worktree leaves between it and `root` (deepest first). A folder with
 * anything inside (another worktree) stops the cleanup. `root` itself is never removed. Returns the folders removed
 */
export async function removeEmptyParents(worktreeFolder: string, root: string): Promise<string[]> {
  const removed: string[] = [];
  for (const folder of emptyParentCandidates(worktreeFolder, root)) {
    try {
      // rmdir refuses a folder that is not empty: nothing else is ever deleted
      await rmdir(folder);
      removed.push(folder);
    } catch {
      break;
    }
  }
  return removed;
}

export type RemovalResult =
  | { status: 'removed'; forced: boolean; foldersRemoved: string[] }
  | { status: 'pruned' }
  | { status: 'skipped'; reason: 'main' | 'current' | 'bare' | 'locked' };

/**
 * Removes one worktree (never the main one nor a folder open in this window, never a locked one): `git worktree
 * prune` when its folder is gone, `git worktree remove` otherwise (`--force` when it has uncommitted changes and
 * `discardChanges`), then the empty parent folders. The branch is not touched
 */
export async function removeWorktreeSafely(
  cwd: string,
  worktrees: Worktree[],
  target: Worktree,
  currentFolders: string[],
  discardChanges: boolean
): Promise<RemovalResult> {
  const blocker = removalBlocker(worktrees, target, currentFolders);
  if (blocker) {
    return { status: 'skipped', reason: blocker };
  }
  if (target.locked) {
    return { status: 'skipped', reason: 'locked' };
  }
  if (target.prunable) {
    await pruneWorktrees(cwd);
    return { status: 'pruned' };
  }
  const forced = discardChanges && (await worktreeHasChanges(target.path));
  await removeWorktree(cwd, target.path, forced);
  const foldersRemoved = await removeEmptyParents(target.path, worktreesRoot(worktrees[0].path));
  return { status: 'removed', forced, foldersRemoved };
}
