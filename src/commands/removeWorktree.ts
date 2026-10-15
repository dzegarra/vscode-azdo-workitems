import * as vscode from 'vscode';
import { GitAPI, pickRepository } from '../git';
import { WorkItemsStore } from '../workItemsStore';
import { listWorktrees, removeWorktreeSafely, worktreeHasChanges } from '../worktreeGit';
import {
  removableWorktrees,
  samePath,
  Worktree,
  worktreeDescription,
  worktreeDetail,
  worktreeLabel,
} from '../worktrees';

const REMOVE = 'Remove';
const REMOVE_LOSING_CHANGES = 'Remove (changes will be lost)';

/** Worktree plus what the confirmation needs to know */
interface Candidate {
  worktree: Worktree;
  dirty: boolean;
}

async function inspect(worktree: Worktree): Promise<Candidate> {
  // A folder that is gone has nothing to lose; an unreadable status counts as dirty (the safe assumption)
  const dirty = worktree.prunable ? false : await worktreeHasChanges(worktree.path).catch(() => true);
  return { worktree, dirty };
}

function confirmationDetail(candidates: Candidate[]): string {
  const lines = candidates.map(({ worktree, dirty }) => {
    const notes = [
      ...(dirty ? ['uncommitted changes that will be lost'] : []),
      ...(worktree.prunable ? ['folder already missing: only the git entry is removed'] : []),
    ];
    return `• ${worktreeLabel(worktree)} (${worktree.path})${notes.length ? ` - ${notes.join(', ')}` : ''}`;
  });
  return [
    ...lines,
    '',
    'The branches are kept. Close its VS Code window first if it is open.',
    ...(candidates.some((c) => c.dirty) ? ['', 'Worktrees with uncommitted changes are removed anyway.'] : []),
  ].join('\n');
}

// Rule WORKTREE-4
/**
 * Removes worktrees after a modal confirmation that lists them. The main working tree and the folders open in this
 * window are never removed; locked worktrees are skipped; entries whose folder is gone are pruned. Branches are kept
 */
export async function removeWorktrees(store: WorkItemsStore, root: string, targets: Worktree[]): Promise<void> {
  const all = await listWorktrees(root);
  const current = store.openFolders();
  // Re-read from git: only what is still a removable worktree (the main one and this window are guarded here too)
  const removable = removableWorktrees(all, current);
  const selected = targets
    .map((target) => removable.find((worktree) => samePath(worktree.path, target.path)))
    .filter((worktree): worktree is Worktree => !!worktree);
  const refused = targets.length - selected.length;
  if (refused) {
    void vscode.window.showWarningMessage(
      `${refused} worktree${
        refused === 1 ? ' is' : 's are'
      } not removed: the main working tree and the folder open in this window stay.`
    );
  }
  const locked = selected.filter((worktree) => worktree.locked);
  const unlocked = selected.filter((worktree) => !worktree.locked);
  if (locked.length) {
    void vscode.window.showWarningMessage(
      `Skipped ${locked.map(worktreeLabel).join(', ')}: locked worktrees are not removed (git worktree unlock first).`
    );
  }
  if (!unlocked.length) {
    return;
  }
  const candidates = await Promise.all(unlocked.map(inspect));
  const dirty = candidates.some((c) => c.dirty);
  const title =
    candidates.length === 1
      ? `Remove the worktree of ${worktreeLabel(candidates[0].worktree)}?`
      : `Remove ${candidates.length} worktrees?`;
  const confirm = await vscode.window.showWarningMessage(
    title,
    { modal: true, detail: confirmationDetail(candidates) },
    dirty ? REMOVE_LOSING_CHANGES : REMOVE
  );
  if (!confirm) {
    return;
  }

  const failures: string[] = [];
  const done: string[] = [];
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Removing worktrees…' },
    async () => {
      for (const { worktree } of candidates) {
        try {
          const result = await removeWorktreeSafely(root, all, worktree, current, true);
          if (result.status === 'skipped') {
            failures.push(`${worktreeLabel(worktree)}: skipped (${result.reason})`);
          } else {
            done.push(worktreeLabel(worktree));
          }
        } catch (error) {
          failures.push(`${worktreeLabel(worktree)}: ${(error as Error).message}`);
        }
      }
    }
  );
  await store.refreshWorktrees();
  store.notify();
  if (done.length) {
    void vscode.window.showInformationMessage(
      done.length === 1
        ? `Removed the worktree of ${done[0]}`
        : `Removed ${done.length} worktrees: ${done.join(', ')}. The branches are kept.`
    );
  }
  if (failures.length) {
    void vscode.window.showErrorMessage(`Could not remove: ${failures.join(' | ')}`);
  }
}

/** The "Remove Worktrees…" command: pick any of the repository's worktrees (except main and this window's) */
export async function removeWorktreesCommand(git: GitAPI, store: WorkItemsStore): Promise<void> {
  const root = pickRepository(git).rootUri.fsPath;
  const all = await listWorktrees(root);
  const removable = removableWorktrees(all, store.openFolders());
  if (!removable.length) {
    void vscode.window.showInformationMessage('There are no other worktrees to remove.');
    return;
  }
  const items = await Promise.all(
    removable.map(async (worktree) => {
      const { dirty } = await inspect(worktree);
      return {
        label: worktreeLabel(worktree),
        description: worktreeDescription(all[0].path, worktree),
        detail: worktreeDetail(worktree, dirty) || undefined,
        worktree,
      };
    })
  );
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Remove worktrees',
    placeHolder: 'Select the worktrees to remove (the branches are kept)',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  if (picked?.length) {
    await removeWorktrees(
      store,
      root,
      picked.map((item) => item.worktree)
    );
  }
}

/** Removes the worktree that has the branch (the branch stays), after the usual confirmation */
export async function removeWorktreeOf(store: WorkItemsStore, git: GitAPI, branch: string): Promise<void> {
  const worktree = store.worktreeFor(branch);
  if (!worktree) {
    throw new Error(`${branch} has no worktree.`);
  }
  await removeWorktrees(store, pickRepository(git).rootUri.fsPath, [worktree]);
}
