import * as vscode from 'vscode';
import { resolveContext } from '../config';
import { WorkItemsStore } from '../workItemsStore';

const STATUS_MESSAGE_MS = 5000;

const LINK = 'Link branch';

// Rule ALERT-FIX-1
/**
 * Adds a branch of a task of the work item to the Development section of the work item (the quick fix of the alert
 * "Branch … of task … is not linked to this work item"). Only branches of the open repository, after a confirmation
 */
export async function linkTaskBranch(store: WorkItemsStore, workItemId: number, branch: string): Promise<void> {
  const entry = store.find(workItemId);
  if (!entry?.taskBranches.includes(branch)) {
    void vscode.window.showWarningMessage(
      `Branch ${branch} is not a branch of this repository linked to a task of work item ${workItemId}.`
    );
    return;
  }
  const answer = await vscode.window.showInformationMessage(
    `Link the branch ${branch} to work item ${workItemId}?`,
    { modal: true, detail: 'It is added to the Development section of the work item, like the branches of its tasks.' },
    LINK
  );
  if (answer !== LINK) {
    return;
  }
  const { client, repositoryName } = resolveContext(store.repository());
  const azdoRepository = await client.getRepository(repositoryName);
  await client.linkBranchToWorkItem(workItemId, azdoRepository, branch);
  void vscode.window.setStatusBarMessage(`$(check) ${workItemId}: branch ${branch} linked`, STATUS_MESSAGE_MS);
  await store.refresh();
}
