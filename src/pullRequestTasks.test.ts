import { describe, expect, it } from 'vitest';
import {
  canCreatePullRequestForTask,
  canCreateBranchForTask,
  chooseTaskBranch,
  stateForNewBranchTask,
  completedPullRequestPrompt,
  publishedPullRequestMessage,
  pullRequestTaskTitle,
  reusableTasks,
  stateForNewPullRequestTask,
  tasksToComplete,
  tasksToStart,
} from './pullRequestTasks';

const task = (id: number, state: string, pullRequestIds: number[] = []) => ({
  id,
  title: `Task ${id}`,
  state,
  pullRequestIds,
});

describe('pullRequestTaskTitle', () => {
  it('prefixes the description', () => {
    expect(pullRequestTaskTitle('  Add widget ')).toBe('PR: Add widget');
  });
});

describe('reusableTasks', () => {
  it('keeps open tasks that are not linked to an active PR', () => {
    const tasks = [
      task(1, 'To Do'),
      task(2, 'Done'),
      task(3, 'In Progress', [10]),
      task(4, 'In Progress', [11]),
      task(5, 'Removed'),
    ];
    expect(reusableTasks(tasks, new Set([10])).map((t) => t.id)).toEqual([1, 4]);
  });
});

describe('tasksToStart / tasksToComplete', () => {
  const tasks = [task(1, 'To Do', [7]), task(2, 'In Progress', [7]), task(3, 'Done', [7]), task(4, 'To Do', [8])];

  it('moves the open tasks of the PR that are not in progress', () => {
    expect(tasksToStart(tasks, 7).map((t) => t.id)).toEqual([1]);
  });

  it('offers to close the open tasks of the PR', () => {
    expect(tasksToComplete(tasks, 7).map((t) => t.id)).toEqual([1, 2]);
    expect(tasksToComplete(tasks, 99)).toEqual([]);
  });
});

describe('stateForNewPullRequestTask', () => {
  it('starts the task only when the PR is published', () => {
    expect(stateForNewPullRequestTask({ state: 'To Do' }, false)).toBe('In Progress');
    expect(stateForNewPullRequestTask({ state: 'To Do' }, true)).toBeUndefined();
    expect(stateForNewPullRequestTask({ state: 'In Progress' }, false)).toBeUndefined();
    expect(stateForNewPullRequestTask({ state: 'Done' }, false)).toBeUndefined();
  });
});

describe('canCreatePullRequestForTask', () => {
  const base = { taskState: 'To Do', parentState: 'Committed', pullRequests: [] as { status: string }[] };

  it('offers it for an open task without an active PR', () => {
    expect(canCreatePullRequestForTask(base)).toBe(true);
    expect(canCreatePullRequestForTask({ ...base, pullRequests: [{ status: 'completed' }] })).toBe(true);
  });

  it('does not offer it for closed tasks, active PRs or finished work items', () => {
    expect(canCreatePullRequestForTask({ ...base, taskState: 'Done' })).toBe(false);
    expect(canCreatePullRequestForTask({ ...base, pullRequests: [{ status: 'active' }] })).toBe(false);
    expect(canCreatePullRequestForTask({ ...base, parentState: 'Ready to Test' })).toBe(false);
    expect(canCreatePullRequestForTask({ ...base, parentState: undefined })).toBe(false);
  });
});

describe('canCreateBranchForTask', () => {
  const base = { taskState: 'To Do', parentState: 'Committed', branches: [] as unknown[] };

  it('is offered for an open task without branch', () => {
    expect(canCreateBranchForTask(base)).toBe(true);
    expect(canCreateBranchForTask({ ...base, taskState: 'In Progress' })).toBe(true);
  });

  it('is not offered with a branch, for closed tasks or finished or unknown work items', () => {
    expect(canCreateBranchForTask({ ...base, branches: [{}] })).toBe(false);
    expect(canCreateBranchForTask({ ...base, taskState: 'Done' })).toBe(false);
    expect(canCreateBranchForTask({ ...base, taskState: 'Removed' })).toBe(false);
    expect(canCreateBranchForTask({ ...base, parentState: 'Done' })).toBe(false);
    expect(canCreateBranchForTask({ ...base, parentState: undefined })).toBe(false);
  });
});

describe('stateForNewBranchTask', () => {
  it('moves only tasks not started yet', () => {
    expect(stateForNewBranchTask({ state: 'To Do' })).toBe('In Progress');
    expect(stateForNewBranchTask({ state: 'New' })).toBe('In Progress');
    expect(stateForNewBranchTask({ state: 'In Progress' })).toBeUndefined();
    expect(stateForNewBranchTask({ state: 'Done' })).toBeUndefined();
  });
});

describe('chooseTaskBranch', () => {
  it('prefers the branches linked to the task', () => {
    const b = (name: string) => ({ name, location: 'local', otherRepository: false });
    expect(chooseTaskBranch('a', [b('a'), b('t')], ['t'])).toEqual({ kind: 'branch', name: 't' });
    expect(chooseTaskBranch(undefined, [b('a'), b('t'), b('u')], ['t', 'u'])).toEqual({
      kind: 'pick',
      names: ['t', 'u'],
    });
    expect(chooseTaskBranch('t', [b('a'), b('t'), b('u')], ['t', 'u'])).toEqual({ kind: 'branch', name: 't' });
  });

  it('falls back to the branches of the work item when the task ones are not usable', () => {
    const b = (name: string) => ({ name, location: 'local', otherRepository: false });
    expect(chooseTaskBranch(undefined, [b('a')], ['gone'])).toEqual({ kind: 'branch', name: 'a' });
  });

  const branch = (name: string, location = 'local', otherRepository = false) => ({ name, location, otherRepository });

  it('prefers the current branch when it belongs to the work item', () => {
    expect(chooseTaskBranch('b', [branch('a'), branch('b')])).toEqual({ kind: 'branch', name: 'b' });
  });

  it('uses the only branch of the repository', () => {
    const branches = [branch('x', 'local', true), branch('a', 'remote'), branch('l', 'linked')];
    expect(chooseTaskBranch('other', branches)).toEqual({ kind: 'branch', name: 'a' });
  });

  it('asks when there are several, main one first', () => {
    expect(chooseTaskBranch(undefined, [branch('a'), branch('b', 'remote')])).toEqual({
      kind: 'pick',
      names: ['a', 'b'],
    });
  });

  it('reports no branch', () => {
    expect(chooseTaskBranch('a', [branch('x', 'local', true)])).toEqual({ kind: 'none' });
    expect(chooseTaskBranch('a', [])).toEqual({ kind: 'none' });
  });
});

describe('messages', () => {
  it('names the task or tasks', () => {
    expect(completedPullRequestPrompt(13770, [{ id: 60985 }])).toBe('PR 13770 completed. Set its task 60985 to Done?');
    expect(completedPullRequestPrompt(1, [{ id: 2 }, { id: 3 }])).toBe('PR 1 completed. Set its tasks 2, 3 to Done?');
    expect(completedPullRequestPrompt(1, [{ id: 2 }], 'f/a')).toBe(
      'PR 1 completed. Set its task 2 to Done? The branch f/a can be deleted.'
    );
    expect(completedPullRequestPrompt(1, [], 'f/a')).toBe('PR 1 completed. Delete the branch f/a?');
    expect(publishedPullRequestMessage(5, [{ id: 9 }])).toBe('PR 5 published: its task 9 moved to In Progress.');
  });
});
