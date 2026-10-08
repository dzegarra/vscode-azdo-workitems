import type { PullRequestDetails } from './azdoClient';
import { describe, expect, it } from 'vitest';
import {
  branchTooltip,
  collectBranches,
  CollectBranchesInput,
  isCheckoutBranch,
  toBranchModels,
  unknownRepositoryIds,
} from './workItemBranches';

const LOCAL_REPO = '2cdbf598-7c0d-425d-845b-d1e8bbf5bb9e';
const OTHER_REPO = '11111111-0000-0000-0000-000000000000';
const MAIN = 'feature/fui-common/66068-platform-ui-user-is-notified-when-the-app';
const EXTRA = 'feature/fui-common/66068-related-changes';

function input(overrides: Partial<CollectBranchesInput> = {}): CollectBranchesInput {
  return {
    workItem: { id: 66068, links: { branches: [] } },
    local: [],
    remote: [],
    pullRequests: [],
    repositoryId: LOCAL_REPO,
    ...overrides,
  };
}

const pr = (
  source: string,
  repository = { id: LOCAL_REPO, name: 'User_Interface' },
  status: PullRequestDetails['status'] = 'active'
) => ({
  sourceRefName: `refs/heads/${source}`,
  status,
  repository,
});

describe('collectBranches', () => {
  it('finds the local and remote branches named after the work item, once', () => {
    const branches = collectBranches(
      input({
        local: [MAIN, EXTRA, 'feature/x/1-other', 'develop'],
        remote: [MAIN, EXTRA, 'feature/fui-common/66068-only-remote', 'feature/x/2-other'],
      })
    );
    expect(branches).toEqual([
      { name: MAIN, location: 'local', otherRepository: false },
      { name: EXTRA, location: 'local', otherRepository: false },
      { name: 'feature/fui-common/66068-only-remote', location: 'remote', otherRepository: false },
    ]);
  });

  it('takes the Development links: this repository or another one, with its name when known', () => {
    const branches = collectBranches(
      input({
        workItem: {
          id: 66068,
          links: {
            branches: [
              { repositoryId: LOCAL_REPO.toUpperCase(), name: MAIN },
              { repositoryId: LOCAL_REPO, name: 'release/not-fetched' },
              { repositoryId: OTHER_REPO, name: 'feature/common/shared' },
            ],
          },
        },
        local: [MAIN],
        repositoryNames: new Map([[OTHER_REPO, 'Common_Translations']]),
      })
    );
    expect(branches).toEqual([
      { name: MAIN, location: 'local', otherRepository: false },
      { name: 'release/not-fetched', location: 'linked', otherRepository: false },
      { name: 'feature/common/shared', location: 'linked', otherRepository: true, repository: 'Common_Translations' },
    ]);
  });

  it('leaves the name of an unknown other repository out', () => {
    const [branch] = collectBranches(
      input({ workItem: { id: 1, links: { branches: [{ repositoryId: OTHER_REPO, name: 'b' }] } } })
    );
    expect(branch).toEqual({ name: 'b', location: 'linked', otherRepository: true, repository: undefined });
  });

  it('adds the source branches of the active PRs and ignores the completed ones', () => {
    const branches = collectBranches(
      input({
        local: [MAIN],
        pullRequests: [
          pr(MAIN),
          pr('feature/fui-common/66068-from-pr'),
          pr('feature/common/pr-in-other', { id: OTHER_REPO, name: 'Common' }),
          pr('feature/old-merged', undefined, 'completed'),
          pr('feature/old-abandoned', undefined, 'abandoned'),
        ],
      })
    );
    expect(
      branches.map(({ name, location, otherRepository, repository }) => [name, location, otherRepository, repository])
    ).toEqual([
      [MAIN, 'local', false, undefined],
      ['feature/fui-common/66068-from-pr', 'linked', false, undefined],
      ['feature/common/pr-in-other', 'linked', true, 'Common'],
    ]);
  });

  it('keeps the same name in two repositories apart, and joins it in one', () => {
    const branches = collectBranches(
      input({
        workItem: { id: 1, links: { branches: [{ repositoryId: OTHER_REPO, name: 'main-work' }] } },
        pullRequests: [pr('main-work'), pr('main-work', { id: OTHER_REPO, name: 'Common' })],
      })
    );
    expect(branches.map(({ name, otherRepository }) => [name, otherRepository])).toEqual([
      ['main-work', true],
      ['main-work', false],
    ]);
  });

  it('takes every branch as being in this repository when it is unknown', () => {
    const branches = collectBranches(
      input({
        repositoryId: undefined,
        workItem: { id: 1, links: { branches: [{ repositoryId: OTHER_REPO, name: 'b' }] } },
      })
    );
    expect(branches).toEqual([{ name: 'b', location: 'linked', otherRepository: false, repository: undefined }]);
  });

  it('reproduces work item 66068: the linked branch, the related-changes branch and the PR sources', () => {
    const branches = collectBranches(
      input({
        workItem: { id: 66068, links: { branches: [{ repositoryId: LOCAL_REPO, name: MAIN }] } },
        local: [MAIN, EXTRA, 'develop'],
        remote: [MAIN, EXTRA, 'develop'],
        pullRequests: [pr(MAIN), pr(EXTRA)],
      })
    );
    expect(branches.map(({ name, location }) => [name, location])).toEqual([
      [MAIN, 'local'],
      [EXTRA, 'local'],
    ]);
  });
});

