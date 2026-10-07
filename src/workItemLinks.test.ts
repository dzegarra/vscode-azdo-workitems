import { describe, expect, it } from 'vitest';
import {
  branchActions,
  changedFilterKeys,
  describeScope,
  isVisible,
  migratePullRequestStates,
  NO_PULL_REQUEST,
} from './viewModel';
import { NO_PRIORITY } from './priority';
import { parseRelations, pullRequestStatus, PullRequestState } from './workItemLinks';

const api = 'https://dev.azure.com/org/_apis/wit/workItems';

describe('parseRelations', () => {
  it('reads parent, children, branches and pull requests', () => {
    expect(
      parseRelations([
        { rel: 'System.LinkTypes.Hierarchy-Reverse', url: `${api}/100` },
        { rel: 'System.LinkTypes.Hierarchy-Forward', url: `${api}/201` },
        { rel: 'System.LinkTypes.Hierarchy-Forward', url: `${api}/202` },
        { rel: 'System.LinkTypes.Related', url: `${api}/300` },
        { rel: 'System.LinkTypes.Dependency-Reverse', url: `${api}/400` },
        { rel: 'System.LinkTypes.Dependency-Forward', url: `${api}/500` },
        { rel: 'System.LinkTypes.Dependency-Forward', url: `${api}/501` },
        {
          rel: 'ArtifactLink',
          url: 'vstfs:///Git/Ref/proj-id%2Frepo-id%2FGBfeature%2Ffui-admin%2F5641-network-restart',
          attributes: { name: 'Branch' },
        },
        {
          rel: 'ArtifactLink',
          url: 'vstfs:///Git/PullRequestId/proj-id%2Frepo-id%2F13720',
          attributes: { name: 'Pull Request' },
        },
        { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/proj-id%2Frepo-id%2Fabc123' },
      ])
    ).toEqual({
      parentId: 100,
      childIds: [201, 202],
      predecessorIds: [400],
      successorIds: [500, 501],
      branches: [{ projectId: 'proj-id', repositoryId: 'repo-id', name: 'feature/fui-admin/5641-network-restart' }],
      pullRequests: [{ projectId: 'proj-id', repositoryId: 'repo-id', id: 13720 }],
    });
  });

  it('handles work items without relations', () => {
    expect(parseRelations(undefined)).toEqual({
      childIds: [],
      predecessorIds: [],
      successorIds: [],
      branches: [],
      pullRequests: [],
    });
  });
});

describe('pullRequestStatus', () => {
  const active: PullRequestState = { status: 'active', isDraft: false, reviewers: [] };
  const reviewer = (vote: number, isRequired = false) => ({ displayName: 'Dev', vote, isRequired });

  it.each([
    [{ ...active, status: 'completed' as const }, 'Completed'],
    [{ ...active, status: 'abandoned' as const }, 'Abandoned'],
    [{ ...active, isDraft: true }, 'Draft'],
    [{ ...active, mergeStatus: 'conflicts' }, 'Conflicts'],
    [active, 'In review'],
    [{ ...active, reviewers: [reviewer(10), reviewer(-10)] }, 'Rejected'],
    [{ ...active, reviewers: [reviewer(10), reviewer(-5)] }, 'Waiting for author'],
    [{ ...active, reviewers: [reviewer(10), reviewer(0)] }, 'Approved'],
    [{ ...active, reviewers: [reviewer(5)] }, 'Approved with suggestions'],
    [{ ...active, reviewers: [reviewer(10), reviewer(0, true)] }, 'In review'],
  ])('%o is %s', (pr, label) => {
    expect(pullRequestStatus(pr).label).toBe(label);
  });
});

describe('isVisible', () => {
  const item = {
    id: 66280,
    title: 'Access point label',
    type: 'Bug',
    state: 'Committed',
    branch: undefined,
    pullRequests: [],
  };
  const filter = {
    types: ['Product Backlog Item', 'Bug'],
    hiddenStates: ['Done'],
    hiddenPullRequestStates: [],
    hiddenPriorities: [],
  };
  const draftPr = { id: 1, title: 'PR', status: 'Draft', tone: 'draft' as const, url: '', isActive: true, runs: [] };

  it('applies the type and state filters', () => {
    expect(isVisible(item, filter)).toBe(true);
    expect(isVisible({ ...item, type: 'Task' }, filter)).toBe(false);
    expect(isVisible({ ...item, state: 'Done' }, filter)).toBe(false);
    expect(isVisible({ ...item, type: 'Task' }, { ...filter, types: [] })).toBe(true);
  });

  it('applies the PR filter to the main PR of the work item', () => {
    const withDraft = { ...item, pullRequests: [draftPr] };
    expect(isVisible(withDraft, { ...filter, hiddenPullRequestStates: ['Draft'] })).toBe(false);
    expect(isVisible(withDraft, { ...filter, hiddenPullRequestStates: [NO_PULL_REQUEST] })).toBe(true);
    expect(isVisible(item, { ...filter, hiddenPullRequestStates: [NO_PULL_REQUEST] })).toBe(false);
  });

  it('applies the filters to work items with alerts too, by default', () => {
    const alerts = [{ rule: 'tasksNotDone', message: 'Is Done but 1 task is not done' }];
    expect(isVisible({ ...item, state: 'Done', alerts }, filter)).toBe(false);
    expect(isVisible({ ...item, alerts }, { ...filter, hiddenPullRequestStates: [NO_PULL_REQUEST] })).toBe(false);
  });

  it('can always show work items with alerts, whatever their state, PR or priority', () => {
    const alerts = [{ rule: 'tasksNotDone', message: 'Is Done but 1 task is not done' }];
    expect(isVisible({ ...item, state: 'Done', alerts }, filter, '', true)).toBe(true);
    expect(isVisible({ ...item, alerts }, { ...filter, hiddenPullRequestStates: [NO_PULL_REQUEST] }, '', true)).toBe(
      true
    );
    expect(isVisible({ ...item, alerts }, { ...filter, hiddenPriorities: [NO_PRIORITY] }, '', true)).toBe(true);
    // Type and search still apply
    expect(isVisible({ ...item, type: 'Task', alerts }, filter, '', true)).toBe(false);
    expect(isVisible({ ...item, state: 'Done', alerts }, filter, 'dashboard', true)).toBe(false);
    expect(isVisible({ ...item, state: 'Done' }, filter, '', true)).toBe(false);
  });

  it('applies the priority filter', () => {
    const hiddenPriorities = ['P4', 'No priority'];
    expect(isVisible({ ...item, priority: 1 }, { ...filter, hiddenPriorities })).toBe(true);
    expect(isVisible({ ...item, priority: 4 }, { ...filter, hiddenPriorities })).toBe(false);
    expect(isVisible(item, { ...filter, hiddenPriorities })).toBe(false);
  });

  it('searches by ID, title and branch', () => {
    expect(isVisible(item, filter, '6628')).toBe(true);
    expect(isVisible(item, filter, 'ACCESS')).toBe(true);
    expect(isVisible({ ...item, branch: 'bugfix/fui-admin/66280-x' }, filter, 'fui-admin')).toBe(true);
    expect(isVisible(item, filter, 'dashboard')).toBe(false);
  });
});

describe('changedFilterKeys', () => {
  const filter = {
    types: ['Bug', 'Product Backlog Item'],
    hiddenStates: ['Done'],
    hiddenPullRequestStates: [],
    hiddenPriorities: [],
  };

  it('ignores the order of the values', () => {
    expect(changedFilterKeys(filter, { ...filter, types: ['Product Backlog Item', 'Bug'] })).toEqual([]);
  });

  it('lists the keys that changed', () => {
    expect(changedFilterKeys(filter, { ...filter, hiddenStates: ['Done', 'New'] })).toEqual(['hiddenStates']);
    expect(
      changedFilterKeys(filter, {
        types: [],
        hiddenStates: [],
        hiddenPullRequestStates: ['Draft'],
        hiddenPriorities: [],
      })
    ).toEqual(['types', 'hiddenStates', 'hiddenPullRequestStates']);
  });
});

describe('describeScope', () => {
  it('makes clear only the work items assigned to the user are listed', () => {
    expect(describeScope([]).text).toBe('Assigned to you');
    expect(describeScope([{ name: 'Sprint 42', teams: ['FUI Team', 'Platform'] }]).text).toBe(
      'Assigned to you in Sprint 42 (FUI Team, Platform)'
    );
    const scope = describeScope([
      { name: 'Sprint 42', teams: ['FUI Team'] },
      { name: 'PMUI Sprint 7', teams: ['PMUI Team'] },
    ]);
    expect(scope.text).toBe('Assigned to you in the current sprints of 2 teams');
    expect(scope.tooltip).toContain('PMUI Sprint 7 (PMUI Team)');
  });
});

describe('branch actions', () => {
  const pr = (isActive: boolean) => ({
    id: 1,
    title: '',
    status: '',
    tone: 'review' as const,
    url: '',
    isActive,
    runs: [],
  });
  const item = { state: 'Committed', branch: 'feature/x/1-a', isCurrentBranch: false, pullRequests: [] };
  const leftoverBranch = { name: 'feature/x/1-a', local: true, remote: true };

  it('offers to create the branch, check it out and create the PR of work items in progress', () => {
    expect(branchActions({ ...item, branch: undefined })).toEqual(['createBranch']);
    expect(branchActions(item)).toEqual(['checkout', 'createPullRequest']);
    expect(branchActions({ ...item, isCurrentBranch: true, pullRequests: [pr(true)] })).toEqual([]);
  });

  it('only offers to delete the branch of finished work items, when it still exists', () => {
    for (const state of ['Done', 'Ready to Test', 'Ready-to-Test']) {
      expect(branchActions({ ...item, state })).toEqual([]);
      expect(branchActions({ ...item, state, branch: undefined })).toEqual([]);
      expect(branchActions({ ...item, state, leftoverBranch, pullRequests: [pr(false)] })).toEqual(['deleteBranch']);
    }
    // A PR still active on the branch would be broken
    expect(branchActions({ ...item, state: 'Done', leftoverBranch, pullRequests: [pr(true)] })).toEqual([]);
  });
});

describe('migratePullRequestStates', () => {
  it('maps the old "Waiting for review" label to "In review" without duplicates', () => {
    expect(migratePullRequestStates(['Draft', 'Waiting for review'])).toEqual(['Draft', 'In review']);
    expect(migratePullRequestStates(['Waiting for review', 'In review'])).toEqual(['In review']);
    expect(migratePullRequestStates([])).toEqual([]);
  });
});
