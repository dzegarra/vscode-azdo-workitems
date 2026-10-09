import * as vscode from 'vscode';
import { WorkItem } from '../azdoClient';
import { resolveContext, settings } from '../config';
import { isCompletedState, openPredecessors, startCheckMessage } from '../predecessors';
import { WorkItemsStore } from '../workItemsStore';

const START_ANYWAY = 'Start anyway';
const OPEN_MAP = 'Open dependency map';

/** Predecessors of the work item: the ones the store has, or fetched when it is not in the list */
async function loadPredecessors(store: WorkItemsStore, workItem: WorkItem): Promise<WorkItem[] | undefined> {
  const known = store.find(workItem.id)?.predecessors;
  if (known || !workItem.links.predecessorIds.length) {
    return known ?? [];
  }
  try {
    return await resolveContext(store.repository()).client.getWorkItems(workItem.links.predecessorIds);
  } catch {
    return undefined;
  }
}

/**
 * Soft team rule: avoid starting a work item whose predecessors are not completed, unless agreed with their
 * owners. When it has open ones, asks before starting. The question is modal so it cannot be missed or
 * dismissed by accident (a notification could be ignored while the work goes on). It is a caution, not a block:
 * "Start anyway" always continues. Returns whether to go on; failing to read the predecessors never stops it
 */
export async function confirmStart(store: WorkItemsStore, workItem: WorkItem): Promise<boolean> {
  const { completedStates, confirmBeforeStart } = settings().dependencies;
  if (!confirmBeforeStart) {
    return true;
  }
  const predecessors = await loadPredecessors(store, workItem);
  const open = predecessors?.filter((predecessor) => !isCompletedState(predecessor.state, completedStates));
  if (!open?.length) {
    return true;
  }
  const sorted = openPredecessors(workItem, open, [], undefined);
  const choice = await vscode.window.showWarningMessage(
    startCheckMessage(workItem, sorted),
    { modal: true },
    START_ANYWAY,
    OPEN_MAP
  );
  if (choice === OPEN_MAP) {
    await vscode.commands.executeCommand('totalflowx.openDependencyMap', workItem.id);
  }
  return choice === START_ANYWAY;
}
