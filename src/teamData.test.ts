import { describe, expect, it } from 'vitest';
import {
  attemptKey,
  groupByPerson,
  mergedPullRequests,
  pullRequestsToFetch,
  runsAreFinal,
  runsCacheKey,
  shapeTeamItems,
  waitedOnBy,
} from './teamData';
import { link, options, rawItem, rawPr, snapshot } from './teamTestData';

describe('shapeTeamItems', () => {
  it('shapes one model per work item with its team badge, PRs and tasks', () => {
    const item = rawItem(1, {
      links: { ...rawItem(1).links, childIds: [10], pullRequests: [link(100)] },
      fields: { 'Microsoft.VSTS.Common.Priority': 2 },
    });
    const task = rawItem(10, {
      type: 'Task',
      state: 'To Do',
      links: { ...rawItem(1).links, pullRequests: [link(101)] },
    });
    const [shaped] = shapeTeamItems(
      snapshot({ items: [item], children: [task], pullRequests: [rawPr(100), rawPr(101, { isDraft: true })] }),
      options
    );
    expect(shaped.team).toBe('PLT');
    expect(shaped.model.priority).toBe(2);
    expect(shaped.model.pullRequests.map((pr) => pr.id)).toEqual([100]);
    expect(shaped.model.otherTasks?.map((t) => t.id)).toEqual([10]);
    expect(shaped.model.otherTasks?.[0].taskPullRequests.map((pr) => pr.id)).toEqual([101]);
    expect(shaped.pullRequests.map((pr) => pr.id).sort()).toEqual([100, 101]);
  });

  it('leaves out the work items the board of the user already has (no duplicates)', () => {
    const shaped = shapeTeamItems(snapshot({ items: [rawItem(1), rawItem(2)] }), { ...options, ownIds: new Set([1]) });
    expect(shaped.map((item) => item.model.id)).toEqual([2]);
  });

  it('flags a work item in progress that was not updated (zZ)', () => {
    const item = rawItem(1, { fields: { 'System.ChangedDate': '2026-10-12T08:00:00Z' } });
    expect(shapeTeamItems(snapshot({ items: [item] }), options)[0].model.notUpdated?.days).toBeGreaterThan(2);
  });

  it('uses the date a PR left draft when it is known, else its creation', () => {
    const item = rawItem(1, { links: { ...rawItem(1).links, pullRequests: [link(100)] } });
    const pullRequests = [rawPr(100)];
    const created = shapeTeamItems(snapshot({ items: [item], pullRequests }), options)[0].pullRequests[0];
    const published = shapeTeamItems(
      snapshot({ items: [item], pullRequests, publishedAt: new Map([[100, '2026-10-21T08:00:00Z']]) }),
      options
    )[0].pullRequests[0];
    expect(created.publishedAt).toBe('2026-10-20T08:00:00Z');
    expect(published.publishedAt).toBe('2026-10-21T08:00:00Z');
  });
});

describe('groupByPerson', () => {
  it('puts the user first, the others by name and the unassigned last', () => {
    const items = [
      rawItem(1, { assignedTo: 'Zed Zebra', assigneeId: 'zed' }),
      rawItem(2, { assignedTo: 'Ana Ruiz EXT', assigneeId: 'ana' }),
      rawItem(3, { assignedTo: undefined, assigneeId: undefined }),
      rawItem(4, { assignedTo: 'Me Myself', assigneeId: 'me' }),
    ];
    const snap = snapshot({ items });
    const people = groupByPerson(shapeTeamItems(snap, options), snap);
    expect(people.map((person) => person.name)).toEqual(['Me Myself', 'Ana Ruiz', 'Zed Zebra', 'Unassigned']);
    expect(people[0].you).toBe(true);
    expect(people[3].unassigned).toBe(true);
  });
});

describe('merged PRs and dependencies', () => {
  it('lists the completed PRs with their closing date', () => {
    const snap = snapshot({
      pullRequests: [rawPr(1, { status: 'completed', closedDate: '2026-10-21T10:00:00Z' }), rawPr(2)],
    });
    expect(mergedPullRequests(snap)).toEqual([{ id: 1, title: '[1] PR 1', closedDate: '2026-10-21T10:00:00Z' }]);
  });

  it('maps a predecessor to the work items of the user that wait for it', () => {
    const map = waitedOnBy([
      { id: 5, predecessorIds: [1, 2] },
      { id: 6, predecessorIds: [1] },
    ]);
    expect(map.get(1)).toEqual([5, 6]);
    expect(map.get(2)).toEqual([5]);
  });
});

describe('request budget', () => {
  it('keys the runs of an active PR by its last commit', () => {
    expect(runsCacheKey({ pullRequestId: 7, lastMergeSourceCommit: { commitId: 'abc' } })).toBe('7:abc');
    expect(runsCacheKey({ pullRequestId: 7 })).toBe('7:');
  });

  it('keeps runs only when all are over', () => {
    const run = (state: 'failed' | 'running' | 'succeeded') => ({ id: 1, pipeline: 'p', state, url: '' });
    expect(runsAreFinal([run('succeeded'), run('failed')])).toBe(true);
    expect(runsAreFinal([run('succeeded'), run('running')])).toBe(false);
    expect(runsAreFinal([])).toBe(false);
  });

  it('fetches only the linked PRs nobody knows', () => {
    expect(pullRequestsToFetch([1, 2, 2, 3], new Map([[1, 1]]), new Map([[2, 1]]))).toEqual([3]);
  });

  it('loads again only when the store, the teams or a refresh changed', () => {
    expect(attemptKey(3, ['A', 'B'], 0)).toBe(attemptKey(3, ['A', 'B'], 0));
    expect(attemptKey(3, ['A'], 0)).not.toBe(attemptKey(4, ['A'], 0));
    expect(attemptKey(3, ['A'], 0)).not.toBe(attemptKey(3, ['B'], 0));
    expect(attemptKey(3, ['A'], 0)).not.toBe(attemptKey(3, ['A'], 1));
  });
});
