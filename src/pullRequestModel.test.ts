import { describe, expect, it } from 'vitest';
import type { PullRequestDetails } from './azdoClient';
import { isOtherRepository, pullRequestTooltip, toPullRequestModel } from './pullRequestModel';
import { branchActions, type WorkItemModel } from './viewModel';

function details(repositoryId: string): PullRequestDetails {
  return {
    pullRequestId: 1204,
    title: 'Fix it',
    status: 'active',
    isDraft: false,
    webUrl: 'u',
    reviewers: [],
    sourceRefName: 'refs/heads/x',
    repository: { id: repositoryId, name: 'Common_Translations' },
  } as unknown as PullRequestDetails;
}

describe('isOtherRepository', () => {
  it('compares ids case-insensitively and ignores an unknown local repository', () => {
    expect(isOtherRepository('a', 'b')).toBe(true);
    expect(isOtherRepository('ABC', 'abc')).toBe(false);
    expect(isOtherRepository('a', undefined)).toBe(false);
  });
});

describe('toPullRequestModel', () => {
  it('flags only PRs of other repositories', () => {
    expect(toPullRequestModel(details('repo-1'), [], 'repo-1').otherRepository).toBe(false);
    expect(toPullRequestModel(details('repo-2'), [], 'repo-1')).toMatchObject({
      otherRepository: true,
      repository: 'Common_Translations',
    });
    expect(toPullRequestModel(details('repo-2'), []).otherRepository).toBe(false);
  });
});

describe('pullRequestTooltip', () => {
  it('names the repository for other repositories only', () => {
    const base = { id: 1204, title: 'Fix it', repository: 'Common_Translations' };
    expect(pullRequestTooltip({ ...base, otherRepository: true })).toBe(
      'PR 1204 · Common_Translations: Fix it — in another repository'
    );
    expect(pullRequestTooltip({ ...base, otherRepository: false })).toBe('Fix it');
  });
});

describe('branchActions with PRs of other repositories', () => {
  const item = (otherRepository: boolean) =>
    ({
      branch: 'feature/1',
      branches: [],
      isCurrentBranch: true,
      state: 'In Progress',
      pullRequests: [{ isActive: true, otherRepository }],
    } as unknown as Pick<
      WorkItemModel,
      'branch' | 'branches' | 'isCurrentBranch' | 'deletableBranches' | 'pullRequests' | 'state'
    >);
  it('offers Create PR when the active PR is in another repository', () => {
    expect(branchActions(item(true))).toContain('createPullRequest');
  });
  it('does not offer it when the active PR is in this repository', () => {
    expect(branchActions(item(false))).not.toContain('createPullRequest');
  });
});
