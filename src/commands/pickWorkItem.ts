import * as vscode from 'vscode';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';

/** Work item the command was invoked on, or ask the user to pick one when run from the command palette */
export async function resolveWorkItemEntry(
  store: WorkItemsStore,
  node: WorkItemEntry | undefined
): Promise<WorkItemEntry | undefined> {
  if (node) {
    return node;
  }
  await store.ensureLoaded();
  const picked = await vscode.window.showQuickPick(
    store.workItems.map((wi) => ({
      label: `${wi.workItem.id} ${wi.workItem.title}`,
      description: wi.workItem.type,
      detail: wi.branch,
      entry: wi,
    })),
    { title: 'Select a work item', matchOnDescription: true, ignoreFocusOut: true }
  );
  return picked?.entry;
}
