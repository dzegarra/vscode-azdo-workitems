import { escapeHtml } from '../html';
import { icon, typeIcon } from '../icons';
import { sortByState, stateCategory, stateRank } from '../states';
import type {
  ExtensionMessage,
  FilterModel,
  IterationModel,
  PullRequestModel,
  ViewModel,
  WebviewMessage,
  WorkItemModel,
} from '../viewModel';
import { isVisible, NO_PULL_REQUEST, pullRequestFilterValue } from '../viewModel';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): { search?: string } | undefined;
  setState(state: { search: string }): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

type FilterKind = 'pullRequest' | 'state' | 'type';

const vscode = acquireVsCodeApi();
let model: ViewModel | undefined;
let search = vscode.getState()?.search ?? '';

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
  const { filter, stateOrder, workItems } = current;
  const types = countBy(workItems, (item) => item.type);
  const states = countBy(workItems, (item) => item.state);
  const pullRequests = countBy(workItems, pullRequestFilterValue);
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
  ].join('');
}

function toggle(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

/* ---------- Cards ---------- */

function renderPullRequest(item: WorkItemModel, pr: PullRequestModel): string {
  return `<div class="row pr">
    ${icon('pullRequest')}
    <button class="link" data-action="openPullRequest" data-id="${item.id}" data-pr="${pr.id}"
      title="${escapeHtml(pr.title)}">PR ${pr.id}</button>
    <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span>
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
  actions.push(
    `<button class="button ghost" data-action="openDetails" data-id="${item.id}" title="Show the details of the work item">Open</button>`
  );
  return `<footer class="actions">${actions.join('')}</footer>`;
}

function stateLabel(state: string): string {
  return `<span class="state state-${stateCategory(state)}">${escapeHtml(state)}</span>`;
}

function renderChild(item: WorkItemModel): string {
  return `<li class="child">
    ${typeIcon(item.type)}
    <button class="link id" data-action="openDetails" data-id="${item.id}" title="Show details">${item.id}</button>
    <span class="child-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
    ${stateLabel(item.state)}
  </li>`;
}

function renderRelations(item: WorkItemModel, visibleIds: Set<number>): string {
  const relations: string[] = [];
  if (item.childCount) {
    relations.push(
      `<span class="pill tone-neutral" title="Parent of ${item.childCount} work items">${icon('children')}${
        item.childCount
      } ${item.childCount === 1 ? 'child' : 'children'}</span>`
    );
  }
  if (item.parentId && !visibleIds.has(item.parentId)) {
    relations.push(
      `<span class="pill tone-neutral" title="Child of ${item.parentId}">${icon('parent')}${item.parentId}</span>`
    );
  }
  return relations.length ? `<div class="relations">${relations.join('')}</div>` : '';
}

function renderCard(item: WorkItemModel, children: WorkItemModel[], visibleIds: Set<number>): string {
  return `<article class="card state-border-${stateCategory(item.state)}${item.isCurrentBranch ? ' current' : ''}">
    <header class="card-head">
      ${typeIcon(item.type)}
      <button class="link id" data-action="openWorkItem" data-id="${item.id}" title="Open in Azure DevOps">${
    item.id
  }</button>
      <span class="type">${escapeHtml(item.type)}</span>
      ${stateLabel(item.state)}
    </header>
    <div class="title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
    ${renderRelations(item, visibleIds)}
    ${renderBranch(item)}
    ${item.pullRequests.map((pr) => renderPullRequest(item, pr)).join('')}
    ${renderActions(item)}
    ${children.length ? `<ul class="children">${children.map(renderChild).join('')}</ul>` : ''}
  </article>`;
}

/** Cards of the visible items. Children whose parent is visible are nested in the parent card */
function renderCards(items: WorkItemModel[]): string {
  const visibleIds = new Set(items.map((item) => item.id));
  const isNested = (item: WorkItemModel) => item.parentId !== undefined && visibleIds.has(item.parentId);
  return items
    .filter((item) => !isNested(item))
    .map((item) =>
      renderCard(
        item,
        items.filter((child) => child.parentId === item.id),
        visibleIds
      )
    )
    .join('');
}

function renderIteration(iteration: IterationModel, items: WorkItemModel[]): string {
  return `<section class="iteration">
    <h2 title="${escapeHtml(iteration.path)}">${escapeHtml(iteration.name)}
      <span class="teams">${escapeHtml(iteration.teams.join(', '))}</span></h2>
    ${items.length ? renderCards(items) : '<p class="muted empty">Nothing to show</p>'}
  </section>`;
}

function renderList(current: ViewModel): string {
  if (current.status === 'error') {
    return `<div class="message error"><p>${escapeHtml(current.error ?? 'Unknown error')}</p>
      <button class="button primary" data-action="refresh">Retry</button></div>`;
  }
  if (current.status === 'loading' && !current.workItems.length) {
    return '<p class="message muted">Loading work items…</p>';
  }
  if (!current.workItems.length) {
    return '<p class="message muted">No work items assigned to you in the current iterations of your teams.</p>';
  }
  const visible = sortByState(
    current.workItems.filter((item) => isVisible(item, current.filter, search)),
    current.stateOrder
  );
  const hidden = current.workItems.length - visible.length;
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
              visible.filter((item) => item.iterationPath === iteration.path)
            )
          )
          .join('')
      : renderCards(visible) || '<p class="message muted">No work items match the filters.</p>';
  return body + hiddenNote;
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
      vscode.setState({ search });
      render();
    });
  }
  (app.querySelector('.progress') as HTMLElement).hidden = model.status !== 'loading';
  (document.getElementById('filters') as HTMLElement).innerHTML = model.workItems.length ? renderFilters(model) : '';
  (document.getElementById('list') as HTMLElement).innerHTML = renderList(model);
}

function toggleFilter(kind: FilterKind, value: string): void {
  if (!model) {
    return;
  }
  const filter = { ...model.filter };
  if (kind === 'type') {
    const allTypes = [...new Set(model.workItems.map((item) => item.type))];
    filter.types = toggle(
      allTypes.filter((type) => isTypeShown(filter, type)),
      value
    );
  } else if (kind === 'state') {
    filter.hiddenStates = toggle(filter.hiddenStates, value);
  } else {
    filter.hiddenPullRequestStates = toggle(filter.hiddenPullRequestStates, value);
  }
  // Render right away; the extension saves the filter and sends the state back
  model = { ...model, filter };
  render();
  post({ type: 'setFilter', filter });
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-filter]');
  if (!target) {
    return;
  }
  const { action, filter, value, id, pr } = target.dataset;
  if (filter && value !== undefined) {
    toggleFilter(filter as FilterKind, value);
  } else if (action === 'refresh') {
    post({ type: 'refresh' });
  } else if (action && id) {
    post({
      type: action as Extract<WebviewMessage, { id: number }>['type'],
      id: Number(id),
      pullRequestId: pr ? Number(pr) : undefined,
    });
  }
});

window.addEventListener('message', ({ data }: MessageEvent<ExtensionMessage>) => {
  ({ model } = data);
  render();
});

post({ type: 'ready' });
