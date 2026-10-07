import * as vscode from 'vscode';
import { resolveContext, settings } from '../config';
import { GitAPI, pickRepository } from '../git';
import { isFinishedState } from '../states';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
import { listWorktrees, removeWorktree, worktreeHasChanges } from '../worktreeGit';
import { findWorktree } from '../worktrees';

/** Work item the command was invoked on, or one of the finished work items whose branch still exists */
async function resolveEntry(
  store: WorkItemsStore,
  entry: WorkItemEntry | undefined
): Promise<WorkItemEntry | undefined> {
  if (entry) {
    return entry;
  }
  await store.ensureLoaded();
  const leftovers = store.workItems.filter((wi) => wi.leftoverBranch);
  if (!leftovers.length) {
    void vscode.window.showInformationMessage('The branches of your finished work items are already deleted.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    leftovers.map((wi) => ({
      label: `${wi.workItem.id} ${wi.workItem.title}`,
      description: wi.workItem.state,
      detail: wi.leftoverBranch?.name,
      entry: wi,
    })),
    { title: 'Delete the branch of a finished work item', ignoreFocusOut: true }
  );
  return picked?.entry;
}

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

/**
 * Deletes the branch of a finished work item (Done, Ready to Test…), in Azure DevOps and locally: the team deletes
 * the branches once their PR is merged. Asks for confirmation, telling what is deleted
 */
export async function deleteBranch(git: GitAPI, store: WorkItemsStore, node: WorkItemEntry | undefined): Promise<void> {
  const entry = await resolveEntry(store, node);
  const leftover = entry?.leftoverBranch;
  if (!entry || !leftover) {
    return;
  }
  const { workItem } = entry;
  if (!isFinishedState(workItem.state)) {
    throw new Error(
      `${workItem.type} ${workItem.id} is ${workItem.state}: only the branches of finished work items are deleted.`
    );
  }
  const activePullRequest = entry.pullRequests.find(
    (pr) => pr.status === 'active' && pr.sourceRefName === `refs/heads/${leftover.name}`
  );
  if (activePullRequest) {
    throw new Error(
      `PR ${activePullRequest.pullRequestId} is still active on ${leftover.name}: complete or abandon it first.`
    );
  }

  const repository = pickRepository(git);
  const { client, repositoryName } = resolveContext(repository);
  const { remote, baseBranch } = settings();
  const isCurrent = repository.state.HEAD?.name === leftover.name;
  const local = leftover.local ? await repository.getBranch(leftover.name) : undefined;
  const root = repository.rootUri.fsPath;
  const worktree = local ? findWorktree(await listWorktrees(root).catch(() => []), leftover.name, [root]) : undefined;
  const details = [
    ...(leftover.remoteObjectId ? [`• In Azure DevOps (${remote}/${leftover.name})`] : []),
    ...(local ? ['• Local branch'] : []),
    ...(worktree ? [`• Worktree at ${worktree.path}`] : []),
    ...(isCurrent ? [`\nIt is checked out: VS Code switches to ${baseBranch} first.`] : []),
  ];
  if (local && local.commit !== leftover.remoteObjectId) {
    details.push(
      leftover.remoteObjectId
        ? '\nThe local branch is not the same as the one in Azure DevOps: its commits that were not pushed will be lost.'
        : '\nThe branch only exists locally: its commits that were not merged will be lost.'
    );
  }
  const confirm = await vscode.window.showWarningMessage(
    `Delete the branch ${leftover.name} of ${workItem.type} ${workItem.id} (${workItem.state})?`,
    { modal: true, detail: details.join('\n') },
    'Delete Branch'
  );
  if (!confirm) {
    return;
  }

  let keptWorktree: string | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Deleting ${leftover.name}…` },
    async () => {
      if (isCurrent) {
        await repository.checkout(baseBranch);
      }
      if (worktree && !(await removeOrKeepWorktree(root, worktree.path))) {
        keptWorktree = worktree.path;
      }
      if (leftover.remoteObjectId) {
        // Refused by Azure DevOps if someone pushed to the branch since it was checked
        const { id } = await client.getRepository(repositoryName);
        await client.deleteRemoteBranch(id, leftover.name, leftover.remoteObjectId);
      }
      if (local && !keptWorktree) {
        // Forced: after a squash merge, git does not see the branch as merged
        await repository.deleteBranch(leftover.name, true);
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
      `Deleted ${leftover.name} in Azure DevOps only: the worktree at ${keptWorktree} has uncommitted changes, so it and the local branch were kept.`
    );
  } else {
    void vscode.window.showInformationMessage(
      `Deleted the branch ${leftover.name} of ${workItem.type} ${workItem.id}${worktree ? ' and its worktree' : ''}.`
    );
  }
  await store.refresh();
}
