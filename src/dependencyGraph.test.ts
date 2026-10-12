import { describe, expect, it } from 'vitest';
import {
  buildGraph,
  dependencyChain,
  filterGraph,
  GraphItem,
  isolatedIds,
  layoutGraph,
  visibleColumns,
} from './dependencyGraph';
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

const today = new Date('2026-10-06T12:00:00Z');
const orderOf = (graph: ReturnType<typeof buildGraph>, sortByState = false) => {
  const { positions } = layoutGraph(graph, { ...options, sortByState });
  return [...positions.entries()]
    .sort(([, a], [, b]) => a.column - b.column || a.lane - b.lane || a.y - b.y)
    .map(([id]) => id);
};

describe('priority', () => {
  it('copies the priority to the nodes', () => {
    const graph = buildGraph([item(1, P41, { priority: 1 }), item(2, P41)], new Set(), schedule, today);
    expect(graph.nodes.map((n) => n.priority)).toEqual([1, undefined]);
  });

  it('breaks ties by priority (P1 first, none last), then by ID', () => {
    const graph = buildGraph(
      [
        item(1, P41),
        item(2, P41, { priority: 4 }),
        item(3, P41, { priority: 2 }),
        item(4, P41, { priority: 1 }),
        item(5, P41, { priority: 2 }),
      ],
      new Set(),
      schedule,
      today
    );
    expect(orderOf(graph)).toEqual([4, 3, 5, 2, 1]);
  });

  it('does not let the priority beat the position of the neighbours', () => {
    // 10 (P4) is linked to the first work item of the next sprint, 11 (P1) to the second: weights differ
    const graph = buildGraph(
      [
        item(10, P41, { priority: 4, successorIds: [20] }),
        item(11, P41, { priority: 1, successorIds: [21] }),
        item(20, P42, { predecessorIds: [10] }),
        item(21, P42, { predecessorIds: [11] }),
      ],
      new Set(),
      schedule,
      today
    );
    const order = orderOf(graph);
    expect(order.indexOf(10)).toBeLessThan(order.indexOf(11));
  });
});

describe('sort by state', () => {
  const states = [
    item(1, P41, { state: 'Done' }),
    item(2, P41, { state: 'New' }),
    item(3, P41, { state: 'Removed' }),
    item(4, P41, { state: 'In Progress' }),
    item(5, P41, { state: 'Ready to Test' }),
    item(6, P41, { state: 'Approved' }),
    item(7, P41, { state: 'Committed', priority: 3 }),
    item(8, P41, { state: 'Committed', priority: 1 }),
  ];
  const graph = buildGraph(states, new Set(), schedule, today);

  it('puts active work first: in progress, not started, finished, removed', () => {
    // In progress: 8 (P1), 7 (P3), 4. Not started: 2, 6. Finished: 1, 5. Removed: 3
    expect(orderOf(graph, true)).toEqual([8, 7, 4, 2, 6, 1, 5, 3]);
  });

  it('keeps the order by ID and priority when it is off', () => {
    expect(orderOf(graph, false)).toEqual([8, 7, 1, 2, 3, 4, 5, 6]);
  });

  it('keeps the line-straightening order inside a state group', () => {
    // Both in progress: the arrows 20 → 31 and 21 → 30 do not cross
    const linked = buildGraph(
      [
        item(20, P41, { successorIds: [31] }),
        item(21, P41, { successorIds: [30] }),
        item(30, P42, { predecessorIds: [21] }),
        item(31, P42, { predecessorIds: [20] }),
      ],
      new Set(),
      schedule,
      today
    );
    const { positions } = layoutGraph(linked, { ...options, sortByState: true });
    const y = (id: number) => positions.get(id)?.y ?? 0;
    expect(y(20) < y(21)).toBe(y(31) < y(30));
    expect(y(21) < y(20)).toBe(y(30) < y(31));
  });
});

