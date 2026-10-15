import { describe, expect, it } from 'vitest';
import { hasTaskAlerts, isTaskListOpen, taskCounts, taskProgress, taskProgressTooltip } from './taskProgress';

const tasksIn = (...states: string[]) => states.map((state) => ({ state }));

describe('taskProgress', () => {
  it('counts every category and ignores removed tasks', () => {
    const tasks = tasksIn('Done', 'Ready to Test', 'In Progress', 'To Do', 'New', 'Approved', 'Removed');
    expect(taskProgress(tasks)).toMatchObject({ done: 2, inProgress: 1, toDo: 3, total: 6 });
  });

  it('orders the segments To do, In progress, Done with their share', () => {
    const { segments } = taskProgress(tasksIn('To Do', 'To Do', 'In Progress', 'Done', 'Done', 'Done'));
    expect(segments).toEqual([
      { category: 'proposed', count: 2, share: 1 / 3 },
      { category: 'in-progress', count: 1, share: 1 / 6 },
      { category: 'done', count: 3, share: 0.5 },
    ]);
  });

  it('leaves out the categories without tasks', () => {
    expect(taskProgress(tasksIn('Done', 'Removed')).segments).toEqual([{ category: 'done', count: 1, share: 1 }]);
  });

  it('has no progress without active tasks', () => {
    const none = { done: 0, inProgress: 0, toDo: 0, total: 0, segments: [] };
    expect(taskProgress([])).toEqual(none);
    expect(taskProgress(tasksIn('Removed'))).toEqual(none);
  });
});

describe('taskCounts', () => {
  it('lists to do, in progress and done, keeping the zeros', () => {
    expect(taskCounts(taskProgress(tasksIn('To Do', 'Done', 'Done', 'Removed')))).toEqual([
      { category: 'proposed', count: 1 },
      { category: 'in-progress', count: 0 },
      { category: 'done', count: 2 },
    ]);
  });
});

describe('taskProgressTooltip', () => {
  it('lists the non-zero counts', () => {
    expect(taskProgressTooltip(taskProgress(tasksIn('To Do', 'To Do', 'In Progress', 'Done', 'Done', 'Done')))).toBe(
      '2 to do, 1 in progress, 3 done'
    );
    expect(taskProgressTooltip(taskProgress(tasksIn('In Progress', 'Done')))).toBe('1 in progress, 1 done');
    expect(taskProgressTooltip(taskProgress(tasksIn('To Do')))).toBe('1 to do');
  });

  it('says when all the tasks are done', () => {
    expect(taskProgressTooltip(taskProgress(tasksIn('Done', 'Done', 'Removed')))).toBe('All 2 tasks done');
    expect(taskProgressTooltip(taskProgress(tasksIn('Done')))).toBe('All 1 task done');
  });

  it('is empty without active tasks', () => {
    expect(taskProgressTooltip(taskProgress([]))).toBe('');
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
