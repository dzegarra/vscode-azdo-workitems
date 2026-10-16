import * as vscode from 'vscode';
import { resolveContext } from '../config';
import { WorkItemsStore } from '../workItemsStore';

const STATUS_MESSAGE_MS = 5000;

const LINK = 'Link PR';

// Rule ALERT-FIX-5
/**
 * Adds a PR of a task of the work item to the Development section of the work item (the quick fix of the alert
 * "PR … of task … is not linked to this work item"). Only PRs linked to one of its tasks, after a confirmation
 */
export async function linkTaskPullRequest(
  store: WorkItemsStore,
  workItemId: number,
  pullRequestId: number
): Promise<void> {
  const link = store.find(workItemId)?.taskPullRequestLinks.find((candidate) => candidate.id === pullRequestId);
  if (!link) {
    void vscode.window.showWarningMessage(`PR ${pullRequestId} is not linked to a task of work item ${workItemId}.`);
    return;
  }
  const answer = await vscode.window.showInformationMessage(
    `Link PR ${pullRequestId} to work item ${workItemId}?`,
    { modal: true, detail: 'It is added to the Development section of the work item, like the PRs of its tasks.' },
    LINK
  );
  if (answer !== LINK) {
    return;
  }
  const { client } = resolveContext(store.repository());
  await client.linkPullRequestToWorkItem(workItemId, link);
  void vscode.window.setStatusBarMessage(`$(check) ${workItemId}: PR ${pullRequestId} linked`, STATUS_MESSAGE_MS);
  await store.refresh();
}
