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

  it('keeps the project and repository ids of the PRs, which may belong to another project', () => {
    const links = parseRelations([
      {
        rel: 'ArtifactLink',
        url: 'vstfs:///Git/PullRequestId/814d2323-fa38-46db-9485-ab17cc0911d5%2F2cdbf598-7c0d-425d-845b-d1e8bbf5bb9e%2F13713',
      },
      { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/other-project%2Fother-repo%2F42' },
      { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/broken' },
    ]);
    expect(links.pullRequests).toEqual([
      {
        projectId: '814d2323-fa38-46db-9485-ab17cc0911d5',
        repositoryId: '2cdbf598-7c0d-425d-845b-d1e8bbf5bb9e',
        id: 13713,
      },
      { projectId: 'other-project', repositoryId: 'other-repo', id: 42 },
    ]);
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
    hiddenPredecessorStates: [],
  };
  const draftPr = {
    id: 1,
    title: 'PR',
    status: 'Draft',
    tone: 'draft' as const,
    url: '',
    isActive: true,
    runs: [],
    repository: 'Repo',
    otherRepository: false,
  };

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

  it('can skip the filters of the work items being worked on, which still respect the type and the search', () => {
    const working = { ...item, state: 'Done', workingOn: 'here' as const };
    const hidden = { ...filter, hiddenPullRequestStates: [NO_PULL_REQUEST], hiddenPriorities: [NO_PRIORITY] };
    expect(isVisible(working, hidden)).toBe(false);
    expect(isVisible(working, hidden, '', false, true)).toBe(true);
    expect(isVisible({ ...working, workingOn: 'worktree' }, hidden, '', false, true)).toBe(true);
    // Without ignoreFilters, or when not being worked on, they apply
    expect(isVisible({ ...item, state: 'Done' }, filter, '', false, true)).toBe(false);
    expect(isVisible(working, filter, '', false, false)).toBe(false);
    // Type and search still apply
    expect(isVisible({ ...working, type: 'Task' }, filter, '', false, true)).toBe(false);
    expect(isVisible(working, filter, 'nothing like this', false, true)).toBe(false);
    expect(isVisible(working, filter, 'access', false, true)).toBe(true);
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

  it('applies the predecessors filter', () => {
    const open = { ...item, openPredecessors: [{ id: 1 }] };
    const none = { ...item, openPredecessors: [] };
    const hideOpen = { ...filter, hiddenPredecessorStates: ['Incomplete predecessors'] };
    const hideNone = { ...filter, hiddenPredecessorStates: ['Complete predecessors'] };
    expect(isVisible(open, hideOpen)).toBe(false);
    expect(isVisible(none, hideOpen)).toBe(true);
    expect(isVisible(none, hideNone)).toBe(false);
    expect(isVisible(open, hideNone)).toBe(true);
  });

  it('never hides work items whose predecessors are unknown with the predecessors filter', () => {
    const both = { ...filter, hiddenPredecessorStates: ['Incomplete predecessors', 'Complete predecessors'] };
    expect(isVisible(item, both)).toBe(true);
  });

  it('can always show work items with alerts whatever their predecessors', () => {
    const alerts = [{ rule: 'tasksNotDone', message: 'x' }];
    const open = { ...item, openPredecessors: [{ id: 1 }], alerts };
    const hideOpen = { ...filter, hiddenPredecessorStates: ['Incomplete predecessors'] };
    expect(isVisible(open, hideOpen)).toBe(false);
    expect(isVisible(open, hideOpen, '', true)).toBe(true);
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
    hiddenPredecessorStates: [],
  };

  it('ignores the order of the values', () => {
    expect(changedFilterKeys(filter, { ...filter, types: ['Product Backlog Item', 'Bug'] })).toEqual([]);
  });

  it('detects the predecessors filter', () => {
    expect(changedFilterKeys(filter, { ...filter, hiddenPredecessorStates: ['Complete predecessors'] })).toEqual([
      'hiddenPredecessorStates',
    ]);
  });

  it('lists the keys that changed', () => {
    expect(changedFilterKeys(filter, { ...filter, hiddenStates: ['Done', 'New'] })).toEqual(['hiddenStates']);
    expect(
      changedFilterKeys(filter, {
        types: [],
        hiddenStates: [],
        hiddenPullRequestStates: ['Draft'],
        hiddenPriorities: [],
        hiddenPredecessorStates: [],
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
    repository: 'Repo',
    otherRepository: false,
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
