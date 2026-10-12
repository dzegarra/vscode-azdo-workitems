import type { DependencyMapMessage, DependencyMapUpdate } from '../dependencyMap';
import type { DependencyGraph, GraphEdge, GraphLayout, GraphNode } from '../dependencyGraph';
import { dependencyChain, filterGraph, layoutGraph } from '../dependencyGraph';
import { escapeHtml } from '../html';
import { typeIcon } from '../icons';
import { DependencyRisk, RISK_DESCRIPTIONS } from '../schedule';
import { stateCategory } from '../states';

interface VsCodeApi {
  postMessage(message: DependencyMapMessage): void;
  getState(): Partial<ViewState> | undefined;
  setState(state: ViewState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface ViewState {
  /** Also my work items without dependencies */
  showIsolated: boolean;
  /** Group the work items of a lane by state, active work first */
  sortByState: boolean;
  /** Hide the Bugs (the focused work item stays) */
  hideBugs: boolean;
  zoom: number;
}

const vscode = acquireVsCodeApi();
const LAYOUT = {
  columnWidth: 230,
  columnGap: 80,
  // Room for two lines of title between the header and the footer
  nodeHeight: 90,
  rowGap: 14,
  headerHeight: 52,
  laneHeaderHeight: 26,
  laneGap: 10,
  padding: 16,
};
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.6;
/** Arrows are drawn in this order, so the riskiest ones stay on top when they overlap */
const RISK_ORDER: DependencyRisk[] = ['done', 'ok', 'unscheduled', 'tight', 'late'];
/** How far the curves go out of the nodes */
const CURVE = 60;

// A "hideDone" saved by a previous version is just an extra property: ignored
const viewState: ViewState = {
  showIsolated: false,
  sortByState: false,
  hideBugs: false,
  zoom: 1,
  ...vscode.getState(),
};
let graph: DependencyGraph | undefined;
let selected: number | undefined;
let focusPending = false;
/** Work item to scroll to as soon as it is rendered and the map is visible (a hidden tab has no size) */
let pendingReveal: number | undefined;
/** Centre the current sprint as soon as the map is rendered and visible (opened without a work item) */
let pendingCurrent = false;

function post(message: DependencyMapMessage): void {
  vscode.postMessage(message);
}

function saveState(): void {
  vscode.setState(viewState);
}

/* ---------- Model ---------- */

/** Graph after the toggles (Hide bugs, work items without dependencies) and the number of work items hidden for having no dependencies */
function visibleGraph(current: DependencyGraph): DependencyGraph {
  return filterGraph(current, viewState).graph;
}

/* ---------- Highlighting ---------- */

function highlight(ids: Set<number> | undefined, className: string): void {
  const canvas = document.getElementById('canvas');
  if (!canvas) {
    return;
  }
  canvas.classList.toggle(className, !!ids);
  canvas.querySelectorAll<HTMLElement>('.node').forEach((node) => {
    node.classList.toggle(`${className}-node`, !!ids?.has(Number(node.dataset.id)));
  });
  canvas.querySelectorAll<SVGPathElement>('.edge').forEach((edge) => {
    const inSet = !!ids?.has(Number(edge.dataset.from)) && ids.has(Number(edge.dataset.to));
    edge.classList.toggle(`${className}-edge`, inSet);
  });
}

/** Click: the whole chain of the work item (what it depends on and what depends on it) */
/** Scrolls the work item to the centre of the map. False when it cannot be done yet */
function revealNode(id: number): boolean {
  const viewport = document.getElementById('viewport');
  const node = document.querySelector(`.node[data-id="${id}"]`);
  if (!viewport || !node || !viewport.clientWidth) {
    return false;
  }
  node.scrollIntoView({ block: 'center', inline: 'center' });
  return true;
}

/** Scrolls the column of the current sprint to the horizontal centre, at the top. False when it cannot be done yet */
function revealCurrentSprint(): boolean {
  const viewport = document.getElementById('viewport');
  if (!viewport || !viewport.clientWidth) {
    return false;
  }
  const column = viewport.querySelector('.column.current');
  if (column) {
    const box = column.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    viewport.scrollLeft += box.left + box.width / 2 - (view.left + view.width / 2);
    viewport.scrollTop = 0;
  }
  // Without a current sprint in the map there is nothing to centre
  return true;
}

function revealPending(): void {
  if (pendingReveal !== undefined && revealNode(pendingReveal)) {
    pendingReveal = undefined;
  }
  if (pendingCurrent && revealCurrentSprint()) {
    pendingCurrent = false;
  }
}

function applySelection(): void {
  highlight(
    selected === undefined || !graph ? undefined : dependencyChain(selected, visibleGraph(graph).edges),
    'selection'
  );
}

/** Hover: the work item and its direct neighbours */
function hover(id: number | undefined): void {
  if (id === undefined || !graph) {
    highlight(undefined, 'hovering');
    return;
  }
  const neighbours = new Set([id]);
  for (const edge of visibleGraph(graph).edges) {
    if (edge.from === id) {
      neighbours.add(edge.to);
    } else if (edge.to === id) {
      neighbours.add(edge.from);
    }
  }
  highlight(neighbours, 'hovering');
}

/* ---------- Geometry ---------- */

interface Box {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scale?: number;
}

/**
 * Geometry is written as a data attribute and applied by applyBoxes: the Content Security Policy
 * of the webview blocks inline style attributes, but not styles set from the script
 */
function box(geometry: Box): string {
  return `data-box='${JSON.stringify(geometry)}'`;
}

function applyBoxes(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>('[data-box]').forEach((element) => {
    const { left, top, width, height, scale } = JSON.parse(element.dataset.box ?? '{}') as Box;
    const px = (value?: number) => (value === undefined ? '' : `${value}px`);
    Object.assign(element.style, { left: px(left), top: px(top), width: px(width), height: px(height) });
    if (scale !== undefined) {
      element.style.transform = `scale(${scale})`;
    }
  });
}

/* ---------- Rendering ---------- */

function formatDate(date?: string): string {
  return date ? new Date(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
}

function renderColumns(current: DependencyGraph, layout: GraphLayout): string {
  return current.columns
    .map((column, index) => {
      const x = LAYOUT.padding + index * (LAYOUT.columnWidth + LAYOUT.columnGap) - LAYOUT.columnGap / 4;
      const isRelease = column.kind === 'container';
      const dates = column.start ? `${formatDate(column.start)} – ${formatDate(column.finish)}` : '';
      const classes = ['column', column.isCurrent ? 'current' : '', isRelease || !column.start ? 'unscheduled' : '']
        .filter(Boolean)
        .join(' ');
      const title = isRelease
        ? `<span class="column-name">${escapeHtml(column.name)}</span>
          <span class="column-dates">Not scheduled in a sprint yet</span>`
        : `<span class="column-name">${escapeHtml(column.name)}</span>
          ${column.isCurrent ? '<span class="pill tone-current">current</span>' : ''}
          <span class="column-dates">${dates}</span>`;
      return `<div class="${classes}"
        ${box({ left: x, width: LAYOUT.columnWidth + LAYOUT.columnGap / 2, height: layout.height })}>
        <div class="column-head" title="${escapeHtml(column.key)}">${title}</div>
      </div>`;
    })
    .join('');
}

/** Name of the sprint above its work items, when several teams share the time slot */
function renderLanes(layout: GraphLayout): string {
  return layout.lanes
    .filter((lane) => lane.hasHeader)
    .map(
      (lane) => `<div class="lane-head" title="${escapeHtml(lane.path)}"
        ${box({
          left: LAYOUT.padding + lane.column * (LAYOUT.columnWidth + LAYOUT.columnGap),
          top: lane.y,
          width: LAYOUT.columnWidth,
          height: LAYOUT.laneHeaderHeight,
        })}>${escapeHtml(lane.name)}</div>`
    )
    .join('');
}

function edgePath(edge: GraphEdge, layout: GraphLayout): string {
  const from = layout.positions.get(edge.from);
  const to = layout.positions.get(edge.to);
  if (!from || !to) {
    return '';
  }
  const width = LAYOUT.columnWidth;
  const y1 = from.y + LAYOUT.nodeHeight / 2;
  const y2 = to.y + LAYOUT.nodeHeight / 2;
  let d: string;
  if (to.column > from.column) {
    // Forward: right side of the predecessor → left side of the successor
    const x1 = from.x + width;
    const x2 = to.x;
    d = `M${x1},${y1} C${x1 + CURVE},${y1} ${x2 - CURVE},${y2} ${x2},${y2}`;
  } else if (to.column === from.column) {
    // Same iteration: a loop on the right side
    const x = from.x + width;
    d = `M${x},${y1} C${x + CURVE},${y1} ${x + CURVE},${y2} ${x},${y2}`;
  } else {
    // Backwards (the predecessor is planned later): left side → right side of the successor
    const x1 = from.x;
    const x2 = to.x + width;
    d = `M${x1},${y1} C${x1 - CURVE},${y1} ${x2 + CURVE},${y2} ${x2},${y2}`;
  }
  return `<path class="edge risk-${edge.risk}" data-from="${edge.from}" data-to="${edge.to}" d="${d}"
    marker-end="url(#arrow-${edge.risk})"><title>${edge.from} → ${edge.to}: ${
    RISK_DESCRIPTIONS[edge.risk]
  }</title></path>`;
}

function renderEdges(current: DependencyGraph, layout: GraphLayout): string {
  const markers = Object.keys(RISK_DESCRIPTIONS)
    .map(
      (risk) => `<marker id="arrow-${risk}" class="arrow risk-${risk}" viewBox="0 0 10 10" refX="9" refY="5"
        markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"/></marker>`
    )
    .join('');
  return `<svg class="edges" width="${layout.width}" height="${layout.height}">
    <defs>${markers}</defs>${[...current.edges]
    .sort((a, b) => RISK_ORDER.indexOf(a.risk) - RISK_ORDER.indexOf(b.risk))
    .map((edge) => edgePath(edge, layout))
    .join('')}</svg>`;
}

/** Same solid pill as the cards of the sidebar (colours in webview.css) */
function renderPriority(node: GraphNode): string {
  return node.priority
    ? `<span class="urgency"><span class="pill urgency-${node.priority}" title="Priority ${node.priority}${
        node.priority === 1 ? ' (critical)' : ''
      }">P${node.priority}</span></span>`
    : '';
}

function renderNode(node: GraphNode, layout: GraphLayout, focusId?: number): string {
  const position = layout.positions.get(node.id);
  if (!position) {
    return '';
  }
  const classes = [
    'node',
    `state-border-${stateCategory(node.state)}`,
    node.isMine ? 'mine' : '',
    // Critical work still to do stands out; a finished P1 keeps only its pill
    node.priority === 1 && !['done', 'removed'].includes(stateCategory(node.state)) ? 'critical' : '',
    node.id === focusId ? 'focus' : '',
  ].join(' ');
  const expand = node.hiddenLinks
    ? `<button class="node-button" data-action="expand" data-id="${node.id}"
        title="Show ${node.hiddenLinks} more dependencies">+${node.hiddenLinks}</button>`
    : '';
  return `<div class="${classes}" data-id="${node.id}" tabindex="0"
      ${box({ left: position.x, top: position.y, width: LAYOUT.columnWidth, height: LAYOUT.nodeHeight })}>
    <div class="node-head">
      ${typeIcon(node.type)}<span class="node-id">${node.id}</span>${renderPriority(node)}
      <span class="state state-${stateCategory(node.state)}">${escapeHtml(node.state)}</span>
    </div>
    <div class="node-title" title="${escapeHtml(node.title)}">${escapeHtml(node.title)}</div>
    <div class="node-foot">
      <span class="assignee" title="${escapeHtml(node.assignedTo ?? 'Unassigned')}">${
    node.isMine ? 'Me' : escapeHtml(node.assignedTo ?? 'Unassigned')
  }</span>
      ${expand}
      <button class="node-button" data-action="openDetails" data-id="${
        node.id
      }" title="Open the Work Item Details panel">Details</button>
    </div>
  </div>`;
}

function renderLegend(): string {
  const risks = (['late', 'tight', 'unscheduled', 'ok', 'done'] as const)
    .map(
      (risk) =>
        `<span class="legend-item"><span class="legend-line risk-${risk}"></span>${RISK_DESCRIPTIONS[risk]}</span>`
    )
    .join('');
  return `<div class="legend">${risks}<span class="legend-item"><span class="legend-mine"></span>Mine</span><span class="legend-item"><span class="legend-critical"></span>P1 critical</span></div>`;
}

function renderToolbar(): string {
  const limbo = graph?.limbo
    ? `<span class="muted limbo-note">${graph.limbo} ${
        graph.limbo === 1 ? 'work item' : 'work items'
      } not planned in a release ${graph.limbo === 1 ? 'is' : 'are'} hidden</span>`
    : '';
  return `<div class="map-toolbar">
    <label class="toggle"><input type="checkbox" id="sort-by-state" ${
      viewState.sortByState ? 'checked' : ''
    }> Sort by state</label>
    <label class="toggle"><input type="checkbox" id="hide-bugs" ${
      viewState.hideBugs ? 'checked' : ''
    }> Hide bugs</label>
    <label class="toggle"><input type="checkbox" id="show-isolated" ${
      viewState.showIsolated ? 'checked' : ''
    }> Show work items without dependencies</label>
    <div class="zoom">
      <button class="button" data-action="zoom-out" title="Zoom out">−</button>
      <span id="zoom-level">${Math.round(viewState.zoom * 100)}%</span>
      <button class="button" data-action="zoom-in" title="Zoom in">+</button>
      <button class="button" data-action="zoom-reset" title="Reset zoom">100%</button>
    </div>
    <button class="button" data-action="refresh">Refresh</button>
    ${limbo}
    ${renderLegend()}
  </div>`;
}

function render(): void {
  const app = document.getElementById('app');
  if (!app || !graph) {
    return;
  }
  const { graph: current, hiddenIsolated: hidden } = filterGraph(graph, viewState);
  const withoutText = `${hidden} work ${hidden === 1 ? 'item has' : 'items have'} no dependencies`;
  if (!current.nodes.length) {
    app.innerHTML = `${renderToolbar()}<p class="message muted">None of your work items in the current iterations has
      predecessors or successors${hidden ? ` (${withoutText}: tick "Show work items without dependencies")` : ''}.</p>`;
    return;
  }
  const layout = layoutGraph(current, { ...LAYOUT, sortByState: viewState.sortByState });
  const note = hidden ? `<p class="muted note">${withoutText} and ${hidden === 1 ? 'is' : 'are'} not shown.</p>` : '';
  // Redrawing replaces the viewport: keep where the user was looking
  const previous = document.getElementById('viewport');
  const scroll = previous ? { left: previous.scrollLeft, top: previous.scrollTop } : undefined;
  app.innerHTML = `${renderToolbar()}${note}
    <div class="viewport" id="viewport">
      <div class="canvas-size" ${box({ width: layout.width * viewState.zoom, height: layout.height * viewState.zoom })}>
        <div class="canvas" id="canvas" ${box({ width: layout.width, height: layout.height, scale: viewState.zoom })}>
          ${renderColumns(current, layout)}
          ${renderLanes(layout)}
          ${renderEdges(current, layout)}
          ${current.nodes.map((node) => renderNode(node, layout, current.focusId)).join('')}
        </div>
      </div>
    </div>`;
  applyBoxes(app);
  const viewport = document.getElementById('viewport');
  if (viewport && scroll) {
    viewport.scrollLeft = scroll.left;
    viewport.scrollTop = scroll.top;
  }
  applySelection();
  if (focusPending && current.focusId !== undefined) {
    focusPending = false;
    selected = current.focusId;
    applySelection();
    pendingReveal = current.focusId;
  }
  requestAnimationFrame(revealPending);
}

/* ---------- Events ---------- */

function setZoom(zoom: number): void {
  viewState.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 10) / 10));
  saveState();
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLElement>('[data-action]');
  const action = button?.dataset.action;
  const id = Number(button?.dataset.id);
  if (action === 'expand' || action === 'openDetails') {
    post({ type: action, id });
  } else if (action === 'refresh') {
    post({ type: 'refresh' });
  } else if (action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-reset') {
    setZoom(action === 'zoom-reset' ? 1 : viewState.zoom + (action === 'zoom-in' ? ZOOM_STEP : -ZOOM_STEP));
  } else if (!button) {
    const node = target.closest<HTMLElement>('.node');
    const nodeId = node ? Number(node.dataset.id) : undefined;
    selected = nodeId === undefined || nodeId === selected ? undefined : nodeId;
    applySelection();
  }
});

