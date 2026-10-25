import { describe, expect, it } from 'vitest';
import type { AuthoredPullRequest } from './myPullRequests';
import type { ThreadResponse } from './reviewThreads';
import {
  childRank,
  completedPullRequestInfos,
  mergedInRange,
  mergedThreadsToAsk,
  planGroups,
  toggleCollapsed,
  visibleRows,
  type CompletedPullRequestInfo,
} from './timelineGroups';
import type { BoardWorkCard } from './trackBoardModel';
import type { PullRequestModel, WorkItemModel } from './viewModel';

const day = (n: number): number => new Date(2026, 9, n, 12).getTime();
const iso = (n: number, hour = 12): string => new Date(2026, 9, n, hour).toISOString();

const author = { id: 'u', displayName: 'Ana' };
const published = (publishedDate: string): ThreadResponse => ({
  id: 1,
  publishedDate,
  threadContext: null,
  properties: { CodeReviewThreadType: { $value: 'IsDraftUpdate' }, CodeReviewIsDraftNowSet: { $value: '0' } },
  comments: [{ id: 1, author, content: 'published', commentType: 'system' }],
});

const authored = (overrides: Partial<AuthoredPullRequest> = {}): AuthoredPullRequest =>
  ({
    pullRequestId: 1,
    title: 'T',
    status: 'completed',
    isDraft: false,
    creationDate: iso(14, 9),
    closedDate: iso(16, 16),
    createdBy: { id: 'u' },
    targetRefName: 'refs/heads/develop',
    sourceRefName: 'refs/heads/x',
    repository: { id: 'r', name: 'User_Interface', project: { id: 'p' } },
    webUrl: '',
    reviewers: [],
    ...overrides,
  } as AuthoredPullRequest);

const info = (id: number, overrides: Partial<CompletedPullRequestInfo> = {}): CompletedPullRequestInfo => ({
  id,
  title: 'T',
  repository: 'User_Interface',
  repositoryId: 'r',
  creationDate: iso(14, 9),
  closedDate: iso(16, 16),
  isDraft: false,
  threadsKnown: false,
  ...overrides,
});

describe('completedPullRequestInfos (TIMELINE-17)', () => {
  it('takes the completed PRs of the list, without a request, with the publication when the threads are known', () => {
    const infos = completedPullRequestInfos([
      { pr: authored({ pullRequestId: 1 }), threads: [published(iso(14, 11))] },
      { pr: authored({ pullRequestId: 2 }) },
      { pr: authored({ pullRequestId: 3, status: 'active', closedDate: undefined }) },
      { pr: authored({ pullRequestId: 4, status: 'abandoned' }) },
    ]);
    expect(infos.map((pr) => pr.id)).toEqual([1, 2]);
    expect(infos[0]).toMatchObject({ publishedAt: iso(14, 11), threadsKnown: true, repository: 'User_Interface' });
    expect(infos[1]).toMatchObject({ publishedAt: undefined, threadsKnown: false });
  });

  it('knows the threads of a PR that was never a draft (no publication)', () => {
    expect(completedPullRequestInfos([{ pr: authored(), threads: [] }])[0]).toMatchObject({ threadsKnown: true });
  });
});

describe('mergedInRange (TIMELINE-17)', () => {
  it('is merged within the axis, from the start of its first day to the end of its last', () => {
    expect(mergedInRange({ closedDate: iso(16) }, day(12), day(24))).toBe(true);
    expect(mergedInRange({ closedDate: iso(5) }, day(12), day(24))).toBe(false);
    expect(mergedInRange({ closedDate: iso(30) }, day(12), day(24))).toBe(false);
  });
});

describe('mergedThreadsToAsk (TIMELINE-14, TIMELINE-17)', () => {
  const completed = [info(1), info(2, { threadsKnown: true }), info(3)];
  it('asks once each PR drawn without threads, never one whose threads are known or that is not listed', () => {
    expect(mergedThreadsToAsk([1, 2, 3, 9, 1], completed, new Map(), 1000, 600).map((pr) => pr.id)).toEqual([1, 3]);
  });

  it('asks a failed one again only after the retry time', () => {
    const failed = new Map([[1, 500]]);
    expect(mergedThreadsToAsk([1], completed, failed, 1000, 600)).toEqual([]);
    expect(mergedThreadsToAsk([1], completed, failed, 1200, 600).map((pr) => pr.id)).toEqual([1]);
  });
});

