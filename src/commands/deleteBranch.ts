import * as vscode from 'vscode';
import { resolveContext, settings } from '../config';
import { GitAPI, pickRepository } from '../git';
import { isFinishedState } from '../states';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';

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
  const details = [
    ...(leftover.remoteObjectId ? [`• In Azure DevOps (${remote}/${leftover.name})`] : []),
    ...(local ? ['• Local branch'] : []),
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

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Deleting ${leftover.name}…` },
    async () => {
      if (isCurrent) {
        await repository.checkout(baseBranch);
      }
      if (leftover.remoteObjectId) {
        // Refused by Azure DevOps if someone pushed to the branch since it was checked
        const { id } = await client.getRepository(repositoryName);
        await client.deleteRemoteBranch(id, leftover.name, leftover.remoteObjectId);
      }
      if (local) {
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
  void vscode.window.showInformationMessage(`Deleted the branch ${leftover.name} of ${workItem.type} ${workItem.id}.`);
  await store.refresh();
}
