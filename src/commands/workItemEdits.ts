import * as vscode from 'vscode';
import { AzdoClient, WorkItem } from '../azdoClient';
import { resolveContext } from '../config';
import { normalizeState } from '../states';
import { isTesterOnlyMove, TESTERS_ONLY } from '../stateSteps';
import { WorkItemsStore } from '../workItemsStore';
import { offerIntegrationBuild } from './integrationBuild';

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

/**
 * Moves the work item to another state among the ones allowed for its type: `target` (a step of the state bar of the
 * details panel, matched by name) or the one the user picks
 */
export async function changeState(store: WorkItemsStore, id: number, target?: string): Promise<void> {
  const { client } = resolveContext(store.repository());
  const workItem = await findWorkItem(store, client, id);
  const states = await client.getWorkItemTypeStates(workItem.type);
  const current = normalizeState(workItem.state);
  const named = target && states.find((state) => normalizeState(state.name) === normalizeState(target));
  const picked =
    named ||
    (await vscode.window.showQuickPick(
      states.map((state) => ({
        label: state.name,
        description: [
          normalizeState(state.name) === current ? 'current' : CATEGORY_LABELS[state.category],
          // Rule STEPS-4
          isTesterOnlyMove(workItem.type, state.name) ? 'testers only' : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        name: state.name,
      })),
      {
        title: `${workItem.type} ${workItem.id}: ${workItem.title}`,
        placeHolder: `Change state (now ${workItem.state})`,
      }
    ));
  if (!picked || normalizeState(picked.name) === current) {
    return;
  }
  // Rule STEPS-4: developers stop Bugs at Ready to Test; a move to Done is asked first
  if (isTesterOnlyMove(workItem.type, picked.name)) {
    const answer = await vscode.window.showWarningMessage(
      `${TESTERS_ONLY}: developers stop at Ready to Test. Move ${workItem.id} to ${picked.name} anyway?`,
      { modal: true },
      'Move anyway'
    );
    if (answer !== 'Move anyway') {
      return;
    }
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: `Moving ${workItem.id} to ${picked.name}` },
    () => client.updateWorkItemState(workItem.id, picked.name)
  );
  await store.refresh();
  await offerIntegrationBuild(store, workItem, picked.name);
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
