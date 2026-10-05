import * as vscode from 'vscode';
import { WorkItemNode, WorkItemsTreeProvider } from '../workItemsTree';

/** Work item the command was invoked on, or ask the user to pick one when run from the command palette */
export async function resolveWorkItemNode(
  tree: WorkItemsTreeProvider,
  node: WorkItemNode | undefined
): Promise<WorkItemNode | undefined> {
  if (node?.kind === 'workItem') {
    return node;
  }
  await tree.getChildren();
  const picked = await vscode.window.showQuickPick(
    tree.workItems.map((wi) => ({
      label: `${wi.workItem.id} ${wi.workItem.title}`,
      description: wi.workItem.type,
      detail: wi.branch,
      node: wi,
    })),
    { title: 'Select a work item', matchOnDescription: true, ignoreFocusOut: true }
  );
  return picked?.node;
}
