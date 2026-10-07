/** Body of the work item details panel. Pure, so no "vscode" import */
import { checkoutButton, worktreePill } from './checkoutButtons';
import { canHaveTasks, escapeHtml, sanitizeHtml, stateButton } from './html';
import type { FigmaLink } from './figmaLinks';
import { icon, typeIcon, typeIdClass } from './icons';
import { DependencyRisk, RISK_DESCRIPTIONS } from './schedule';
import { isFinishedState, stateCategory } from './states';
import { BranchAction, branchActions, type WorkItemModel } from './viewModel';

export interface RelatedWorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath?: string;
  /** For predecessors / successors: how risky the dependency is */
  risk?: DependencyRisk;
}

export interface DetailsData {
  id: number;
  title: string;
  type: string;
  state: string;
  fields: Record<string, unknown>;
  parent?: RelatedWorkItem;
  children: RelatedWorkItem[];
  predecessors: RelatedWorkItem[];
  successors: RelatedWorkItem[];
  /** Name of the iteration of each related work item, by path */
  iterationNames?: Partial<Record<string, string>>;
  /** Branch and PRs, when the work item is in the current iterations */
  card?: WorkItemModel;
  /** Figma links of the description, acceptance criteria… */
  figmaLinks?: FigmaLink[];
  /** True when the Figma extension for VS Code is installed */
  figmaInVsCode?: boolean;
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

export const RICH_TEXT_FIELDS: [string, string][] = [
  ['Description', 'System.Description'],
  ['Repro steps', 'Microsoft.VSTS.TCM.ReproSteps'],
  ['System info', 'Microsoft.VSTS.TCM.SystemInfo'],
  ['Acceptance criteria', 'Microsoft.VSTS.Common.AcceptanceCriteria'],
];

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
  const location = card.isCurrentBranch ? 'current' : card.branchLocation ?? 'remote';
  let branch = `<div class="row muted">${icon('branch')}<span>No branch</span></div>`;
  if (card.branch && isFinishedState(card.state) && !card.leftoverBranch) {
    // The links of the work item remain after the branch is deleted
    branch = `<div class="row muted">${icon('branch')}<span>Branch deleted</span></div>`;
  } else if (card.branch) {
    const pill = card.leftoverBranch
      ? '<span class="pill tone-leftover" title="The PR is merged: the branch should be deleted">not deleted</span>'
      : `<span class="pill tone-${location}">${location}</span>`;
    branch = `<div class="row">${icon('branch')}<code>${escapeHtml(card.branch)}</code>${pill}${worktreePill(
      card.worktree
    )}</div>`;
  }
  const pullRequests = card.pullRequests.map(
    (pr) => `<div class="row">${icon('pullRequest')}
      <button class="link" data-action="openPullRequest" data-id="${card.id}" data-pr="${pr.id}">PR ${pr.id}</button>
      <span class="pr-title">${escapeHtml(pr.title)}</span>
      <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span></div>`
  );
  return branch + pullRequests.join('');
}

/** Opens the Figma designs linked in the description: in VS Code when possible, or in the browser */
function renderFigmaActions(data: DetailsData): string[] {
  const links = data.figmaLinks ?? [];
  if (!links.length) {
    return [];
  }
  const where = data.figmaInVsCode ? 'in VS Code (Figma extension)' : 'in the browser';
  const label = links.length === 1 ? 'Figma design' : `Figma designs (${links.length})`;
  return [
    `<span class="button-group">
      <button class="button with-icon" data-action="openFigma" data-id="${data.id}" title="Open ${escapeHtml(
      links.length === 1 ? links[0].name : 'a design'
    )} ${where}">${icon('figma')}${label}</button>${
      data.figmaInVsCode
        ? `<button class="button icon-only" data-action="openFigmaInBrowser" data-id="${data.id}"
              title="Open in the browser" aria-label="Open the Figma design in the browser">${icon(
                'external'
              )}</button>`
        : ''
    }
    </span>`,
  ];
}

const BRANCH_BUTTONS: Record<BranchAction, (card: WorkItemModel) => string> = {
  createPullRequest: ({ id }) =>
    `<button class="button primary" data-action="createPullRequest" data-id="${id}">Create PR</button>`,
  createBranch: ({ id }) =>
    `<button class="button primary" data-action="createBranch" data-id="${id}">Create branch</button>`,
  checkout: ({ id, worktree }) =>
    checkoutButton({
      kind: 'workItem',
      id,
      mainAttributes: `data-action="checkout" data-id="${id}"`,
      title: 'Switch to the branch of the work item',
      worktree,
    }),
  deleteBranch: ({ id }) =>
    `<button class="button danger" data-action="deleteBranch" data-id="${id}"
      title="The work item is finished: delete its branch, as the team does once the PR is merged">Delete branch</button>`,
};