document.addEventListener('dblclick', (event) => {
  const node = (event.target as HTMLElement).closest<HTMLElement>('.node');
  if (node) {
    post({ type: 'openDetails', id: Number(node.dataset.id) });
  }
});

document.addEventListener('change', (event) => {
  const { id, checked } = event.target as HTMLInputElement;
  if (id === 'sort-by-state') {
    viewState.sortByState = checked;
  } else if (id === 'hide-bugs') {
    viewState.hideBugs = checked;
  } else if (id === 'show-isolated') {
    viewState.showIsolated = checked;
  } else {
    return;
  }
  saveState();
  render();
});

document.addEventListener('mouseover', (event) => {
  const node = (event.target as HTMLElement).closest<HTMLElement>('.node');
  hover(node ? Number(node.dataset.id) : undefined);
});

document.addEventListener(
  'wheel',
  (event) => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      setZoom(viewState.zoom + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
    }
  },
  { passive: false }
);

// Drag the background to move around the map
let drag: { x: number; y: number; left: number; top: number } | undefined;
document.addEventListener('mousedown', (event) => {
  const viewport = document.getElementById('viewport');
  const target = event.target as HTMLElement;
  if (viewport?.contains(target) && !target.closest('.node')) {
    drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.classList.add('dragging');
  }
});
document.addEventListener('mousemove', (event) => {
  const viewport = document.getElementById('viewport');
  if (drag && viewport) {
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  }
});
document.addEventListener('mouseup', () => {
  drag = undefined;
  document.getElementById('viewport')?.classList.remove('dragging');
});

window.addEventListener('message', ({ data }: MessageEvent<DependencyMapUpdate>) => {
  const app = document.getElementById('app');
  if (data.type === 'graph') {
    focusPending = data.graph.focusId !== undefined && data.graph.focusId !== graph?.focusId;
    ({ graph } = data);
    render();
  } else if (data.type === 'showCurrent') {
    pendingCurrent = true;
    requestAnimationFrame(revealPending);
  } else if (data.type === 'focus') {
    pendingCurrent = false;
    selected = data.id;
    applySelection();
    pendingReveal = data.id;
    requestAnimationFrame(revealPending);
  } else if (data.type === 'error' && app) {
    app.innerHTML = `${renderToolbar()}<p class="message error">${escapeHtml(data.message)}</p>`;
  } else if (data.type === 'loading' && app && !graph) {
    app.innerHTML = '<p class="message muted">Loading dependencies…</p>';
  }
});

// A tab that was hidden gets its size when shown: scroll to the pending work item then
window.addEventListener('resize', revealPending);

post({ type: 'ready' });
