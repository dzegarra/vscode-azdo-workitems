import { describe, expect, it } from 'vitest';
import { baseCandidates, baseConfigKey, usableStoredBase } from './baseBranch';

describe('baseConfigKey', () => {
  it('is a per-branch git config variable', () => {
    expect(baseConfigKey('feature/fui-x/66068-a')).toBe('branch.feature/fui-x/66068-a.totalflowxBase');
  });
});

describe('baseCandidates', () => {
  const remoteBranches = ['develop', 'feature/m/1-main', 'feature/m/1-task', 'feature/m/1-local', 'other/x', 'a/b'];

  it('puts the default first, then the branches of the work item (main first), then the rest sorted', () => {
    const result = baseCandidates({
      defaultBase: 'develop',
      workItemBranches: ['feature/m/1-main', 'feature/m/1-task'],
      pullRequests: [],
      remoteBranches,
    });
    expect(result.defaultBase.name).toBe('develop');
    expect(result.workItem.map((c) => c.name)).toEqual(['feature/m/1-main', 'feature/m/1-task']);
    expect(result.others.map((c) => c.name)).toEqual(['a/b', 'feature/m/1-local', 'other/x']);
  });

  it('leaves out work item branches that are not in the remote and the default', () => {
    const result = baseCandidates({
      defaultBase: 'develop',
      workItemBranches: ['develop', 'feature/m/1-gone', 'feature/m/1-main', 'feature/m/1-main'],
      pullRequests: [],
      remoteBranches,
    });
    expect(result.workItem.map((c) => c.name)).toEqual(['feature/m/1-main']);
  });

  it('describes the PR of a branch and flags a completed one', () => {
    const result = baseCandidates({
      defaultBase: 'develop',
      workItemBranches: ['feature/m/1-main', 'feature/m/1-task'],
      pullRequests: [
        { id: 10, sourceBranch: 'feature/m/1-main', status: 'abandoned' },
        { id: 13770, sourceBranch: 'feature/m/1-main', status: 'completed' },
        { id: 5, sourceBranch: 'feature/m/1-task', status: 'active' },
      ],
      remoteBranches,
    });
    expect(result.workItem[0]).toEqual({
      name: 'feature/m/1-main',
      description: 'PR 13770 completed',
      completed: true,
    });
    expect(result.workItem[1]).toEqual({ name: 'feature/m/1-task', description: 'PR 5 active', completed: false });
  });
});

describe('usableStoredBase', () => {
  const base = { defaultBase: 'develop', remoteBranches: ['develop', 'feature/b'], baseCompleted: false };

  it('uses the stored base while it exists and its PR is not completed', () => {
    expect(usableStoredBase({ ...base, stored: 'feature/b' })).toBe('feature/b');
  });

  it('falls back to the default without a stored base or when it is the default', () => {
    expect(usableStoredBase({ ...base, stored: undefined })).toBeUndefined();
    expect(usableStoredBase({ ...base, stored: '  ' })).toBeUndefined();
    expect(usableStoredBase({ ...base, stored: 'develop' })).toBeUndefined();
  });

  it('falls back when the base branch is gone or its PR is completed', () => {
    expect(usableStoredBase({ ...base, stored: 'feature/c' })).toBeUndefined();
    expect(usableStoredBase({ ...base, stored: 'feature/b', baseCompleted: true })).toBeUndefined();
  });
});
