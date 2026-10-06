import { describe, expect, it } from 'vitest';
import { buildGraph, dependencyChain, GraphItem, layoutGraph } from './dependencyGraph';
import { dependencyRisk, flattenIterations, orderIterations, toIterationPath } from './schedule';

const schedule = flattenIterations({
  name: 'Flow',
  path: '\\Flow\\Iteration',
  children: [
    {
      name: 'Sprint 41',
      path: '\\Flow\\Iteration\\Sprint 41',
      attributes: { startDate: '2026-09-21T00:00:00Z', finishDate: '2026-10-02T00:00:00Z' },
    },
    {
      name: 'Sprint 42',
      path: '\\Flow\\Iteration\\Sprint 42',
      attributes: { startDate: '2026-10-05T00:00:00Z', finishDate: '2026-10-16T00:00:00Z' },
    },
    {
      name: 'Sprint 43',
      path: '\\Flow\\Iteration\\Sprint 43',
      attributes: { startDate: '2026-10-19T00:00:00Z', finishDate: '2026-10-30T00:00:00Z' },
    },
  ],
});

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

describe('schedule', () => {
  it('converts classification node paths to iteration paths', () => {
    expect(toIterationPath('\\Flow Digital Architecture\\Iteration\\Sprint 42')).toBe(
      'Flow Digital Architecture\\Sprint 42'
    );
    expect(toIterationPath('\\Flow Digital Architecture\\Iteration')).toBe('Flow Digital Architecture');
  });

  it('orders iterations by start date, unscheduled last', () => {
    expect(orderIterations(['Flow', 'Flow\\Sprint 43', 'Flow\\Sprint 41'], schedule).map((i) => i.name)).toEqual([
      'Sprint 41',
      'Sprint 43',
      'Flow',
    ]);
  });

  it.each([
    [{ state: 'Committed', iterationPath: 'Flow\\Sprint 43' }, 'Flow\\Sprint 42', 'late'],
    [{ state: 'Committed', iterationPath: 'Flow\\Sprint 42' }, 'Flow\\Sprint 42', 'tight'],
    [{ state: 'New', iterationPath: 'Flow' }, 'Flow\\Sprint 42', 'unscheduled'],
    [{ state: 'Committed', iterationPath: 'Flow\\Sprint 41' }, 'Flow\\Sprint 42', 'ok'],
    [{ state: 'Done', iterationPath: 'Flow\\Sprint 43' }, 'Flow\\Sprint 42', 'done'],
    [{ state: 'Committed', iterationPath: 'Flow\\Sprint 43' }, 'Flow', 'ok'],
  ])('%o before a successor in %s is %s', (predecessor, successorPath, risk) => {
    expect(dependencyRisk(predecessor, { iterationPath: successorPath }, schedule)).toBe(risk);
  });
});

describe('dependency graph', () => {
  // 1 → 2 → 3, and 4 → 2; 2 also depends on 99, which is not loaded
  const items = [
    item(1, 'Flow\\Sprint 41', { successorIds: [2] }),
    item(2, 'Flow\\Sprint 42', { predecessorIds: [1, 4, 99], successorIds: [3] }),
    item(3, 'Flow\\Sprint 42', { predecessorIds: [2] }),
    item(4, 'Flow\\Sprint 43', { successorIds: [2] }),
    item(5, 'Flow\\Sprint 41'),
  ];
  const graph = buildGraph(items, new Set([2]), schedule, new Date('2026-10-06T12:00:00Z'), 2);

  it('builds one edge per dependency, with its risk', () => {
    expect(graph.edges).toEqual([
      { from: 1, to: 2, risk: 'ok' },
      { from: 4, to: 2, risk: 'late' },
      { from: 2, to: 3, risk: 'tight' },
    ]);
  });

  it('marks my work items, the current iteration and the links not loaded', () => {
    expect(graph.nodes.find((node) => node.id === 2)).toMatchObject({ isMine: true, hiddenLinks: 1 });
    expect(graph.columns.map((column) => [column.name, column.isCurrent])).toEqual([
      ['Sprint 41', false],
      ['Sprint 42', true],
      ['Sprint 43', false],
    ]);
  });

  it('finds the whole chain of a work item', () => {
    expect([...dependencyChain(1, graph.edges)].sort()).toEqual([1, 2, 3]);
    expect([...dependencyChain(2, graph.edges)].sort()).toEqual([1, 2, 3, 4]);
  });

  it('places each work item in the column of its iteration', () => {
    const options = { columnWidth: 200, columnGap: 50, nodeHeight: 60, rowGap: 10, headerHeight: 30, padding: 10 };
    const { positions, width } = layoutGraph(graph, options);
    expect(positions.get(1)?.column).toBe(0);
    expect(positions.get(3)?.column).toBe(1);
    expect(positions.get(4)?.column).toBe(2);
    expect(width).toBe(10 * 2 + 3 * 200 + 2 * 50);
    // 1 is next to its successor 2, so it goes above the unrelated 5
    expect(positions.get(1)?.y).toBeLessThan(positions.get(5)?.y ?? 0);
  });
});
