/** Body of the Work Item Details panel. Pure, so no "vscode" import */
import { renderBranchList } from './branchRows';
import { checkoutButton } from './checkoutButtons';
import { canHaveTasks, escapeHtml, sanitizeHtml, stateButton } from './html';
import type { FigmaLink } from './figmaLinks';
import { fixRelationLabel } from './fixLinks';
import { icon, typeIcon, typeIdClass } from './icons';
import { DependencyRisk, RISK_DESCRIPTIONS } from './schedule';
import { normalizeState, stateCategory } from './states';
import { pullRequestTooltip } from './pullRequestModel';
import { BranchAction, branchActions, type WorkItemModel } from './viewModel';
import { severityLevel, severityName } from './priority';
import { stateSteps } from './stateSteps';
import { beforeCompletion } from './beforeCompletion';
import type { Station } from './track';
import { CHECK_MARK, renderTrackColumnsHtml } from './trackHtml';
import { stationNotes, type NotesPullRequest } from './stationNotes';
import { taskProgress, taskProgressTooltip } from './taskProgress';

export interface RelatedWorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath?: string;
  /** Display name of the assignee */
  assignedTo?: string;
  /** For predecessors / successors: how risky the dependency is */
  risk?: DependencyRisk;
}

export interface DetailsData {
  id: number;
  title: string;
  type: string;
  state: string;
  /** State to show in the header: In review (Rule STATE-10) or the real state */
  displayState?: string;
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
  /** The track of a Backlog Item or Bug of the list (Rules TRACK-*), with what My Pull Requests knows of its PR */
  track?: Station[];
  /** The user's own PR followed by the track (what only My Pull Requests knows: reviewers, runs, auto-complete) */
  ownPullRequest?: NotesPullRequest;
  /** Class of the body for the look (Rule LOOK-1), undefined: the theme */
  lookClass?: string;
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

const INTEGRATION_BUILD = 'Microsoft.VSTS.Build.IntegrationBuild';

export const RICH_TEXT_FIELDS: [string, string][] = [
  ['Description', 'System.Description'],
  ['Repro steps', 'Microsoft.VSTS.TCM.ReproSteps'],
  ['System info', 'Microsoft.VSTS.TCM.SystemInfo'],
  ['Acceptance criteria', 'Microsoft.VSTS.Common.AcceptanceCriteria'],
];

const isType = (type: string, name: string): boolean => normalizeState(type) === normalizeState(name);

/** The types whose tasks, track and "Before completion" the panel shows */
const hasTaskList = (type: string): boolean => isType(type, 'Bug') || isType(type, 'Product Backlog Item');

/** Initials of a display name, for the badge of an assignee: "Ana Ruiz" is "AR" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.slice(0, 1).toUpperCase())
    .join('');
}

/** A box of the side column */
function renderBox(title: string, content: string, className = ''): string {
  return `<section class="box${className ? ` ${className}` : ''}"><h2>${title}</h2>${content}</section>`;
}

/** The fields of the work item, label and value, then the link to Azure DevOps */
function renderMeta(data: DetailsData): string {
  const { fields } = data;
  const rows = META_FIELDS.map(([label, name]) => [label, fieldText(fields[name])] as const)
    .filter((row): row is readonly [string, string] => row[1] !== undefined)
    .map(([label, value]) => `<dt>${label}</dt><dd>${escapeHtml(value)}</dd>`);
  if (isType(data.type, 'Bug')) {
    const build = fieldText(fields[INTEGRATION_BUILD]);
    rows.push(
      `<dt>Integrated in Build</dt><dd${build ? '' : ' class="muted"'}>${build ? escapeHtml(build) : 'empty'}</dd>`
    );
  }
  const link = `<button class="link open-ado" data-action="openWorkItem" data-id="${data.id}">Open in Azure DevOps ↗</button>`;
  return `<dl class="meta">${rows.join('')}</dl>${link}`;
}

function renderDevelopment(card: WorkItemModel | undefined): string {
  if (!card) {
    return '<p class="muted">Not in the current iterations: branch and pull requests are not tracked.</p>';
  }
  const branch = renderBranchList(card);
  const pullRequests = card.pullRequests.map(
    (pr) => `<div class="row${pr.otherRepository ? ' pr other-repo' : ''}" title="${escapeHtml(
      pullRequestTooltip(pr)
    )}">${icon('pullRequest')}
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

/** `lead`: the main action of the header, prominent */
const BRANCH_BUTTONS: Record<BranchAction, (card: WorkItemModel, lead: boolean) => string> = {
  createPullRequest: ({ id }, lead) =>
    `<button class="button primary with-icon${
      lead ? ' cta' : ''
    }" data-action="createPullRequest" data-id="${id}">${icon('pullRequest')}Create PR</button>`,
  createBranch: ({ id }, lead) =>
    `<button class="button primary with-icon${lead ? ' cta' : ''}" data-action="createBranch" data-id="${id}">${icon(
      'branch'
    )}Create branch</button>`,
  checkout: ({ id, worktree }, lead) =>
    checkoutButton({
      kind: 'workItem',
      id,
      mainAttributes: `data-action="checkout" data-id="${id}"`,
      title: 'Switch to the branch of the work item',
      worktree,
      lead,
    }),
  deleteBranch: ({ id, deletableBranches }, lead) =>
    `<button class="button danger with-icon${
      lead ? ' lead-danger' : ''
    }" data-action="deleteBranch" data-id="${id}" data-branch="${escapeHtml(deletableBranches?.[0] ?? '')}"
      title="The PR is merged: delete the branch, as the team does">${icon('trash')}Delete branch</button>`,
};

// Rule CARD-BTN-3
function renderActions(data: DetailsData): string {
  const { card } = data;
  // Same branch actions as the cards; the prominent button is the first one that moves the work on (Checkout only
  // when there is nothing else), and it comes first
  const branchList = card ? branchActions(card) : [];
  const lead = branchList.find((action) => action !== 'checkout') ?? branchList.at(0);
  const ordered = lead ? [lead, ...branchList.filter((action) => action !== lead)] : [];
  const branchButtons = card ? ordered.map((action) => BRANCH_BUTTONS[action](card, action === lead)) : [];
  const actions = [
    ...branchButtons,
    ...renderFigmaActions(data),
    `<button class="button ghost with-icon" data-action="reload" data-id="${data.id}">${icon(
      'refresh'
    )}Reload</button>`,
  ];
  return `<div class="actions">${actions.join('')}</div>`;
}

function renderRelated(item: RelatedWorkItem): string {
  return `<li class="child">${typeIcon(item.type)}
    <button class="link id${typeIdClass(item.type)}" data-action="openDetails" data-id="${
    item.id
  }" title="Open the Work Item Details panel">${item.id}</button>
    <span class="child-title">${escapeHtml(item.title)}</span>${stateButton(item.id, item.state)}</li>`;
}

function renderSection(title: string, content: string, headerAction = ''): string {
  return `<section class="section"><h2><span>${title}</span>${headerAction}</h2>${content}</section>`;
}

/** Predecessor / successor: its ID, title and state, and under them the labels (fix, risk, iteration) */
function renderDependency(
  item: RelatedWorkItem,
  iterationNames: Partial<Record<string, string>>,
  fixLabel?: { text: string; tone: string }
): string {
  const iteration = item.iterationPath
    ? `<span class="iteration-name" title="${escapeHtml(item.iterationPath)}">${escapeHtml(
        iterationNames[item.iterationPath] ?? item.iterationPath.split('\\').at(-1) ?? ''
      )}</span>`
    : '';
  const risk =
    item.risk && item.risk !== 'ok' && item.risk !== 'done'
      ? `<span class="pill wrap risk-${item.risk}" title="${RISK_DESCRIPTIONS[item.risk]}">${
          RISK_DESCRIPTIONS[item.risk]
        }</span>`
      : '';
  const fix = fixLabel ? `<span class="pill tone-${fixLabel.tone}">${fixLabel.text}</span>` : '';
  const labels = fix + risk + iteration;
  return `<li class="dependency"><div class="dep-line">
    <button class="link id${typeIdClass(item.type)}" data-action="openDetails" data-id="${
    item.id
  }" title="Open the Work Item Details panel">${item.id}</button>
    <span class="child-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>${stateButton(
    item.id,
    item.state
  )}</div>${labels ? `<div class="dep-labels">${labels}</div>` : ''}</li>`;
}

function renderDependencyList(
  direction: 'predecessor' | 'successor',
  title: string,
  items: RelatedWorkItem[],
  data: DetailsData,
  emptyText: string
): string {
  const list = items.length
    ? `<ul class="related">${items
        .map((item) => renderDependency(item, data.iterationNames ?? {}, fixRelationLabel(data, item, direction)))
        .join('')}</ul>`
    : `<p class="muted">${emptyText}</p>`;
  return `<h3>${title} <span class="dep-count">${items.length}</span></h3>${list}`;
}

/** Predecessors and successors, with the way to the map (not for Tasks: they are not shown in it) */
function renderDependencies(data: DetailsData): string {
  const lists =
    renderDependencyList(
      'predecessor',
      'Predecessors',
      data.predecessors,
      data,
      'Does not depend on other work items.'
    ) + renderDependencyList('successor', 'Successors', data.successors, data, 'No work items depend on this one.');
  const map =
    data.type === 'Task'
      ? ''
      : `<button class="button with-icon wide" data-action="openDependencyMap" data-id="${data.id}">${icon(
          'graph'
        )}Open dependency map</button>`;
  return renderBox('Dependencies', lists + map, 'dependencies');
}

/** Children of the types without a task list (Features, Epics…), with a button to add tasks */
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

function renderTaskRow(task: RelatedWorkItem): string {
  const owner = task.assignedTo
    ? `<span class="task-owner" title="${escapeHtml(task.assignedTo)}" aria-label="${escapeHtml(
        task.assignedTo
      )}">${escapeHtml(initials(task.assignedTo))}</span>`
    : '';
  return `<li class="task-row"><span class="task-dot dot-${stateCategory(task.state)}" aria-hidden="true"></span>
    <button class="link id" data-action="openDetails" data-id="${task.id}" title="Open the Work Item Details panel">${
    task.id
  }</button>
    <span class="task-title" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</span>${owner}${stateButton(
    task.id,
    task.state
  )}</li>`;
}

/** The tasks of a Backlog Item or a Bug, with a bar of how far they are */
function renderTasks(data: DetailsData): string {
  const progress = taskProgress(data.children);
  const bar = progress.total
    ? `<div class="tasks-progress" role="img" aria-label="${escapeHtml(
        taskProgressTooltip(progress)
      )}" title="${escapeHtml(taskProgressTooltip(progress))}">${progress.segments
        .map((segment) => `<span class="seg seg-${segment.category}" style="flex: ${segment.count}"></span>`)
        .join('')}</div>`
    : '';
  const list = data.children.length
    ? `<ul class="task-list">${data.children.map(renderTaskRow).join('')}</ul>`
    : `<p class="empty-box">No tasks yet. Create PR adds the PR task; work that starts without one raises an alert.</p>`;
  return `<section class="section tasks"><div class="section-head"><h2>Tasks · ${data.children.length}</h2>${bar}
    <button class="button ghost small add-task" data-action="addTask" data-id="${data.id}">Add task</button></div>${list}</section>`;
}

/** Priority and severity, as the sidebar shows them */
function renderUrgency(fields: Record<string, unknown>): string {
  const priority = fieldText(fields['Microsoft.VSTS.Common.Priority']);
  const severity = fieldText(fields['Microsoft.VSTS.Common.Severity']);
  const level = severityLevel(severity);
  const pills = [
    priority ? `<span class="pill urgency-${escapeHtml(priority)}">P${escapeHtml(priority)}</span>` : '',
    severity
      ? `<span class="pill urgency-${level ?? 'none'}" title="Severity ${escapeHtml(severity)}">${
          level ? `S${level} ` : ''
        }${escapeHtml(severityName(severity))}</span>`
      : '',
  ].join('');
  return pills ? `<span class="urgency">${pills}</span>` : '';
}

function renderTags(data: DetailsData): string {
  const blocking = (data.card?.blockingTags ?? []).map((tag) => tag.toLowerCase());
  return (fieldText(data.fields['System.Tags'])?.split(';') ?? [])
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map(
      (tag) =>
        `<span class="pill ${blocking.includes(tag.toLowerCase()) ? 'tag-blocking' : 'tone-neutral'}"${
          blocking.includes(tag.toLowerCase()) ? ' title="Blocking tag"' : ''
        }>${escapeHtml(tag)}</span>`
    )
    .join('');
}

/** Priority, severity, effort and tags as pills, then the sprint and the assignee */
function renderMetaLine(data: DetailsData): string {
  const effort = fieldText(data.fields['Microsoft.VSTS.Scheduling.Effort']);
  const iterationPath = fieldText(data.fields['System.IterationPath']);
  const iteration = iterationPath
    ? data.iterationNames?.[iterationPath] ?? iterationPath.split('\\').at(-1)
    : undefined;
  const assignee = fieldText(data.fields['System.AssignedTo']);
  const where = [iteration, assignee].filter(Boolean).map((text) => escapeHtml(text ?? ''));
  const pills =
    renderUrgency(data.fields) +
    (effort ? `<span class="pill tone-neutral">Effort ${escapeHtml(effort)}</span>` : '') +
    renderTags(data);
  const text = where.length ? `<span class="where">· ${where.join(' · ')}</span>` : '';
  return `<div class="head-meta">${pills}${text}</div>`;
}

function renderBreadcrumb(data: DetailsData): string {
  const current = `<span class="crumb-type">${escapeHtml(data.type)}</span><span class="crumb-id">${data.id}</span>`;
  if (!data.parent) {
    return `<nav class="breadcrumb" aria-label="Work item">${current}</nav>`;
  }
  return `<nav class="breadcrumb" aria-label="Parent"><span class="crumb-type">${escapeHtml(data.parent.type)}</span>
    <button class="link id" data-action="openDetails" data-id="${
      data.parent.id
    }" title="Open the Work Item Details panel">${data.parent.id}</button>
    <span class="breadcrumb-title">${escapeHtml(
      data.parent.title
    )}</span><span class="crumb-sep">/</span>${current}</nav>`;
}

// Rules STEPS-1..5
/** The states the work item goes through, the current one marked; the moves left to others are locked */
function renderStateBar(data: DetailsData): string {
  const steps = stateSteps(data.type, data.state, data.displayState);
  if (!steps) {
    return `<div class="state-bar single">${stateButton(data.id, data.displayState ?? data.state, data.state)}</div>`;
  }
  const buttons = steps.map((step) => {
    const label = `${escapeHtml(step.label)}${
      step.note ? ` <span class="step-note">· ${escapeHtml(step.note)}</span>` : ''
    }`;
    const finish = step.note === 'your finish line' ? ' finish' : '';
    if (step.status === 'current' || !step.state) {
      return `<span class="step step-${step.status}${step.derived ? ' derived' : ''}" aria-current="${
        step.status === 'current' ? 'step' : 'false'
      }">${label}</span>`;
    }
    if (step.locked) {
      return `<button class="step step-${step.status} locked" disabled title="${escapeHtml(step.locked)}">${icon(
        'lock'
      )}${label}</button>`;
    }
    return `<button class="step step-${step.status}${finish}" data-action="changeState" data-id="${
      data.id
    }" data-state="${escapeHtml(step.state)}" title="Move to ${escapeHtml(step.state)}">${label}</button>`;
  });
  return `<nav class="state-bar" aria-label="State">${buttons.join('')}</nav>`;
}

/** One line under the state bar: the flow of the type and who makes the moves */
function renderStateHelp(data: DetailsData): string {
  const lines: string[] = [];
  if (isType(data.type, 'Bug')) {
    lines.push(
      'Bug states: New → Approved → Committed → Ready to Test → Done. A reopened Bug shows ReOpened in the Approved slot and moves on to Committed. Only testers move a Bug to Done.'
    );
  } else if (isType(data.type, 'Product Backlog Item')) {
    lines.push('Backlog Item states: New → Approved → Committed → Done. The developer completes it.');
    if (stateSteps(data.type, data.state, data.displayState)?.some((step) => step.derived)) {
      lines.push('In review is derived from the tasks; Azure DevOps still says Committed.');
    }
  }
  return lines.length ? `<p class="state-help">${lines.map(escapeHtml).join(' ')}</p>` : '';
}

function renderTrack(data: DetailsData): string {
  if (!data.track) {
    return '';
  }
  const notes = data.card
    ? stationNotes({
        card: data.card,
        mine: data.ownPullRequest,
        integrationBuild: fieldText(data.fields[INTEGRATION_BUILD]),
      })
    : {};
  return renderTrackColumnsHtml(data.track, notes, `Track of ${data.id}`);
}

// Rules BEFORE-1..3
/** What keeps the work item from being completed, in one list; nothing for closed items or those not in the list */
function renderBeforeCompletion(data: DetailsData): string {
  const { card } = data;
  if (!card || !canHaveTasks(data.type)) {
    return '';
  }
  const checks = beforeCompletion(card);
  const rows = checks.length
    ? checks
        .map(
          (check) =>
            `<li class="check check-${check.severity}"><span class="ring ring-${check.severity}" aria-hidden="true">${
              check.severity === 'broken' ? '!' : ''
            }</span>${
              check.relatedId === undefined
                ? `<span>${escapeHtml(check.text)}</span>`
                : `<button class="link" data-action="openDetails" data-id="${check.relatedId}">${escapeHtml(
                    check.text
                  )}</button>`
            }</li>`
        )
        .join('')
    : `<li class="check check-clear"><span class="ring ring-clear" aria-hidden="true">${CHECK_MARK}</span><span>Nothing in the way</span></li>`;
  const count = checks.length ? `<span class="count">${checks.length}</span>` : '';
  return `<section class="box before-completion${
    checks.length ? ' open' : ''
  }"><h2><span>Before completion</span>${count}</h2><ul class="checks">${rows}</ul></section>`;
}

function renderMain(data: DetailsData): string {
  const richText = RICH_TEXT_FIELDS.map(([label, name]) => [label, fieldText(data.fields[name])] as const)
    .filter((section): section is readonly [string, string] => !!section[1])
    .map(([label, html]) =>
      renderSection(
        label,
        `<div class="rich-text${label === 'Acceptance criteria' ? ' acceptance' : ''}">${sanitizeHtml(html)}</div>`
      )
    );
  const children = hasTaskList(data.type) ? renderTasks(data) : renderChildren(data);
  return `<main>${richText.join('') || '<p class="muted">No description.</p>'}${children}</main>`;
}

export function renderDetailsBody(data: DetailsData): string {
  return `<div class="details-page">
    <header class="details-head">
      ${renderBreadcrumb(data)}
      <div class="head-row">
        <div class="head-main"><h1>${escapeHtml(data.title)}</h1>${renderMetaLine(data)}</div>
        ${renderActions(data)}
      </div>
    </header>
    <section class="state-section">${renderStateBar(data)}${renderStateHelp(data)}</section>
    ${renderTrack(data)}
    <div class="details-grid">
      ${renderMain(data)}
      <aside>
        ${renderBeforeCompletion(data)}
        ${renderBox('Development', renderDevelopment(data.card))}
        ${renderDependencies(data)}
        ${renderBox('Details', renderMeta(data))}
      </aside>
    </div>
  </div>`;
}
