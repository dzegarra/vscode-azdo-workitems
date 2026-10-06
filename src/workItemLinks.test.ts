import { describe, expect, it } from 'vitest';
import { changedFilterKeys, isVisible, NO_PULL_REQUEST } from './viewModel';
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
    [active, 'Waiting for review'],
    [{ ...active, reviewers: [reviewer(10), reviewer(-10)] }, 'Rejected'],
    [{ ...active, reviewers: [reviewer(10), reviewer(-5)] }, 'Waiting for author'],
    [{ ...active, reviewers: [reviewer(10), reviewer(0)] }, 'Approved'],
    [{ ...active, reviewers: [reviewer(5)] }, 'Approved with suggestions'],
    [{ ...active, reviewers: [reviewer(10), reviewer(0, true)] }, 'Waiting for review'],
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
  const filter = { types: ['Product Backlog Item', 'Bug'], hiddenStates: ['Done'], hiddenPullRequestStates: [] };
  const draftPr = { id: 1, title: 'PR', status: 'Draft', tone: 'draft' as const, url: '', isActive: true };

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

  it('always shows work items with alerts, whatever their state or PR', () => {
    const alerts = [{ rule: 'tasksNotDone', message: 'Is Done but 1 task is not done' }];
    expect(isVisible({ ...item, state: 'Done', alerts }, filter)).toBe(true);
    expect(isVisible({ ...item, alerts }, { ...filter, hiddenPullRequestStates: [NO_PULL_REQUEST] })).toBe(true);
    expect(isVisible({ ...item, type: 'Task', alerts }, filter)).toBe(false);
  });

  it('searches by ID, title and branch', () => {
    expect(isVisible(item, filter, '6628')).toBe(true);
    expect(isVisible(item, filter, 'ACCESS')).toBe(true);
    expect(isVisible({ ...item, branch: 'bugfix/fui-admin/66280-x' }, filter, 'fui-admin')).toBe(true);
    expect(isVisible(item, filter, 'dashboard')).toBe(false);
  });
});

describe('changedFilterKeys', () => {
  const filter = { types: ['Bug', 'Product Backlog Item'], hiddenStates: ['Done'], hiddenPullRequestStates: [] };

  it('ignores the order of the values', () => {
    expect(changedFilterKeys(filter, { ...filter, types: ['Product Backlog Item', 'Bug'] })).toEqual([]);
  });

  it('lists the keys that changed', () => {
    expect(changedFilterKeys(filter, { ...filter, hiddenStates: ['Done', 'New'] })).toEqual(['hiddenStates']);
    expect(changedFilterKeys(filter, { types: [], hiddenStates: [], hiddenPullRequestStates: ['Draft'] })).toEqual([
      'types',
      'hiddenStates',
      'hiddenPullRequestStates',
    ]);
  });
});
