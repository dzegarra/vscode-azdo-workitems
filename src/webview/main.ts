import { canHaveTasks, escapeHtml, stateButton } from '../html';
import { ICONS, icon, typeIcon } from '../icons';
import { describeRun, RunState } from '../pipelines';
import { NO_PRIORITY, priorityFilterValue, severityLevel, severityName, sortWorkItems } from '../priority';
import { stateCategory, stateRank } from '../states';
import type {
  ExtensionMessage,
  FilterModel,
  IterationModel,
  PullRequestModel,
  ViewModel,
  WebviewMessage,
  WorkItemModel,
} from '../viewModel';
import { changedFilterKeys, isVisible, NO_PULL_REQUEST, pullRequestFilterValue } from '../viewModel';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): { search?: string; onlyAlerts?: boolean } | undefined;
  setState(state: { search: string; onlyAlerts: boolean }): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

type FilterKind = 'priority' | 'pullRequest' | 'state' | 'type';

const vscode = acquireVsCodeApi();
/** Toggling several chips quickly saves the filter only once */
const SAVE_FILTER_DELAY_MS = 400;
let saveFilterTimer: ReturnType<typeof setTimeout> | undefined;
/** Filter chosen by the user and not saved yet */
let pendingFilter: FilterModel | undefined;
let model: ViewModel | undefined;
const savedState = vscode.getState();
let search = savedState?.search ?? '';
/** Show only the work items with alerts */
let onlyAlerts = savedState?.onlyAlerts ?? false;

function saveState(): void {
  vscode.setState({ search, onlyAlerts });
}

/** Order of the PR states in the filter */
const PULL_REQUEST_ORDER = [
  NO_PULL_REQUEST,
  'Draft',
  'Waiting for review',
  'Waiting for author',
  'Conflicts',
  'Rejected',
  'Approved with suggestions',
  'Approved',
  'Completed',
  'Abandoned',
];

function post(message: WebviewMessage): void {
  vscode.postMessage(message);
}

/**
 * Work items shown as cards. Tasks are never planned alone: they are only shown nested in the card
 * of their Backlog Item / Bug, so they are not cards nor part of the filters
 */
function cardItems(current: ViewModel): WorkItemModel[] {
  return current.workItems.filter((item) => canHaveTasks(item.type));
}

/* ---------- Filters ---------- */

function countBy(items: WorkItemModel[], key: (item: WorkItemModel) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }
  return counts;
}

function isTypeShown(filter: FilterModel, type: string): boolean {
  return !filter.types.length || filter.types.includes(type);
}

function chip(kind: FilterKind, value: string, count: number, pressed: boolean): string {
  return `<button class="chip" data-filter="${kind}" data-value="${escapeHtml(value)}" aria-pressed="${pressed}">
    ${escapeHtml(value)} <span class="count">${count}</span></button>`;
}

function filterRow(label: string, chips: string[]): string {
  return `<div class="filter-row" role="group" aria-label="${label}">
    <span class="filter-label">${label}</span>${chips.join('')}</div>`;
}

