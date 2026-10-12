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
import { stateCategory, StateCategory } from './states';

export interface GraphItem {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath: string;
  assignedTo?: string;
  /** 1 (critical) … 4 (very low) */
  priority?: number;
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
  /** 1 (critical) … 4 (very low) */
  priority?: number;
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

/** What "Hide bugs" and "Show work items without dependencies" do to the graph */
export interface GraphFilter {
  hideBugs: boolean;
  showIsolated: boolean;
}

const BUG_TYPE = 'Bug';

/**
 * Graph after the toggles. The focused work item (the one the map was opened for) is never hidden.
 * - Hide bugs: bugs and their arrows go away.
 * - Without dependencies: unless shown on demand, the work items with no arrow and nothing left to load are hidden.
 *   This is evaluated AFTER hiding the bugs: a work item whose only links were to hidden bugs has no dependency left
 *   to show, so it follows the same rule (hide bugs is meant to declutter; "Show work items without dependencies"
 *   brings it back)
 * `hiddenIsolated` is the number of work items hidden for having no dependencies
 */
export function filterGraph(
  graph: DependencyGraph,
  filter: GraphFilter
): { graph: DependencyGraph; hiddenIsolated: number } {
  const keepFocus = (node: GraphNode) => node.id === graph.focusId;
  const withoutBugs = (nodes: GraphNode[]) =>
    filter.hideBugs ? nodes.filter((node) => node.type !== BUG_TYPE || keepFocus(node)) : nodes;
  const link = (nodes: GraphNode[]) => {
    const ids = new Set(nodes.map((node) => node.id));
    return { nodes, edges: graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to)) };
  };
  const stage = link(withoutBugs(graph.nodes));
  const isolated = filter.showIsolated ? new Set<number>() : isolatedIds(stage);
  isolated.delete(graph.focusId ?? Number.NaN);
  if (stage.nodes.length === graph.nodes.length && !isolated.size) {
    return { graph, hiddenIsolated: 0 };
  }
  const shown = link(stage.nodes.filter((node) => !isolated.has(node.id)));
  return {
    graph: { ...graph, ...shown, columns: visibleColumns(graph.columns, shown.nodes) },
    hiddenIsolated: isolated.size,
  };
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
  /** Group the work items of a lane by state, active work first (see STATE_GROUPS) */
  sortByState?: boolean;
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

/**
 * Order of the states inside a lane with "Sort by state": active work first. Work in progress is what the team
 * looks at, then what is waiting to start; finished work (Ready to Test, Done…) is context and goes after, removed last
 */
const STATE_GROUPS: StateCategory[] = ['in-progress', 'proposed', 'done', 'removed'];
const SWEEPS = 8;
/** Work items without priority go after P4 */
const NO_PRIORITY_RANK = 5;

type Cells = number[][][];

/** Vertical stacking of the lanes of a column. Shared by the ordering (needs the heights) and the final layout */
function stackColumn(column: GraphColumn, laneCells: number[][], options: LayoutOptions) {
  const nodeY = new Map<number, number>();
  const lanes: { laneTop: number; height: number }[] = [];
  let y = options.padding + options.headerHeight;
  laneCells.forEach((ids) => {
    const laneTop = y;
    y += column.kind === 'slot' ? options.laneHeaderHeight : 0;
    ids.forEach((id, row) => nodeY.set(id, y + row * (options.nodeHeight + options.rowGap)));
    y += Math.max(1, ids.length) * (options.nodeHeight + options.rowGap);
    lanes.push({ laneTop, height: y - laneTop });
    y += options.laneGap;
  });
  return { nodeY, lanes, bottom: y };
}

function neighbourMap(edges: GraphEdge[]): Map<number, number[]> {
  const neighbours = new Map<number, number[]>();
  for (const { from, to } of edges) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }
  return neighbours;
}

function initialCells(graph: Pick<DependencyGraph, 'columns' | 'nodes'>): Cells {
  const laneIndex = new Map<string, [number, number]>();
  graph.columns.forEach((column, c) => column.lanes.forEach((lane, l) => laneIndex.set(lane.path, [c, l])));
  const cells: Cells = graph.columns.map((column) => column.lanes.map(() => []));
  for (const node of graph.nodes) {
    const [c, l] = laneIndex.get(node.iterationPath) ?? [];
    if (c !== undefined && l !== undefined) {
      cells[c][l].push(node.id);
    }
  }
  return cells;
}

