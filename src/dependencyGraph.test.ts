import { describe, expect, it } from 'vitest';
import { buildGraph, dependencyChain, GraphItem, isolatedIds, layoutGraph, visibleColumns } from './dependencyGraph';
import { flattenIterations, IterationNode } from './schedule';

const sprint = (release: string, name: string, startDate: string, finishDate: string): IterationNode => ({
  name,
  path: `\\Flow\\Iteration\\${release}\\${name}`,
  attributes: { startDate: `${startDate}T00:00:00Z`, finishDate: `${finishDate}T00:00:00Z` },
});

const schedule = flattenIterations({
  name: 'Flow',
  path: '\\Flow\\Iteration',
  children: [
    {
      name: 'R1',
      path: '\\Flow\\Iteration\\R1',
      attributes: { startDate: '2026-09-01T00:00:00Z', finishDate: '2027-03-01T00:00:00Z' },
      children: [
        sprint('R1', 'Platform Sprint 41', '2026-09-21', '2026-10-02'),
        sprint('R1', 'UX Sprint 41', '2026-09-21', '2026-10-02'),
        sprint('R1', 'Platform Sprint 42', '2026-10-05', '2026-10-16'),
        sprint('R1', 'UX Sprint 42', '2026-10-05', '2026-10-16'),
        sprint('R1', 'Platform Sprint 43', '2026-10-19', '2026-10-30'),
      ],
    },
    {
      name: 'R2',
      path: '\\Flow\\Iteration\\R2',
      attributes: { startDate: '2026-11-01T00:00:00Z', finishDate: '2027-06-01T00:00:00Z' },
      children: [sprint('R2', 'Platform Sprint 44', '2026-11-02', '2026-11-13')],
    },
  ],
});

const P41 = 'Flow\\R1\\Platform Sprint 41';
const UX41 = 'Flow\\R1\\UX Sprint 41';
const P42 = 'Flow\\R1\\Platform Sprint 42';
const P43 = 'Flow\\R1\\Platform Sprint 43';

const item = (id: number, iterationPath: string, overrides: Partial<GraphItem> = {}): GraphItem => ({
  id,
  title: `Item ${id}`,
  type: 'Product Backlog Item',
  state: 'Committed',
  iterationPath,
  predecessorIds: [],
  successorIds: [],
  ...overrides,
});

const options = {
  columnWidth: 200,
  columnGap: 50,
  nodeHeight: 60,
  rowGap: 10,
  headerHeight: 30,
  laneHeaderHeight: 20,
  laneGap: 5,
  padding: 10,
};

describe('dependency graph', () => {
  // 1 → 2 → 3, and 4 → 2; 2 also depends on 99, which is not loaded
  const items = [
    item(1, P41, { successorIds: [2] }),
    item(2, P42, { predecessorIds: [1, 4, 99], successorIds: [3] }),
    item(3, P42, { predecessorIds: [2] }),
    item(4, P43, { successorIds: [2] }),
    item(5, UX41),
  ];
  const graph = buildGraph(items, new Set([2]), schedule, new Date('2026-10-06T12:00:00Z'), 2);

  it('builds one edge per dependency, with its risk', () => {
    expect(graph.edges).toEqual([
      { from: 1, to: 2, risk: 'ok' },
      { from: 4, to: 2, risk: 'late' },
      { from: 2, to: 3, risk: 'tight' },
    ]);
  });

  it('marks my work items and the links not loaded', () => {
    expect(graph.nodes.find((node) => node.id === 2)).toMatchObject({ isMine: true, hiddenLinks: 1 });
  });

  it('puts the sprints with the same dates in one time slot, one lane per team', () => {
    expect(graph.columns.map((c) => [c.kind, c.name, c.start, c.isCurrent, c.lanes.map((l) => l.name)])).toEqual([
      ['slot', 'Sprint 41', '2026-09-21', false, ['Platform Sprint 41', 'UX Sprint 41']],
      ['slot', 'Sprint 42', '2026-10-05', true, ['Platform Sprint 42']],
      ['slot', 'Sprint 43', '2026-10-19', false, ['Platform Sprint 43']],
    ]);
  });

  it('finds the whole chain of a work item', () => {
    expect([...dependencyChain(1, graph.edges)].sort()).toEqual([1, 2, 3]);
    expect([...dependencyChain(2, graph.edges)].sort()).toEqual([1, 2, 3, 4]);
  });

  it('places each work item in the column and lane of its sprint', () => {
    const { positions, width, lanes } = layoutGraph(graph, options);
    expect(positions.get(1)).toMatchObject({ column: 0, lane: 0 });
    expect(positions.get(5)).toMatchObject({ column: 0, lane: 1 });
    expect(positions.get(3)?.column).toBe(1);
    expect(positions.get(4)?.column).toBe(2);
    expect(width).toBe(10 * 2 + 3 * 200 + 2 * 50);
    // The UX lane starts below the platform lane (header 20 + one node of 70 + gap 5), plus its own header
    const top = 10 + 30;
    expect(positions.get(1)?.y).toBe(top + 20);
    expect(positions.get(5)?.y).toBe(top + 20 + 70 + 5 + 20);
    expect(lanes.filter((lane) => lane.column === 0).map((lane) => lane.name)).toEqual([
      'Platform Sprint 41',
      'UX Sprint 41',
    ]);
  });

  it('orders the nodes of a lane next to their neighbours', () => {
    const lane = buildGraph(
      [item(10, P41, { successorIds: [12] }), item(11, P41), item(12, P42, { predecessorIds: [10] })],
      new Set(),
      schedule,
      new Date()
    );
    const { positions } = layoutGraph(lane, options);
    expect(positions.get(10)?.y).toBeLessThan(positions.get(11)?.y ?? 0);
  });

  it('keeps the same order of teams in every slot', () => {
    const teams = buildGraph(
      [item(1, 'Flow\\R1\\UX Sprint 42'), item(2, P42), item(3, UX41), item(4, P41)],
      new Set(),
      schedule,
      new Date()
    );
    expect(teams.columns.map((c) => c.lanes.map((l) => l.name))).toEqual([
      ['Platform Sprint 41', 'UX Sprint 41'],
      ['Platform Sprint 42', 'UX Sprint 42'],
    ]);
  });

  it('shows no sprint number when the sprints of a slot differ in number', () => {
    const odd = flattenIterations({
      name: 'Flow',
      path: '\\Flow\\Iteration',
      children: [
        {
          name: 'R1',
          path: '\\Flow\\Iteration\\R1',
          children: [
            sprint('R1', 'Platform Sprint 5', '2026-10-05', '2026-10-16'),
            sprint('R1', 'UX Sprint 9', '2026-10-05', '2026-10-16'),
          ],
        },
      ],
    });
    const result = buildGraph(
      [item(1, 'Flow\\R1\\Platform Sprint 5'), item(2, 'Flow\\R1\\UX Sprint 9')],
      new Set(),
      odd,
      new Date()
    );
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe('');
  });
});

