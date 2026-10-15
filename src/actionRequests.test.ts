import { describe, expect, it } from 'vitest';
import { pullRequestActionsRequest, taskActionsRequest, workItemActionsRequest } from './actionRequests';
import type { BranchModel } from './viewModel';

const branch = (over: Partial<BranchModel> = {}): BranchModel => ({
  name: 'feature/1-a',
  location: 'remote',
  isCurrent: false,
  otherRepository: false,
  ...over,
});

describe('taskActionsRequest', () => {
  it('is titled with the task and offers its actions', () => {
    const request = taskActionsRequest(
      { id: 11, title: 'Fix it', taskBranches: [], taskPullRequests: [], canCreateBranch: true },
      5
    );
    expect(request?.title).toBe('Task 11 · Fix it');
    expect(request?.sections).toEqual([
      {
        title: 'Create',
        items: [{ label: 'Create branch for this task', act: { action: 'createBranch', id: 5, task: 11 } }],
      },
    ]);
  });

  it('is nothing when there is nothing to choose', () => {
    expect(taskActionsRequest({ id: 11, title: 'Fix it', taskBranches: [], taskPullRequests: [] }, 5)).toBeUndefined();
  });
});

describe('workItemActionsRequest', () => {
  const card = {
    id: 100,
    branch: 'feature/100-x',
    branches: [branch(), branch({ name: 'feature/1-b', worktree: '/w/b' })],
    deletableBranches: ['feature/1-a'],
  };

  it('card: the main branch, acted on as the card button does (no branch field)', () => {
    const request = workItemActionsRequest(card);
    expect(request?.title).toBe('feature/100-x');
    expect(request?.sections[0].items.map((item) => item.act)).toEqual([
      { action: 'checkoutHere', id: 100, kind: 'workItem' },
      { action: 'openWorktree', id: 100, kind: 'workItem' },
    ]);
  });

  it('card with a worktree: open / remove it', () => {
    const request = workItemActionsRequest({ ...card, worktree: '/w/x' });
    expect(request?.sections[0].items.map((item) => item.label)).toEqual(['Open worktree', 'Remove worktree']);
  });

  it('branch row: checkout items, and Delete when the branch is deletable', () => {
    const request = workItemActionsRequest(card, 'feature/1-a');
    expect(request?.title).toBe('feature/1-a');
    expect(request?.sections.map((section) => section.title)).toEqual(['Branch', 'Cleanup']);
    expect(request?.sections[0].items[0].act).toEqual({
      action: 'checkoutHere',
      id: 100,
      kind: 'workItem',
      branch: 'feature/1-a',
    });
  });

  it('is nothing for a branch the card does not have', () => {
    expect(workItemActionsRequest(card, 'nope')).toBeUndefined();
  });
});

describe('pullRequestActionsRequest', () => {
  it('is titled with the branch of the PR and acts on the PR', () => {
    const request = pullRequestActionsRequest('review', { id: 501, sourceBranch: 'feature/r' });
    expect(request?.title).toBe('feature/r');
    expect(request?.sections[0].items[0].act).toEqual({ action: 'checkoutHere', id: 501, kind: 'review' });
  });

  it('offers the worktree when another one has the branch', () => {
    const request = pullRequestActionsRequest('myPullRequest', { id: 6, sourceBranch: 'b', worktree: '/w' });
    expect(request?.sections[0].items.map((item) => item.act?.action)).toEqual(['openWorktree', 'removeWorktree']);
  });
});
