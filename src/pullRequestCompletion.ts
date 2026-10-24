/**
 * What "Complete…" of My Pull Requests does to the work items of the PR (DEVELOPMENT_APPROACH §8.2.3 and §8.2.5,
 * with the team's correction: Bugs are never completed by developers). Pure, so no "vscode" import
 */
import { isClosedState, normalizeState } from './states';
import { isTaskClosed, TASK_DONE } from './pullRequestTasks';

/** Merge type of the PRs into the base branch: one commit per PR (§8.2.5) */
export const COMPLETION_MERGE_STRATEGY = 'squash';
export const BACKLOG_ITEM_DONE = 'Done';
const BACKLOG_ITEM_TYPES = ['Product Backlog Item', 'User Story'];
const TASK_TYPE = 'Task';

/** A work item as the plan needs it, freshly fetched */
export interface CompletionWorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  /** Child tasks with the PRs linked to them */
  tasks: { id: number; state: string; pullRequestIds: number[] }[];
  /** PRs linked to the work item or to its tasks, with their status (this PR included or not) */
  pullRequests: { id: number; status: string }[];
}

export interface CompletionOptions {
  /** `integrationBuild.workItemTypes` (default Bug) */
  bugTypes: readonly string[];
  /** The state a merged Bug goes to: the first of `integrationBuild.states` (default Ready to Test) */
  bugState: string;
}

export interface CompletionMove {
  id: number;
  title: string;
  type: string;
  from: string;
  to: string;
  /** Bugs: "Integrated in Build" is set too */
  setsIntegrationBuild: boolean;
}

export interface CompletionPlan {
  moves: CompletionMove[];
  /** Work items left as they are, and why (shown before completing) */
  kept: { id: number; title: string; reason: string }[];
}

/** Another PR of the work item (or of its tasks) still active: its work is not over */
function otherActivePullRequests(item: CompletionWorkItem, pullRequestId: number): number[] {
  return item.pullRequests
    .filter((pr) => pr.id !== pullRequestId && pr.status === 'active')
    .map((pr) => pr.id)
    .sort((a, b) => a - b);
}

// Rules COMPLETE-PR-1..4
/**
 * The work items of a PR the user is completing: Backlog Items go to Done and Bugs to Ready to Test (with
 * "Integrated in Build") when nothing else is left in them; the open tasks linked to the PR go to Done. Azure DevOps does not
 * transition anything (`transitionWorkItems` false): it would complete the Bugs
 */
export function completionPlan(
  pullRequestId: number,
  workItems: CompletionWorkItem[],
  options: CompletionOptions
): CompletionPlan {
  const plan: CompletionPlan = { moves: [], kept: [] };
  const move = (item: CompletionWorkItem, to: string, setsIntegrationBuild = false) =>
    plan.moves.push({ id: item.id, title: item.title, type: item.type, from: item.state, to, setsIntegrationBuild });
  const keep = (item: CompletionWorkItem, reason: string) => plan.kept.push({ id: item.id, title: item.title, reason });
  for (const item of workItems) {
    // Rule COMPLETE-PR-1
    if (item.type === TASK_TYPE) {
      if (!isTaskClosed(item.state)) {
        move(item, TASK_DONE);
      }
      continue;
    }
    if (isClosedState(item.state)) {
      keep(item, `already ${item.state}`);
      continue;
    }
    const isBug = options.bugTypes.includes(item.type);
    if (!isBug && !BACKLOG_ITEM_TYPES.includes(item.type)) {
      keep(item, `a ${item.type} is not changed`);
      continue;
    }
    // Rule COMPLETE-PR-2
    if (isBug && normalizeState(item.state) === normalizeState(options.bugState)) {
      keep(item, `already ${item.state}`);
      continue;
    }
    // Rule COMPLETE-PR-3: the tasks of this PR are closed by the completion itself. Done and Ready to Test with
    // open tasks would be an alert (ALERT-1), another active PR means the work goes on
    const openTasks = item.tasks.filter(
      (task) => !isTaskClosed(task.state) && !task.pullRequestIds.includes(pullRequestId)
    );
    const otherPullRequests = otherActivePullRequests(item, pullRequestId);
    if (openTasks.length) {
      keep(item, `${openTasks.length} other task${openTasks.length === 1 ? ' is' : 's are'} not done`);
    } else if (otherPullRequests.length) {
      keep(item, `PR ${otherPullRequests.join(', ')} still active`);
    } else if (isBug) {
      move(item, options.bugState, true);
    } else {
      move(item, BACKLOG_ITEM_DONE);
    }
  }
  return plan;
}

// Rule COMPLETE-PR-4
/** The text of the confirmation: the PR, then each work item and what happens to it */
export function completionSummary(
  pullRequestId: number,
  baseBranch: string,
  plan: CompletionPlan,
  integrationBuild?: { field: string; value: string }
): string {
  const lines = [`Squash merge into ${baseBranch}, then delete the branch.`];
  for (const moved of plan.moves) {
    const build =
      moved.setsIntegrationBuild && integrationBuild ? `, "${integrationBuild.field}" = ${integrationBuild.value}` : '';
    lines.push(`• ${moved.type} ${moved.id}: ${moved.from} → ${moved.to}${build}`);
  }
  for (const kept of plan.kept) {
    lines.push(`• ${kept.id} stays as it is: ${kept.reason}`);
  }
  if (!plan.moves.length && !plan.kept.length) {
    lines.push(`No work item linked to PR ${pullRequestId}.`);
  }
  return lines.join('\n');
}
