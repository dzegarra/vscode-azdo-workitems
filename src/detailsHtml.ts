/** Body of the work item details panel. Pure, so no "vscode" import */
import { escapeHtml, sanitizeHtml } from './html';
import { icon, typeIcon } from './icons';
import { stateCategory } from './states';
import type { WorkItemModel } from './viewModel';

export interface RelatedWorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
}

export interface DetailsData {
  id: number;
  title: string;
  type: string;
  state: string;
  fields: Record<string, unknown>;
  parent?: RelatedWorkItem;
  children: RelatedWorkItem[];
  /** Branch and PRs, when the work item is in the current iterations */
  card?: WorkItemModel;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T/;

/** Readable value of a field: identities show their name, dates are localized */
export function fieldText(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'object' && 'displayName' in value) {
    return String((value as { displayName: unknown }).displayName);
  }
  if (typeof value === 'string' && ISO_DATE.test(value)) {
    return new Date(value).toLocaleString();
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value as boolean | number | string);
}

const META_FIELDS: [string, string][] = [
  ['Assigned to', 'System.AssignedTo'],
  ['Reason', 'System.Reason'],
  ['Iteration', 'System.IterationPath'],
  ['Area', 'System.AreaPath'],
  ['Priority', 'Microsoft.VSTS.Common.Priority'],
  ['Severity', 'Microsoft.VSTS.Common.Severity'],
  ['Effort', 'Microsoft.VSTS.Scheduling.Effort'],
  ['Story points', 'Microsoft.VSTS.Scheduling.StoryPoints'],
  ['Remaining work', 'Microsoft.VSTS.Scheduling.RemainingWork'],
  ['Created', 'System.CreatedDate'],
  ['Created by', 'System.CreatedBy'],
  ['Changed', 'System.ChangedDate'],
];

const RICH_TEXT_FIELDS: [string, string][] = [
  ['Description', 'System.Description'],
  ['Repro steps', 'Microsoft.VSTS.TCM.ReproSteps'],
  ['System info', 'Microsoft.VSTS.TCM.SystemInfo'],
  ['Acceptance criteria', 'Microsoft.VSTS.Common.AcceptanceCriteria'],
];

function stateLabel(state: string): string {
  return `<span class="state state-${stateCategory(state)}">${escapeHtml(state)}</span>`;
}

function renderMeta(fields: Record<string, unknown>): string {
  const rows = META_FIELDS.map(([label, name]) => [label, fieldText(fields[name])] as const)
    .filter((row): row is readonly [string, string] => row[1] !== undefined)
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`);
  const tags = fieldText(fields['System.Tags'])
    ?.split(';')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => `<span class="pill tone-neutral">${escapeHtml(tag)}</span>`);
  if (tags?.length) {
    rows.push(`<dt>Tags</dt><dd class="tags">${tags.join('')}</dd>`);
  }
  return `<dl class="meta">${rows.join('')}</dl>`;
}

function renderDevelopment(card: WorkItemModel | undefined): string {
  if (!card) {
    return '<p class="muted">Not in the current iterations: branch and pull requests are not tracked.</p>';
  }
  const branch = card.branch
    ? `<div class="row">${icon('branch')}<code>${escapeHtml(card.branch)}</code>
        <span class="pill tone-${card.isCurrentBranch ? 'current' : card.branchLocation ?? 'remote'}">${
        card.isCurrentBranch ? 'current' : card.branchLocation ?? 'remote'
      }</span></div>`
    : `<div class="row muted">${icon('branch')}<span>No branch</span></div>`;
  const pullRequests = card.pullRequests.map(
    (pr) => `<div class="row">${icon('pullRequest')}
      <button class="link" data-action="openPullRequest" data-id="${card.id}" data-pr="${pr.id}">PR ${pr.id}</button>
      <span class="pr-title">${escapeHtml(pr.title)}</span>
      <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span></div>`
  );
  return branch + pullRequests.join('');
}

function renderActions(data: DetailsData): string {
  const { card } = data;
  const actions = [
    `<button class="button" data-action="openWorkItem" data-id="${data.id}">Open in Azure DevOps</button>`,
  ];
  if (card && !card.branch) {
    actions.unshift(
      `<button class="button primary" data-action="createBranch" data-id="${card.id}">Create branch</button>`
    );
  } else if (card && !card.isCurrentBranch) {
    actions.unshift(`<button class="button" data-action="checkout" data-id="${card.id}">Checkout</button>`);
  }
  if (card?.branch && !card.pullRequests.some((pr) => pr.isActive)) {
    actions.unshift(
      `<button class="button primary" data-action="createPullRequest" data-id="${card.id}">Create PR</button>`
    );
  }
  actions.push(`<button class="button ghost" data-action="reload" data-id="${data.id}">Reload</button>`);
  return `<div class="actions">${actions.join('')}</div>`;
}

function renderRelated(item: RelatedWorkItem): string {
  return `<li class="child">${typeIcon(item.type)}
    <button class="link id" data-action="openDetails" data-id="${item.id}" title="Show details">${item.id}</button>
    <span class="child-title">${escapeHtml(item.title)}</span>${stateLabel(item.state)}</li>`;
}

function renderSection(title: string, content: string): string {
  return `<section class="section"><h2>${title}</h2>${content}</section>`;
}

export function renderDetailsBody(data: DetailsData): string {
  const richText = RICH_TEXT_FIELDS.map(([label, name]) => [label, fieldText(data.fields[name])] as const)
    .filter((section): section is readonly [string, string] => !!section[1])
    .map(([label, html]) => renderSection(label, `<div class="rich-text">${sanitizeHtml(html)}</div>`));
  const hierarchy = [
    data.parent ? renderSection('Parent', `<ul class="related">${renderRelated(data.parent)}</ul>`) : '',
    data.children.length
      ? renderSection(
          `Children (${data.children.length})`,
          `<ul class="related">${data.children.map(renderRelated).join('')}</ul>`
        )
      : '',
  ];
  return `<header class="details-head state-border-${stateCategory(data.state)}">
      <div class="head-line">${typeIcon(data.type)}<span class="type">${escapeHtml(data.type)}</span>
        <span class="id">${data.id}</span>${stateLabel(data.state)}</div>
      <h1>${escapeHtml(data.title)}</h1>
      ${renderActions(data)}
    </header>
    <div class="details-grid">
      <main>${richText.join('') || '<p class="muted">No description.</p>'}${hierarchy.join('')}</main>
      <aside>
        ${renderSection('Development', renderDevelopment(data.card))}
        ${renderSection('Details', renderMeta(data.fields))}
      </aside>
    </div>`;
}
