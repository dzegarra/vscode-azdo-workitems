import * as vscode from 'vscode';
import { AzdoClient, PullRequestDetails, WorkItem } from '../azdoClient';
import {
  completedPullRequestPrompt,
  publishedPullRequestMessage,
  PullRequestTaskRef,
  pullRequestTaskTitle,
  reusableTasks,
  stateForNewPullRequestTask,
  tasksToComplete,
  tasksToStart,
  TASK_DONE,
  TASK_IN_PROGRESS,
} from '../pullRequestTasks';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';

/** What to do with the PR task of a new PR */
export type PullRequestTaskChoice =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'existing'; task: PullRequestTaskRef };

function toRef(workItem: WorkItem): PullRequestTaskRef {
  return {
    id: workItem.id,
    title: workItem.title,
    state: workItem.state,
    pullRequestIds: workItem.links.pullRequests.map((link) => link.id),
    branchNames: workItem.links.branches.map((link) => link.name),
  };
}

interface ChildTasks {
  tasks: PullRequestTaskRef[];
  activePullRequestIds: Set<number>;
}

/** Child tasks of the work item known to the store (the ones in the list and the ones of other developers) */
function childTasksOf(store: WorkItemsStore, parentId: number): ChildTasks {
  const parent = store.find(parentId);
  const listed = store.workItems.filter(
    (entry) => entry.workItem.type === 'Task' && entry.workItem.links.parentId === parentId
  );
  const entries = [
    ...listed.map((entry) => ({ workItem: entry.workItem, pullRequests: entry.pullRequests })),
    ...(parent?.otherTasks ?? []),
  ];
  const active = entries.flatMap((entry) => entry.pullRequests.filter((pr) => pr.status === 'active'));
  return {
    tasks: entries.map((entry) => toRef(entry.workItem)),
    activePullRequestIds: new Set(active.map((pr: PullRequestDetails) => pr.pullRequestId)),
  };
}

/** A child task of the parent as the store has it (listed, or assigned to other people) */
export function findChildTaskWorkItem(store: WorkItemsStore, parentId: number, taskId: number): WorkItem | undefined {
  const listed = store.find(taskId)?.workItem;
  const task = listed ?? store.find(parentId)?.otherTasks.find((other) => other.workItem.id === taskId)?.workItem;
  return task?.links.parentId === parentId ? task : undefined;
}

/** A task of the parent in the store, for the "Create PR" button of the task rows */
export function findChildTask(
  store: WorkItemsStore,
  parent: WorkItemEntry,
  taskId: number
): PullRequestTaskRef | undefined {
  return childTasksOf(store, parent.workItem.id).tasks.find((task) => task.id === taskId);
}

/** The "PR task" question: create one (default), reuse an open task of the work item, or none. Undefined: cancelled */
export async function pickPullRequestTask(
  store: WorkItemsStore,
  primaryId: number,
  description: string
): Promise<PullRequestTaskChoice | undefined> {
  const { tasks, activePullRequestIds } = childTasksOf(store, primaryId);
  const picked = await vscode.window.showQuickPick<vscode.QuickPickItem & { choice: PullRequestTaskChoice }>(
    [
      {
        label: `$(add) Create task "${pullRequestTaskTitle(description)}"`,
        description: 'Default',
        choice: { kind: 'create' },
      },
      ...reusableTasks(tasks, activePullRequestIds).map((task) => ({
        label: `${task.id} ${task.title}`,
        description: `Existing task · ${task.state}`,
        choice: { kind: 'existing' as const, task },
      })),
      { label: 'No PR task', choice: { kind: 'none' } },
    ],
    {
      title: 'PR task',
      placeHolder: 'The task stands for "this PR is in review"',
      ignoreFocusOut: true,
    }
  );
  return picked?.choice;
}

/** Creates the PR task under the work item. Undefined (with a warning) when it cannot: the PR is created anyway */
export async function createPullRequestTask(
  client: AzdoClient,
  parent: WorkItem,
  description: string
): Promise<PullRequestTaskRef | undefined> {
  try {
    return toRef(await client.createTask(parent, pullRequestTaskTitle(description)));
  } catch (error) {
    void vscode.window.showWarningMessage(`Unable to create the PR task: ${(error as Error).message}`);
    return undefined;
  }
}

async function moveTasks(client: AzdoClient, tasks: { id: number }[], state: string): Promise<boolean> {
  try {
    await Promise.all(tasks.map((task) => client.updateWorkItemState(task.id, state)));
    return true;
  } catch (error) {
    void vscode.window.showWarningMessage(`Unable to change the PR task to "${state}": ${(error as Error).message}`);
    return false;
  }
}

/** Tasks (not other work items) linked to the PR */
async function tasksLinkedTo(client: AzdoClient, pr: Pick<PullRequestDetails, 'pullRequestId' | 'repository'>) {
  const ids = await client.getPullRequestWorkItemIds(pr.repository.id, pr.pullRequestId);
  return (await client.getWorkItems(ids)).filter((workItem) => workItem.type === 'Task').map(toRef);
}

/** A PR was created active: its task starts being "in review". A draft leaves the task as it is */
export async function startNewPullRequestTask(client: AzdoClient, task: PullRequestTaskRef, isDraft: boolean) {
  if (stateForNewPullRequestTask(task, isDraft)) {
    await moveTasks(client, [task], TASK_IN_PROGRESS);
  }
}

/** A draft PR was published from the extension: its tasks move to In Progress */
export async function startPublishedPullRequestTasks(
  client: AzdoClient,
  pr: Pick<PullRequestDetails, 'pullRequestId' | 'repository'>
): Promise<void> {
  try {
    const tasks = tasksToStart(await tasksLinkedTo(client, pr), pr.pullRequestId);
    if (tasks.length && (await moveTasks(client, tasks, TASK_IN_PROGRESS))) {
      void vscode.window.showInformationMessage(publishedPullRequestMessage(pr.pullRequestId, tasks));
    }
  } catch (error) {
    void vscode.window.showWarningMessage(`Unable to update the PR task: ${(error as Error).message}`);
  }
}

/** A PR of the user was completed: offers to set its open tasks to Done */
export async function offerCompletedPullRequestTasks(
  client: AzdoClient,
  pr: Pick<PullRequestDetails, 'pullRequestId' | 'repository'>,
  open: (url: string) => Thenable<unknown>
): Promise<void> {
  const tasks = tasksToComplete(await tasksLinkedTo(client, pr), pr.pullRequestId);
  if (!tasks.length) {
    return;
  }
  const picked = await vscode.window.showInformationMessage(
    completedPullRequestPrompt(pr.pullRequestId, tasks),
    'Set Done',
    'Open task'
  );
  if (picked === 'Set Done') {
    await moveTasks(client, tasks, TASK_DONE);
  } else if (picked === 'Open task') {
    await open(client.workItemWebUrl(tasks[0].id));
  }
}
