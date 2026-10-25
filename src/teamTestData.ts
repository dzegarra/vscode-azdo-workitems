/** Fixtures of the whole-team tests (raw Azure DevOps shapes): not part of the extension */
import type { PullRequestDetails, WorkItem } from './azdoClient';
import type { TeamShapeOptions, TeamSnapshot } from './teamData';

export function rawItem(id: number, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: `Item ${String(id)}`,
    type: 'Product Backlog Item',
    state: 'Committed',
    iterationPath: 'P\\R\\Platform Sprint 1',
    assignedTo: 'Ana Ruiz EXT',
    assigneeId: 'ana',
    url: `https://wi/${String(id)}`,
    links: {
      childIds: [],
      predecessorIds: [],
      successorIds: [],
      duplicateOfIds: [],
      duplicateIds: [],
      branches: [],
      pullRequests: [],
    },
    fields: {},
    ...overrides,
  };
}

export function rawPr(id: number, overrides: Partial<PullRequestDetails> = {}): PullRequestDetails {
  return {
    pullRequestId: id,
    url: `https://api/pr/${String(id)}`,
    webUrl: `https://dev.azure.com/o/p/_git/r/pullrequest/${String(id)}`,
    title: `[1] PR ${String(id)}`,
    sourceRefName: 'refs/heads/x',
    status: 'active',
    isDraft: false,
    reviewers: [],
    createdBy: { id: 'ana', displayName: 'Ana Ruiz EXT' },
    repository: { id: 'repo', name: 'User_Interface' },
    creationDate: '2026-10-20T08:00:00Z',
    ...overrides,
  };
}

export function snapshot(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    teams: [{ name: 'Platform Team', badge: 'PLT', iterationPath: 'P\\R\\Platform Sprint 1' }],
    iterations: [{ name: 'Platform Sprint 1', path: 'P\\R\\Platform Sprint 1', teams: ['Platform Team'] }],
    items: [],
    children: [],
    pullRequests: [],
    runs: new Map(),
    publishedAt: new Map(),
    myId: 'me',
    fetchedAt: 0,
    ...overrides,
  };
}

export const options: TeamShapeOptions = {
  ownIds: new Set(),
  baseBranch: 'develop',
  staleAfterWorkingDays: 2,
  workingDays: [1, 2, 3, 4, 5],
  now: new Date('2026-10-22T12:00:00Z'),
};

export const link = (id: number) => ({ id, projectId: 'p', repositoryId: 'repo' });
