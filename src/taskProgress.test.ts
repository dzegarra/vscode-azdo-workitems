import { describe, expect, it } from 'vitest';
import { hasTaskAlerts, isTaskListOpen, taskProgress } from './taskProgress';

describe('taskProgress', () => {
  it('counts the done category and ignores removed tasks', () => {
    const tasks = ['Done', 'Ready to Test', 'In Progress', 'Removed'].map((state) => ({ state }));
    expect(taskProgress(tasks)).toEqual({ done: 2, total: 3, ratio: 2 / 3 });
  });

  it('is complete when only a removed task is left', () => {
    expect(taskProgress([{ state: 'Done' }, { state: 'Removed' }]).ratio).toBe(1);
  });

  it('has no progress without active tasks', () => {
    expect(taskProgress([])).toEqual({ done: 0, total: 0, ratio: 0 });
    expect(taskProgress([{ state: 'Removed' }])).toEqual({ done: 0, total: 0, ratio: 0 });
  });
});

describe('hasTaskAlerts', () => {
  it('detects the alerts about tasks only', () => {
    expect(hasTaskAlerts([{ rule: 'blockingTag' }, { rule: 'tasksNotDone' }])).toBe(true);
    expect(hasTaskAlerts([{ rule: 'pullRequestTaskNotDone' }])).toBe(true);
    expect(hasTaskAlerts([{ rule: 'missingField' }, { rule: 'noPullRequestTask' }])).toBe(false);
    expect(hasTaskAlerts([])).toBe(false);
  });
});

describe('isTaskListOpen', () => {
  const none = { expanded: false, collapsed: false };
  it('is closed by default', () => {
    expect(isTaskListOpen(false, none)).toBe(false);
  });
  it('opens by itself with task alerts', () => {
    expect(isTaskListOpen(true, none)).toBe(true);
  });
  it('respects the choice of the user', () => {
    expect(isTaskListOpen(true, { expanded: false, collapsed: true })).toBe(false);
    expect(isTaskListOpen(false, { expanded: true, collapsed: false })).toBe(true);
  });
});
