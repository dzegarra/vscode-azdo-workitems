import { describe, expect, it } from 'vitest';
import {
  branchesToVerify,
  describeTaskBranch,
  splitTaskBranches,
  taskBranchTooltip,
  TaskBranchContext,
  TaskBranchPullRequest,
  toTaskBranchModels,
} from './taskBranches';

const REPO = 'repo-1';
const link = (name: string, repositoryId = REPO) => ({ repositoryId, name });
const context = (overrides: Partial<TaskBranchContext> = {}): TaskBranchContext => ({
  repositoryId: REPO,
  local: [],
  remoteExists: () => true,
  ...overrides,
});
const pr = (overrides: Partial<TaskBranchPullRequest> = {}): TaskBranchPullRequest => ({
  pullRequestId: 7,
  sourceRefName: 'refs/heads/feature/a',
  repository: { id: REPO },
  status: 'active',
  isDraft: false,
  reviewers: [],
  ...overrides,
});

describe('toTaskBranchModels', () => {
  it('marks the checked out branch and where it exists', () => {
    const [branch] = toTaskBranchModels(
      [link('feature/a')],
      [],
      context({ currentBranch: 'feature/a', local: ['feature/a'] })
    );
    expect(branch).toMatchObject({ state: 'current', where: 'local and remote', canCheckout: false });
  });

  it('tells remote only, local only and not verified', () => {
    const where = (ctx: Partial<TaskBranchContext>) =>
      toTaskBranchModels([link('feature/a')], [], context(ctx))[0].where;
    expect(where({})).toBe('remote only');
    expect(where({ local: ['feature/a'], remoteExists: () => false })).toBe('local only');
    expect(where({ remoteExists: () => undefined })).toBe('remote, not verified');
    expect(where({ local: ['feature/a'], remoteExists: () => undefined })).toBe('local');
  });

  it('flags a branch gone from Azure DevOps and not local as deleted, without checkout', () => {
    const [branch] = toTaskBranchModels([link('feature/a')], [], context({ remoteExists: () => false }));
    expect(branch).toMatchObject({ state: 'deleted', canCheckout: false });
    expect(describeTaskBranch(branch)).toBe('deleted');
  });

  it('counts a local branch named like the link even when the remote one is gone', () => {
    const [branch] = toTaskBranchModels(
      [link('feature/a')],
      [],
      context({ local: ['feature/a'], remoteExists: () => false })
    );
    expect(branch.state).toBe('exists');
  });

  it('keeps the branches of other repositories, with the name of the repository, and no checkout', () => {
    const [branch] = toTaskBranchModels(
      [link('feature/a', 'OTHER')],
      [],
      context({ repositoryNames: new Map([['other', 'Common']]) })
    );
    expect(branch).toMatchObject({ state: 'other', repository: 'Common', canCheckout: false });
    expect(describeTaskBranch(branch)).toBe('in another repository (Common)');
  });

  it('attaches the PR of the branch, preferring the active one', () => {
    const [branch] = toTaskBranchModels(
      [link('feature/a')],
      [
        pr({ pullRequestId: 9, status: 'completed' }),
        pr({ pullRequestId: 5 }),
        pr({ sourceRefName: 'refs/heads/x', pullRequestId: 1 }),
      ],
      context()
    );
    expect(branch.pullRequest).toMatchObject({ id: 5, status: 'In review' });
    expect(taskBranchTooltip(branch)).toContain('PR 5');
  });

  it('does not attach a PR of another repository with the same branch name', () => {
    const [branch] = toTaskBranchModels([link('feature/a')], [pr({ repository: { id: 'other' } })], context());
    expect(branch.pullRequest).toBeUndefined();
  });

  it('lists each branch once and orders current, existing, deleted, other repository', () => {
    const names = toTaskBranchModels(
      [link('o', 'OTHER'), link('gone'), link('b'), link('b'), link('cur')],
      [],
      context({ currentBranch: 'cur', remoteExists: (name) => name !== 'gone' })
    ).map((branch) => branch.name);
    expect(names).toEqual(['cur', 'b', 'gone', 'o']);
  });
});

describe('splitTaskBranches', () => {
  it('shows the first three', () => {
    expect(splitTaskBranches([1, 2, 3, 4])).toEqual({ shown: [1, 2, 3], hidden: [4] });
  });
});

describe('branchesToVerify', () => {
  it('lists the unknown branches of this repository once', () => {
    expect(
      branchesToVerify([link('a'), link('a'), link('b'), link('c', 'OTHER')], REPO, (name) => name === 'b')
    ).toEqual(['a']);
  });
});
