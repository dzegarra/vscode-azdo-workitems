import { describe, expect, it } from 'vitest';
import {
  BranchWorkItem,
  branchPickItems,
  branchStatusBarText,
  branchWorkItemIds,
  dropTasksOfLinkedParents,
  iterationDescription,
  iterationTag,
  normalizeMaxItems,
  orderBranchWorkItems,
} from './branchWorkItems';
import { WorkingOnEntry } from './workingOn';

const P = 'Proj\\Release';
const schedule = [
  { path: `${P}\\Sprint 1`, name: 'Sprint 1', start: '2026-10-05T00:00:00Z', finish: '2026-10-16T00:00:00Z' },
  { path: `${P}\\Sprint 2`, name: 'Sprint 2', start: '2026-10-19T00:00:00Z', finish: '2026-10-30T00:00:00Z' },
  { path: `${P}\\Sprint 3`, name: 'Sprint 3', start: '2026-11-02T00:00:00Z', finish: '2026-11-13T00:00:00Z' },
  { path: `${P}\\Sprint 0`, name: 'Sprint 0', start: '2026-09-21T00:00:00Z', finish: '2026-10-02T00:00:00Z' },
];
const today = new Date('2026-10-29T10:00:00Z');
const item = (id: number, iterationPath: string) => ({ id, iterationPath });

const mine = { isMine: true, assignee: 'you', ownerLabel: 'you' };
const wi = (id: number, type = 'Task', isMine = true): BranchWorkItem => ({
  id,
  title: `Title ${id}`,
  type,
  state: 'Active',
  iterationPath: `${P}\\Sprint 2`,
  view: isMine ? mine : { isMine: false, assignee: 'Ana', branchOwner: 'Ana', ownerLabel: 'Ana' },
});

describe('branchWorkItemIds (STATUSBAR-WI-1)', () => {
  const entry = (id: number, extra: Partial<WorkingOnEntry> = {}): WorkingOnEntry => ({
    workItem: { id, links: { branches: [] } },
    pullRequests: [],
    ...extra,
  });
  it('takes the ID of the name, the active PR from the branch and the Development links', () => {
    const entries = [
      entry(10),
      entry(11, { pullRequests: [{ status: 'active', sourceRefName: 'refs/heads/feature/x/10-a' }] }),
      entry(12, { taskBranches: ['feature/x/10-a'] }),
      entry(13),
    ];
    expect(branchWorkItemIds('feature/x/10-a', entries, 10)).toEqual([10, 11, 12]);
  });
  it('adds the named work item when it is not in the list', () => {
    expect(branchWorkItemIds('feature/x/99-a', [entry(10)], 99)).toEqual([99]);
  });
});

describe('orderBranchWorkItems (STATUSBAR-WI-2)', () => {
  const order = (items: ReturnType<typeof item>[], named?: number) =>
    orderBranchWorkItems(items, named, schedule, today).map((i) => i.id);
  it('puts the current sprint first, then by distance', () => {
    expect(order([item(1, `${P}\\Sprint 1`), item(2, `${P}\\Sprint 3`), item(3, `${P}\\Sprint 2`)])).toEqual([3, 2, 1]);
  });
  it('puts the future before the past at the same distance', () => {
    // Sprint 1 ended 3 days before this day and Sprint 2 starts 3 days after it
    const day = new Date('2026-10-16T10:00:00Z');
    const dates = [
      { ...schedule[0], finish: '2026-10-13T00:00:00Z' },
      { ...schedule[1], start: '2026-10-19T00:00:00Z' },
    ];
    const result = orderBranchWorkItems([item(1, `${P}\\Sprint 1`), item(2, `${P}\\Sprint 2`)], undefined, dates, day);
    expect(result.map((i) => i.id)).toEqual([2, 1]);
  });
  it('names first and then the lower ID inside an iteration', () => {
    expect(order([item(5, `${P}\\Sprint 2`), item(3, `${P}\\Sprint 2`), item(9, `${P}\\Sprint 2`)], 9)).toEqual([
      9, 3, 5,
    ]);
  });
  it('leaves the work items without sprint dates last', () => {
    expect(order([item(1, 'Proj'), item(2, P), item(3, `${P}\\Sprint 0`), item(4, `${P}\\Sprint Z`)])).toEqual([
      3, 1, 2, 4,
    ]);
  });
});

