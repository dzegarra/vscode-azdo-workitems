import * as vscode from 'vscode';
import { settings } from '../config';
import { GitAPI, pickRepository, Repository } from '../git';
import { WorkItemsStore } from '../workItemsStore';
import { copyEnvFiles, createWorktree, listWorktrees, stashPop, stashPush, writeSetupMarker } from '../worktreeGit';
import {
  CheckoutChoice,
  decideCheckout,
  findWorktree,
  hasUncommittedChanges,
  stashMessage,
  worktreePath,
} from '../worktrees';

/** The branch to check out and what it belongs to: a work item (no PR) or a PR */
export interface BranchTarget {
  branch: string;
  pullRequest?: { id: number; title: string };
}

const OPEN_IN_WORKTREE = 'Open in a worktree';
const STASH_AND_CHECKOUT = 'Stash and checkout';
const CHECKOUT_ANYWAY = 'Checkout anyway';

async function hasChanges(repository: Repository): Promise<boolean> {
  await repository.status();
  const { workingTreeChanges, indexChanges, untrackedChanges, mergeChanges } = repository.state;
  return hasUncommittedChanges({
    workingTree: workingTreeChanges.length,
    index: indexChanges.length,
    untracked: untrackedChanges?.length,
    merge: mergeChanges?.length,
  });
}

/**
 * Switches this window to the branch. For a PR the branch is fetched first and, when the local branch existed and is
 * behind, the latest commits are pulled. For a branch that only exists in the remote, git creates the local one
 */
async function checkoutHere(repository: Repository, target: BranchTarget): Promise<'diverged' | 'done'> {
  const { branch, pullRequest } = target;
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Checking out ${branch}${pullRequest ? ` (PR ${pullRequest.id})` : ''}…`,
    },
    async () => {
      if (pullRequest) {
        await repository.fetch(settings().remote, branch);
      }
      await repository.checkout(branch);
      if (!pullRequest) {
        return 'done';
      }
      const local = await repository.getBranch(branch);
      if (local.behind && !local.ahead) {
        await repository.pull();
        return 'done';
      }
      return local.behind ? 'diverged' : 'done';
    }
  );
}

function announceCheckout(target: BranchTarget, result: 'diverged' | 'done'): void {
  const { branch, pullRequest } = target;
  if (!pullRequest) {
    return;
  }
  if (result === 'diverged') {
    void vscode.window.showWarningMessage(
      `Checked out ${branch}, but it has local commits that are not in PR ${pullRequest.id}: it may not match the PR.`
    );
    return;
  }
  void vscode.window.showInformationMessage(`Checked out ${branch} (PR ${pullRequest.id}: ${pullRequest.title})`);
}

/** Stashes the changes (untracked files included), checks out and tells how to get the changes back */
async function stashAndCheckout(repository: Repository, target: BranchTarget): Promise<void> {
  const root = repository.rootUri.fsPath;
  const previous = repository.state.HEAD?.name ?? 'the previous branch';
  const stashed = await stashPush(root, stashMessage(target.branch));
  let result: 'diverged' | 'done';
  try {
    result = await checkoutHere(repository, target);
  } catch (error) {
    if (stashed) {
      try {
        await stashPop(root);
      } catch {
        throw new Error(
          `${(error as Error).message}. Your changes remain in the stash "${stashMessage(
            target.branch
          )}": run git stash pop.`
        );
      }
    }
    throw error;
  }
  announceCheckout(target, result);
  if (stashed) {
    void vscode.window.showInformationMessage(
      `Your changes on ${previous} were stashed ("${stashMessage(
        target.branch
      )}"). To get them back, switch to ${previous} and run git stash pop.`
    );
  }
}

/** Opens a folder in a new window (VS Code focuses the window when the folder is already open) */
async function openFolder(folder: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow: true });
}

/** Opens the worktree where the branch is checked out */
export async function openWorktree(store: WorkItemsStore, branch: string): Promise<void> {
  const worktree = store.worktreeFor(branch);
  if (!worktree) {
    throw new Error(`${branch} has no worktree.`);
  }
  await openFolder(worktree.path);
}

