/**
 * The "artifacts" pill of a task row (its branches and PRs in one control) and the actions menu behind it.
 * Pure, so no "vscode" import: the webview bundles it
 */
import { describeTaskBranch, TaskBranchModel } from './taskBranches';
import type { TaskPullRequestModel } from './taskPullRequests';

/** What the pill needs to know about a task */
export interface TaskMenuTask {
  id: number;
  taskBranches: TaskBranchModel[];
  taskPullRequests: TaskPullRequestModel[];
  canCreateBranch?: boolean;
  canCreatePullRequest?: boolean;
}

/** The message an item of the menu posts: the data attributes of its button */
export interface TaskMenuAction {
  action: 'checkoutHere' | 'openWorktree' | 'deleteBranch' | 'openPullRequest' | 'createBranch' | 'createPullRequest';
  /** Id sent as `id`: the task, or the parent work item for the create actions */
  id: number;
  kind?: 'task';
  branch?: string;
  pr?: number;
  task?: number;
}

export interface TaskMenuItem {
  label: string;
  /** Second line, e.g. the state of the PR */
  detail?: string;
  /** Without action: the item only informs (dimmed) */
  act?: TaskMenuAction;
  /** Destructive: shown in the danger colour */
  danger?: boolean;
}

export interface TaskMenuSection {
  title: string;
  items: TaskMenuItem[];
}

export function taskMenuSections(task: TaskMenuTask, parentId: number): TaskMenuSection[] {
  const branchItems = task.taskBranches.flatMap((branch): TaskMenuItem[] => {
    const remove: TaskMenuItem[] = branch.deletable
      ? [
          {
            label: `Delete branch ${branch.name}`,
            detail: 'The PR is merged',
            danger: true,
            act: { action: 'deleteBranch', id: task.id, kind: 'task', branch: branch.name },
          },
        ]
      : [];
    if (branch.canCheckout) {
      const base = { id: task.id, kind: 'task' as const, branch: branch.name };
      return [
        {
          label: `Checkout ${branch.name}`,
          detail: describeTaskBranch(branch),
          act: { action: 'checkoutHere', ...base },
        },
        { label: 'Open in a worktree', detail: branch.name, act: { action: 'openWorktree', ...base } },
        ...remove,
      ];
    }
    const note = branch.state === 'current' ? 'Checked out' : describeTaskBranch(branch);
    return [{ label: branch.name, detail: branch.state === 'current' ? `${note} (${branch.where})` : note }, ...remove];
  });
  const prItems = task.taskPullRequests.map(
    (pr): TaskMenuItem => ({
      label: `Open PR ${pr.id}`,
      detail: `${pr.status} · ${pr.title}`,
      act: { action: 'openPullRequest', id: task.id, pr: pr.id },
    })
  );
  const createItems: TaskMenuItem[] = [];
  if (task.canCreateBranch) {
    createItems.push({
      label: 'Create branch for this task',
      act: { action: 'createBranch', id: parentId, task: task.id },
    });
  }
  if (task.canCreatePullRequest) {
    createItems.push({
      label: 'Create PR with this task',
      act: { action: 'createPullRequest', id: parentId, task: task.id },
    });
  }
  return [
    { title: 'Branches', items: branchItems },
    { title: 'Pull requests', items: prItems },
    { title: 'Create', items: createItems },
  ].filter((section) => section.items.length);
}

export type PillBranchTone = 'current' | 'local' | 'remote' | 'dim';
export type PillPullRequestTone = TaskPullRequestModel['tone'];

export interface TaskPill {
  branches: number;
  /** Colour of the branch icon: the best state among the branches */
  branchTone?: PillBranchTone;
  pullRequests: number;
  /** The most relevant PR: an active one first */
  pullRequest?: TaskPullRequestModel;
  /** Nothing linked, but something can be created */
  empty: boolean;
  label: string;
}

const BRANCH_RANK: Record<PillBranchTone, number> = { current: 0, local: 1, remote: 2, dim: 3 };

function branchToneOf(branch: TaskBranchModel): PillBranchTone {
  if (branch.state === 'current') {
    return 'current';
  }
  if (branch.state !== 'exists') {
    return 'dim';
  }
  return branch.where?.startsWith('local') ? 'local' : 'remote';
}

function bestBranchTone(branches: TaskBranchModel[]): PillBranchTone | undefined {
  return branches.map(branchToneOf).sort((a, b) => BRANCH_RANK[a] - BRANCH_RANK[b])[0];
}

function mostRelevantPullRequest(prs: TaskPullRequestModel[]): TaskPullRequestModel | undefined {
  const finished = (pr: TaskPullRequestModel) => pr.tone === 'completed' || pr.tone === 'abandoned';
  return prs.find((pr) => !finished(pr)) ?? prs[0];
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function describePill(task: TaskMenuTask, pr: TaskPullRequestModel | undefined): string {
  const parts: string[] = [];
  if (task.taskBranches.length) {
    const first = task.taskBranches[0];
    const where = task.taskBranches.length === 1 ? ` (${describeTaskBranch(first)})` : '';
    parts.push(`${plural(task.taskBranches.length, 'branch', 'branches')}${where}`);
  }
  if (task.taskPullRequests.length) {
    const status = task.taskPullRequests.length === 1 && pr ? ` (${pr.status})` : '';
    parts.push(`${plural(task.taskPullRequests.length, 'pull request', 'pull requests')}${status}`);
  }
  return parts.length
    ? `Task ${task.id}: ${parts.join(', ')}. Actions`
    : `Task ${task.id}: create a branch or a pull request`;
}

/** The pill of a task row; undefined when there is nothing to show and nothing to do */
export function taskPill(task: TaskMenuTask): TaskPill | undefined {
  const linked = task.taskBranches.length + task.taskPullRequests.length > 0;
  if (!linked && !task.canCreateBranch && !task.canCreatePullRequest) {
    return undefined;
  }
  const pullRequest = mostRelevantPullRequest(task.taskPullRequests);
  return {
    branches: task.taskBranches.length,
    branchTone: bestBranchTone(task.taskBranches),
    pullRequests: task.taskPullRequests.length,
    pullRequest,
    empty: !linked,
    label: describePill(task, pullRequest),
  };
}
