import * as vscode from 'vscode';
import { resolveContext } from '../config';
import { GitAPI, pickRepository } from '../git';
import { canLinkBranchForTask } from '../pullRequestTasks';
import { workItemsMissingBranchLink } from '../taskBranches';
import { WorkItemsStore } from '../workItemsStore';
import { remoteBranchNames } from './pickBaseBranch';
import { findChildTaskWorkItem } from './pullRequestTask';

const STATUS_MESSAGE_MS = 5000;

const LINK = 'Link branch';

interface BranchItem extends vscode.QuickPickItem {
  branch?: string;
}

/** The branches of the remote, the ones of the work item first; the task's own branches are left out */
async function pickBranch(remoteBranches: string[], parentBranches: string[], own: Set<string>, parentId: number) {
  const candidates = remoteBranches.filter((branch) => !own.has(branch));
  const ofParent = candidates.filter((branch) => parentBranches.includes(branch));
  const others = candidates.filter((branch) => !parentBranches.includes(branch));
  const items: BranchItem[] = [
    ...(ofParent.length ? [{ label: `Work item ${parentId}`, kind: vscode.QuickPickItemKind.Separator }] : []),
    ...ofParent.map((branch) => ({ label: branch, description: `branch of ${parentId}`, branch })),
    ...(others.length ? [{ label: 'Remote branches', kind: vscode.QuickPickItemKind.Separator }] : []),
    ...others.map((branch) => ({ label: branch, branch })),
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Branch to link to the task' });
  return picked?.branch;
}

// Rules TASK-MENU-6, TASK-LINK-1
/**
 * Links an existing branch of the remote to a task (the "Link …" items of the task pill), after a confirmation. The
 * work item of the task gets the link too when it does not have it, so the task branch is never "not linked to this
 * work item" (ALERT-2). Without `branch` the user picks one of the remote branches
 */
export async function linkBranchToTask(
  git: GitAPI,
  store: WorkItemsStore,
  parentId: number,
  taskId: number,
  branch?: string
): Promise<void> {
  const parent = store.find(parentId);
  const task = findChildTaskWorkItem(store, parentId, taskId);
  if (!parent || !task) {
    void vscode.window.showWarningMessage(`Task ${taskId} was not found under work item ${parentId}.`);
    return;
  }
  if (!canLinkBranchForTask({ taskState: task.state, parentState: parent.workItem.state })) {
    void vscode.window.showWarningMessage(`Task ${taskId} or its work item ${parentId} is closed: nothing is linked.`);
    return;
  }
  const repository = pickRepository(git);
  const remoteBranches = await remoteBranchNames(repository);
  const own = new Set(task.links.branches.map((link) => link.name));
  const parentBranches = parent.branches.filter((entry) => !entry.otherRepository).map((entry) => entry.name);
  const name = branch ?? (await pickBranch(remoteBranches, parentBranches, own, parentId));
  if (!name) {
    return;
  }
  if (!remoteBranches.includes(name)) {
    void vscode.window.showWarningMessage(`The branch ${name} is not in the remote: push it first, then link it.`);
    return;
  }
  const { client, repositoryName } = resolveContext(repository);
  const azdoRepository = await client.getRepository(repositoryName);
  const ids = workItemsMissingBranchLink(name, azdoRepository.id, [
    { id: task.id, branches: task.links.branches },
    { id: parentId, branches: parent.workItem.links.branches },
  ]);
  if (!ids.includes(task.id)) {
    void vscode.window.showInformationMessage(`The branch ${name} is already linked to task ${taskId}.`);
    return;
  }
  const answer = await vscode.window.showInformationMessage(
    `Link the branch ${name} to task ${taskId}?`,
    {
      modal: true,
      detail: ids.includes(parentId)
        ? `It is added to the Development section of the task and of its work item ${parentId}.`
        : 'It is added to the Development section of the task.',
    },
    LINK
  );
  if (answer !== LINK) {
    return;
  }
  for (const id of ids) {
    await client.linkBranchToWorkItem(id, azdoRepository, name);
  }
  void vscode.window.setStatusBarMessage(`$(check) ${taskId}: branch ${name} linked`, STATUS_MESSAGE_MS);
  await store.refresh();
}