/**
 * Opens the branch in a worktree next to the repository (creating it, and its local branch, when needed), copies the
 * untracked env files and opens it in a new window, which runs `npm ci` once
 */
export async function openInWorktree(
  repository: Repository,
  store: WorkItemsStore,
  target: BranchTarget
): Promise<void> {
  const root = repository.rootUri.fsPath;
  const { branch } = target;
  if (repository.state.HEAD?.name === branch) {
    void vscode.window.showInformationMessage(`${branch} is the branch checked out in this window: nothing to do.`);
    return;
  }
  const existing = findWorktree(await listWorktrees(root), branch, [root]);
  if (existing) {
    await openFolder(existing.path);
    return;
  }
  const folder = worktreePath(root, branch);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating a worktree for ${branch}…` },
    async () => {
      await createWorktree(root, settings().remote, branch, folder);
      await copyEnvFiles(root, folder);
      await writeSetupMarker(folder, { npmCi: true, createdAt: new Date().toISOString() });
    }
  );
  await store.refreshWorktrees();
  store.notify();
  await openFolder(folder);
  void vscode.window.showInformationMessage(`Opened ${branch} in a worktree at ${folder}`);
}

const CHOICES: Record<string, CheckoutChoice | 'stash'> = {
  [OPEN_IN_WORKTREE]: 'worktree',
  [STASH_AND_CHECKOUT]: 'stash',
  [CHECKOUT_ANYWAY]: 'here',
};

async function askWhatToDo(current: string | undefined): Promise<CheckoutChoice | 'stash' | undefined> {
  const picked = await vscode.window.showWarningMessage(
    `You have uncommitted changes on ${current ?? 'the current branch'}.`,
    {
      modal: true,
      detail:
        'A worktree gives the branch its own folder and window: your changes stay where they are. ' +
        'Or stash them (untracked files included) and switch this window to the branch.',
    },
    OPEN_IN_WORKTREE,
    STASH_AND_CHECKOUT,
    CHECKOUT_ANYWAY
  );
  return picked ? CHOICES[picked] : undefined;
}

/**
 * Checks out a branch of a work item or PR. By default (azdoWorkItems.checkout.mode "ask") a clean repository switches
 * branch and a repository with uncommitted changes asks what to do. `choice` (the ▾ menu) skips the question
 */
export async function checkoutBranch(
  git: GitAPI,
  store: WorkItemsStore,
  target: BranchTarget,
  choice?: CheckoutChoice
): Promise<void> {
  const repository = pickRepository(git);
  const { branch } = target;
  if (repository.state.HEAD?.name === branch) {
    void vscode.window.showInformationMessage(`${branch} is already checked out.`);
    return;
  }
  const root = repository.rootUri.fsPath;
  const other = findWorktree(await listWorktrees(root).catch(() => []), branch, [root]);
  if (other && choice !== 'here') {
    // Git does not let a branch be checked out twice
    await openFolder(other.path);
    return;
  }
  const mode = settings().checkoutMode;
  const dirty = mode === 'ask' && !choice && (await hasChanges(repository));
  const decided = decideCheckout({ mode, dirty, choice });
  const decision = decided === 'ask' ? await askWhatToDo(repository.state.HEAD?.name) : decided;
  if (!decision) {
    return;
  }
  switch (decision) {
    case 'worktree':
      await openInWorktree(repository, store, target);
      return;
    case 'stash':
      await stashAndCheckout(repository, target);
      break;
    case 'here':
      announceCheckout(target, await checkoutHere(repository, target));
      break;
  }
  if (!target.pullRequest) {
    await store.refresh();
  }
}

/** The ▾ of a Checkout button */
export async function showCheckoutMenu(git: GitAPI, store: WorkItemsStore, target: BranchTarget): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    [
      {
        label: '$(git-branch) Checkout here',
        description: 'Switch this window to the branch',
        choice: 'here' as const,
      },
      {
        label: '$(folder-opened) Open in a worktree',
        description: 'Its own folder and window; your changes here stay untouched',
        choice: 'worktree' as const,
      },
    ],
    { title: `Check out ${target.branch}`, ignoreFocusOut: true }
  );
  if (picked) {
    await checkoutBranch(git, store, target, picked.choice);
  }
}