describe('iterationTag (STATUSBAR-WI-4)', () => {
  it('says current, starts in and ended ago', () => {
    expect(iterationTag(`${P}\\Sprint 2`, schedule, today)).toBe('current');
    expect(iterationTag(`${P}\\Sprint 3`, schedule, today)).toBe('starts in 4 days');
    expect(iterationTag(`${P}\\Sprint 1`, schedule, today)).toBe('ended 13 days ago');
    expect(iterationTag(`${P}\\Sprint 2`, schedule, new Date('2026-10-31T00:00:00Z'))).toBe('ended 1 day ago');
    expect(iterationTag(P, schedule, today)).toBeUndefined();
  });
  it('describes the iteration with its name and tag', () => {
    expect(iterationDescription(`${P}\\Sprint 3`, schedule, today)).toBe('Sprint 3 (starts in 4 days)');
    expect(iterationDescription('Proj', schedule, today)).toBeUndefined();
  });
});

describe('normalizeMaxItems (STATUSBAR-WI-6)', () => {
  it('accepts integers from 1 and defaults otherwise', () => {
    expect(normalizeMaxItems(5)).toBe(5);
    expect(normalizeMaxItems(0)).toBe(3);
    expect(normalizeMaxItems(2.5)).toBe(3);
    expect(normalizeMaxItems('4')).toBe(3);
  });
});

describe('branchStatusBarText (STATUSBAR-WI-3)', () => {
  it('reads like the single work item text when there is one', () => {
    expect(branchStatusBarText([wi(1, 'Bug')], 'id', 3)).toBe('$(bug) 1');
    expect(branchStatusBarText([wi(1, 'Bug', false)], 'idAndTitle', 3)).toBe('$(eye) $(bug) 1 Title 1 · Ana');
  });
  it('shows N work items and +M for the rest', () => {
    const items = [wi(1, 'Bug'), wi(2), wi(3, 'Product Backlog Item'), wi(4)];
    expect(branchStatusBarText(items, 'id', 3)).toBe('$(bug) 1 $(tasklist) 2 $(book) 3 +1');
    expect(branchStatusBarText(items, 'id', 5)).toBe('$(bug) 1 $(tasklist) 2 $(book) 3 $(tasklist) 4');
    expect(branchStatusBarText(items, 'id', 1)).toBe('$(bug) 1 +3');
  });
  it('shows the title of the first only', () => {
    expect(branchStatusBarText([wi(1), wi(2)], 'idAndTitle', 3)).toBe('$(tasklist) 1 Title 1 $(tasklist) 2');
  });
  it("adds the eye and the owner when any is not the user's", () => {
    expect(branchStatusBarText([wi(1), wi(2, 'Task', false)], 'id', 3)).toBe(
      '$(eye) $(tasklist) 1 $(tasklist) 2 · Ana'
    );
  });
});

describe('branchPickItems (STATUSBAR-WI-5)', () => {
  it('lists id, type, title and iteration in order', () => {
    expect(branchPickItems([wi(7, 'Bug')], schedule, today)).toEqual([
      { id: 7, label: '$(bug) 7 Title 7', description: 'Bug', detail: 'Sprint 2 (current)' },
    ]);
  });
});

describe('dropTasksOfLinkedParents (STATUSBAR-WI-1)', () => {
  const t = (id: number, parentId?: number): BranchWorkItem => ({ ...wi(id), parentId });
  const pbi = (id: number) => wi(id, 'Product Backlog Item');
  const ids = (items: BranchWorkItem[]) => dropTasksOfLinkedParents(items).map((i) => i.id);
  it('keeps only the parent when the Task and its parent are both linked', () => {
    expect(ids([t(2, 1), pbi(1)])).toEqual([1]);
  });
  it('keeps a Task alone, or without a known parent', () => {
    expect(ids([t(2, 1)])).toEqual([2]);
    expect(ids([t(2)])).toEqual([2]);
  });
  it('keeps a Task whose parent is not linked', () => {
    expect(ids([t(2, 9), pbi(1)])).toEqual([2, 1]);
  });
  it('drops every Task of the linked parent', () => {
    expect(ids([t(2, 1), t(3, 1), pbi(1)])).toEqual([1]);
  });
  it('never drops a parent, and the +M counts the filtered list', () => {
    const items = dropTasksOfLinkedParents([t(2, 1), t(3, 1), pbi(1), wi(4, 'Bug'), wi(5, 'Bug')]);
    expect(branchStatusBarText(items, 'id', 2)).toBe('$(book) 1 $(bug) 4 +1');
  });
});
