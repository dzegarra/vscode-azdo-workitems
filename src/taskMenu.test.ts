import { describe, expect, it } from 'vitest';
import { taskHasActions, taskMenuSections, taskPill, TaskMenuTask } from './taskMenu';
import type { TaskBranchModel } from './taskBranches';
import type { TaskPullRequestModel } from './taskPullRequests';

const branch = (over: Partial<TaskBranchModel> = {}): TaskBranchModel => ({
  name: 'feature/1-x',
  state: 'exists',
  where: 'remote only',
  canCheckout: true,
  ...over,
});

const pr = (over: Partial<TaskPullRequestModel> = {}): TaskPullRequestModel => ({
  id: 7,
  title: 'Fix it',
  status: 'In review',
  tone: 'review',
  url: 'https://x/7',
  repository: 'User_Interface',
  otherRepository: false,
  reviewers: [],
  moreReviewers: 0,
  runs: [],
  ...over,
});

const task = (over: Partial<TaskMenuTask> = {}): TaskMenuTask => ({
  id: 11,
  taskBranches: [],
  taskPullRequests: [],
  ...over,
});

describe('taskMenuSections', () => {
  it('offers to delete a deletable branch, in the danger style, also when it is checked out', () => {
    const [section] = taskMenuSections(task({ taskBranches: [branch({ deletable: true })] }), 5);
    const remove = section.items.at(-1);
    expect(remove).toMatchObject({ label: 'Delete branch feature/1-x', danger: true });
    expect(remove?.act).toEqual({ action: 'deleteBranch', id: 11, kind: 'task', branch: 'feature/1-x' });
    const [current] = taskMenuSections(
      task({ taskBranches: [branch({ state: 'current', canCheckout: false, deletable: true })] }),
      5
    );
    expect(current.items.map((item) => item.act?.action)).toEqual([undefined, 'deleteBranch']);
  });

  it('does not offer to delete the other branches', () => {
    const [section] = taskMenuSections(task({ taskBranches: [branch()] }), 5);
    expect(section.items.some((item) => item.danger)).toBe(false);
  });

  it('offers checkout and worktree for a branch that exists', () => {
    const [section] = taskMenuSections(task({ taskBranches: [branch()] }), 5);
    expect(section.title).toBe('Branches');
    expect(section.items.map((item) => item.act?.action)).toEqual(['checkoutHere', 'openWorktree']);
    expect(section.items[0].act).toEqual({ action: 'checkoutHere', id: 11, kind: 'task', branch: 'feature/1-x' });
  });

  it('shows the checked out, deleted and other-repository branches without action', () => {
    const [section] = taskMenuSections(
      task({
        taskBranches: [
          branch({ state: 'current', where: 'local and remote', canCheckout: false, name: 'cur' }),
          branch({ state: 'deleted', canCheckout: false, name: 'gone' }),
          branch({ state: 'other', canCheckout: false, name: 'o', repository: 'Common' }),
        ],
      }),
      5
    );
    expect(section.items.every((item) => item.act === undefined)).toBe(true);
    expect(section.items.map((item) => item.detail)).toEqual([
      'Checked out (local and remote)',
      'deleted',
      'in another repository (Common)',
    ]);
  });

  it('lists the PRs', () => {
    const sections = taskMenuSections(task({ taskPullRequests: [pr(), pr({ id: 8 })] }), 5);
    expect(sections.map((section) => section.title)).toEqual(['Pull requests']);
    expect(sections[0].items[1].act).toEqual({ action: 'openPullRequest', id: 11, pr: 8 });
    expect(sections[0].items[0].detail).toBe('In review · Fix it');
  });

  it('creates through the parent work item', () => {
    const sections = taskMenuSections(task({ canCreateBranch: true, canCreatePullRequest: true }), 5);
    expect(sections.map((section) => section.title)).toEqual(['Create']);
    expect(sections[0].items.map((item) => item.act)).toEqual([
      { action: 'createBranch', id: 5, task: 11 },
      { action: 'createPullRequest', id: 5, task: 11 },
    ]);
  });

  it('has only the create item that applies, after branches and PRs', () => {
    const sections = taskMenuSections(
      task({ taskBranches: [branch()], taskPullRequests: [pr()], canCreatePullRequest: true }),
      5
    );
    expect(sections.map((section) => section.title)).toEqual(['Branches', 'Pull requests', 'Create']);
    expect(sections[2].items).toHaveLength(1);
  });

  it('offers Create PR for each branch without PR, with the branch in the action', () => {
    const sections = taskMenuSections(
      task({
        taskBranches: [
          branch({ name: 'a', pullRequest: { id: 7, status: 'In review', tone: 'review' } }),
          branch({ name: 'b' }),
        ],
        taskPullRequests: [pr()],
        canCreatePullRequest: true,
      }),
      5
    );
    const create = sections.find((section) => section.title === 'Create');
    expect(create?.items.map((item) => item.label)).toEqual(['Create PR from b']);
    expect(create?.items[0].act).toEqual({ action: 'createPullRequest', id: 5, task: 11, branch: 'b' });
  });

  it('is empty for a finished task', () => {
    expect(taskMenuSections(task(), 5)).toEqual([]);
  });
});