/**
 * Comparison of two work items of a lane: state group (only "Sort by state"), then the average height of their
 * neighbours (lower first), then priority (P1 first, none last) and finally the ID, so the result is deterministic
 */
function laneComparator(
  nodes: Map<number, GraphNode>,
  weights: Map<number, number>,
  sortByState: boolean
): (a: number, b: number) => number {
  const group = (id: number) => (sortByState ? STATE_GROUPS.indexOf(stateCategory(nodes.get(id)?.state ?? '')) : 0);
  const priority = (id: number) => nodes.get(id)?.priority ?? NO_PRIORITY_RANK;
  // Rounded: sums of the same numbers in a different order must not break a tie
  const weight = (id: number) => Math.round((weights.get(id) ?? 0) * 100);
  return (a, b) => group(a) - group(b) || weight(a) - weight(b) || priority(a) - priority(b) || a - b;
}

/**
 * Orders every lane: the first order is by state group (if enabled), priority and ID; then sweeps alternate left to
 * right and right to left (SWEEPS) placing each work item at the average vertical position (centre of the card, in
 * pixels, with lane headers and gaps) of its neighbours. Pixels instead of row numbers, so lanes of different sizes
 * in different columns do not skew the result
 */
function orderCells(graph: Pick<DependencyGraph, 'columns' | 'edges' | 'nodes'>, options: LayoutOptions): Cells {
  const cells = initialCells(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const neighbours = neighbourMap(graph.edges);
  const centre = new Map<number, number>();
  const stack = (c: number) => {
    const { nodeY } = stackColumn(graph.columns[c], cells[c], options);
    nodeY.forEach((y, id) => centre.set(id, y + options.nodeHeight / 2));
  };
  const sortLanes = (c: number) => {
    for (const ids of cells[c]) {
      const weights = new Map(
        ids.map((id) => {
          const ys = (neighbours.get(id) ?? []).map((n) => centre.get(n) ?? 0);
          return [id, ys.length ? ys.reduce((sum, y) => sum + y, 0) / ys.length : centre.get(id) ?? 0];
        })
      );
      ids.sort(laneComparator(nodes, weights, !!options.sortByState));
    }
    stack(c);
  };
  cells.forEach((lanes) => lanes.forEach((ids) => ids.sort(laneComparator(nodes, new Map(), !!options.sortByState))));
  cells.forEach((_, c) => stack(c));
  const columns = cells.map((_, c) => c);
  for (let pass = 0; pass < SWEEPS; pass++) {
    (pass % 2 ? [...columns].reverse() : columns).forEach(sortLanes);
  }
  return cells;
}

/**
 * One column per time slot (or release), with a lane per sprint stacked vertically. Inside a lane, nodes are
 * ordered to keep related work items at the same height and reduce the crossings of the arrows (see orderCells)
 */
export function layoutGraph(
  graph: Pick<DependencyGraph, 'columns' | 'edges' | 'nodes'>,
  options: LayoutOptions
): GraphLayout {
  const cells = orderCells(graph, options);
  const positions = new Map<number, NodePosition>();
  const lanes: LanePosition[] = [];
  let bottom = options.padding + options.headerHeight;
  cells.forEach((laneCells, column) => {
    const stacked = stackColumn(graph.columns[column], laneCells, options);
    const x = options.padding + column * (options.columnWidth + options.columnGap);
    laneCells.forEach((ids, lane) => {
      const { path, name } = graph.columns[column].lanes[lane];
      const { laneTop, height } = stacked.lanes[lane];
      ids.forEach((id) => positions.set(id, { column, lane, x, y: stacked.nodeY.get(id) ?? 0 }));
      lanes.push({ column, path, name, hasHeader: graph.columns[column].kind === 'slot', y: laneTop, height });
    });
    bottom = Math.max(bottom, stacked.bottom);
  });
  const count = graph.columns.length;
  return {
    positions,
    lanes,
    width: options.padding * 2 + count * options.columnWidth + Math.max(0, count - 1) * options.columnGap,
    height: bottom + options.padding,
  };
}
