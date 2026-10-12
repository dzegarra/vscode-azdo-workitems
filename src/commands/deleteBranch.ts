import * as vscode from 'vscode';
import { AzdoClient, GitRepository } from '../azdoClient';
import { resolveContext, settings } from '../config';
import { GitAPI, pickRepository } from '../git';
import { deleteBranchQuestion, isProtectedBranch } from '../deletableBranches';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
import { listWorktrees, removeWorktree, worktreeHasChanges } from '../worktreeGit';
import { findWorktree } from '../worktrees';

/**
 * Removes the worktree of the branch. When it has uncommitted changes the user decides: remove it anyway (the changes
 * are lost) or keep it. Returns false when it was kept
 */
async function removeOrKeepWorktree(root: string, folder: string): Promise<boolean> {
  try {
    await removeWorktree(root, folder);
    return true;
  } catch (error) {
    if (!(await worktreeHasChanges(folder).catch(() => false))) {
      throw error;
    }
  }
  const remove = 'Remove anyway (they will be lost)';
  const picked = await vscode.window.showWarningMessage(
    'The worktree has uncommitted changes',
    { modal: true, detail: `${folder}\n\nKeeping it also keeps the local branch.` },
    remove,
    'Keep it'
  );
  if (picked !== remove) {
    return false;
  }
  await removeWorktree(root, folder, true);
  return true;
}

/** A branch to delete, and the work item it was found on when known (for the messages) */
interface Target {
  name: string;
  owner?: WorkItemEntry['workItem'];
}

/** Branch picked among the ones to delete of the work item, or of the whole list (command palette) */
async function resolveTarget(
  store: WorkItemsStore,
  entry: WorkItemEntry | undefined,
  branch: string | undefined
): Promise<Target | undefined> {
  if (branch) {
    // From a branch row, the menu of a task or a notification: it is checked again below
    return { name: branch, owner: entry?.workItem };
  }
  await store.ensureLoaded();
  const list = entry ? entry.deletableBranches.map((name) => ({ name, entry })) : store.deletableBranchList();
  if (!list.length) {
    void vscode.window.showInformationMessage('There are no branches of completed PRs to delete.');
    return undefined;
  }
  if (entry && list.length === 1) {
    return { name: list[0].name, owner: entry.workItem };
  }
  const picked = await vscode.window.showQuickPick(
    list.map((item) => ({
      label: item.name,
      description: `${item.entry.workItem.type} ${item.entry.workItem.id} ${item.entry.workItem.title}`,
      detail: 'The PR is completed',
      target: { name: item.name, owner: item.entry.workItem },
    })),
    { title: 'Delete the branch of a completed PR', ignoreFocusOut: true }
  );
  return picked?.target;
}

/** What Azure DevOps says now about the branch: its commit, and whether a PR is still active or one was completed */
interface LiveState {
  remoteObjectId?: string;
  activePullRequestId?: number;
  completed: boolean;
}

async function liveState(client: AzdoClient, repository: GitRepository, name: string): Promise<LiveState> {
  const [remoteObjectId, active, completed] = await Promise.all([
    client.getBranchObjectId(repository.id, name),
    client.findActivePullRequestId(repository.id, name),
    client.hasCompletedPullRequestFrom(repository, name),
  ]);
  return { remoteObjectId, activePullRequestId: active, completed };
}

/**
 * Deletes a branch whose PR was completed, in Azure DevOps and locally: the team deletes the branches once their PR
 * is merged, whatever the state of the work item. Everything is checked again with Azure DevOps first (the list may
 * be minutes old); asks for confirmation, telling what is deleted.
 * `node`/`branch`: the work item and branch of a button or menu item; none: the command palette
 */
export async function deleteBranch(
  git: GitAPI,
  store: WorkItemsStore,
  node: WorkItemEntry | undefined,
  branch?: string
): Promise<void> {
  const target = await resolveTarget(store, node, branch);
  if (!target) {
    return;
  }
  const { name, owner } = target;
  const repository = pickRepository(git);
  const { client, repositoryName } = resolveContext(repository);
  const { remote, baseBranch } = settings();
  const azdoRepository = await client.getRepository(repositoryName);
  if (isProtectedBranch(name) || name === baseBranch) {
    throw new Error(`${name} is a base branch: it is never deleted.`);
  }
  const live = await liveState(client, azdoRepository, name);
  if (live.activePullRequestId !== undefined) {
    throw new Error(`PR ${live.activePullRequestId} is still active on ${name}: complete or abandon it first.`);
  }
  if (!live.completed) {
    throw new Error(`${name} has no completed PR: only the branches of completed PRs are deleted.`);
  }
  const { remoteObjectId } = live;
  const isCurrent = repository.state.HEAD?.name === name;
  const local = await repository.getBranch(name).catch(() => undefined);
  if (!local && !remoteObjectId) {
    void vscode.window.showInformationMessage(`The branch ${name} is already deleted.`);
    store.forgetBranch(name);
    await store.refresh();
    return;
  }
  const root = repository.rootUri.fsPath;
  const worktree = local ? findWorktree(await listWorktrees(root).catch(() => []), name, [root]) : undefined;
  const details = [
    ...(remoteObjectId ? [`• In Azure DevOps (${remote}/${name})`] : []),
    ...(local ? ['• Local branch'] : []),
    ...(worktree ? [`• Worktree at ${worktree.path}`] : []),
    ...(isCurrent ? [`\nIt is checked out: VS Code switches to ${baseBranch} first.`] : []),
  ];
  if (local && local.commit !== remoteObjectId) {
    details.push(
      remoteObjectId
        ? '\nThe local branch is not the same as the one in Azure DevOps: its commits that were not pushed will be lost.'
        : '\nThe branch only exists locally: its commits that were not merged will be lost.'
    );
  }
  const confirm = await vscode.window.showWarningMessage(
    deleteBranchQuestion(name, owner),
    { modal: true, detail: details.join('\n') },
    'Delete Branch'
  );
  if (!confirm) {
    return;
  }

  let keptWorktree: string | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Deleting ${name}…` },
    async () => {
      if (isCurrent) {
        await repository.checkout(baseBranch);
      }
      if (worktree && !(await removeOrKeepWorktree(root, worktree.path))) {
        keptWorktree = worktree.path;
      }
      if (remoteObjectId) {
        // Refused by Azure DevOps if someone pushed to the branch since it was checked
        await client.deleteRemoteBranch(azdoRepository.id, name, remoteObjectId);
        store.forgetBranch(name);
      }
      if (local && !keptWorktree) {
        // Forced: after a squash merge, git does not see the branch as merged
        await repository.deleteBranch(name, true);
      }
      try {
        // Removes the "origin/…" ref of the deleted branch
        await repository.fetch({ remote, prune: true });
      } catch {
        // Not needed for the deletion
      }
    }
  );
  if (keptWorktree) {
    void vscode.window.showWarningMessage(
      `Deleted ${name} in Azure DevOps only: the worktree at ${keptWorktree} has uncommitted changes, so it and the local branch were kept.`
    );
  } else {
    void vscode.window.showInformationMessage(`Deleted the branch ${name}${worktree ? ' and its worktree' : ''}.`);
  }
  await store.refresh();
}
