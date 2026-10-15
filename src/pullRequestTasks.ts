/**
 * Team rule: every PR has its own PR task. The task stands for "this PR is in review" (Backlog Items and Bugs have
 * no such state): In Progress while the PR is published, Done once it is completed. Decisions about those tasks.
 * Pure, so no "vscode" import
 */
import { deleteBranchOffer } from './deletableBranches';
import type { TaskBranchModel } from './taskBranches';
import { isNotStartedState, stateCategory, normalizeState } from './states';

export const TASK_IN_PROGRESS = 'In Progress';
export const TASK_DONE = 'Done';

export interface PullRequestTaskRef {
  id: number;
  title: string;
  state: string;
  /** PRs the task is linked to */
  pullRequestIds: number[];
  /** Names of the branches linked to the task (Development section) */
  branchNames?: string[];
}

// Rule TASK-PR-1
/** Done or Removed: nothing more to do in the task */
export function isTaskClosed(state: string): boolean {
  return ['done', 'removed'].includes(stateCategory(state));
}

function isInProgress(state: string): boolean {
  return normalizeState(state) === normalizeState(TASK_IN_PROGRESS);
}

/** Title of the task created with a PR */
export function pullRequestTaskTitle(description: string): string {
  return `PR: ${description.trim()}`;
}

// Rule TASK-PR-2
/** Open tasks that can stand for a new PR: not closed and not already linked to an active PR */
export function reusableTasks(tasks: PullRequestTaskRef[], activePullRequestIds: ReadonlySet<number>) {
  return tasks.filter(
    (task) => !isTaskClosed(task.state) && !task.pullRequestIds.some((id) => activePullRequestIds.has(id))
  );
}

// Rule TASK-PR-4
/** Tasks of the PR that must move to In Progress when the PR is published */
export function tasksToStart(tasks: PullRequestTaskRef[], pullRequestId: number): PullRequestTaskRef[] {
  return tasks.filter(
    (task) => task.pullRequestIds.includes(pullRequestId) && !isTaskClosed(task.state) && !isInProgress(task.state)
  );
}

// Rule TASK-PR-5
/** Tasks of the PR to offer to set Done once the PR is completed */
export function tasksToComplete(tasks: PullRequestTaskRef[], pullRequestId: number): PullRequestTaskRef[] {
  return tasks.filter((task) => task.pullRequestIds.includes(pullRequestId) && !isTaskClosed(task.state));
}

// Rule TASK-PR-3
/** State of the task of a PR just created: In Progress when the PR is published, untouched for a draft */
export function stateForNewPullRequestTask(task: Pick<PullRequestTaskRef, 'state'>, isDraft: boolean) {
  return isDraft || isTaskClosed(task.state) || isInProgress(task.state) ? undefined : TASK_IN_PROGRESS;
}

/** Branch of the task that exists in this repository: a PR can be created from it */
function isUsableTaskBranch(branch: TaskBranchModel): boolean {
  return branch.state === 'current' || branch.state === 'exists';
}

// Rule TASK-ACT-2
/**
 * Branches of the task to offer "Create PR" for: the usable ones (here and not deleted) without a PR or whose PR
 * was abandoned. Active, draft and completed PRs get nothing: they have "Open PR" (or "Delete branch")
 */
export function taskBranchesForNewPullRequest(branches: TaskBranchModel[]): string[] {
  return branches
    .filter((branch) => isUsableTaskBranch(branch) && (!branch.pullRequest || branch.pullRequest.tone === 'abandoned'))
    .map((branch) => branch.name);
}

// Rule TASK-ACT-2
/**
 * The "Create PR" button of a task row: open task and its work item not finished, and either some usable branch
 * without a PR, or (no usable branch) no active PR yet
 */
export function canCreatePullRequestForTask(input: {
  taskState: string;
  parentState: string | undefined;
  pullRequests: { status: string }[];
  /** Branches linked to the task, as the pill shows them */
  branches: TaskBranchModel[];
}): boolean {
  const open =
    input.parentState !== undefined &&
    stateCategory(input.parentState) !== 'done' &&
    stateCategory(input.parentState) !== 'removed' &&
    !isTaskClosed(input.taskState);
  if (!open) {
    return false;
  }
  return input.branches.some(isUsableTaskBranch)
    ? taskBranchesForNewPullRequest(input.branches).length > 0
    : !input.pullRequests.some((pr) => pr.status === 'active');
}

// Rule TASK-ACT-1
/** The "Create branch" button of a task row: open task without branch, and its work item not finished */
export function canCreateBranchForTask(input: {
  taskState: string;
  parentState: string | undefined;
  /** Branches linked to the task */
  branches: unknown[];
}): boolean {
  return (
    input.parentState !== undefined &&
    stateCategory(input.parentState) !== 'done' &&
    stateCategory(input.parentState) !== 'removed' &&
    !isTaskClosed(input.taskState) &&
    input.branches.length === 0
  );
}

// Rule TASK-PR-6
/** State of the task once a branch is created for it: In Progress when it was not started, untouched otherwise */
export function stateForNewBranchTask(task: Pick<PullRequestTaskRef, 'state'>): string | undefined {
  return isNotStartedState(task.state) ? TASK_IN_PROGRESS : undefined;
}

export interface CandidateBranch {
  name: string;
  /** "local" / "remote": it exists in the open repository; "linked": only known from a link or a PR */
  location: string;
  otherRepository: boolean;
}

export type TaskBranchChoice = { kind: 'branch'; name: string } | { kind: 'pick'; names: string[] } | { kind: 'none' };

// Rule TASK-PR-7
/**
 * Branch for a PR created from a task: the branches linked to the task come first when some are usable in this
 * repository, otherwise the ones of the work item. Among them: the current branch when it is one, otherwise the
 * only one, otherwise the user picks (main branch first). `branches` are the branches of the work item, main one first
 */
export function chooseTaskBranch(
  currentBranch: string | undefined,
  branches: CandidateBranch[],
  taskBranchNames: string[] = []
): TaskBranchChoice {
  const available = branches.filter(
    (branch) => !branch.otherRepository && ['local', 'remote'].includes(branch.location)
  );
  const ofTask = available.filter((branch) => taskBranchNames.includes(branch.name));
  const usable = ofTask.length ? ofTask : available;
  if (currentBranch && usable.some((branch) => branch.name === currentBranch)) {
    return { kind: 'branch', name: currentBranch };
  }
  if (usable.length === 1) {
    return { kind: 'branch', name: usable[0].name };
  }
  return usable.length ? { kind: 'pick', names: usable.map((branch) => branch.name) } : { kind: 'none' };
}

function listTasks(tasks: { id: number }[]): string {
  return tasks.length === 1 ? `task ${tasks[0].id}` : `tasks ${tasks.map((task) => task.id).join(', ')}`;
}

/** Question once a PR is completed */
export function completedPullRequestPrompt(pullRequestId: number, tasks: { id: number }[], branch?: string): string {
  if (!tasks.length) {
    return branch ? deleteBranchOffer(pullRequestId, branch) : `PR ${pullRequestId} completed.`;
  }
  const question = `PR ${pullRequestId} completed. Set its ${listTasks(tasks)} to ${TASK_DONE}?`;
  return branch ? `${question} The branch ${branch} can be deleted.` : question;
}

/** Info message after publishing */
export function publishedPullRequestMessage(pullRequestId: number, tasks: { id: number }[]): string {
  return `PR ${pullRequestId} published: its ${listTasks(tasks)} moved to ${TASK_IN_PROGRESS}.`;
}
