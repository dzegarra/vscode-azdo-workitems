/** Model and layout of the dependency map. Shared with its webview, so no "vscode" import */
import {
  compareDates,
  containerPath,
  dependencyRisk,
  DependencyRisk,
  isCurrentIteration,
  iterationKind,
  ScheduledIteration,
  sprintDates,
} from './schedule';

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

/** The sprint of a team, or the release itself in the "not scheduled yet" column of a container */
export interface GraphLane {
  /** Iteration path of the work items in the lane */
  path: string;
  name: string;
}

/**
 * - slot: the sprints of every team with the same dates, one lane per sprint
 * - container: the work items of a release not planned in any sprint yet
 */
export interface GraphColumn {
  key: string;
  kind: 'container' | 'slot';
  /** "Sprint 122" when all the sprints of the slot share the number, the release for a container */
  name: string;
  start?: string;
  finish?: string;
  isCurrent: boolean;
  lanes: GraphLane[];
}

export interface DependencyGraph {
  columns: GraphColumn[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Work items directly in the project (not planned in any release): not shown */
  limbo: number;
  /** Work item to highlight when the map opens */
  focusId?: number;
}

const UNKNOWN_DATES = 'unknown';

/** Name of a sprint without its number: the team, to keep the same order of lanes in every column */
function team(name: string): string {
  return name.replace(/\d+/g, '').trim();
}

function commonSprintNumber(lanes: GraphLane[]): string | undefined {
  const numbers = new Set(lanes.map((lane) => /(\d+)\s*$/.exec(lane.name)?.[1]));
  const [number] = numbers;
  return numbers.size === 1 && number ? `Sprint ${number}` : undefined;
}

const byTeam = (a: GraphLane, b: GraphLane) => team(a.name).localeCompare(team(b.name)) || a.path.localeCompare(b.path);

/**
 * Sprints with the same dates share a column (a time slot), one lane per sprint. The work items planned in a release
 * but in no sprint go to a column of the release, right after the last slot with sprints of that release
 */
function buildColumns(nodes: GraphNode[], schedule: ScheduledIteration[], today: Date): GraphColumn[] {
  const nameOf = (path: string) =>
    schedule.find((iteration) => iteration.path === path)?.name ?? path.split('\\').at(-1) ?? path;
  const slots = new Map<string, GraphColumn & { releases: Set<string> }>();
  const containers = new Set<string>();
  for (const path of new Set(nodes.map((node) => node.iterationPath))) {
    const kind = iterationKind(path);
    if (kind === 'container') {
      containers.add(path);
    } else if (kind === 'sprint') {
      const dates = sprintDates(path, schedule);
      const key = dates ? `${dates.start}|${dates.finish}` : UNKNOWN_DATES;
      const slot = slots.get(key) ?? {
        key,
        kind: 'slot' as const,
        name: dates ? '' : 'Dates unknown',
        ...dates,
        isCurrent: !!dates && isCurrentIteration({ path, name: '', ...dates }, today),
        lanes: [],
        releases: new Set<string>(),
      };
      slot.lanes.push({ path, name: nameOf(path) });
      // Sprints with unknown dates do not say where the release ends
      if (dates) {
        slot.releases.add(containerPath(path));
      }
      slots.set(key, slot);
    }
  }
  const ordered = [...slots.values()].sort((a, b) => {
    if (a.start && a.finish && b.start && b.finish) {
      return compareDates({ start: a.start, finish: a.finish }, { start: b.start, finish: b.finish });
    }
    return Number(!a.start) - Number(!b.start);
  });
  for (const slot of ordered) {
    slot.lanes.sort(byTeam);
    slot.name = slot.name || commonSprintNumber(slot.lanes) || '';
  }

  const startOf = (path: string) => schedule.find((iteration) => iteration.path === path)?.start ?? '';
  const releaseColumns = [...containers]
    .sort(
      (a, b) => Number(!startOf(a)) - Number(!startOf(b)) || startOf(a).localeCompare(startOf(b)) || a.localeCompare(b)
    )
    .map((path) => ({
      anchor: ordered.reduce((last, slot, index) => (slot.releases.has(path) ? index : last), -1),
      column: {
        key: path,
        kind: 'container' as const,
        name: nameOf(path),
        isCurrent: false,
        lanes: [{ path, name: nameOf(path) }],
      },
    }));
  const columns: GraphColumn[] = [];
  ordered.forEach(({ releases, ...slot }, index) => {
    columns.push(slot);
    columns.push(...releaseColumns.filter(({ anchor }) => anchor === index).map(({ column }) => column));
  });
  columns.push(...releaseColumns.filter(({ anchor }) => anchor < 0).map(({ column }) => column));
  return columns;
}

/** Columns and lanes with at least one of the given work items */
export function visibleColumns(columns: GraphColumn[], nodes: GraphNode[]): GraphColumn[] {
  const paths = new Set(nodes.map((node) => node.iterationPath));
  return columns
    .map((column) => ({ ...column, lanes: column.lanes.filter((lane) => paths.has(lane.path)) }))
    .filter((column) => column.lanes.length);
}

/** Never shown in the map (their links still count as known, so they do not show as "+N" once loaded) */
const TASK_TYPE = 'Task';

export function buildGraph(
  items: GraphItem[],
  mineIds: Set<number>,
  schedule: ScheduledIteration[],
  today: Date,
  focusId?: number
): DependencyGraph {
  const byId = new Map(items.map((item) => [item.id, item]));
  // Tasks are parts of their Backlog Item / Bug, not planned work of their own: never shown
  const planned = items.filter((item) => item.type !== TASK_TYPE);
  // Work items directly in the project are not planned in any release: ignored
  const shown = planned.filter((item) => iterationKind(item.iterationPath) !== 'limbo');
  const shownIds = new Set(shown.map((item) => item.id));
  const edges = new Map<string, GraphEdge>();
  const addEdge = (from: number, to: number) => {
    const predecessor = byId.get(from);
    const successor = byId.get(to);
    if (predecessor && successor && shownIds.has(from) && shownIds.has(to)) {
      edges.set(`${from}>${to}`, { from, to, risk: dependencyRisk(predecessor, successor, schedule) });
    }
  };
  for (const item of shown) {
    item.predecessorIds.forEach((id) => addEdge(id, item.id));
    item.successorIds.forEach((id) => addEdge(item.id, id));
  }
  const nodes = shown.map(({ predecessorIds, successorIds, ...item }) => ({
    ...item,
    isMine: mineIds.has(item.id),
    hiddenLinks: [...predecessorIds, ...successorIds].filter((id) => !byId.has(id)).length,
  }));
  return {
    columns: buildColumns(nodes, schedule, today),
    nodes,
    edges: [...edges.values()],
    limbo: planned.length - shown.length,
    focusId,
  };
}

/**
 * Work items without dependencies in the map: no arrow, and no dependency left to load ("+N"). Only shown on
 * demand ("Show work items without dependencies")
 */
export function isolatedIds(graph: Pick<DependencyGraph, 'edges' | 'nodes'>): Set<number> {
  const linked = new Set(graph.edges.flatMap(({ from, to }) => [from, to]));
  return new Set(graph.nodes.filter((node) => !linked.has(node.id) && !node.hiddenLinks).map((node) => node.id));
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
  /** Height of the sub-header with the name of the sprint in a lane of a time slot */
  laneHeaderHeight: number;
  laneGap: number;
  padding: number;
}

export interface NodePosition {
  x: number;
  y: number;
  column: number;
  lane: number;
}

export interface LanePosition {
  column: number;
  path: string;
  name: string;
  /** Slots show the name of the sprint above the lane; the column of a release does not */
  hasHeader: boolean;
  y: number;
  height: number;
}

export interface GraphLayout {
  positions: Map<number, NodePosition>;
  lanes: LanePosition[];
  width: number;
  height: number;
}

const ORDERING_PASSES = 4;

/**
 * One column per time slot (or release), with a lane per sprint stacked vertically. Inside a lane, nodes are
 * ordered by the average row of their neighbours (barycenter heuristic), which keeps related work items at the same
 * height and reduces the crossings of the arrows
 */
export function layoutGraph(
  graph: Pick<DependencyGraph, 'columns' | 'edges' | 'nodes'>,
  options: LayoutOptions
): GraphLayout {
  const laneIndex = new Map<string, [number, number]>();
  graph.columns.forEach((column, c) => column.lanes.forEach((lane, l) => laneIndex.set(lane.path, [c, l])));
  const cells: number[][][] = graph.columns.map((column) => column.lanes.map(() => []));
  for (const node of graph.nodes) {
    const [c, l] = laneIndex.get(node.iterationPath) ?? [];
    if (c !== undefined && l !== undefined) {
      cells[c][l].push(node.id);
    }
  }
  cells.forEach((lanes) => lanes.forEach((ids) => ids.sort((a, b) => a - b)));

  const neighbours = new Map<number, number[]>();
  for (const { from, to } of graph.edges) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  // Row of a node counting from the top of its column, through all its lanes
  const rowOf = new Map<number, number>();
  const updateRows = () => cells.forEach((lanes) => lanes.flat().forEach((id, row) => rowOf.set(id, row)));
  updateRows();
  for (let pass = 0; pass < ORDERING_PASSES; pass++) {
    for (const lanes of cells) {
      for (const ids of lanes) {
        const weight = (id: number) => {
          const rows = (neighbours.get(id) ?? []).map((n) => rowOf.get(n) ?? 0);
          return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : rowOf.get(id) ?? 0;
        };
        const weights = new Map(ids.map((id) => [id, weight(id)]));
        ids.sort((a, b) => (weights.get(a) ?? 0) - (weights.get(b) ?? 0) || a - b);
        updateRows();
      }
    }
  }

  const positions = new Map<number, NodePosition>();
  const lanes: LanePosition[] = [];
  const top = options.padding + options.headerHeight;
  let bottom = top;
  cells.forEach((laneCells, column) => {
    let y = top;
    laneCells.forEach((ids, lane) => {
      const { path, name } = graph.columns[column].lanes[lane];
      const hasHeader = graph.columns[column].kind === 'slot';
      const laneTop = y;
      y += hasHeader ? options.laneHeaderHeight : 0;
      ids.forEach((id, row) =>
        positions.set(id, {
          column,
          lane,
          x: options.padding + column * (options.columnWidth + options.columnGap),
          y: y + row * (options.nodeHeight + options.rowGap),
        })
      );
      y += Math.max(1, ids.length) * (options.nodeHeight + options.rowGap);
      lanes.push({ column, path, name, hasHeader, y: laneTop, height: y - laneTop });
      y += options.laneGap;
    });
    bottom = Math.max(bottom, y);
  });
  const count = graph.columns.length;
  return {
    positions,
    lanes,
    width: options.padding * 2 + count * options.columnWidth + Math.max(0, count - 1) * options.columnGap,
    height: bottom + options.padding,
  };
}
