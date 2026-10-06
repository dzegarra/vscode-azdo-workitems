/** Model and layout of the dependency map. Shared with its webview, so no "vscode" import */
import { dependencyRisk, DependencyRisk, isCurrentIteration, orderIterations, ScheduledIteration } from './schedule';

export interface GraphItem {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath: string;
  assignedTo?: string;
  predecessorIds: number[];
  successorIds: number[];
}

export interface GraphNode {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath: string;
  assignedTo?: string;
  /** Assigned to the user in the current iterations */
  isMine: boolean;
  /** Dependencies of the node not loaded in the map yet */
  hiddenLinks: number;
}

/** "from" must be done before "to" */
export interface GraphEdge {
  from: number;
  to: number;
  risk: DependencyRisk;
}

export interface GraphColumn extends ScheduledIteration {
  isCurrent: boolean;
}

export interface DependencyGraph {
  columns: GraphColumn[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Work item to highlight when the map opens */
  focusId?: number;
}

export function buildGraph(
  items: GraphItem[],
  mineIds: Set<number>,
  schedule: ScheduledIteration[],
  today: Date,
  focusId?: number
): DependencyGraph {
  const byId = new Map(items.map((item) => [item.id, item]));
  const edges = new Map<string, GraphEdge>();
  const addEdge = (from: number, to: number) => {
    const predecessor = byId.get(from);
    const successor = byId.get(to);
    if (predecessor && successor) {
      edges.set(`${from}>${to}`, { from, to, risk: dependencyRisk(predecessor, successor, schedule) });
    }
  };
  for (const item of items) {
    item.predecessorIds.forEach((id) => addEdge(id, item.id));
    item.successorIds.forEach((id) => addEdge(item.id, id));
  }
  const nodes = items.map(({ predecessorIds, successorIds, ...item }) => ({
    ...item,
    isMine: mineIds.has(item.id),
    hiddenLinks: [...predecessorIds, ...successorIds].filter((id) => !byId.has(id)).length,
  }));
  const columns = orderIterations(
    items.map((item) => item.iterationPath),
    schedule
  ).map((iteration) => ({ ...iteration, isCurrent: isCurrentIteration(iteration, today) }));
  return { columns, nodes, edges: [...edges.values()], focusId };
}

/** IDs reachable following the edges in one direction */
function reachable(start: number, edges: GraphEdge[], direction: 'down' | 'up'): Set<number> {
  const result = new Set<number>();
  const pending = [start];
  while (pending.length) {
    const id = pending.pop() as number;
    for (const edge of edges) {
      const [from, to] = direction === 'down' ? [edge.from, edge.to] : [edge.to, edge.from];
      if (from === id && !result.has(to)) {
        result.add(to);
        pending.push(to);
      }
    }
  }
  return result;
}

/** The work item, everything it depends on and everything that depends on it */
export function dependencyChain(id: number, edges: GraphEdge[]): Set<number> {
  return new Set([id, ...reachable(id, edges, 'up'), ...reachable(id, edges, 'down')]);
}

export interface LayoutOptions {
  columnWidth: number;
  columnGap: number;
  nodeHeight: number;
  rowGap: number;
  headerHeight: number;
  padding: number;
}

export interface NodePosition {
  x: number;
  y: number;
  column: number;
}

export interface GraphLayout {
  positions: Map<number, NodePosition>;
  width: number;
  height: number;
}

const ORDERING_PASSES = 4;

/**
 * One column per iteration. Inside a column, nodes are ordered by the average row of their
 * neighbours (barycenter heuristic), which keeps related work items at the same height and
 * reduces the crossings of the arrows
 */
export function layoutGraph(
  graph: Pick<DependencyGraph, 'columns' | 'edges' | 'nodes'>,
  options: LayoutOptions
): GraphLayout {
  const columnIndex = new Map(graph.columns.map((column, index) => [column.path, index]));
  const columns: number[][] = graph.columns.map(() => []);
  for (const node of graph.nodes) {
    columns[columnIndex.get(node.iterationPath) ?? columns.length - 1]?.push(node.id);
  }
  columns.forEach((ids) => ids.sort((a, b) => a - b));

  const neighbours = new Map<number, number[]>();
  for (const { from, to } of graph.edges) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  const rowOf = new Map<number, number>();
  const updateRows = () => columns.forEach((ids) => ids.forEach((id, row) => rowOf.set(id, row)));
  updateRows();
  for (let pass = 0; pass < ORDERING_PASSES; pass++) {
    for (const ids of columns) {
      const weight = (id: number) => {
        const rows = (neighbours.get(id) ?? []).map((n) => rowOf.get(n) ?? 0);
        return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : rowOf.get(id) ?? 0;
      };
      const weights = new Map(ids.map((id) => [id, weight(id)]));
      ids.sort((a, b) => (weights.get(a) ?? 0) - (weights.get(b) ?? 0) || a - b);
      updateRows();
    }
  }

  const positions = new Map<number, NodePosition>();
  columns.forEach((ids, column) =>
    ids.forEach((id, row) =>
      positions.set(id, {
        column,
        x: options.padding + column * (options.columnWidth + options.columnGap),
        y: options.padding + options.headerHeight + row * (options.nodeHeight + options.rowGap),
      })
    )
  );
  const maxRows = Math.max(1, ...columns.map((ids) => ids.length));
  return {
    positions,
    width:
      options.padding * 2 + columns.length * options.columnWidth + Math.max(0, columns.length - 1) * options.columnGap,
    height: options.padding * 2 + options.headerHeight + maxRows * (options.nodeHeight + options.rowGap),
  };
}
