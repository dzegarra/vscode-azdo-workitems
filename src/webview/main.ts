import type {
  ExtensionMessage,
  FilterModel,
  IterationModel,
  PullRequestModel,
  ViewModel,
  WebviewMessage,
  WorkItemModel,
} from '../viewModel';
import { isVisible } from '../viewModel';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): { search?: string } | undefined;
  setState(state: { search: string }): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
let model: ViewModel | undefined;
let search = vscode.getState()?.search ?? '';

const ICONS = {
  bug: '<path d="M8 2.5a2.5 2.5 0 0 0-2.4 1.8A4 4 0 0 0 4 7.5V10a4 4 0 0 0 8 0V7.5a4 4 0 0 0-1.6-3.2A2.5 2.5 0 0 0 8 2.5zM2 8h2m8 0h2M2.5 12.5 4.3 11m9.2 1.5L11.7 11M2.5 4l1.8 1.4M13.5 4l-1.8 1.4M8 6v8"/>',
  book: '<path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2zM3 11.5a2 2 0 0 1 2-2h7.5"/>',
  task: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="m5 8 2 2 4-4"/>',
  item: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/>',
  branch:
    '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.5 4"/>',
  pullRequest:
    '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7m1.5-2-2 2 2 2"/>',
  children:
    '<path d="M3 2.5v9a1.5 1.5 0 0 0 1.5 1.5H8M3 6.5h5"/><rect x="9" y="4.5" width="4.5" height="4" rx="1"/><rect x="9" y="11" width="4.5" height="4" rx="1"/>',
  parent: '<path d="M8 13.5v-11M4 6.5l4-4 4 4"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
};

function icon(name: keyof typeof ICONS, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char)
  );
}

const TYPE_ICONS: Partial<Record<string, keyof typeof ICONS>> = {
  Bug: 'bug',
  'Product Backlog Item': 'book',
  'User Story': 'book',
  Task: 'task',
};

const TYPE_CLASSES: Partial<Record<string, string>> = {
  Bug: 'type-bug',
  'Product Backlog Item': 'type-backlog',
  'User Story': 'type-backlog',
  Task: 'type-task',
  Feature: 'type-feature',
};

/** Order of the states in the filter, following the usual Scrum workflow */
const STATE_ORDER = [
  'New',
  'Approved',
  'To Do',
  'Committed',
  'In Progress',
  'Active',
  'Resolved',
  'Done',
  'Closed',
  'Removed',
];

/** Known states first, in workflow order; unknown ones at the end */
function stateRank(state: string): number {
  const index = STATE_ORDER.indexOf(state);
  return index === -1 ? STATE_ORDER.length : index;
}

function stateCategory(state: string): string {
  if (['Committed', 'In Progress', 'Active'].includes(state)) {
    return 'in-progress';
  }
  if (['Done', 'Closed', 'Resolved'].includes(state)) {
    return 'done';
  }
  return state === 'Removed' ? 'removed' : 'proposed';
}

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

function chip(kind: 'state' | 'type', value: string, count: number, pressed: boolean): string {
  return `<button class="chip" data-filter="${kind}" data-value="${escapeHtml(value)}" aria-pressed="${pressed}">
    ${escapeHtml(value)} <span class="count">${count}</span></button>`;
}

function renderFilters(current: ViewModel): string {
  const types = countBy(current.workItems, (item) => item.type);
  const states = countBy(current.workItems, (item) => item.state);
  const orderedStates = [...states.keys()].sort((a, b) => stateRank(a) - stateRank(b) || a.localeCompare(b));
  const typeChips = [...types].map(([type, count]) => chip('type', type, count, isTypeShown(current.filter, type)));
  const stateChips = orderedStates.map((state) =>
    chip('state', state, states.get(state) ?? 0, !current.filter.hiddenStates.includes(state))
  );
  return `<div class="filter-row" role="group" aria-label="Type"><span class="filter-label">Type</span>${typeChips.join(
    ''
  )}</div>
    <div class="filter-row" role="group" aria-label="State"><span class="filter-label">State</span>${stateChips.join(
      ''
    )}</div>`;
}

/* ---------- Cards ---------- */

function renderPullRequest(item: WorkItemModel, pr: PullRequestModel): string {
  return `<div class="row pr">
    ${icon('pullRequest')}
    <button class="link" data-action="openPullRequest" data-id="${item.id}" data-pr="${pr.id}" title="${escapeHtml(
    pr.title
  )}">PR ${pr.id}</button>
    <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span>
  </div>`;
}

function renderBranch(item: WorkItemModel): string {
  if (!item.branch) {
    return `<div class="row muted">${icon('branch')}<span>No branch</span></div>`;
  }
  const location = item.isCurrentBranch
    ? '<span class="pill tone-current">current</span>'
    : `<span class="pill tone-${item.branchLocation === 'local' ? 'local' : 'remote'}">${
        item.branchLocation ?? ''
      }</span>`;
  return `<div class="row branch">${icon('branch')}<code title="${escapeHtml(item.branch)}">${escapeHtml(
    item.branch
  )}</code>${location}</div>`;
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
    `<button class="button ghost" data-action="copyId" data-id="${item.id}" title="Copy ID">Copy ID</button>`
  );
  return `<footer class="actions">${actions.join('')}</footer>`;
}

function renderChild(item: WorkItemModel): string {
  return `<li class="child">
    ${icon(TYPE_ICONS[item.type] ?? 'item', TYPE_CLASSES[item.type] ?? '')}
    <button class="link id" data-action="openWorkItem" data-id="${item.id}">${item.id}</button>
    <span class="child-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
    <span class="state state-${stateCategory(item.state)}">${escapeHtml(item.state)}</span>
  </li>`;
}

function renderCard(item: WorkItemModel, children: WorkItemModel[], visibleIds: Set<number>): string {
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
  return `<article class="card state-border-${stateCategory(item.state)}${item.isCurrentBranch ? ' current' : ''}">
    <header class="card-head">
      ${icon(TYPE_ICONS[item.type] ?? 'item', TYPE_CLASSES[item.type] ?? '')}
      <button class="link id" data-action="openWorkItem" data-id="${item.id}" title="Open in Azure DevOps">${
    item.id
  }</button>
      <span class="type">${escapeHtml(item.type)}</span>
      <span class="state state-${stateCategory(item.state)}">${escapeHtml(item.state)}</span>
    </header>
    <div class="title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
    ${relations.length ? `<div class="relations">${relations.join('')}</div>` : ''}
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
  const visible = current.workItems.filter((item) => isVisible(item, current.filter, search));
  const hidden = current.workItems.length - visible.length;
  const hiddenNote = hidden
    ? `<p class="muted note">${hidden} work item${hidden === 1 ? '' : 's'} hidden by filters</p>`
    : '';
  if (!current.workItems.length) {
    return '<p class="message muted">No work items assigned to you in the current iterations of your teams.</p>';
  }
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

function toggleFilter(kind: string, value: string): void {
  if (!model) {
    return;
  }
  const filter = { ...model.filter };
  if (kind === 'type') {
    const allTypes = [...new Set(model.workItems.map((item) => item.type))];
    const shown = allTypes.filter((type) => isTypeShown(filter, type));
    filter.types = shown.includes(value) ? shown.filter((type) => type !== value) : [...shown, value];
  } else {
    filter.hiddenStates = filter.hiddenStates.includes(value)
      ? filter.hiddenStates.filter((state) => state !== value)
      : [...filter.hiddenStates, value];
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
    toggleFilter(filter, value);
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