describe('unknownRepositoryIds', () => {
  it('lists once the other repositories whose name is not known', () => {
    const workItems = [
      {
        id: 1,
        links: {
          branches: [
            { repositoryId: OTHER_REPO, name: 'a' },
            { repositoryId: OTHER_REPO.toUpperCase(), name: 'b' },
            { repositoryId: LOCAL_REPO, name: 'c' },
            { repositoryId: '22222222-0000-0000-0000-000000000000', name: 'd' },
          ],
        },
      },
    ];
    expect(unknownRepositoryIds(workItems, LOCAL_REPO, new Map())).toEqual([
      OTHER_REPO,
      '22222222-0000-0000-0000-000000000000',
    ]);
    expect(unknownRepositoryIds(workItems, LOCAL_REPO, new Map([[OTHER_REPO, 'Known']]))).toEqual([
      '22222222-0000-0000-0000-000000000000',
    ]);
  });
});

describe('toBranchModels', () => {
  const entry = (name: string, overrides: Partial<Parameters<typeof toBranchModels>[0][number]> = {}) => ({
    name,
    location: 'local' as const,
    otherRepository: false,
    ...overrides,
  });

  it('puts the current branch first, then the main one, this repository and the other repositories', () => {
    const models = toBranchModels(
      [
        entry('other-repo', { location: 'linked', otherRepository: true, repository: 'Common' }),
        entry('rest-1'),
        entry('main'),
        entry('rest-2', { location: 'remote' }),
        entry('current'),
      ],
      { currentBranch: 'current', mainBranch: 'main', worktreeFor: () => undefined }
    );
    expect(models.map((model) => model.name)).toEqual(['current', 'main', 'rest-1', 'rest-2', 'other-repo']);
    expect(models[0]).toMatchObject({ location: 'current', isCurrent: true });
    expect(models[3].location).toBe('remote');
  });

  it('gives the worktree of the branches of this repository only, not the current one', () => {
    const models = toBranchModels(
      [entry('current'), entry('b'), entry('c', { location: 'linked', otherRepository: true })],
      { currentBranch: 'current', worktreeFor: () => '/work/tree' }
    );
    expect(models.map((model) => model.worktree)).toEqual([undefined, '/work/tree', undefined]);
  });

  it('does not take a branch of another repository with the name of the current one as checked out', () => {
    const [model] = toBranchModels([entry('current', { location: 'linked', otherRepository: true })], {
      currentBranch: 'current',
      worktreeFor: () => undefined,
    });
    expect(model).toMatchObject({ isCurrent: false, location: 'linked' });
  });
});

describe('isCheckoutBranch', () => {
  it('accepts the branches of this repository only', () => {
    const branches = [
      { name: 'a', otherRepository: false },
      { name: 'b', otherRepository: true },
    ];
    expect(isCheckoutBranch(branches, 'a')).toBe(true);
    expect(isCheckoutBranch(branches, 'b')).toBe(false);
    expect(isCheckoutBranch(branches, 'c')).toBe(false);
  });
});

describe('branchTooltip', () => {
  it('says the location, or the repository for the ones of other repositories', () => {
    expect(branchTooltip({ name: 'a', location: 'remote', otherRepository: false })).toBe('a (remote)');
    expect(branchTooltip({ name: 'a', location: 'linked', otherRepository: true, repository: 'Common' })).toBe(
      'a · Common — in another repository'
    );
    expect(branchTooltip({ name: 'a', location: 'linked', otherRepository: true })).toBe('a — in another repository');
  });
});
