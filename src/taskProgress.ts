/** Progress of the tasks of a work item, and when their list is shown open. Pure, so no "vscode" import */
import type { AlertRule } from './alerts';
import { stateCategory } from './states';

export type TaskSegmentCategory = 'done' | 'in-progress' | 'proposed';

export interface TaskSegment {
  category: TaskSegmentCategory;
  count: number;
  /** Share of the active tasks, from 0 to 1 */
  share: number;
}

/** One number of the `to do/in progress/done` label and the state category that colours it */
export interface TaskCount {
  category: TaskSegmentCategory;
  count: number;
}

export interface TaskProgress {
  /** Tasks in a done state (Done, Ready to Test, Closed…) */
  done: number;
  /** Tasks being worked on */
  inProgress: number;
  /** Tasks not started (New, Approved, To Do…) */
  toDo: number;
  /** All the tasks but the removed ones: a removed task never keeps the work item from being complete */
  total: number;
  /** Bar segments in workflow order (To do, In progress, Done); categories without tasks are left out */
  segments: TaskSegment[];
}

const SEGMENT_ORDER: TaskSegmentCategory[] = ['proposed', 'in-progress', 'done'];

export function taskProgress(tasks: { state: string }[]): TaskProgress {
  const categories = tasks.map((task) => stateCategory(task.state)).filter((category) => category !== 'removed');
  const count = (wanted: TaskSegmentCategory): number => categories.filter((category) => category === wanted).length;
  const total = categories.length;
  const segments = SEGMENT_ORDER.map((category) => ({
    category,
    count: count(category),
    share: count(category) / total,
  })).filter((segment) => segment.count > 0);
  return { done: count('done'), inProgress: count('in-progress'), toDo: count('proposed'), total, segments };
}

/** Counts in the order of the compact label: To do, In progress, Done. Zeros are kept so the positions mean something */
export function taskCounts(progress: TaskProgress): TaskCount[] {
  return [
    { category: 'proposed', count: progress.toDo },
    { category: 'in-progress', count: progress.inProgress },
    { category: 'done', count: progress.done },
  ];
}

/** Plain-text breakdown ("2 to do, 1 in progress, 3 done"), so the colours are not the only cue */
export function taskProgressTooltip(progress: TaskProgress): string {
  if (progress.total && progress.done === progress.total) {
    return `All ${progress.total} ${progress.total === 1 ? 'task' : 'tasks'} done`;
  }
  const parts = [
    progress.toDo ? `${progress.toDo} to do` : '',
    progress.inProgress ? `${progress.inProgress} in progress` : '',
    progress.done ? `${progress.done} done` : '',
  ];
  return parts.filter(Boolean).join(', ');
}

/** Alerts about the tasks: their list opens by itself so the problem stays visible */
const TASK_ALERT_RULES: AlertRule[] = ['tasksNotDone', 'pullRequestTaskNotDone', 'pullRequestTaskNotInProgress'];

// Rule ALERT-SHOW-1
export function hasTaskAlerts(alerts: { rule: AlertRule }[]): boolean {
  return alerts.some((alert) => TASK_ALERT_RULES.includes(alert.rule));
}

/**
 * Whether the task list of a card is open. The user's choice always wins; without one, the list is closed
 * unless the card has alerts about its tasks
 */
export function isTaskListOpen(autoOpen: boolean, choice: { expanded: boolean; collapsed: boolean }): boolean {
  if (choice.expanded) {
    return true;
  }
  return autoOpen && !choice.collapsed;
}