describe('taskPill', () => {
  it('has no pill when nothing is linked and nothing can be created', () => {
    expect(taskPill(task())).toBeUndefined();
  });

  it('is the dim "+" pill of an empty task that can get a branch', () => {
    const pill = taskPill(task({ canCreateBranch: true }));
    expect(pill).toMatchObject({ empty: true, branches: 0, pullRequests: 0 });
    expect(pill?.label).toBe('Task 11: create a branch or a pull request');
  });

  it('colours the branch icon by the best branch and the PR icon by the active PR', () => {
    const pill = taskPill(
      task({
        taskBranches: [
          branch({ state: 'deleted', canCheckout: false }),
          branch({ where: 'remote only' }),
          branch({ where: 'local only', name: 'l' }),
        ],
        taskPullRequests: [pr({ id: 1, tone: 'completed', status: 'Completed' }), pr({ id: 2 })],
      })
    );
    expect(pill).toMatchObject({ branches: 3, branchTone: 'local', pullRequests: 2, empty: false });
    expect(pill?.pullRequest?.id).toBe(2);
  });

  it('ranks a checked out branch first and a deleted one last', () => {
    expect(taskPill(task({ taskBranches: [branch({ state: 'current', canCheckout: false })] }))?.branchTone).toBe(
      'current'
    );
    expect(taskPill(task({ taskBranches: [branch({ state: 'other', canCheckout: false })] }))?.branchTone).toBe('dim');
  });

  it('summarises for screen readers', () => {
    expect(taskPill(task({ taskBranches: [branch()], taskPullRequests: [pr()] }))?.label).toBe(
      'Task 11: 1 branch (remote only), 1 pull request (In review). Actions'
    );
    expect(taskPill(task({ taskBranches: [branch(), branch({ name: 'b' })] }))?.label).toBe(
      'Task 11: 2 branches. Actions'
    );
  });
});

describe('taskHasActions', () => {
  it('is true when something can be done: a PR to open, a branch to check out, something to create', () => {
    expect(taskHasActions(task({ taskPullRequests: [pr()] }), 5)).toBe(true);
    expect(taskHasActions(task({ taskBranches: [branch()] }), 5)).toBe(true);
    expect(taskHasActions(task({ canCreateBranch: true }), 5)).toBe(true);
  });

  it('is false when the menu would only inform', () => {
    const current = branch({ state: 'current', canCheckout: false, where: 'local' });
    expect(taskHasActions(task({ taskBranches: [current] }), 5)).toBe(false);
    expect(taskHasActions(task(), 5)).toBe(false);
  });
});