function renderActions(data: DetailsData): string {
  const { card } = data;
  const actions = [
    `<button class="button" data-action="openWorkItem" data-id="${data.id}">Open in Azure DevOps</button>`,
    `<button class="button with-icon" data-action="openDependencyMap" data-id="${data.id}">${icon(
      'graph'
    )}Dependency map</button>`,
    ...renderFigmaActions(data),
  ];
  // Same branch actions as the cards; finished work items only get "Delete branch"
  const branchButtons = card ? branchActions(card).map((action) => BRANCH_BUTTONS[action](card)) : [];
  actions.unshift(...branchButtons);
  actions.push(`<button class="button ghost" data-action="reload" data-id="${data.id}">Reload</button>`);
  return `<div class="actions">${actions.join('')}</div>`;
}

function renderRelated(item: RelatedWorkItem): string {
  return `<li class="child">${typeIcon(item.type)}
    <button class="link id${typeIdClass(item.type)}" data-action="openDetails" data-id="${
    item.id
  }" title="Show details">${item.id}</button>
    <span class="child-title">${escapeHtml(item.title)}</span>${stateButton(item.id, item.state)}</li>`;
}

function renderSection(title: string, content: string, headerAction = ''): string {
  return `<section class="section"><h2><span>${title}</span>${headerAction}</h2>${content}</section>`;
}

/** Predecessor / successor, with its iteration and a warning when the dependency is at risk */
function renderDependency(item: RelatedWorkItem, iterationNames: Partial<Record<string, string>>): string {
  const iteration = item.iterationPath
    ? `<span class="iteration-name" title="${escapeHtml(item.iterationPath)}">${escapeHtml(
        iterationNames[item.iterationPath] ?? item.iterationPath.split('\\').at(-1) ?? ''
      )}</span>`
    : '';
  const risk =
    item.risk && item.risk !== 'ok' && item.risk !== 'done'
      ? `<span class="pill risk-${item.risk}" title="${RISK_DESCRIPTIONS[item.risk]}">${
          RISK_DESCRIPTIONS[item.risk]
        }</span>`
      : '';
  return `<li class="child dependency">${typeIcon(item.type)}
    <button class="link id${typeIdClass(item.type)}" data-action="openDetails" data-id="${
    item.id
  }" title="Show details">${item.id}</button>
    <span class="child-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
    ${risk}${iteration}${stateButton(item.id, item.state)}</li>`;
}

function renderDependencies(title: string, items: RelatedWorkItem[], data: DetailsData, emptyText: string): string {
  const list = items.length
    ? `<ul class="related">${items.map((item) => renderDependency(item, data.iterationNames ?? {})).join('')}</ul>`
    : `<p class="muted">${emptyText}</p>`;
  return renderSection(`${title} (${items.length})`, list);
}

/** Children, with a button to add tasks to Backlog Items / Bugs */
function renderChildren(data: DetailsData): string {
  const addTask = canHaveTasks(data.type)
    ? `<button class="button ghost small" data-action="addTask" data-id="${data.id}">Add task</button>`
    : '';
  if (!data.children.length && !addTask) {
    return '';
  }
  const list = data.children.length
    ? `<ul class="related">${data.children.map(renderRelated).join('')}</ul>`
    : '<p class="muted">No tasks yet.</p>';
  return renderSection(`Children (${data.children.length})`, list, addTask);
}

export function renderDetailsBody(data: DetailsData): string {
  const richText = RICH_TEXT_FIELDS.map(([label, name]) => [label, fieldText(data.fields[name])] as const)
    .filter((section): section is readonly [string, string] => !!section[1])
    .map(([label, html]) => renderSection(label, `<div class="rich-text">${sanitizeHtml(html)}</div>`));
  const hierarchy = [
    data.parent ? renderSection('Parent', `<ul class="related">${renderRelated(data.parent)}</ul>`) : '',
    renderChildren(data),
    renderDependencies('Predecessors', data.predecessors, data, 'Does not depend on other work items.'),
    renderDependencies('Successors', data.successors, data, 'No work items depend on this one.'),
  ];
  return `<header class="details-head state-border-${stateCategory(data.state)}">
      <div class="head-line">${typeIcon(data.type)}<span class="type">${escapeHtml(data.type)}</span>
        <span class="id">${data.id}</span>${stateButton(data.id, data.state)}</div>
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