describe('planGroups (TIMELINE-16)', () => {
  const pr = (id: number, tone: PullRequestModel['tone']): PullRequestModel =>
    ({ id, title: 'T', status: '', tone, url: '', isActive: tone !== 'completed', runs: [] } as never);
  const item = (id: number, overrides: Partial<WorkItemModel> = {}): WorkItemModel =>
    ({ id, title: 'I', type: 'Product Backlog Item', state: 'Committed', pullRequests: [], ...overrides } as never);
  const card = (id: number, part?: BoardWorkCard['part'], key = String(id)): BoardWorkCard =>
    ({ id, key, part } as never);
  const plan = (workItems: WorkItemModel[], cards: BoardWorkCard[], completed: CompletedPullRequestInfo[]) =>
    planGroups({ cards, workItems, completed, from: day(12), to: day(24) });

  it('is a group with 2+ PRs drawn, counting the merged ones within the axis only', () => {
    const items = [item(1, { pullRequests: [pr(10, 'review'), pr(11, 'completed'), pr(12, 'completed')] })];
    const before = { closedDate: iso(2) };
    expect(plan(items, [card(1)], [info(11, before), info(12, before)]).size).toBe(0);
    expect(
      plan(items, [card(1)], [info(11, before), info(12)])
        .get(1)
        ?.merged.map((merged) => merged.id)
    ).toEqual([12]);
    const both = plan(items, [card(1)], [info(11), info(12)]);
    expect([...both.keys()]).toEqual([1]);
    expect(both.get(1)).toMatchObject({ openCount: 1, mergedTotal: 2 });
    expect(both.get(1)?.merged.map((merged) => merged.id)).toEqual([11, 12]);
  });

  it('is a group with one merged PR while the work item is not finished, and keeps its own card as a row', () => {
    const items = [item(1, { pullRequests: [pr(11, 'completed')] })];
    const plans = plan(items, [card(1)], [info(11)]);
    expect(plans.get(1)?.cards.map((c) => c.key)).toEqual(['1']);
  });

  it('keeps one row for a finished work item with one merged PR, and has no row of its own in a group', () => {
    const done = { state: 'Done' };
    expect(plan([item(1, { ...done, pullRequests: [pr(11, 'completed')] })], [card(1)], [info(11)]).size).toBe(0);
    const group = plan(
      [item(1, { ...done, pullRequests: [pr(11, 'completed'), pr(12, 'completed')] })],
      [card(1)],
      [info(11), info(12)]
    );
    expect(group.get(1)?.cards).toEqual([]);
  });

  it('is a group when the board split the work item, and ignores merged PRs without dates', () => {
    const items = [item(1, { pullRequests: [pr(10, 'review'), pr(11, 'review'), pr(12, 'completed')] })];
    const plans = plan(items, [card(1, 'pr', '1:pr:10'), card(1, 'pr', '1:pr:11'), card(1, 'tasks', '1:tasks')], []);
    expect(plans.get(1)?.cards).toHaveLength(3);
    expect(plans.get(1)?.merged).toEqual([]);
    expect(plans.get(1)?.mergedTotal).toBe(1);
  });
});

describe('childRank (TIMELINE-16)', () => {
  it('puts the PRs first, then the work item itself, the tasks and the tasks to do', () => {
    expect(childRank({ part: 'pr' }, true)).toBe(0);
    expect(childRank({ part: undefined }, true)).toBe(0);
    expect(childRank({ part: undefined }, false)).toBe(1);
    expect(childRank({ part: 'task' }, false)).toBe(2);
    expect(childRank({ part: 'tasks' }, false)).toBe(3);
  });
});

describe('collapse (TIMELINE-18)', () => {
  it('toggles a work item in the list of collapsed groups', () => {
    expect(toggleCollapsed([], 5)).toEqual([5]);
    expect(toggleCollapsed([5, 6], 5)).toEqual([6]);
  });

  it('hides the rows under a collapsed group and keeps the group row and every other row', () => {
    const rows = [
      { key: 'a' },
      { key: 'g', group: {}, groupId: undefined },
      { key: 'c', groupId: 5 },
      { key: 'd', groupId: 6 },
    ];
    expect(visibleRows(rows, [5]).map((row) => row.key)).toEqual(['a', 'g', 'd']);
    expect(visibleRows(rows, []).map((row) => row.key)).toEqual(['a', 'g', 'c', 'd']);
  });
});