describe('line straightening', () => {
  // 1 → 4 and 2 → 3 cross when each column is ordered by ID
  const crossing = buildGraph(
    [
      item(1, P41, { successorIds: [4] }),
      item(2, P41, { successorIds: [3] }),
      item(3, P42, { predecessorIds: [2] }),
      item(4, P42, { predecessorIds: [1] }),
    ],
    new Set(),
    schedule,
    today
  );

  it('untangles a simple crossing', () => {
    const { positions } = layoutGraph(crossing, options);
    const y = (id: number) => positions.get(id)?.y ?? 0;
    expect(y(1) < y(2)).toBe(y(4) < y(3));
  });

  it('is stable: same result for the same graph, whatever the order of the work items', () => {
    const shuffled = { ...crossing, nodes: [...crossing.nodes].reverse(), edges: [...crossing.edges].reverse() };
    expect(orderOf(shuffled)).toEqual(orderOf(crossing));
    expect(orderOf(crossing)).toEqual(orderOf(crossing));
  });

  it('uses the height, not the row, when lanes have different sizes', () => {
    // Column 0 has two lanes (the second one with a header); 50 sits low in column 0 but is the only row of column 1
    const graph = buildGraph(
      [
        item(40, P41, { successorIds: [60] }),
        item(41, UX41, { successorIds: [61] }),
        item(60, P42, { predecessorIds: [40] }),
        item(61, P42, { predecessorIds: [41] }),
      ],
      new Set(),
      schedule,
      today
    );
    const { positions } = layoutGraph(graph, options);
    const y = (id: number) => positions.get(id)?.y ?? 0;
    expect(y(60)).toBeLessThan(y(61));
  });
});

describe('filterGraph', () => {
  const graph = buildGraph(
    [
      item(1, P41, { successorIds: [2] }),
      item(2, P42, { predecessorIds: [1], successorIds: [3] }),
      item(3, P43, { type: 'Bug', predecessorIds: [2], successorIds: [4] }),
      item(4, P43, { predecessorIds: [3] }),
      item(5, P42),
      item(6, UX41, { type: 'Bug', successorIds: [7] }),
      item(7, UX41, { predecessorIds: [6] }),
    ],
    new Set(),
    schedule,
    today,
    2
  );
  const ids = (g: { nodes: { id: number }[] }) => g.nodes.map((n) => n.id).sort((a, b) => a - b);

  it('shows everything except the isolated work items by default', () => {
    const result = filterGraph(graph, { hideBugs: false, showIsolated: false });
    expect(ids(result.graph)).toEqual([1, 2, 3, 4, 6, 7]);
    expect(result.hiddenIsolated).toBe(1);
  });

  it('hides the bugs and their arrows', () => {
    const { graph: result } = filterGraph(graph, { hideBugs: true, showIsolated: true });
    expect(ids(result)).toEqual([1, 2, 4, 5, 7]);
    expect(result.edges).toEqual([{ from: 1, to: 2, risk: expect.any(String) }]);
  });

  it('hides a work item that only had links to hidden bugs, unless the isolated ones are shown', () => {
    const hidden = filterGraph(graph, { hideBugs: true, showIsolated: false });
    expect(ids(hidden.graph)).toEqual([1, 2]);
    expect(hidden.hiddenIsolated).toBe(3);
    const shown = filterGraph(graph, { hideBugs: true, showIsolated: true });
    expect(ids(shown.graph)).toEqual([1, 2, 4, 5, 7]);
  });

  it('always keeps the focused work item, even a bug', () => {
    const focusedBug = { ...graph, focusId: 3 };
    const { graph: result } = filterGraph(focusedBug, { hideBugs: true, showIsolated: false });
    expect(ids(result)).toContain(3);
    expect(result.edges.map((e) => `${e.from}>${e.to}`)).toContain('2>3');
  });

  it('drops the columns left empty', () => {
    const { graph: result } = filterGraph(graph, { hideBugs: true, showIsolated: false });
    expect(result.columns.map((c) => c.name)).toEqual(['Sprint 41', 'Sprint 42']);
  });

  it('returns the same graph when nothing is hidden', () => {
    const plain = buildGraph(
      [item(1, P41, { successorIds: [2] }), item(2, P42, { predecessorIds: [1] })],
      new Set(),
      schedule,
      today
    );
    expect(filterGraph(plain, { hideBugs: true, showIsolated: false }).graph).toBe(plain);
  });
});