function renderFilters(current: ViewModel): string {
  const { filter, stateOrder } = current;
  const workItems = cardItems(current);
  const types = countBy(workItems, (item) => item.type);
  const states = countBy(workItems, (item) => item.state);
  const pullRequests = countBy(workItems, pullRequestFilterValue);
  const priorities = countBy(workItems, priorityFilterValue);
  // P1 … P4, then the work items without priority
  const sortedPriorities = [...priorities.keys()].sort(
    (a, b) => Number(a === NO_PRIORITY) - Number(b === NO_PRIORITY) || a.localeCompare(b)
  );
  const sortedStates = [...states.keys()].sort(
    (a, b) => stateRank(a, stateOrder) - stateRank(b, stateOrder) || a.localeCompare(b)
  );
  const sortedPullRequests = [...pullRequests.keys()].sort(
    (a, b) => stateRank(a, PULL_REQUEST_ORDER) - stateRank(b, PULL_REQUEST_ORDER)
  );
  return [
    filterRow(
      'Type',
      [...types].map(([type, count]) => chip('type', type, count, isTypeShown(filter, type)))
    ),
    filterRow(
      'State',
      sortedStates.map((state) => chip('state', state, states.get(state) ?? 0, !filter.hiddenStates.includes(state)))
    ),
    filterRow(
      'PR',
      sortedPullRequests.map((status) =>
        chip('pullRequest', status, pullRequests.get(status) ?? 0, !filter.hiddenPullRequestStates.includes(status))
      )
    ),
    filterRow(
      'Priority',
      sortedPriorities.map((priority) =>
        chip('priority', priority, priorities.get(priority) ?? 0, !filter.hiddenPriorities.includes(priority))
      )
    ),
  ].join('');
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/* ---------- Cards ---------- */

const RUN_ICONS: Record<RunState, keyof typeof ICONS> = {
  queued: 'clock',
  running: 'sync',
  succeeded: 'check',
  partial: 'warning',
  failed: 'error',
  canceled: 'stop',
};

/** Last CI run of each pipeline validating the PR. Clicking one opens it in Azure DevOps */
function renderRuns(item: WorkItemModel, pr: PullRequestModel): string {
  if (!pr.isActive || !pr.runs.length) {
    return '';
  }
  const now = new Date();
  const runs = pr.runs.map(
    (run) => `<button class="run run-${run.state}" data-action="openRun" data-id="${item.id}" data-run="${run.id}"
      title="${escapeHtml(`${run.pipeline}: ${describeRun(run, now)}`)}">
      ${icon(RUN_ICONS[run.state], run.state === 'running' ? 'spin' : '')}<span>${escapeHtml(
      describeRun(run, now)
    )}</span>
    </button>`
  );
  return `<div class="runs">${runs.join('')}</div>`;
}

function renderPullRequest(item: WorkItemModel, pr: PullRequestModel): string {
  return `<div class="row pr">
    ${icon('pullRequest')}
    <button class="link" data-action="openPullRequest" data-id="${item.id}" data-pr="${pr.id}"
      title="${escapeHtml(pr.title)}">PR ${pr.id}</button>
    <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span>
    ${renderRuns(item, pr)}
  </div>`;
}

function renderBranch(item: WorkItemModel): string {
  if (!item.branch) {
    return `<div class="row muted">${icon('branch')}<span>No branch</span></div>`;
  }
  const location = item.isCurrentBranch ? 'current' : item.branchLocation ?? 'remote';
  return `<div class="row branch">${icon('branch')}
    <code title="${escapeHtml(item.branch)}">${escapeHtml(item.branch)}</code>
    <span class="pill tone-${location}">${location}</span></div>`;
}

function renderActions(item: WorkItemModel): string {
  const actions: string[] = [];
  if (!item.branch) {
    actions.push(
      `<button class="button primary" data-action="createBranch" data-id="${item.id}">Create branch</button>`
    );
  } else if (!item.isCurrentBranch) {
    actions.push(`<button class="button" data-action="checkout" data-id="${item.id}">Checkout</button>`);
  }
  if (item.branch && !item.pullRequests.some((pr) => pr.isActive)) {
    actions.push(
      `<button class="button primary" data-action="createPullRequest" data-id="${item.id}">Create PR</button>`
    );
  }
  if (canHaveTasks(item.type)) {
    actions.push(
      `<button class="button ghost" data-action="addTask" data-id="${item.id}" title="Create a task under this work item">Add task</button>`
    );
  }
  actions.push(
    `<button class="button ghost" data-action="openDetails" data-id="${item.id}" title="Show the details of the work item">Open</button>`
  );
  return `<footer class="actions">${actions.join('')}</footer>`;
}

function renderChild(item: WorkItemModel): string {
  return `<li class="child">
    ${typeIcon(item.type)}
    <button class="link id" data-action="openDetails" data-id="${item.id}" title="Show details">${item.id}</button>
    <span class="child-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
    ${stateButton(item.id, item.state)}
  </li>`;
}

/**
 * Priority and severity pills. They replace the type label of the header: the icon already shows the type.
 * Colours go from red (1, most urgent) to grey (4)
 */
function renderUrgency(item: WorkItemModel): string {
  const pills: string[] = [];
  if (item.priority) {
    pills.push(
      `<span class="pill urgency-${item.priority}" title="${escapeHtml(item.type)} · Priority ${item.priority}">P${
        item.priority
      }</span>`
    );
  }
  const level = severityLevel(item.severity);
  if (item.severity) {
    pills.push(
      `<span class="pill urgency-${level ?? 'none'}" title="Severity ${escapeHtml(item.severity)}">${
        level ? `S${level} ` : ''
      }${escapeHtml(severityName(item.severity))}</span>`
    );
  }
  return `<span class="urgency" title="${escapeHtml(item.type)}">${pills.join('')}</span>`;
}

/** Problems the developers must fix ASAP */
function renderAlerts(item: WorkItemModel): string {
  if (!item.alerts.length) {
    return '';
  }
  const alerts = item.alerts.map((alert) => {
    let fix = '';
    if (alert.action === 'fillIntegrationBuild') {
      fix = ` <button class="link" data-action="fillIntegrationBuild" data-id="${item.id}" title="Use the last release of the deploy image">Fill</button>`;
    } else if (alert.relatedId) {
      fix = ` <button class="link" data-action="changeState" data-id="${alert.relatedId}" title="Change the state of ${alert.relatedId}">Fix</button>`;
    }
    return `<li>${icon('warning')}<span>${escapeHtml(alert.message)}${fix}</span></li>`;
  });
  return `<ul class="alerts" aria-label="Problems to fix">${alerts.join('')}</ul>`;
}

/** Parent of the work item, when it is not the card the work item is nested in */
function renderParent(item: WorkItemModel, visibleIds: Set<number>): string {
  if (item.parentId === undefined || visibleIds.has(item.parentId)) {
    return '';
  }
  const title = item.parent ? ` ${escapeHtml(item.parent.title)}` : '';
  const tooltip = item.parent
    ? `${item.parent.type} ${item.parentId}: ${item.parent.title}`
    : `Parent ${item.parentId}`;
  return `<button class="parent-link" data-action="openDetails" data-id="${item.parentId}" title="${escapeHtml(
    tooltip
  )}">
    ${icon('parent')}<span class="parent-id">${
    item.parentId
  }</span><span class="parent-title">${title}</span></button>`;
}

function renderCard(item: WorkItemModel, children: WorkItemModel[], visibleIds: Set<number>): string {
  const classes = [
    'card',
    `state-border-${stateCategory(item.state)}`,
    item.isCurrentBranch ? 'current' : '',
    item.alerts.length ? 'has-alerts' : '',
  ].join(' ');
  return `<article class="${classes}">
    <header class="card-head">
      ${typeIcon(item.type)}
      <button class="link id" data-action="openWorkItem" data-id="${item.id}" title="Open in Azure DevOps">${
    item.id
  }</button>
      ${renderUrgency(item)}
      ${stateButton(item.id, item.state)}
    </header>
    <div class="title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
    ${renderParent(item, visibleIds)}
    ${renderAlerts(item)}
    ${renderBranch(item)}
    ${item.pullRequests.map((pr) => renderPullRequest(item, pr)).join('')}
    ${renderActions(item)}
    ${children.length ? `<ul class="children">${children.map(renderChild).join('')}</ul>` : ''}
  </article>`;
}

/**
 * Cards of the visible items. Children of a visible item are nested in its card, whatever the type filter,
 * so the tasks of a Backlog Item / Bug can be managed while Tasks are filtered out
 */
function renderCards(items: WorkItemModel[], current: ViewModel): string {
  const visibleIds = new Set(items.map((item) => item.id));
  const childFilter = { ...current.filter, types: [] };
  const childrenOf = (parent: WorkItemModel) =>
    sortWorkItems(
      current.workItems.filter((child) => child.parentId === parent.id && isVisible(child, childFilter)),
      current.stateOrder
    );
  return items
    .filter((item) => item.parentId === undefined || !visibleIds.has(item.parentId))
    .map((item) => renderCard(item, childrenOf(item), visibleIds))
    .join('');
}

function renderIteration(iteration: IterationModel, items: WorkItemModel[], current: ViewModel): string {
  return `<section class="iteration">
    <h2 title="${escapeHtml(iteration.path)}">${escapeHtml(iteration.name)}
      <span class="teams">${escapeHtml(iteration.teams.join(', '))}</span></h2>
    ${items.length ? renderCards(items, current) : '<p class="muted empty">Nothing to show</p>'}
  </section>`;
}

/** Summary of the work items with problems, with a toggle to show only them */
function renderAlertsBanner(current: ViewModel): string {
  const count = cardItems(current).filter((item) => item.alerts.length).length;
  if (!count && !onlyAlerts) {
    return '';
  }
  const label = count === 1 ? '1 work item needs attention' : `${count} work items need attention`;
  return `<div class="alerts-banner${count ? '' : ' resolved'}" role="status">
    ${icon('warning')}<span>${count ? label : 'No work items need attention'}</span>
    <button class="button small" data-action="toggleAlerts">${onlyAlerts ? 'Show all' : 'Show only these'}</button>
  </div>`;
}

function renderList(current: ViewModel): string {
  if (current.status === 'error') {
    return `<div class="message error"><p>${escapeHtml(current.error ?? 'Unknown error')}</p>
      <button class="button primary" data-action="refresh">Retry</button></div>`;
  }
  const cards = cardItems(current);
  if (current.status === 'loading' && !cards.length) {
    return '<p class="message muted">Loading work items…</p>';
  }
  if (!cards.length) {
    return '<p class="message muted">No work items assigned to you in the current iterations of your teams.</p>';
  }
  const visible = sortWorkItems(
    cards.filter((item) => isVisible(item, current.filter, search) && (!onlyAlerts || item.alerts.length > 0)),
    current.stateOrder
  );
  const hidden = cards.length - visible.length;
  const hiddenNote = hidden
    ? `<p class="muted note">${hidden} work item${hidden === 1 ? '' : 's'} hidden by filters</p>`
    : '';
  // Group by iteration only when the teams are in different sprints
  const body =
    current.iterations.length > 1
      ? current.iterations
          .map((iteration) =>
            renderIteration(
              iteration,
              visible.filter((item) => item.iterationPath === iteration.path),
              current
            )
          )
          .join('')
      : renderCards(visible, current) || '<p class="message muted">No work items match the filters.</p>';
  return renderAlertsBanner(current) + body + hiddenNote;
}

/* ---------- Page ---------- */

function render(): void {
  const app = document.getElementById('app');
  if (!app || !model) {
    return;
  }
  if (!app.childElementCount) {
    app.innerHTML = `<div class="toolbar">
        <input id="search" type="search" placeholder="Search by ID, title or branch" aria-label="Search work items">
      </div>
      <div class="progress" hidden></div>
      <div id="filters" class="filters"></div>
      <div id="list" class="list"></div>`;
    const input = document.getElementById('search') as HTMLInputElement;
    input.value = search;
    input.addEventListener('input', () => {
      search = input.value;
      saveState();
      render();
    });
  }
  (app.querySelector('.progress') as HTMLElement).hidden = model.status !== 'loading';
  (document.getElementById('filters') as HTMLElement).innerHTML = cardItems(model).length ? renderFilters(model) : '';
  (document.getElementById('list') as HTMLElement).innerHTML = renderList(model);
}

function toggleFilter(kind: FilterKind, value: string): void {
  if (!model) {
    return;
  }
  const filter = { ...model.filter };
  if (kind === 'type') {
    const allTypes = [...new Set(cardItems(model).map((item) => item.type))];
    filter.types = toggle(
      allTypes.filter((type) => isTypeShown(filter, type)),
      value
    );
  } else if (kind === 'state') {
    filter.hiddenStates = toggle(filter.hiddenStates, value);
  } else if (kind === 'priority') {
    filter.hiddenPriorities = toggle(filter.hiddenPriorities, value);
  } else {
    filter.hiddenPullRequestStates = toggle(filter.hiddenPullRequestStates, value);
  }
  // Render right away, and save once the user stops clicking
  model = { ...model, filter };
  pendingFilter = filter;
  render();
  clearTimeout(saveFilterTimer);
  saveFilterTimer = setTimeout(() => post({ type: 'setFilter', filter }), SAVE_FILTER_DELAY_MS);
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-filter]');
  if (!target) {
    return;
  }
  const { action, filter, value, id, pr, run } = target.dataset;
  if (filter && value !== undefined) {
    toggleFilter(filter as FilterKind, value);
  } else if (action === 'refresh') {
    post({ type: 'refresh' });
  } else if (action === 'toggleAlerts') {
    onlyAlerts = !onlyAlerts;
    saveState();
    render();
  } else if (action && id) {
    post({
      type: action as Extract<WebviewMessage, { id: number }>['type'],
      id: Number(id),
      pullRequestId: pr ? Number(pr) : undefined,
      runId: run ? Number(run) : undefined,
    });
  }
});

window.addEventListener('message', ({ data }: MessageEvent<ExtensionMessage>) => {
  // While the last filter is not saved, the extension still sends older filters: keep the user's one
  if (pendingFilter && changedFilterKeys(data.model.filter, pendingFilter).length) {
    model = { ...data.model, filter: pendingFilter };
  } else {
    pendingFilter = undefined;
    ({ model } = data);
  }
  render();
});

post({ type: 'ready' });