describe('releases, limbo and unknown dates', () => {
  const items = [
    item(1, 'Flow\\R1', { successorIds: [2] }),
    item(2, P42, { predecessorIds: [1, 6], successorIds: [3] }),
    item(3, 'Flow\\R2\\Platform Sprint 44', { predecessorIds: [2] }),
    item(4, 'Flow\\R2'),
    item(5, 'Flow', { successorIds: [2] }),
    item(6, 'Flow\\R1\\Mystery Sprint 7', { successorIds: [2] }),
    item(7, 'Flow\\R1', { successorIds: [4] }),
  ];
  const graph = buildGraph(items, new Set(), schedule, new Date('2026-10-06T00:00:00Z'));

  it('puts a release column after the last slot of its sprints', () => {
    expect(graph.columns.map((c) => [c.kind, c.name])).toEqual([
      ['slot', 'Sprint 42'],
      ['container', 'R1'],
      ['slot', 'Sprint 44'],
      ['container', 'R2'],
      ['slot', 'Dates unknown'],
    ]);
  });

  it('puts the work items of a release in its column', () => {
    const { positions } = layoutGraph(graph, options);
    expect(positions.get(1)?.column).toBe(1);
    expect(positions.get(7)?.column).toBe(1);
    expect(positions.get(4)?.column).toBe(3);
    expect(positions.get(6)?.column).toBe(4);
  });

  it('ignores the work items in the project and counts them', () => {
    expect(graph.limbo).toBe(1);
    expect(graph.nodes.map((node) => node.id)).not.toContain(5);
    expect(graph.edges.some((edge) => edge.from === 5 || edge.to === 5)).toBe(false);
    expect(graph.nodes.find((node) => node.id === 2)?.hiddenLinks).toBe(0);
  });

  it('flags dependencies on work items not in a sprint', () => {
    const risk = (from: number, to: number) => graph.edges.find((e) => e.from === from && e.to === to)?.risk;
    expect(risk(1, 2)).toBe('unscheduled');
    expect(risk(6, 2)).toBe('unscheduled');
    expect(risk(2, 3)).toBe('ok');
    expect(risk(7, 4)).toBe('ok');
  });

  it('puts a release without sprints at the end', () => {
    const only = buildGraph([item(1, 'Flow\\R2'), item(2, P41)], new Set(), schedule, new Date());
    expect(only.columns.map((c) => c.name)).toEqual(['Sprint 41', 'R2']);
  });

  it('drops the lanes and columns without work items', () => {
    const nodes = graph.nodes.filter((node) => node.id !== 2);
    expect(visibleColumns(graph.columns, nodes).map((c) => c.name)).toEqual(['R1', 'Sprint 44', 'R2', 'Dates unknown']);
  });
});

describe('tasks', () => {
  it('never shows tasks, nor their links, and does not count loaded ones as "+N"', () => {
    const items = [
      item(1, P41, { successorIds: [2, 3] }),
      item(2, P42, { predecessorIds: [1] }),
      item(3, P42, { type: 'Task', predecessorIds: [1] }),
      // A task in the project root is not counted as hidden "limbo" either
      item(4, 'Flow', { type: 'Task' }),
    ];
    const graph = buildGraph(items, new Set(), schedule, new Date('2026-10-06T12:00:00Z'));
    expect(graph.nodes.map((node) => node.id)).toEqual([1, 2]);
    expect(graph.edges.map(({ from, to }) => [from, to])).toEqual([[1, 2]]);
    expect(graph.nodes.find((node) => node.id === 1)?.hiddenLinks).toBe(0);
    expect(graph.limbo).toBe(0);
  });
});

describe('isolatedIds', () => {
  it('finds the work items without arrows nor dependencies left to load', () => {
    const items = [
      item(1, P41, { successorIds: [2] }),
      item(2, P42, { predecessorIds: [1] }),
      item(3, P42),
      // Its dependency is not loaded yet ("+1"): not isolated
      item(4, P43, { predecessorIds: [99] }),
    ];
    const graph = buildGraph(items, new Set([1, 3, 4]), schedule, new Date('2026-10-06T12:00:00Z'));
    expect([...isolatedIds(graph)]).toEqual([3]);
  });
});
