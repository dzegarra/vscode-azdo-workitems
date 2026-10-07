/** Progress of the tasks of a work item, and when their list is shown open. Pure, so no "vscode" import */
import type { AlertRule } from './alerts';
import { stateCategory } from './states';

export interface TaskProgress {
  /** Tasks in a done state (Done, Ready to Test, Closed…) */
  done: number;
  /** All the tasks but the removed ones: a removed task never keeps the work item from being complete */
  total: number;
  /** Share of done tasks, from 0 to 1. A work item without active tasks has 0 */
  ratio: number;
}

export function taskProgress(tasks: { state: string }[]): TaskProgress {
  const categories = tasks.map((task) => stateCategory(task.state)).filter((category) => category !== 'removed');
  const done = categories.filter((category) => category === 'done').length;
  return { done, total: categories.length, ratio: categories.length ? done / categories.length : 0 };
}

/** Alerts about the tasks: their list opens by itself so the problem stays visible */
const TASK_ALERT_RULES: AlertRule[] = ['tasksNotDone', 'pullRequestTaskNotDone', 'pullRequestTaskNotInProgress'];

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
