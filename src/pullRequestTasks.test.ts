import { describe, expect, it } from 'vitest';
import {
  canCreatePullRequestForTask,
  canCreateBranchForTask,
  chooseTaskBranch,
  isInReview,
  shownState,
  startedTaskKey,
  startedTasksMessage,
  stateForNewBranchTask,
  completedPullRequestPrompt,
  publishedPullRequestMessage,
  pullRequestTaskTitle,
  reusableTasks,
  stateForNewPullRequestTask,
  taskBranchesForNewPullRequest,
  tasksOfPublishedPullRequests,
  tasksToComplete,
  tasksToStart,
} from './pullRequestTasks';
import type { TaskBranchModel } from './taskBranches';

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

describe('tasksOfPublishedPullRequests', () => {
  const ME = 'ME-ID';
  const pr = (id: number, overrides: { status?: string; isDraft?: boolean; authorId?: string } = {}) => ({
    id,
    status: 'active',
    isDraft: false,
    authorId: 'me-id',
    ...overrides,
  });

  it('starts the open tasks of the published PRs of the user that are not in progress', () => {
    const tasks = [task(1, 'To Do', [7]), task(2, 'In Progress', [7]), task(3, 'Done', [7]), task(4, 'Removed', [7])];
    expect(tasksOfPublishedPullRequests(tasks, [pr(7)], ME)).toEqual([{ pullRequestId: 7, tasks: [tasks[0]] }]);
  });

  it('leaves drafts, completed and abandoned PRs alone', () => {
    const tasks = [task(1, 'To Do', [7]), task(2, 'New', [8]), task(3, 'To Do', [9])];
    const pullRequests = [pr(7, { isDraft: true }), pr(8, { status: 'completed' }), pr(9, { status: 'abandoned' })];
    expect(tasksOfPublishedPullRequests(tasks, pullRequests, ME)).toEqual([]);
  });

  it('only acts on the PRs the user created', () => {
    const tasks = [task(1, 'To Do', [7]), task(2, 'To Do', [8])];
    expect(
      tasksOfPublishedPullRequests(tasks, [pr(7, { authorId: 'someone' }), pr(8, { authorId: undefined })], ME)
    ).toEqual([]);
  });

  it('moves each task once and never twice for the same PR', () => {
    const tasks = [task(1, 'To Do', [7, 8]), task(2, 'To Do', [8])];
    expect(tasksOfPublishedPullRequests(tasks, [pr(7), pr(8)], ME)).toEqual([
      { pullRequestId: 7, tasks: [tasks[0]] },
      { pullRequestId: 8, tasks: [tasks[1]] },
    ]);
    expect(tasksOfPublishedPullRequests(tasks, [pr(8)], ME, new Set([startedTaskKey(2, 8)]))).toEqual([
      { pullRequestId: 8, tasks: [tasks[0]] },
    ]);
  });

  it('tells which tasks moved', () => {
    expect(
      startedTasksMessage([
        { pullRequestId: 7, tasks: [{ id: 1 }] },
        { pullRequestId: 8, tasks: [{ id: 2 }, { id: 3 }] },
      ])
    ).toBe('PR published: task 1 of PR 7, tasks 2, 3 of PR 8 moved to In Progress.');
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

const taskBranch = (name: string, over: Partial<TaskBranchModel> = {}): TaskBranchModel => ({
  name,
  state: 'exists',
  canCheckout: true,
  ...over,
});
const withPr = (tone: 'abandoned' | 'completed' | 'draft' | 'review') => ({ id: 1, status: tone, tone });

describe('taskBranchesForNewPullRequest', () => {
  it('offers the usable branches without PR or with an abandoned one', () => {
    const branches = [
      taskBranch('none'),
      taskBranch('current', { state: 'current' }),
      taskBranch('abandoned', { pullRequest: withPr('abandoned') }),
    ];
    expect(taskBranchesForNewPullRequest(branches)).toEqual(['none', 'current', 'abandoned']);
  });

  it('skips active, draft and completed PRs, deleted branches and other repositories', () => {
    const branches = [
      taskBranch('active', { pullRequest: withPr('review') }),
      taskBranch('draft', { pullRequest: withPr('draft') }),
      taskBranch('completed', { pullRequest: withPr('completed') }),
      taskBranch('deleted', { state: 'deleted', canCheckout: false }),
      taskBranch('other', { state: 'other', canCheckout: false }),
    ];
    expect(taskBranchesForNewPullRequest(branches)).toEqual([]);
  });
});

describe('canCreatePullRequestForTask', () => {
  const base = {
    taskState: 'To Do',
    parentState: 'Committed',
    pullRequests: [] as { status: string }[],
    branches: [] as TaskBranchModel[],
  };

  it('is offered for a branch without PR although another branch has an active one', () => {
    const branches = [taskBranch('a', { pullRequest: withPr('review') }), taskBranch('b')];
    expect(canCreatePullRequestForTask({ ...base, pullRequests: [{ status: 'active' }], branches })).toBe(true);
  });

  it('is not offered when every usable branch has an active PR', () => {
    const branches = [
      taskBranch('a', { pullRequest: withPr('review') }),
      taskBranch('b', { pullRequest: withPr('draft') }),
    ];
    expect(canCreatePullRequestForTask({ ...base, pullRequests: [{ status: 'active' }], branches })).toBe(false);
  });

  it('keeps the old check when the task has no usable branch', () => {
    const branches = [taskBranch('gone', { state: 'deleted', canCheckout: false })];
    expect(canCreatePullRequestForTask({ ...base, branches })).toBe(true);
    expect(canCreatePullRequestForTask({ ...base, branches, pullRequests: [{ status: 'active' }] })).toBe(false);
  });

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

// Rule STATE-10
describe('isInReview', () => {
  const pattern = /\b(PR|pull request)\b/i;
  const prTask = (state: string) => ({ id: 1, title: 'PR: Add label', state, pullRequestIds: [] });
  const review = (state: string, tasks: ReturnType<typeof task>[]) => isInReview(state, tasks, pattern);

  it('is true when the only task in progress is a PR task and the rest is Done', () => {
    expect(review('Committed', [task(2, 'Done'), prTask('In Progress')])).toBe(true);
  });

  it('compares the work item state ignoring typos', () => {
    expect(review('Commited', [prTask('In Progress')])).toBe(true);
    expect(review('In Progress', [prTask('In Progress')])).toBe(false);
    expect(review('New', [prTask('In Progress')])).toBe(false);
  });

  it('recognizes a PR task by its link even if the title does not match', () => {
    expect(review('Committed', [task(2, 'In Progress', [10])])).toBe(true);
  });

  it('recognizes a PR task by its title even if it is not linked', () => {
    expect(review('Committed', [{ ...task(2, 'In Progress'), title: 'Create pull request' }])).toBe(true);
  });

  it('ignores the Removed tasks', () => {
    expect(review('Committed', [task(2, 'Removed'), prTask('In Progress')])).toBe(true);
  });

  it('stays Committed without tasks or when all of them are Done', () => {
    expect(review('Committed', [])).toBe(false);
    expect(review('Committed', [task(2, 'Done'), task(3, 'Removed')])).toBe(false);
  });

  it('is blocked by a To Do task', () => {
    expect(review('Committed', [task(2, 'To Do'), prTask('In Progress')])).toBe(false);
  });

  it('is blocked by an In Progress task that is not a PR task', () => {
    expect(review('Committed', [task(2, 'In Progress'), prTask('In Progress')])).toBe(false);
  });

  it('is false when the PR task is not In Progress', () => {
    expect(review('Committed', [prTask('To Do')])).toBe(false);
  });
});

describe('shownState', () => {
  it('shows In review only when it applies and the setting is on', () => {
    expect(shownState('Committed', true, true)).toBe('In review');
    expect(shownState('Committed', true, false)).toBe('Committed');
    expect(shownState('Committed', false, true)).toBe('Committed');
  });
});
