import * as vscode from 'vscode';
import { AzdoClient, WorkItem } from '../azdoClient';
import { resolveContext } from '../config';
import { normalizeState } from '../states';
import { WorkItemsStore } from '../workItemsStore';

const CATEGORY_LABELS: Partial<Record<string, string>> = {
  Proposed: 'Not started',
  InProgress: 'In progress',
  Resolved: 'Resolved',
  Completed: 'Completed',
  Removed: 'Removed',
};

/** Work item from the store or, for parents / children not assigned to the user, from Azure DevOps */
async function findWorkItem(store: WorkItemsStore, client: AzdoClient, id: number): Promise<WorkItem> {
  const workItem = store.find(id)?.workItem ?? (await client.getWorkItems([id])).at(0);
  if (!workItem) {
    throw new Error(`Work item ${id} not found.`);
  }
  return workItem;
}

/** Lets the user pick a new state among the ones allowed for the type of the work item */
export async function changeState(store: WorkItemsStore, id: number): Promise<void> {
  const { client } = resolveContext(store.repository());
  const workItem = await findWorkItem(store, client, id);
  const states = await client.getWorkItemTypeStates(workItem.type);
  const current = normalizeState(workItem.state);
  const picked = await vscode.window.showQuickPick(
    states.map((state) => ({
      label: state.name,
      description: normalizeState(state.name) === current ? 'current' : CATEGORY_LABELS[state.category],
      state: state.name,
    })),
    { title: `${workItem.type} ${workItem.id}: ${workItem.title}`, placeHolder: `Change state (now ${workItem.state})` }
  );
  if (!picked || normalizeState(picked.state) === current) {
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Moving ${workItem.id} to ${picked.state}` },
    () => client.updateWorkItemState(workItem.id, picked.state)
  );
  await store.refresh();
}

/** Creates a Task under the work item */
export async function addTask(store: WorkItemsStore, parentId: number): Promise<void> {
  const { client } = resolveContext(store.repository());
  const parent = await client.getWorkItemDetails(parentId);
  const title = (
    await vscode.window.showInputBox({
      title: `New Task under ${parent.type} ${parent.id}: ${parent.title}`,
      prompt: 'Task title',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'Title is required'),
    })
  )?.trim();
  if (!title) {
    return;
  }
  const task = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Creating task' },
    () => client.createTask(parent, title)
  );
  await store.refresh();
  void vscode.window.showInformationMessage(`Task ${task.id} created under ${parent.id}.`);
}
