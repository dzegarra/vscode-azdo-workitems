import * as vscode from 'vscode';
import type { PullRequestDetails, WorkItem } from './azdoClient';
import { resolveContext, settings } from './config';
import {
  LinkedPullRequest,
  PullRequestTaskRef,
  startedTaskKey,
  startedTasksMessage,
  TASK_IN_PROGRESS,
  tasksOfPublishedPullRequests,
} from './pullRequestTasks';
import { withFeature } from './requestContext';
import { WorkItemsStore } from './workItemsStore';

interface TaskWithPullRequests {
  workItem: WorkItem;
  pullRequests: PullRequestDetails[];
}

// Rule TASK-PR-8
/**
 * After every load of the work items, moves to In Progress the tasks linked to the user's published PRs, however
 * they were published (the Publish button already does it, TASK-PR-4). Uses what the load fetched: the only extra
 * request is the user's id, once. Each task / PR pair is tried once per session, so a failure (or a task moved
 * back by hand) is not retried on every load
 */
export class PullRequestTaskStarter implements vscode.Disposable {
  private readonly subscription: vscode.Disposable;
  private readonly tried = new Set<string>();
  private myId?: Promise<string>;
  private running = false;

  constructor(private readonly store: WorkItemsStore) {
    this.subscription = store.onDidLoad(() => void this.run());
  }

  dispose(): void {
    this.subscription.dispose();
  }

  private async run(): Promise<void> {
    // The refresh after moving tasks loads again: that load has nothing left to do
    if (this.running || !settings().startPullRequestTasks) {
      return;
    }
    this.running = true;
    try {
      await withFeature('sidebar', () => this.start());
    } finally {
      this.running = false;
    }
  }

  /** The tasks of the list and the ones of other developers under the user's work items, with their PRs */
  private tasks(): TaskWithPullRequests[] {
    const entries = this.store.entries;
    const all = [
      ...entries.filter((entry) => entry.workItem.type === 'Task'),
      ...entries.flatMap((entry) => entry.otherTasks),
    ];
    return [...new Map(all.map((task) => [task.workItem.id, task])).values()];
  }

  private async start(): Promise<void> {
    const tasks = this.tasks();
    const refs: PullRequestTaskRef[] = tasks.map(({ workItem }) => ({
      id: workItem.id,
      title: workItem.title,
      state: workItem.state,
      pullRequestIds: workItem.links.pullRequests.map((link) => link.id),
    }));
    const pullRequests: LinkedPullRequest[] = [
      ...new Map(tasks.flatMap((task) => task.pullRequests).map((pr) => [pr.pullRequestId, pr])).values(),
    ].map((pr) => ({ id: pr.pullRequestId, status: pr.status, isDraft: pr.isDraft, authorId: pr.createdBy?.id }));
    if (!pullRequests.some((pr) => pr.status === 'active' && !pr.isDraft)) {
      return;
    }
    const { client } = resolveContext(this.store.repository());
    let myId: string;
    try {
      this.myId ??= client.getMyId();
      myId = await this.myId;
    } catch {
      // Asked again on the next load
      this.myId = undefined;
      return;
    }
    const started: { pullRequestId: number; tasks: PullRequestTaskRef[] }[] = [];
    for (const entry of tasksOfPublishedPullRequests(refs, pullRequests, myId, this.tried)) {
      const moved: PullRequestTaskRef[] = [];
      for (const task of entry.tasks) {
        this.tried.add(startedTaskKey(task.id, entry.pullRequestId));
        try {
          await client.updateWorkItemState(task.id, TASK_IN_PROGRESS);
          moved.push(task);
        } catch (error) {
          void vscode.window.showWarningMessage(
            `Unable to move task ${task.id} of PR ${entry.pullRequestId} to ${TASK_IN_PROGRESS}: ${
              (error as Error).message
            }`
          );
        }
      }
      if (moved.length) {
        started.push({ pullRequestId: entry.pullRequestId, tasks: moved });
      }
    }
    if (started.length) {
      void vscode.window.showInformationMessage(startedTasksMessage(started));
      await this.store.refresh();
    }
  }
}
