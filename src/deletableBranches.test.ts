import { describe, expect, it } from 'vitest';
import {
  branchesToCheckRemotely,
  deletableBranches,
  deleteBranchOffer,
  deleteBranchQuestion,
  isBranchMerged,
  isProtectedBranch,
  mergedBranches,
} from './deletableBranches';

const REPO = 'repo-1';
const pr = (branch: string, status: string, repositoryId = REPO) => ({
  sourceRefName: `refs/heads/${branch}`,
  status,
  repository: { id: repositoryId },
});

describe('isBranchMerged', () => {
  it('needs a completed PR from the branch', () => {
    expect(isBranchMerged('f/a', [pr('f/a', 'completed')], REPO)).toBe(true);
    expect(isBranchMerged('f/a', [], REPO)).toBe(false);
    expect(isBranchMerged('f/a', [pr('f/b', 'completed')], REPO)).toBe(false);
  });

  it('ignores abandoned PRs', () => {
    expect(isBranchMerged('f/a', [pr('f/a', 'abandoned')], REPO)).toBe(false);
    expect(isBranchMerged('f/a', [pr('f/a', 'abandoned'), pr('f/a', 'completed')], REPO)).toBe(true);
  });

  it('is not merged while another PR from the branch is still active', () => {
    expect(isBranchMerged('f/a', [pr('f/a', 'completed'), pr('f/a', 'active')], REPO)).toBe(false);
  });

  it('only counts the PRs of this repository', () => {
    expect(isBranchMerged('f/a', [pr('f/a', 'completed', 'other')], REPO)).toBe(false);
    expect(isBranchMerged('f/a', [pr('f/a', 'completed'), pr('f/a', 'active', 'other')], REPO)).toBe(true);
    expect(isBranchMerged('f/a', [pr('f/a', 'completed', 'REPO-1')], REPO)).toBe(true);
  });

  it('takes every PR as being in the repository when it is unknown', () => {
    expect(isBranchMerged('f/a', [pr('f/a', 'completed', 'x')])).toBe(true);
  });
});

describe('base branches', () => {
  it('are never merged branches, even as the source of a completed PR', () => {
    expect(isProtectedBranch('develop')).toBe(true);
    expect(isProtectedBranch('release/1.2')).toBe(true);
    expect(isProtectedBranch('feature/x/1-a')).toBe(false);
    expect(isBranchMerged('develop', [pr('develop', 'completed')], REPO)).toBe(false);
  });
});

describe('mergedBranches', () => {
  it('lists each merged branch once', () => {
    const prs = [pr('f/a', 'completed'), pr('f/b', 'active'), pr('f/c', 'completed')];
    expect(mergedBranches(['f/a', 'f/b', 'f/a', 'f/c', 'f/d'], prs, REPO)).toEqual(['f/a', 'f/c']);
  });
});

describe('deletableBranches', () => {
  const prs = [pr('f/a', 'completed'), pr('f/b', 'completed'), pr('f/c', 'completed'), pr('f/d', 'active')];
  const names = ['f/a', 'f/b', 'f/c', 'f/d', 'f/e'];

  it('keeps the merged branches that still exist, locally or in Azure DevOps', () => {
    const remote = new Map([
      ['f/b', true],
      ['f/c', false],
    ]);
    expect(
      deletableBranches({
        names,
        pullRequests: prs,
        repositoryId: REPO,
        local: ['f/a'],
        remoteExists: (name) => remote.get(name),
      })
    ).toEqual(['f/a', 'f/b']);
  });

  it('leaves out a branch whose existence is unknown', () => {
    expect(
      deletableBranches({
        names: ['f/a'],
        pullRequests: prs,
        repositoryId: REPO,
        local: [],
        remoteExists: () => undefined,
      })
    ).toEqual([]);
  });

  it('does not depend on the state of any work item', () => {
    expect(
      deletableBranches({
        names: ['f/a'],
        pullRequests: prs,
        repositoryId: REPO,
        local: ['f/a'],
        remoteExists: () => false,
      })
    ).toEqual(['f/a']);
  });
});

describe('branchesToCheckRemotely', () => {
  it('only asks about merged branches that are not local', () => {
    const prs = [pr('f/a', 'completed'), pr('f/b', 'completed'), pr('f/c', 'active')];
    expect(branchesToCheckRemotely(['f/a', 'f/b', 'f/c', 'f/d'], prs, ['f/a'], REPO)).toEqual(['f/b']);
  });
});

describe('texts', () => {
  it('names the owner of the branch when known', () => {
    expect(deleteBranchQuestion('f/a')).toBe('Delete the branch f/a?');
    expect(deleteBranchQuestion('f/a', { type: 'Task', id: 7, state: 'Done' })).toBe(
      'Delete the branch f/a of Task 7 (Done)?'
    );
    expect(deleteBranchQuestion('f/a', { type: 'Bug', id: 8 })).toBe('Delete the branch f/a of Bug 8?');
  });

  it('asks in the notification of a completed PR', () => {
    expect(deleteBranchOffer(12, 'f/a')).toBe('PR 12 completed. Delete the branch f/a?');
  });
});
