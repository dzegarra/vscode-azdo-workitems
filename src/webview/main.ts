import { compactSignals, CompactSignal } from '../compactSignals';
import { placePopover } from '../popoverPlacement';
import { renderBranchList } from '../branchRows';
import { checkoutButton, worktreePill } from '../checkoutButtons';
import {
  pullRequestActionsRequest,
  taskActionsRequest,
  workItemActionsRequest,
  type ActionsRequest,
} from '../actionRequests';
import { canHaveTasks, escapeHtml, stateButton } from '../html';
import { ICONS, icon, TYPE_CLASSES, typeIcon, typeIdClass } from '../icons';
import {
  coverageLevel,
  CoverageSummary,
  DEFAULT_THRESHOLDS,
  describeFileStats,
  listedNames,
  filesBelowTarget,
  formatDelta,
  formatPercent,
} from '../coverage';
import { RunModel, RunState } from '../pipelines';
import { runLabel, runTooltip, RunView, runViewUrl } from '../runDetails';
import { fixesBugsText, type FixLink } from '../fixLinks';
import { completionIssueCount, completionIssueLines } from '../completionIssues';
import { NONE_OPEN, OPEN_PREDECESSORS, predecessorFilterValue, type OpenPredecessor } from '../predecessors';
import { RISK_DESCRIPTIONS } from '../schedule';
import { NO_PRIORITY, priorityFilterValue, severityLevel, severityName, sortWorkItems } from '../priority';
import { shownStateOf, stateCategory, stateRank } from '../states';
import { eventPosition, layoutBands } from '../phaseLayout';
import { MyPullRequestModel, PhaseEventModel, ReviewerModel, VoteKind } from '../myPullRequests';
import { describeTeamRules } from '../reviewCard';
import { dueSoonZoneStart } from '../reviewDue';
import { myPullRequestCompactSignals, PrSignal, reviewCompactSignals } from '../prCompactSignals';
import { countLate } from '../reviewRequests';
import type { ReviewRequestModel, ReviewUrgency } from '../reviewRequests';
import type { ReviewedDetails, ReviewedPeriod, ReviewedRequest } from '../reviewedRequests';
import {
  hasTaskAlerts,
  isTaskListOpen,
  taskProgress,
  taskProgressTooltip,
  type TaskCount,
  type TaskProgress,
} from '../taskProgress';
import { pullRequestTooltip } from '../pullRequestModel';
import { describeTaskBranch, TaskBranchModel } from '../taskBranches';
import { TaskPullRequestModel } from '../taskPullRequests';
import { taskHasActions, taskPill, TaskPill } from '../taskMenu';
import { needsAttention } from '../myPullRequestsAttention';
import { myPullRequestsPanelTone, reviewsPanelTone } from '../panelTone';
import { ATTENTION_EFFECTS, attentionEffectClass } from '../attentionEffect';
import { HOVER_STYLES, hoverStyleClass } from '../hoverStyle';
import { TASK_COUNT_STYLES, taskCountStyleClass } from '../taskCountStyle';
import { splitWorkingOn, WorkingOnLevel, workingOnAnimationClasses, workingOnBadge } from '../workingOn';
import type { CompletedPeriod } from '../myPullRequests';
import type {
  CheckoutKind,
  ExtensionMessage,
  FilterModel,
  IterationModel,
  Layout,
  PanelId,
  PullRequestModel,
  ViewModel,
  WebviewMessage,
  WorkItemActionMessage,
  WorkItemModel,
} from '../viewModel';
import {
  activeFilterCount,
  BranchAction,
  branchActions,
  changedFilterKeys,
  describeScope,
  isVisible,
  NO_PULL_REQUEST,
  pullRequestFilterValue,
} from '../viewModel';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): Partial<SavedState> | undefined;
  setState(state: SavedState): void;
}
interface SavedState {
  search: string;
  onlyAlerts: boolean;
  reviewsCollapsed: boolean;
  /** Filter chips shown under the search box (folded by default) */
  filtersExpanded: boolean;
  myPullRequestsCollapsed: boolean;
  /** Iteration groups collapsed by the user, by iteration path */
  collapsedIterations: string[];
  /** PRs to review already shown: the section opens again when a new one arrives */
  seenReviews: number[];
  /** Cards whose task list the user opened (lists are closed by default) */
  expandedTasks: number[];
  /** Cards whose task list the user closed, even though it opens by itself because of task alerts */
  collapsedTasks: number[];
  /** Work items the user expanded into the full card, in the compact layout */
  expandedCards: number[];
  /** PRs waiting for review the user expanded into the full card, in the compact layout of the box */
  expandedReviews: number[];
  /** Same for "My Pull Requests" */
  expandedPullRequests: number[];
  /** Reviewed PRs the user unfolded: the extension fetches their details */
  expandedReviewed: number[];
}
declare function acquireVsCodeApi(): VsCodeApi;

type FilterKind = 'predecessor' | 'priority' | 'pullRequest' | 'state' | 'type';

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
let reviewsCollapsed = savedState?.reviewsCollapsed ?? false;
let filtersExpanded = savedState?.filtersExpanded ?? false;
let myPullRequestsCollapsed = savedState?.myPullRequestsCollapsed ?? false;
let seenReviews = savedState?.seenReviews;
const collapsedIterations = new Set(savedState?.collapsedIterations ?? []);
const expandedTasks = new Set(savedState?.expandedTasks ?? []);
const collapsedTasks = new Set(savedState?.collapsedTasks ?? []);
const expandedCards = new Set(savedState?.expandedCards ?? []);
const expandedReviews = new Set(savedState?.expandedReviews ?? []);
const expandedPullRequests = new Set(savedState?.expandedPullRequests ?? []);
const expandedReviewed = new Set(savedState?.expandedReviewed ?? []);
/**
 * Task whose pill was clicked: its detail card stays away until the pointer leaves the pill and the card. A module
 * variable because the page is rendered again on every update and the wrap of the pill is `display: contents`
 */
let suppressedTaskCard: number | undefined;

function saveState(): void {
  vscode.setState({
    search,
    onlyAlerts,
    reviewsCollapsed,
    filtersExpanded,
    myPullRequestsCollapsed,
    collapsedIterations: [...collapsedIterations],
    seenReviews: seenReviews ?? [],
    expandedTasks: [...expandedTasks],
    collapsedTasks: [...collapsedTasks],
    expandedCards: [...expandedCards],
    expandedReviews: [...expandedReviews],
    expandedPullRequests: [...expandedPullRequests],
    expandedReviewed: [...expandedReviewed],
  });
}

/** Order of the PR states in the filter */
const PULL_REQUEST_ORDER = [
  NO_PULL_REQUEST,
  'Draft',
  'In review',
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

/**
 * Filter chip. The marker (type icon, state dot, priority swatch) and the colour are the ones of the cards,
 * so the chips are easy to match with them
 */
function chip(
  kind: FilterKind,
  value: string,
  count: number,
  pressed: boolean,
  style: { marker?: string; colorClass?: string } = {}
): string {
  return `<button class="chip ${style.colorClass ?? ''}" data-filter="${kind}" data-value="${escapeHtml(
    value
  )}" aria-pressed="${pressed}" title="${pressed ? 'Shown: click to hide' : 'Hidden: click to show'}">
    ${style.marker ?? ''}${escapeHtml(value)} <span class="count">${count}</span></button>`;
}

const DOT = '<span class="chip-dot" aria-hidden="true"></span>';

/** Tone of the PR status, as in the PR pills of the cards */
function pullRequestTones(items: WorkItemModel[]): Map<string, string> {
  return new Map(items.flatMap((item) => item.pullRequests.map((pr) => [pr.status, pr.tone] as const)));
}

function filterRow(label: string, chips: string[], wide = false): string {
  return `<div class="filter-row${wide ? ' wide' : ''}" role="group" aria-label="${label}">
    <span class="filter-label">${label}</span><span class="filter-chips">${chips.join('')}</span></div>`;
}

function renderFilters(current: ViewModel): string {
  const { filter, stateOrder } = current;
  const workItems = cardItems(current);
  const types = countBy(workItems, (item) => item.type);
  const states = countBy(workItems, shownStateOf);
  const pullRequests = countBy(workItems, pullRequestFilterValue);
  const priorities = countBy(workItems, priorityFilterValue);
  const tones = pullRequestTones(workItems);
  // Work items whose predecessors are unknown are in neither group
  const predecessors = countBy(
    workItems.filter((item) => predecessorFilterValue(item) !== undefined),
    (item) => predecessorFilterValue(item) ?? NONE_OPEN
  );
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
      [...types].map(([type, count]) =>
        chip('type', type, count, isTypeShown(filter, type), {
          marker: typeIcon(type),
          colorClass: `chip-${TYPE_CLASSES[type] ?? 'type-other'}`,
        })
      )
    ),
    filterRow(
      'State',
      sortedStates.map((state) =>
        chip('state', state, states.get(state) ?? 0, !filter.hiddenStates.includes(state), {
          marker: DOT,
          colorClass: `chip-state-${stateCategory(state)}`,
        })
      )
    ),
    filterRow(
      'PR',
      sortedPullRequests.map((status) =>
        chip('pullRequest', status, pullRequests.get(status) ?? 0, !filter.hiddenPullRequestStates.includes(status), {
          marker: DOT,
          colorClass: `tone-${tones.get(status) ?? 'neutral'}`,
        })
      )
    ),
    filterRow(
      'Priority',
      sortedPriorities.map((priority) =>
        chip('priority', priority, priorities.get(priority) ?? 0, !filter.hiddenPriorities.includes(priority), {
          marker: '<span class="chip-swatch" aria-hidden="true"></span>',
          colorClass: `chip-urgency-${priority === NO_PRIORITY ? 'none' : priority.slice(1)}`,
        })
      )
    ),
    predecessors.size
      ? filterRow(
          'Deps',
          [OPEN_PREDECESSORS, NONE_OPEN]
            .filter((value) => predecessors.has(value))
            .map((value) =>
              chip(
                'predecessor',
                value,
                predecessors.get(value) ?? 0,
                !filter.hiddenPredecessorStates.includes(value),
                {
                  marker: DOT,
                  colorClass: value === OPEN_PREDECESSORS ? 'chip-pred-open' : 'chip-pred-none',
                }
              )
            )
        )
      : '',
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

/** Coverage thresholds and personal records, from the extension */
function coverageSettings(): { thresholds: typeof DEFAULT_THRESHOLDS; records?: string } {
  return model?.coverage ?? { thresholds: DEFAULT_THRESHOLDS };
}

function renderFileList(coverage: CoverageSummary, target: number): string {
  const files = filesBelowTarget(coverage.files, target);
  if (!files.length) {
    return `<p class="cov-note">Every file is at ${formatPercent(target)} or more.</p>`;
  }
  const names = listedNames(files);
  const items = files.map(
    (file, index) => `<li><button class="cov-file" data-action="openFile" data-path="${escapeHtml(file.path)}"
      title="${escapeHtml(`Open ${file.path}`)}"><span class="cov-file-name">${escapeHtml(names[index])}</span>
      <span class="cov-file-stats">${escapeHtml(describeFileStats(file))}</span></button></li>`
  );
  return `<p class="cov-note">Files below ${formatPercent(target)}, least covered first</p>
    <ul class="cov-files">${items.join('')}</ul>`;
}

/**
 * Badge with the coverage of a successful run: clicking it opens the coverage report of the run. Its popover lists the
 * files below the target, to open them
 */
function renderCoverage(run: RunModel, open: string): string {
  const { coverage } = run;
  if (!coverage) {
    return '';
  }
  const { thresholds, records } = coverageSettings();
  const level = coverageLevel(coverage.percent, thresholds);
  const delta = formatDelta(coverage.delta);
  const percent = formatPercent(coverage.percent);
  const deltaBadge = delta
    ? `<span class="cov-delta cov-delta-${delta.direction}">${escapeHtml(delta.text)}</span>`
    : '';
  const trophy = level === 'excellent' ? icon('trophy', 'cov-trophy') : '';
  const details = [
    `<p class="cov-title"><strong>Coverage ${percent}</strong> <span>${coverage.covered}/${coverage.total} lines</span> ${deltaBadge}</p>`,
    '<p class="cov-note">Lines covered by the tests of this run</p>',
    records ? `<p class="cov-records">${escapeHtml(records)}</p>` : '',
    renderFileList(coverage, thresholds.target),
  ];
  return `<span class="cov-wrap popover-anchor" data-popover-width="300" data-popover-align="start"><button class="cov cov-${level}" ${open} aria-label="${escapeHtml(
    `Coverage ${percent}${delta ? `, ${delta.text}` : ''}: open the coverage report`
  )}">${icon('shield')}<span>${percent}</span>${trophy}${deltaBadge}</button>
    <div class="cov-pop popover" role="group" aria-label="Coverage details">${details.join('')}</div></span>`;
}

/**
 * A CI run: its state, and the coverage when it succeeded. `open` gives the attributes of the click that opens the run,
 * on one of its tabs (the failed tests from the pill, the coverage report from the coverage badge)
 */
function renderRun(run: RunModel, open: (view?: RunView) => string): string {
  const now = new Date();
  const label = runLabel(run, now);
  const pill = `<button class="run run-${run.state}" ${open(label.opensTests ? 'tests' : undefined)}
      title="${escapeHtml(runTooltip(run, now))}">
      ${icon(RUN_ICONS[run.state], run.state === 'running' ? 'spin' : '')}<span>${escapeHtml(label.text)}</span>
    </button>`;
  const coverage = run.state === 'succeeded' ? renderCoverage(run, open('coverage')) : '';
  return coverage ? `<span class="run-group">${pill}${coverage}</span>` : pill;
}

/** Click of a run of a work item or task card: the extension finds the run by its ID and opens it on the tab */
function openRunAttributes(id: number, run: RunModel, view: RunView | undefined): string {
  return `data-action="openRun" data-id="${id}" data-run="${run.id}"${view ? ` data-view="${view}"` : ''}`;
}

/** Last CI run of each pipeline validating the PR. Clicking one opens it in Azure DevOps */
function renderRuns(item: WorkItemModel, pr: PullRequestModel): string {
  if (!pr.isActive || !pr.runs.length) {
    return '';
  }
  const runs = pr.runs.map((run) => {
    return renderRun(run, (view) => openRunAttributes(item.id, run, view));
  });
  return `<div class="runs">${runs.join('')}</div>`;
}

function renderPullRequest(item: WorkItemModel, pr: PullRequestModel): string {
  return `<div class="row pr${pr.otherRepository ? ' other-repo' : ''}">
    ${icon('pullRequest')}
    <button class="link" data-action="openPullRequest" data-id="${item.id}" data-pr="${pr.id}"
      title="${escapeHtml(pullRequestTooltip(pr))}">PR ${pr.id}</button>
    <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span>
    ${renderRuns(item, pr)}
  </div>`;
}

/** One open predecessor: ID, title, state, owner, iteration and risk */
function renderPredecessorRow(predecessor: OpenPredecessor): string {
  const risk = predecessor.risk;
  const details = [
    `<span class="pred-state state-${stateCategory(predecessor.state)}">${escapeHtml(predecessor.state)}</span>`,
    escapeHtml(predecessor.assignedTo ?? 'unassigned'),
    predecessor.iterationName ? escapeHtml(predecessor.iterationName) : '',
  ].filter(Boolean);
  return `<li class="pred-item">
      <div class="pred-line">${typeIcon(predecessor.type)}
        <button class="link id${typeIdClass(predecessor.type)}" data-action="openDetails" data-id="${
    predecessor.id
  }" title="Open the Work Item Details panel">${predecessor.id}</button>
        <span class="pred-title" title="${escapeHtml(predecessor.title)}">${escapeHtml(predecessor.title)}</span></div>
      <div class="pred-meta">${details.join(' · ')}</div>
      ${risk ? `<div class="pred-risk risk-${risk}">${escapeHtml(RISK_DESCRIPTIONS[risk])}</div>` : ''}
    </li>`;
}

/** Section of the popover: heading and list. Empty when there is nothing to list */
function renderCompletionSection(heading: string, rows: string[], extra = ''): string {
  return rows.length
    ? `<section class="pred-section"><h4 class="pred-heading">${heading}</h4>
      <ol class="pred-list">${rows.join('')}</ol>${extra}</section>`
    : '';
}

/** A tag or an empty field: plain row; the empty fields open the Work Item Details panel, where they are edited */
function renderIssueRow(item: WorkItemModel, text: string, editable: boolean): string {
  return `<li class="pred-item pred-issue">${
    editable
      ? `<button class="link" data-action="openDetails" data-id="${
          item.id
        }" title="Open the Work Item Details panel to fill it">${escapeHtml(text)}</button>`
      : `<span>${escapeHtml(text)}</span>`
  }</li>`;
}

/**
 * Everything that keeps the work item from being completed: the predecessors not completed (the riskiest first),
 * the blocking tags and the empty fields. Starting it is allowed
 */
function renderCompletionList(item: WorkItemModel, id: string): string {
  const predecessors = renderCompletionSection(
    'Open predecessors',
    (item.openPredecessors ?? []).map(renderPredecessorRow),
    `<button class="link pred-map" data-action="openDependencyMap" data-id="${item.id}">Open dependency map</button>`
  );
  const tags = renderCompletionSection(
    'Tags',
    (item.blockingTags ?? []).map((tag) => renderIssueRow(item, tag, false))
  );
  const missing = renderCompletionSection(
    'Missing',
    (item.missingFields ?? []).map((field) => renderIssueRow(item, field, true))
  );
  return `<div class="pred-pop popover" id="${id}" role="group" aria-label="Issues that keep ${item.id} from being completed">
    <div class="pred-card">
      <p class="pred-intro">Can be started, but it cannot be completed until these are solved.</p>
      ${predecessors}${tags}${missing}
    </div></div>`;
}

/** Text of the large pill: only predecessors keep their wording, otherwise the number of issues */
function completionPillText(item: WorkItemModel, count: number): string {
  return count === item.openPredecessors?.length
    ? `${count} open predecessor${count === 1 ? '' : 's'}`
    : `${count} issue${count === 1 ? '' : 's'} before completion`;
}

/**
 * Amber caution (never red: it is a team rule that can be agreed with the owners, not an error) with the issues
 * in a popover, shown on hover or focus. The button has an action without ID, so clicking it does not fold the
 * compact row. Link icon when only predecessors, warning icon otherwise
 */
function renderCompletionTrigger(item: WorkItemModel, compact: boolean): string {
  const count = completionIssueCount(item);
  const id = `pred-${item.id}`;
  const glyph = icon(count === item.openPredecessors?.length ? 'link' : 'warning');
  const title = `Cannot be completed yet: ${completionIssueLines(item).join(' · ')}`;
  const trigger = compact
    ? `<button class="signal signal-completion tone-caution" data-action="showCompletion" aria-describedby="${id}"
      title="${escapeHtml(title)}">${glyph}<span>${count}</span></button>`
    : `<button class="pill tone-caution pred-pill" data-action="showCompletion" aria-describedby="${id}">${glyph}${completionPillText(
        item,
        count
      )}</button>`;
  return `<span class="pred-wrap popover-anchor">${trigger}${renderCompletionList(item, id)}</span>`;
}

/** Large card: the caution with what keeps the work item from being completed; nothing when there is nothing */
function renderCompletion(item: WorkItemModel): string {
  return completionIssueCount(item) ? `<div class="row pred-row">${renderCompletionTrigger(item, false)}</div>` : '';
}

function fixLinkClass(link: FixLink): string {
  return link.stateCategory === 'done' || link.stateCategory === 'removed' ? ' fix-done' : '';
}

/** A fix link: its ID (opening its details) and a dot with its state */
function fixLinkItem(link: FixLink, type: 'Bug' | 'Product Backlog Item'): string {
  return `<span class="fix-item${fixLinkClass(link)}"><button class="link id${typeIdClass(
    type
  )}" data-action="openDetails" data-id="${link.id}" title="${escapeHtml(
    `#${link.id} ${link.state} · ${link.title}`
  )}">#${link.id}</button><span class="fix-dot state-${link.stateCategory}" title="${escapeHtml(
    link.state
  )}" role="img" aria-label="${escapeHtml(link.state)}"></span></span>`;
}

/**
 * Large card: a Backlog Item shows the bugs it fixes, a Bug the Backlog Item that fixes it, each with a dot with its
 * state. Finished ones are faded
 */
function renderFixLinks(item: WorkItemModel): string {
  if (item.fixesBugs?.length) {
    const bugs = item.fixesBugs.map((bug) => fixLinkItem(bug, 'Bug'));
    return `<div class="row fix-row">${icon('bug', 'type-bug')}<span class="fix-text">${fixesBugsText(
      item.fixesBugs.length
    )}</span>${bugs.join('')}</div>`;
  }
  if (item.fixedBy?.length) {
    const backlogItems = item.fixedBy.map((fix) => fixLinkItem(fix, 'Product Backlog Item'));
    return `<div class="row fix-row">${icon(
      'book',
      'type-backlog'
    )}<span class="fix-text">Fixed by</span>${backlogItems.join('')}</div>`;
  }
  return '';
}

const BRANCH_ACTION_BUTTONS: Record<BranchAction, { label: string; className: string; title: string }> = {
  createBranch: { label: 'Create branch', className: 'primary', title: 'Create the branch of the work item' },
  checkout: { label: 'Checkout', className: '', title: 'Switch to the branch of the work item' },
  createPullRequest: { label: 'Create PR', className: 'primary', title: 'Create a pull request from the branch' },
  deleteBranch: {
    label: 'Delete branch',
    className: 'danger',
    title: 'The PR is merged: delete the branch, as the team does',
  },
};

// Rule CARD-BTN-4
function branchActionButton(action: BranchAction, item: WorkItemModel): string {
  if (action === 'checkout') {
    return checkoutButton({
      kind: 'workItem',
      id: item.id,
      mainAttributes: `data-action="checkout" data-id="${item.id}"`,
      title: BRANCH_ACTION_BUTTONS.checkout.title,
      worktree: item.worktree,
    });
  }
  const { label, className, title } = BRANCH_ACTION_BUTTONS[action];
  // Delete branch is only offered with one deletable branch: it is the one the button acts on
  const branch = action === 'deleteBranch' && item.deletableBranches?.length === 1 ? item.deletableBranches[0] : '';
  const target = branch ? ` data-branch="${escapeHtml(branch)}"` : '';
  return `<button class="button ${className}" data-action="${action}" data-id="${item.id}"${target} title="${title}">${label}</button>`;
}

// Rule CARD-BTN-1
function renderActions(item: WorkItemModel): string {
  const actions = branchActions(item).map((action) => branchActionButton(action, item));
  if (canHaveTasks(item.type)) {
    actions.push(
      `<button class="button ghost" data-action="addTask" data-id="${item.id}" title="Create a task under this work item">Add task</button>`
    );
  }
  return `<footer class="actions">${actions.join('')}</footer>`;
}

function isTasksOpen(item: WorkItemModel): boolean {
  return isTaskListOpen(hasTaskAlerts(item.alerts), {
    expanded: expandedTasks.has(item.id),
    collapsed: collapsedTasks.has(item.id),
  });
}

/* ---------- Shared by both PR boxes ---------- */

const VOTE_ICONS: Record<VoteKind, keyof typeof ICONS> = {
  approved: 'check',
  suggestions: 'check',
  waiting: 'clock',
  rejected: 'error',
  declined: 'stop',
  none: 'circle',
};

const VOTE_LABELS: Record<VoteKind, string> = {
  approved: 'Approved',
  suggestions: 'Approved with suggestions',
  waiting: 'Waiting for the author',
  rejected: 'Rejected',
  declined: 'Declined',
  none: 'No vote yet',
};

/** Groups are named "[Project]\\Team": the project is noise in a chip */
function reviewerName(name: string): string {
  return name.replace(/^\[[^\]]*\]\\/, '');
}

function renderReviewer(reviewer: ReviewerModel): string {
  const name = reviewer.isMe ? 'you' : reviewerName(reviewer.name);
  const details = [
    VOTE_LABELS[reviewer.vote],
    reviewer.isRequired ? 'required' : '',
    reviewer.isContainer ? 'group' : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `<span class="reviewer vote-${reviewer.vote}${reviewer.isContainer ? ' group' : ''}${
    reviewer.isMe ? ' me' : ''
  }" title="${escapeHtml(`${reviewer.isMe ? `You (${reviewerName(reviewer.name)})` : name}: ${details}`)}">${icon(
    VOTE_ICONS[reviewer.vote]
  )}<span class="reviewer-name">${escapeHtml(name)}</span>${
    reviewer.isRequired ? '<span class="required" aria-hidden="true">*</span>' : ''
  }</span>`;
}

/** A task of a card: the ones in the list, and the ones assigned to other developers (not in the list) */
type TaskRow = Pick<WorkItemModel, 'id' | 'title' | 'type' | 'state' | 'priority' | 'severity'> & {
  assignedTo?: string;
  taskPullRequests: TaskPullRequestModel[];
  taskBranches: TaskBranchModel[];
  /** A branch of the task is checked out here or in another worktree */
  taskWorkingOn?: WorkingOnLevel;
  canCreateBranch?: boolean;
  canCreatePullRequest?: boolean;
};

function taskRowsOf(children: WorkItemModel[], item: WorkItemModel, stateOrder: string[]): TaskRow[] {
  const own: TaskRow[] = children.map((child) => ({
    ...child,
    taskPullRequests: child.taskPullRequests ?? [],
    taskBranches: child.taskBranches ?? [],
  }));
  const others: TaskRow[] = (item.otherTasks ?? []).map((task) => ({ ...task, taskBranches: task.taskBranches ?? [] }));
  const rows: TaskRow[] = [...own, ...others];
  return sortWorkItems(rows, stateOrder);
}

function renderTaskPullRequestRuns(task: TaskRow, pr: TaskPullRequestModel): string {
  if (!pr.runs.length) {
    return '';
  }
  const runs = pr.runs.map((run) => {
    return renderRun(run, (view) => openRunAttributes(task.id, run, view));
  });
  return `<div class="runs">${runs.join('')}</div>`;
}

/** What the popover of a PR icon says about the PR; the icon and the popover are described by the same text */
function renderTaskPullRequestCard(task: TaskRow, pr: TaskPullRequestModel): string {
  const meta = [
    `<span class="task-pr-repo" title="Repository">${escapeHtml(pr.repository)}</span>${
      pr.otherRepository
        ? '<span class="pill tone-neutral" title="Not the repository open in VS Code">other repository</span>'
        : ''
    }`,
    pr.author ? `<span title="Author">${escapeHtml(pr.author)}</span>` : '',
    pr.target ? `<span title="Target branch">→ ${escapeHtml(pr.target)}</span>` : '',
  ].filter(Boolean);
  const reviewers = pr.reviewers.length
    ? `<div class="reviewers">${pr.reviewers.map(renderReviewer).join('')}${
        pr.moreReviewers ? `<span class="reviewer-more">+${pr.moreReviewers}</span>` : ''
      }</div>`
    : '';
  return `<div class="task-pr-head"><strong>PR ${pr.id}</strong>
      <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span></div>
    <div class="task-pr-title">${escapeHtml(pr.title)}</div>
    <div class="task-pr-meta">${meta.join('<span aria-hidden="true">·</span>')}</div>
    ${reviewers}${renderTaskPullRequestRuns(task, pr)}`;
}

function renderTaskBranchCard(branch: TaskBranchModel): string {
  const meta = [
    branch.state === 'other' || branch.repository
      ? `<span class="task-pr-repo" title="Repository">${escapeHtml(
          branch.repository ?? 'another repository'
        )}</span><span class="pill tone-neutral" title="Not the repository open in VS Code">other repository</span>`
      : '',
  ].filter(Boolean);
  const pr = branch.pullRequest
    ? `<div class="task-pr-meta"><span>PR ${branch.pullRequest.id}</span><span class="pill tone-${
        branch.pullRequest.tone
      }">${escapeHtml(branch.pullRequest.status)}</span></div>`
    : '';
  return `<div class="task-pr-head"><code class="task-branch-name">${escapeHtml(branch.name)}</code>
      <span class="pill ${branch.state === 'current' ? 'tone-current' : 'tone-neutral'}">${escapeHtml(
    describeTaskBranch(branch)
  )}</span></div>
    ${meta.length ? `<div class="task-pr-meta">${meta.join('<span aria-hidden="true">·</span>')}</div>` : ''}${pr}`;
}

/** Branch to the right of the pill: its icon coloured by the best state of the branches, with their number */
function renderPillBranches(pill: TaskPill): string {
  return pill.branchTone
    ? `<span class="task-pill-part pill-branch-${pill.branchTone}">${icon('branch')}${
        pill.branches > 1 ? pill.branches : ''
      }</span>`
    : '';
}

function renderPillPullRequests(pill: TaskPill): string {
  return pill.pullRequest
    ? `<span class="task-pill-part tone-${pill.pullRequest.tone}">${icon('pullRequest')}${
        pill.pullRequests > 1 ? pill.pullRequests : ''
      }</span>`
    : '';
}

/** The detail card of the pill (hover or focus): every branch, then every PR */
function renderTaskPillDetails(task: TaskRow, id: string, parentId: number): string {
  const entries = [
    ...task.taskBranches.map(renderTaskBranchCard),
    ...task.taskPullRequests.map((pr) => renderTaskPullRequestCard(task, pr)),
  ];
  return entries.length
    ? `<div class="task-pr-pop popover" id="${id}" role="tooltip"><div class="task-pr-card">${entries
        .map((entry) => `<div class="task-pr-entry">${entry}</div>`)
        .join('')}${
        taskHasActions(task, parentId) ? '<div class="task-pr-hint">Click for actions</div>' : ''
      }</div></div>`
    : '';
}

/**
 * One pill per task with its branches and PRs (icons and counts); a dim "+" when there are none but something can be
 * created. Hover shows the details, click the native picker with the actions
 */
function renderTaskPill(task: TaskRow, parentId: number): string {
  const pill = taskPill(task);
  if (!pill) {
    return '';
  }
  const detailsId = `task-pill-pop-${task.id}`;
  const content = pill.empty ? '+' : `${renderPillBranches(pill)}${renderPillPullRequests(pill)}`;
  return `<span class="task-pr-wrap popover-anchor${
    suppressedTaskCard === task.id ? ' card-suppressed' : ''
  }" data-popover-width="360" data-popover-align="end"><button class="task-pill${pill.empty ? ' empty' : ''}"
      data-action="taskActions" data-id="${task.id}" data-parent="${parentId}"
      ${pill.empty ? '' : `aria-describedby="${detailsId}"`}
      ${pill.empty ? 'title="Create a branch or a pull request for this task"' : ''}
      aria-label="${escapeHtml(pill.label)}">${content}</button>${renderTaskPillDetails(
    task,
    detailsId,
    parentId
  )}</span>`;
}

/** "Szymon Kwasek EXT" -> "SK" */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => /^\p{L}/u.test(word) && word !== 'EXT')
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

const TASK_WORKING_NOTES: Record<WorkingOnLevel, string> = {
  here: 'Checked out here',
  worktree: 'Checked out in a worktree',
};

function renderChild(item: TaskRow, parentId: number): string {
  const title = item.assignedTo ? `${item.title} (${item.assignedTo})` : item.title;
  const note = item.taskWorkingOn ? TASK_WORKING_NOTES[item.taskWorkingOn] : '';
  return `<li class="child${item.taskWorkingOn ? ` working-${item.taskWorkingOn}` : ''}"${
    note ? ` title="${note}"` : ''
  }>
    ${note ? `<span class="visually-hidden">${note}: </span>` : ''}${typeIcon(item.type)}
    <button class="link id${typeIdClass(item.type)}" data-action="openDetails" data-id="${
    item.id
  }" title="Open the Work Item Details panel">${item.id}</button>
    <span class="child-title" title="${escapeHtml(title)}">${escapeHtml(item.title)}</span>
    ${
      item.assignedTo
        ? `<span class="child-owner" title="Assigned to ${escapeHtml(item.assignedTo)}">${escapeHtml(
            initials(item.assignedTo)
          )}</span>`
        : ''
    }
    ${renderTaskPill(item, parentId)}
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

// Rules ALERT-FIX-1..5, ALERT-SHOW-1
/** Problems the developers must fix ASAP */
function renderAlerts(item: WorkItemModel): string {
  if (!item.alerts.length) {
    return '';
  }
  const alerts = item.alerts.map((alert) => {
    let fix = '';
    if (alert.action === 'linkTaskBranch' && alert.branch) {
      fix = ` <button class="link" data-action="linkTaskBranch" data-id="${item.id}" data-branch="${escapeHtml(
        alert.branch
      )}" title="Add ${escapeHtml(alert.branch)} to the Development section of ${item.id}">Link branch</button>`;
    } else if (alert.action === 'linkTaskPullRequest' && alert.pullRequestId) {
      fix = ` <button class="link" data-action="linkTaskPullRequest" data-id="${item.id}" data-pr="${alert.pullRequestId}" title="Add PR ${alert.pullRequestId} to the links of ${item.id}">Link PR</button>`;
    } else if (alert.action === 'fillIntegrationBuild') {
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

/** Bar segments in workflow order (To do, In progress, Done), each with its count inside; widths are set through CSSOM (sizeTaskBars) */
function renderTaskSegments(progress: TaskProgress): string {
  return progress.segments
    .map(
      (s) =>
        `<span class="tasks-bar-seg state-${s.category}" data-share="${s.share}"><span class="tasks-bar-count">${s.count}</span></span>`
    )
    .join('');
}

/** Task list with a header to open / close it. Cards without tasks show nothing */
function renderTasks(item: WorkItemModel, children: TaskRow[]): string {
  if (!children.length) {
    return '';
  }
  const open = isTasksOpen(item);
  const progress = taskProgress(children);
  const summary = taskProgressTooltip(progress);
  return `<section class="tasks${open ? '' : ' collapsed'}">
    <button class="tasks-toggle" data-action="toggleTasks" data-id="${item.id}" aria-expanded="${open}"
      title="${summary}" aria-label="Tasks: ${summary}">
      ${icon('chevron', 'chevron')}<span class="tasks-title">Tasks</span>
      <span class="tasks-bar" aria-hidden="true">${renderTaskSegments(progress)}</span>
    </button>
    ${open ? `<ul class="children">${children.map((child) => renderChild(child, item.id)).join('')}</ul>` : ''}
  </section>`;
}

/** Highlight of the work items being worked on: here (this window) or in another worktree */
function workingOnClass(item: WorkItemModel): string {
  return item.workingOn ? `working-on working-${item.workingOn}` : '';
}

/** Badge in the header of a large card */
function renderWorkingOn(item: WorkItemModel): string {
  if (!item.workingOn) {
    return '';
  }
  const badge = workingOnBadge(item.workingOn, item.worktree);
  return `<span class="pill working-pill working-${item.workingOn}" title="${escapeHtml(
    badge.title
  )}"><span class="working-glyph" aria-hidden="true">${badge.glyph}</span>${badge.label}</span>`;
}

/**
 * Full card. In the compact layout, an expanded card gets a chevron and a header that fold it back
 * into its row
 */
function renderCard(item: WorkItemModel, children: TaskRow[], visibleIds: Set<number>, foldable: boolean): string {
  const classes = [
    'card',
    `state-border-${stateCategory(item.displayState)}`,
    workingOnClass(item),
    item.alerts.length ? 'has-alerts' : '',
  ].join(' ');
  const fold = foldable
    ? `<button class="card-chevron" data-action="toggleCard" data-id="${item.id}" aria-expanded="true"
      aria-label="Collapse work item ${item.id}" title="Collapse">${icon('chevron', 'chevron')}</button>`
    : '';
  return `<article class="${classes}" data-card="${item.id}">
    <header class="card-head${foldable ? ' foldable' : ''}"${
    foldable ? ` data-action="toggleCard" data-id="${item.id}"` : ''
  }>
      ${fold}${typeIcon(item.type)}
      <button class="link id${typeIdClass(item.type)}" data-action="openDetails" data-id="${
    item.id
  }" title="Open the Work Item Details panel">${item.id}</button>
      ${renderWorkingOn(item)}
      ${renderUrgency(item)}
      ${stateButton(item.id, item.displayState, item.state)}
    </header>
    <div class="title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
    ${renderParent(item, visibleIds)}
    ${renderAlerts(item)}
    ${renderCompletion(item)}
    ${renderBranchList(item)}
    ${item.pullRequests.map((pr) => renderPullRequest(item, pr)).join('')}
    ${renderFixLinks(item)}
    ${renderActions(item)}
    ${renderTasks(item, children)}
  </article>`;
}

/** Marker of a compact signal: a coloured dot for the PR, an icon for the others */
function signalMarker(signal: CompactSignal, item: WorkItemModel): string {
  switch (signal.kind) {
    case 'branch':
      return icon('branch');
    case 'ci':
      return icon(RUN_ICONS[signal.tone as RunState], signal.tone === 'running' ? 'spin' : '');
    case 'tasks':
      return icon('task');
    case 'alerts':
      return icon('warning');
    case 'completion':
      return icon('warning');
    case 'fixesBugs':
      return icon('bug');
    case 'fixedBy':
      return icon('book');
    case 'workingOn':
      return `<span class="working-glyph" aria-hidden="true">${workingOnBadge(item.workingOn ?? 'here').glyph}</span>`;
    case 'pullRequest':
      return DOT;
    case 'priority':
    case 'severity':
      return '';
  }
}

/** Counts of the tasks signal, each in the colour of its state, the slashes muted */
function renderSignalCounts(counts: TaskCount[]): string {
  const spans = counts.map(({ category, count }) => `<span class="state-${category}">${count}</span>`);
  return `<span class="signal-counts">${spans.join('<span class="count-sep">/</span>')}</span>`;
}

function renderSignal(signal: CompactSignal, item: WorkItemModel): string {
  const title = escapeHtml(signal.title);
  const label = signal.label ? `<span>${escapeHtml(signal.label)}</span>` : '';
  switch (signal.kind) {
    case 'priority':
    case 'severity':
      // Same pills as the large cards
      return `<span class="urgency"><span class="pill ${signal.tone}" title="${title}">${escapeHtml(
        signal.label
      )}</span></span>`;
    case 'completion':
      return renderCompletionTrigger(item, true);
    case 'ci':
      return `<span class="signal signal-ci run-${signal.tone}" title="${title}">${signalMarker(signal, item)}</span>`;
    case 'tasks':
      return `<span class="signal signal-tasks tone-${signal.tone}" title="${title}">${signalMarker(signal, item)}${
        signal.counts ? renderSignalCounts(signal.counts) : label
      }</span>`;
    case 'alerts':
    case 'branch':
    case 'fixedBy':
    case 'fixesBugs':
    case 'pullRequest':
    case 'workingOn':
      return `<span class="signal signal-${signal.kind} tone-${signal.tone}${
        signal.otherRepository ? ' other-repo' : ''
      }" title="${title}">${signalMarker(signal, item)}${label}</span>`;
  }
}

/**
 * Two lines: type, ID, title and state; then the small signals that apply. Clicking the row expands it into the
 * full card: the ID and the state keep their own actions (closest [data-action])
 */
function renderCompactCard(item: WorkItemModel, children: TaskRow[]): string {
  const classes = [
    'card compact',
    `state-border-${stateCategory(item.displayState)}`,
    workingOnClass(item),
    item.alerts.length ? 'has-alerts' : '',
  ].join(' ');
  const signals = compactSignals(item, children).map((signal) => renderSignal(signal, item));
  return `<article class="${classes}" data-card="${item.id}" data-action="toggleCard" data-id="${item.id}">
    <div class="compact-head">
      <button class="card-chevron" data-action="toggleCard" data-id="${item.id}" aria-expanded="false"
        aria-label="Expand work item ${item.id}" title="Expand">${icon('chevron', 'chevron')}</button>
      ${item.workingOn ? '<span class="working-dot" aria-hidden="true"></span>' : ''}${typeIcon(item.type)}
      <button class="link id${typeIdClass(item.type)}" data-action="openDetails" data-id="${
    item.id
  }" title="Open the Work Item Details panel">${item.id}</button>
      <span class="compact-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
      ${stateButton(item.id, item.displayState, item.state)}
    </div>
    ${signals.length ? `<div class="signals">${signals.join('')}</div>` : ''}
  </article>`;
}

/**
 * Cards of the visible items. The filters only apply to Backlog Items and Bugs: the children of a visible item
 * (its tasks) are always nested in its card, so they can be managed whatever the filters or the search
 */
function renderCards(items: WorkItemModel[], current: ViewModel): string {
  const visibleIds = new Set(items.map((item) => item.id));
  const childrenOf = (parent: WorkItemModel) =>
    taskRowsOf(
      current.workItems.filter((child) => child.parentId === parent.id),
      parent,
      current.stateOrder
    );
  return items
    .filter((item) => item.parentId === undefined || !visibleIds.has(item.parentId))
    .map((item) => {
      if (current.layout === 'large') {
        return renderCard(item, childrenOf(item), visibleIds, false);
      }
      return expandedCards.has(item.id)
        ? renderCard(item, childrenOf(item), visibleIds, true)
        : renderCompactCard(item, childrenOf(item));
    })
    .join('');
}

// Rule WORKON-4
/**
 * Work items of one iteration. The group can be collapsed to keep only the iterations of interest open;
 * its header keeps counting the work items, and the ones that need attention, while it is collapsed
 */
function renderIteration(iteration: IterationModel, items: WorkItemModel[], current: ViewModel): string {
  const collapsed = collapsedIterations.has(iteration.path);
  const cards = items.filter(
    (item) => item.parentId === undefined || !items.some((other) => other.id === item.parentId)
  );
  const withAlerts = items.filter((item) => item.alerts.length).length;
  const alerts = withAlerts
    ? `<span class="pill iteration-alerts" title="${withAlerts} with alerts">${icon('warning')}${withAlerts}</span>`
    : '';
  // A collapsed group keeps listing the work items being worked on, which are never hidden
  const shown = collapsed ? items.filter((item) => item.workingOn && current.workingOn.ignoreFilters) : items;
  let body = '<p class="muted empty">Nothing to show</p>';
  if (shown.length) {
    body = renderCards(shown, current);
  } else if (collapsed) {
    body = '';
  }
  return `<section class="iteration${collapsed ? ' collapsed' : ''}">
    <h2><button class="iteration-toggle" data-action="toggleIteration" data-path="${escapeHtml(iteration.path)}"
      aria-expanded="${!collapsed}" title="${escapeHtml(iteration.path)}">
      ${icon('chevron', 'chevron')}<span class="iteration-name">${escapeHtml(iteration.name)}</span>
      <span class="count">${cards.length}</span>${alerts}</button></h2>
    ${body}
  </section>`;
}

/** Work items being worked on, at the top of the list, under the toolbar and above the iteration groups */
function renderWorkingOnSection(items: WorkItemModel[], current: ViewModel): string {
  if (!items.length) {
    return '';
  }
  return `<section class="working-section" aria-label="Working on">
    <h2 class="working-section-head"><span class="working-glyph" aria-hidden="true">●</span>
      <span class="working-section-title">Working on</span><span class="working-section-count">${
        items.length
      }</span></h2>
    ${renderCards(items, current)}
  </section>`;
}

// Rule ALERT-SHOW-4
/**
 * Whether the card is shown. "Show only these" shows every work item with alerts, even those the
 * state / PR / priority filters hide
 */
function isCardVisible(item: WorkItemModel, current: ViewModel): boolean {
  const { ignoreFilters } = current.workingOn;
  // The work items being worked on (workingOn.ignoreFilters) are not hidden by the toggle either
  if (onlyAlerts && !(ignoreFilters && item.workingOn)) {
    return item.alerts.length > 0 && isVisible(item, current.filter, search, true, ignoreFilters);
  }
  return isVisible(item, current.filter, search, current.alwaysShowAlerts, ignoreFilters);
}

// Rule ALERT-SHOW-2
/** Summary of the work items with problems, with a toggle to show only them */
function renderAlertsBanner(current: ViewModel): string {
  const withAlerts = cardItems(current).filter((item) => item.alerts.length);
  const count = withAlerts.length;
  // Hidden by the filters (not by the search): "Show only these" reveals them
  const hidden = onlyAlerts
    ? 0
    : withAlerts.filter((item) => !isCardVisible(item, current) && isVisible(item, current.filter, search, true))
        .length;
  if (!count && !onlyAlerts) {
    return '';
  }
  const label = count === 1 ? '1 work item needs attention' : `${count} work items need attention`;
  return `<div class="alerts-banner${count ? '' : ' resolved'}" role="status">
    ${icon('warning')}<span>${count ? label : 'No work items need attention'}${
    hidden ? ` <span class="alerts-hidden">(${hidden} hidden by filters)</span>` : ''
  }</span>
    <button class="button small" data-action="toggleAlerts">${onlyAlerts ? 'Show all' : 'Show only these'}</button>
  </div>`;
}

interface SignalsData {
  unresolved?: number;
  conflicts: boolean;
  runs: RunModel[];
  autoComplete: boolean;
}

/** Unresolved comments, conflicts, CI runs and auto-complete of a PR; `extra` goes at the end of the row */
function renderSignals(pr: SignalsData, extra = ''): string {
  const signals = [
    pr.unresolved
      ? `<span class="signal signal-comments" title="Comment threads still active or pending">${icon('comment')}${
          pr.unresolved
        } unresolved</span>`
      : '',
    pr.conflicts
      ? `<span class="signal signal-conflicts" title="The branch cannot be merged without resolving the conflicts">${icon(
          'warning'
        )}Conflicts</span>`
      : '',
    pr.runs
      .map((run) =>
        renderRun(
          run,
          (view) =>
            `data-action="openMyPullRequest" data-url="${escapeHtml(view ? runViewUrl(run.url, view) : run.url)}"`
        )
      )
      .join(''),
    pr.autoComplete
      ? '<span class="pill tone-approved" title="The PR is completed by itself when its policies pass">Auto-complete</span>'
      : '',
    extra,
  ].filter(Boolean);
  return signals.length ? `<div class="mypr-signals">${signals.join('')}</div>` : '';
}

function renderTimeline(id: string, timeline: MyPullRequestModel['timeline']): string {
  const { events, earlier } = timeline;
  const rows = events.map(
    ({ when, text }) =>
      `<li><time class="timeline-when">${escapeHtml(when)}</time><span class="timeline-text">${escapeHtml(
        text
      )}</span></li>`
  );
  // Latest first: the events left out are the oldest ones, at the end
  if (earlier) {
    rows.push(`<li class="timeline-earlier">… ${earlier} earlier event${earlier === 1 ? '' : 's'}</li>`);
  }
  return `<div class="timeline popover" id="${id}" role="tooltip"><ol class="timeline-card" aria-label="Events of the pull request">${rows.join(
    ''
  )}</ol></div>`;
}

/** The age (or time left) of a PR; hovering or focusing it shows what happened */
function renderTimeText(id: string, text: string, timeline: MyPullRequestModel['timeline'], className = ''): string {
  // Its own (no-op) action: clicking the time or the history must not fold the card around it
  return `<span class="mypr-time-wrap popover-anchor" data-action="timeline"><button class="mypr-time${className}" aria-describedby="${id}">${escapeHtml(
    text
  )}</button>${renderTimeline(id, timeline)}</span>`;
}

function renderLinkedWorkItems(workItems: MyPullRequestModel['workItems']): string {
  const links = workItems.map(
    ({ id, type }) =>
      `<button class="link id${
        type ? typeIdClass(type) : ''
      }" data-action="openDetails" data-id="${id}" title="${escapeHtml(
        type ? `${type} ${id}` : `Work item ${id}`
      )}: open the Work Item Details panel">#${id}</button>`
  );
  return `<span class="mypr-items">${links.join('')}</span>`;
}

/* ---------- PRs waiting for my review ---------- */

// Rule REVIEW-CARD-5
/** Most urgent first: the section takes the colour of the first one */
/** Branch of the PR, to check it out and review it locally */
function renderReviewBranch(request: ReviewRequestModel): string {
  let action = '';
  if (request.isCurrentBranch) {
    action = '<span class="pill tone-current">current</span>';
  } else if (request.canCheckout) {
    action = checkoutButton({
      kind: 'review',
      id: request.id,
      mainAttributes: `data-action="checkoutReviewRequest" data-pr="${request.id}"`,
      title: 'Fetch the branch of the PR and switch to it',
      worktree: request.worktree,
      small: true,
    });
  }
  return `<div class="row review-branch">${icon('branch')}<code title="${escapeHtml(
    request.sourceBranch
  )}">${escapeHtml(request.sourceBranch)}</code>${worktreePill(request.worktree)}${action}</div>`;
}

/** What a reviewer needs to know about the PR, under the title. Empty until the PR is checked in depth */
function renderReviewDetails({ details }: { details?: ReviewedDetails }): string {
  if (!details) {
    return '';
  }
  const meta = [
    details.target
      ? `<span class="mypr-target" title="Merges into ${escapeHtml(details.target)}">→ ${escapeHtml(
          details.target
        )}</span>`
      : '',
    details.workItems.length ? renderLinkedWorkItems(details.workItems) : '',
  ].filter(Boolean);
  const files = details.filesChangedText
    ? `<span class="signal signal-files" title="Files changed in the latest iteration of the PR">${escapeHtml(
        details.filesChangedText
      )}</span>`
    : '';
  const rules = describeTeamRules(details.teamRules);
  const note = details.autoCompleteNote;
  const notes = [
    details.approvalCompletes
      ? `<li class="review-ready" role="note">${icon('check')}<span>Your approval completes it</span></li>`
      : '',
    note
      ? `<li class="mypr-${note.severity}" role="${note.severity === 'error' ? 'alert' : 'note'}">${icon(
          note.severity === 'error' ? 'error' : 'warning'
        )}<span>${escapeHtml(note.text)}</span></li>`
      : '',
    details.myComments
      ? `<li class="review-muted" role="note">${icon('comment')}<span>${escapeHtml(details.myComments)}</span></li>`
      : '',
    rules
      ? `<li class="review-muted" role="note" title="${escapeHtml(details.teamRules.join('\n'))}">${icon(
          'warning'
        )}<span>${escapeHtml(rules)}</span></li>`
      : '',
  ].filter(Boolean);
  return `${meta.length ? `<div class="mypr-meta">${meta.join('<span aria-hidden="true">·</span>')}</div>` : ''}
    ${details.reviewers.length ? `<div class="reviewers">${details.reviewers.map(renderReviewer).join('')}</div>` : ''}
    ${renderSignals(details, files)}
    ${notes.length ? `<ul class="mypr-warnings review-notes">${notes.join('')}</ul>` : ''}`;
}

/** Required / optional, with the same look in the large card and the compact row */
function roleBadge(request: Pick<ReviewRequestModel, 'isRequired'>): string {
  return request.isRequired
    ? '<span class="pill role-pill required" title="You are a required reviewer">Required</span>'
    : '<span class="pill role-pill optional" title="You are an optional reviewer">Optional</span>';
}

/** Small mark of a compact signal: icons are the ones of the work item rows */
function renderPrSignal(signal: PrSignal): string {
  const title = escapeHtml(signal.title);
  const label = signal.label ? `<span>${escapeHtml(signal.label)}</span>` : '';
  switch (signal.kind) {
    case 'role':
      return `<span class="pill role-pill ${signal.tone}" title="${title}">${escapeHtml(signal.label)}</span>`;
    case 'bar':
      return `<span class="mini-bar" role="img" aria-label="${title}" title="${title}"><span class="mini-bar-fill" data-elapsed="${
        signal.elapsed ?? 0
      }"></span></span>`;
    case 'ci':
      return `<span class="signal signal-ci run-${signal.tone}" title="${title}">${icon(
        RUN_ICONS[signal.tone as RunState],
        signal.tone === 'running' ? 'spin' : ''
      )}</span>`;
    case 'comments':
      return `<span class="signal signal-comments" title="${title}">${icon('comment')}${label}</span>`;
    case 'warnings':
      return `<span class="signal signal-warnings tone-${signal.tone}" title="${title}">${icon(
        signal.tone === 'error' ? 'error' : 'warning'
      )}${label}</span>`;
    case 'branch':
      return `<span class="signal signal-branch tone-${signal.tone}" title="${title}">${icon('branch')}${label}</span>`;
    case 'ready':
      return `<span class="signal signal-ready" title="${title}">${icon('check')}${label}</span>`;
    case 'autoComplete':
      return `<span class="signal signal-autocomplete tone-${signal.tone}" title="${title}">${label}</span>`;
    case 'next':
      return `<span class="signal signal-next next-${signal.tone}" title="${title}">${label}</span>`;
    case 'author':
    case 'time':
      return `<span class="signal signal-${signal.kind}" title="${title}">${label}</span>`;
  }
}

/** Chevron of the compact rows: expands the row; in the expanded card it folds it back */
function rowChevron(action: string, id: number, expanded: boolean, what: string): string {
  return `<button class="card-chevron" data-action="${action}" data-id="${id}" aria-expanded="${expanded}"
    aria-label="${expanded ? 'Collapse' : 'Expand'} ${what}" title="${expanded ? 'Collapse' : 'Expand'}">${icon(
    'chevron',
    'chevron'
  )}</button>`;
}

/**
 * Two lines: ID, title and time left; then the small signals (role, author, time waited, CI, comments, branch).
 * Clicking the row expands it into the full card: the ID keeps its own action (closest [data-action])
 */
function renderCompactReview(request: ReviewRequestModel): string {
  const signals = reviewCompactSignals(request).map(renderPrSignal).join('');
  return `<li class="review compact urgency-${request.urgency} ${
    request.isRequired ? 'role-required' : 'role-optional'
  }" data-review="${request.id}" data-action="toggleReviewRow" data-id="${request.id}">
    <div class="compact-head">
      ${rowChevron('toggleReviewRow', request.id, false, `pull request ${request.id}`)}
      <button class="link id" data-action="openReviewRequest" data-url="${escapeHtml(
        request.url
      )}" title="Open the PR in Azure DevOps">PR ${request.id}</button>
      <span class="compact-title" title="${escapeHtml(request.title)}">${escapeHtml(request.title)}</span>
      <span class="review-time compact-time">${escapeHtml(request.timeLeft)}</span>
    </div>
    <div class="signals pr-signals">${signals}</div>
  </li>`;
}

const EVENT_LABELS: Record<PhaseEventModel['kind'], string> = {
  published: 'Published',
  approve: 'Approval',
  wait: 'Waiting for the author',
  reject: 'Rejection',
  push: 'Push',
  autoComplete: 'Auto-complete',
};

/**
 * Mini timeline of a completed PR: a track with a coloured band per phase, a dot per event, the dates of the
 * ends and a legend with the durations. Widths and positions come from data attributes (see sizePhaseTimelines)
 */
function renderPhaseTimeline(pr: MyPullRequestModel): string {
  const { phases, phaseEvents = [] } = pr;
  if (!phases?.length || !pr.took) {
    return '';
  }
  const summary = `Time spent: ${(pr.phaseTotals ?? phases)
    .map((phase) => `${phase.label} ${phase.duration}`)
    .join(', ')}. Took ${pr.took}`;
  const bands = phases.map(
    (phase, index) =>
      `<span class="phase-band phase-${phase.kind}${index === 0 ? ' first' : ''}${
        index === phases.length - 1 ? ' last' : ''
      }" data-band="${index}" title="${escapeHtml(
        `${phase.label}: ${phase.duration} (${phase.startText} to ${phase.endText})`
      )}"></span>`
  );
  const dots = phaseEvents.map(
    (event) =>
      `<span class="phase-dot phase-dot-${event.kind}" data-share="${event.share}" title="${escapeHtml(
        `${EVENT_LABELS[event.kind]}: ${event.text} (${event.when})`
      )}"></span>`
  );
  const legend = (pr.phaseTotals ?? phases).map(
    (phase) =>
      `<span class="phase-key"><span class="phase-swatch phase-${phase.kind}" aria-hidden="true"></span>${escapeHtml(
        phase.label
      )} ${escapeHtml(phase.duration)}</span>`
  );
  return `<div class="pr-phases" role="img" aria-label="${escapeHtml(summary)}" data-shares="${phases
    .map((phase) => phase.share)
    .join(',')}">
    <div class="phase-track">${bands.join('')}${dots.join('')}</div>
    <div class="phase-ends"><time>${escapeHtml(phases[0].startText)}</time><time>${escapeHtml(
    phases[phases.length - 1].endText
  )}</time></div>
    <div class="phase-legend">${legend.join('')}</div>
  </div>`;
}

/** `foldable`: the full card of a row expanded in the compact layout; its chevron folds it back */
function renderReview(request: ReviewRequestModel, foldable = false): string {
  const time = request.details
    ? `<span class="review-time">${renderTimeText(
        `review-timeline-${request.id}`,
        request.timeLeft,
        request.details.timeline
      )}</span>`
    : `<span class="review-time">${request.timeLeft}</span>`;
  const maxWaitHours = model?.reviews.maxWaitHours ?? 24;
  const zoneStart = dueSoonZoneStart(maxWaitHours, model?.reviews.dueSoonHours ?? 6);
  return `<li class="review urgency-${request.urgency} ${
    request.isRequired ? 'role-required' : 'role-optional'
  }" data-review="${request.id}">
    <div class="review-line${foldable ? ` foldable" data-action="toggleReviewRow" data-id="${request.id}` : ''}">
      ${foldable ? rowChevron('toggleReviewRow', request.id, true, `pull request ${request.id}`) : ''}${time}
      <span class="review-meta" title="${escapeHtml(
        `${request.repository}: ${request.author} → ${request.targetBranch}`
      )}">PR ${request.id} · ${escapeHtml(request.author)}</span>
      ${
        request.details
          ? `<span class="pill tone-${request.details.tone} review-status">${escapeHtml(request.details.status)}</span>`
          : ''
      }
    </div>
    <button class="link review-title" data-action="openReviewRequest" data-url="${escapeHtml(request.url)}"
      title="Open the PR in Azure DevOps">${escapeHtml(request.title)}</button>
    <div class="review-bar-text">
      <span class="review-caption">${roleBadge(request)}${icon('clock')}<span>${escapeHtml(
    request.barCaption
  )}</span></span>
      <span class="review-due">${escapeHtml(request.dueText)}</span>
    </div>
    <div class="review-bar" role="progressbar" aria-label="Time waiting for review" aria-valuemin="0"
      aria-valuemax="${maxWaitHours}" aria-valuenow="${request.waitedHours}"
      aria-valuetext="${escapeHtml(request.barValueText)}"
      title="Waiting for ${request.waited} of ${maxWaitHours} h; ${escapeHtml(request.dueText)}">
      <span class="review-bar-zone" data-zone-start="${zoneStart}"></span>
      <span class="review-bar-fill" data-elapsed="${request.elapsed}"></span>
    </div>
    ${renderReviewDetails(request)}
    ${renderReviewBranch(request)}
  </li>`;
}

/**
 * Framed box with a bold title, the number of items and a chevron: it must not be mistaken for the headers of
 * the iterations, which are plain uppercase lines
 */
function renderPanel(panel: {
  className: string;
  collapsed: boolean;
  toggle: string;
  title: string;
  count: number;
  sub: string;
  /** Icon buttons next to the title */
  tools: string;
  /** Buttons in a row under the title (what to list, layout), wrapping when the view is narrow */
  options: string;
  body: string;
}): string {
  return `<section class="panel ${panel.className}${panel.collapsed ? ' collapsed' : ''}">
    <div class="panel-head">
      <button class="panel-toggle" data-action="${panel.toggle}" aria-expanded="${!panel.collapsed}">
        ${icon('chevron', 'chevron')}${icon('pullRequest')}<span class="panel-title">${panel.title}</span>
        <span class="panel-count">${panel.count}</span>
        <span class="panel-sub">${panel.sub}</span>
      </button>
      <div class="panel-tools">${panel.tools}</div>
    </div>
    ${panel.collapsed ? '' : `<div class="panel-options">${panel.options}</div>`}
    ${panel.collapsed ? '' : panel.body}
  </section>`;
}

/**
 * Layout button of a PR box: shows the icon of the layout it switches to, so it takes the room of one button.
 * The box keeps the choice in its own setting
 */
function layoutButton(panel: PanelId, layout: Layout, what: string): string {
  const target: Layout = layout === 'compact' ? 'large' : 'compact';
  const label = `Switch ${what} to the ${target} layout`;
  return `<button class="icon-button" data-action="setPanelLayout" data-panel="${panel}" data-layout="${target}"
    title="${label}" aria-label="${label}">${icon(target === 'large' ? 'cards' : 'rows')}</button>`;
}

function renderReviewList(requests: ReviewRequestModel[], layout: Layout): string {
  const firstOptional = requests.findIndex((request) => !request.isRequired);
  const rows = requests.map((request) => {
    const row =
      layout === 'large' || expandedReviews.has(request.id)
        ? renderReview(request, layout === 'compact')
        : renderCompactReview(request);
    // Required reviews come first: a thin line tells where the optional ones start
    return requests.indexOf(request) === firstOptional && firstOptional > 0
      ? `<li class="review-separator" role="separator" aria-label="Optional reviews"><span>Optional</span></li>${row}`
      : row;
  });
  return `<ul class="review-list${layout === 'compact' ? ' compact' : ''}">${rows.join('')}</ul>`;
}

const REVIEWED_PERIOD_OPTIONS: { value: ReviewedPeriod; label: string }[] = [
  { value: 'hidden', label: 'Reviewed: hidden' },
  { value: 'active', label: 'Reviewed: active' },
  { value: 'day', label: 'Reviewed: 24 h' },
  { value: 'week', label: 'Reviewed: 7 days' },
  { value: 'month', label: 'Reviewed: 30 days' },
];

function renderReviewedPeriod(period: ReviewedPeriod): string {
  const title = 'Pull requests you already reviewed to list below the ones waiting (saved in your settings)';
  const options = REVIEWED_PERIOD_OPTIONS.map(
    ({ value, label }) => `<option value="${value}"${value === period ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `<select class="period-select" data-setting="reviewedPeriod" title="${title}" aria-label="${title}">${options}</select>`;
}

/** "Completed 2 d ago" / "Abandoned 5 h ago" of a closed reviewed PR; nothing for the active ones */
function renderReviewedStatus(request: ReviewedRequest): string {
  if (request.status === 'active') {
    return '';
  }
  const label = request.status === 'completed' ? 'Completed' : 'Abandoned';
  return `<span class="pill tone-${request.status}">${label}${
    request.closedAgo ? ` ${escapeHtml(request.closedAgo)} ago` : ''
  }</span>`;
}

/** The vote of the user in a reviewed PR, as the chips of the reviewers */
function renderReviewedVote(request: ReviewedRequest): string {
  const vote = VOTE_LABELS[request.vote];
  return `<span class="reviewer vote-${request.vote}" title="Your vote: ${vote}">${icon(
    VOTE_ICONS[request.vote]
  )}<span class="reviewer-name">${vote}</span></span>`;
}

/** Compact row of a reviewed PR: dimmed; clicking it unfolds the details (the ID opens the PR in Azure DevOps) */
function renderCompactReviewed(request: ReviewedRequest, author: string): string {
  return `<li class="review compact reviewed role-optional" data-reviewed="${
    request.id
  }" data-action="toggleReviewedRow" data-id="${request.id}">
    <div class="compact-head">
      ${rowChevron('toggleReviewedRow', request.id, false, `reviewed pull request ${request.id}`)}
      <button class="link id" data-action="openReviewRequest" data-url="${escapeHtml(
        request.url
      )}" title="Open the PR in Azure DevOps">PR ${request.id}</button>
      <span class="compact-title" title="${escapeHtml(request.title)}">${escapeHtml(request.title)}</span>
    </div>
    <div class="signals pr-signals">${renderReviewedVote(request)}${renderReviewedStatus(
    request
  )}<span class="signal signal-author" title="${escapeHtml(author)}">${escapeHtml(author)}</span></div>
  </li>`;
}

/** Unfolded reviewed PR: the card of a PR waiting for review without the waiting-time parts */
function renderUnfoldedReviewed(request: ReviewedRequest, author: string): string {
  const { details } = request;
  const closedLabel = request.status === 'completed' ? 'Completed' : 'Abandoned';
  const status = details
    ? `<span class="pill tone-${details.tone} review-status">${escapeHtml(details.status)}</span>`
    : request.status !== 'active' && `<span class="pill tone-${request.status} review-status">${closedLabel}</span>`;
  return `<li class="review reviewed unfolded" data-reviewed="${request.id}">
    <div class="review-line foldable" data-action="toggleReviewedRow" data-id="${request.id}">
      ${rowChevron('toggleReviewedRow', request.id, true, `reviewed pull request ${request.id}`)}
      <span class="review-meta" title="${escapeHtml(`${request.repository}: ${author}`)}">PR ${
    request.id
  } · ${escapeHtml(author)}</span>
      ${status || ''}
    </div>
    <button class="link review-title" data-action="openReviewRequest" data-url="${escapeHtml(request.url)}"
      title="Open the PR in Azure DevOps">${escapeHtml(request.title)}</button>
    <div class="reviewed-vote">${renderReviewedVote(request)}${
    request.closedAgo ? `<span class="muted reviewed-closed">closed ${escapeHtml(request.closedAgo)} ago</span>` : ''
  }</div>
    ${
      details
        ? renderReviewDetails({ details })
        : '<p class="muted reviewed-loading" role="status">Loading details…</p>'
    }
  </li>`;
}

/** A PR already reviewed: a compact row, or the card with its details once the user unfolds it */
function renderReviewed(request: ReviewedRequest, showRepository: boolean): string {
  const author = [request.author, showRepository ? request.repository : ''].filter(Boolean).join(' · ');
  return expandedReviewed.has(request.id)
    ? renderUnfoldedReviewed(request, author)
    : renderCompactReviewed(request, author);
}

/** The PRs already reviewed, below the ones waiting; empty when the period is hidden */
function renderReviewedList(
  reviewed: ReviewedRequest[],
  period: ReviewedPeriod,
  waiting: ReviewRequestModel[]
): string {
  if (period === 'hidden') {
    return '';
  }
  const repositories = new Set([...reviewed.map((request) => request.repository), ...waiting.map((r) => r.repository)]);
  const rows = reviewed.length
    ? reviewed.map((request) => renderReviewed(request, repositories.size > 1)).join('')
    : '<li class="muted reviewed-empty">No reviewed PRs in this period</li>';
  return `<ul class="review-list reviewed-list compact"><li class="review-separator" role="separator" aria-label="Reviewed pull requests"><span>Reviewed (${reviewed.length})</span></li>${rows}</ul>`;
}

function renderReviews(current: ViewModel): string {
  const { requests, status, error, includeOptional, hiddenOptional, layout, reviewed, reviewedPeriod } =
    current.reviews;
  if (status === 'error') {
    return `<div class="reviews-error muted">${icon(
      'warning'
    )}<span>Unable to check the PRs waiting for your review: ${escapeHtml(
      error ?? ''
    )}</span><button class="link" data-action="checkReviewRequests">Retry</button></div>`;
  }
  if (!requests.length && !hiddenOptional && !reviewed.length && reviewedPeriod === 'hidden') {
    return '';
  }
  // The team rule about the maximum wait is about required reviewers: the optional ones are not counted as late
  const { overdue, dueSoon } = countLate(requests);
  const required = requests.find((request) => request.isRequired);
  const hasOptional = hiddenOptional > 0 || requests.some((request) => !request.isRequired);
  const optionalButton = hasOptional
    ? `<button class="button small ghost" data-action="toggleOptional" title="${
        includeOptional ? 'Hide' : 'Show'
      } the pull requests where you are an optional reviewer (saved in your settings)">${
        includeOptional ? 'Hide optional' : `Show optional (${hiddenOptional})`
      }</button>`
    : '';
  const pills = [
    overdue ? `<span class="pill reviews-pill urgency-overdue">${overdue} overdue</span>` : '',
    dueSoon ? `<span class="pill reviews-pill urgency-dueSoon">${dueSoon} due soon</span>` : '',
  ].join('');
  return renderPanel({
    className: `reviews urgency-${required?.urgency ?? 'fresh'} panel-tone-${reviewsPanelTone(requests)}`,
    collapsed: reviewsCollapsed,
    toggle: 'toggleReviews',
    title: 'Waiting for your review',
    count: requests.length,
    sub: pills,
    options: `${optionalButton}${renderReviewedPeriod(reviewedPeriod)}${layoutButton(
      'reviews',
      layout,
      'the pull requests to review'
    )}`,
    tools: `<button class="icon-button" data-action="checkReviewRequests" title="Check now" aria-label="Check the PRs waiting for your review now">${icon(
      'refresh'
    )}</button>`,
    body: `${
      requests.length
        ? renderReviewList(requests, layout)
        : '<p class="muted panel-empty">No required reviews are waiting</p>'
    }${renderReviewedList(reviewed, reviewedPeriod, requests)}`,
  });
}

/* ---------- My pull requests ---------- */

// Rules MYPR-ACT-1..3
function renderMyActions(pr: MyPullRequestModel): string {
  const buttons = [
    `<button class="button" data-action="openMyPullRequest" data-url="${escapeHtml(
      pr.url
    )}" title="Open the PR in Azure DevOps">Open PR</button>`,
  ];
  if (!pr.isCompleted && pr.canCheckout && !pr.isCurrentBranch) {
    buttons.push(
      checkoutButton({
        kind: 'myPullRequest',
        id: pr.id,
        mainAttributes: `data-action="checkoutMyPullRequest" data-pr="${pr.id}"`,
        title: 'Fetch the branch of the PR and switch to it',
        worktree: pr.worktree,
      })
    );
  }
  if (pr.isDraft) {
    buttons.push(
      `<button class="button primary" data-action="publishMyPullRequest" data-pr="${pr.id}" title="Take the PR out of draft: the reviewers are notified">Publish</button>`
    );
  }
  return `<footer class="actions">${buttons.join('')}</footer>`;
}

// Rule MYPR-PULSE-5
/** Two lines: ID, title and status; then the next step and the small signals. Clicking the row expands it */
function renderCompactMyPullRequest(pr: MyPullRequestModel): string {
  const signals = myPullRequestCompactSignals(pr).map(renderPrSignal).join('');
  return `<li class="mypr compact tone-${pr.tone}${pr.isCompleted ? ' completed' : ''}${
    pr.readyToMerge ? ' ready-to-merge' : ''
  }${needsAttention(pr) ? ' needs-attention' : ''}" data-mypr="${
    pr.id
  }" data-action="toggleMyPullRequestRow" data-id="${pr.id}">
    <div class="compact-head">
      ${rowChevron('toggleMyPullRequestRow', pr.id, false, `pull request ${pr.id}`)}
      <button class="link id" data-action="openMyPullRequest" data-url="${escapeHtml(
        pr.url
      )}" title="Open the PR in Azure DevOps">PR ${pr.id}</button>
      <span class="compact-title" title="${escapeHtml(pr.title)}">${escapeHtml(pr.title)}</span>
      <span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span>
    </div>
    ${signals ? `<div class="signals pr-signals">${signals}</div>` : ''}
  </li>`;
}

// Rules MYPR-ACT-4, MYPR-ACT-5, MYPR-PULSE-5, PR-EFFECT-3
/** `foldable`: the full card of a row expanded in the compact layout; its chevron folds it back */
function renderMyPullRequest(pr: MyPullRequestModel, showRepository: boolean, foldable = false): string {
  const meta = [
    pr.target
      ? `<span class="mypr-target" title="Merges into ${escapeHtml(pr.target)}">→ ${escapeHtml(pr.target)}</span>`
      : '',
    renderTimeText(`timeline-${pr.id}`, pr.time, pr.timeline),
    pr.workItems.length ? renderLinkedWorkItems(pr.workItems) : '',
    showRepository ? `<span>${escapeHtml(pr.repository)}</span>` : '',
  ].filter(Boolean);
  const warnings = pr.warnings.map(
    ({ text, severity, action, actionLabel }) =>
      `<li class="mypr-${severity}" role="${severity === 'error' ? 'alert' : 'note'}">${icon(
        severity === 'error' ? 'error' : 'warning'
      )}<span>${escapeHtml(text)}</span>${
        action === 'addSkipTag'
          ? `<button class="button small mypr-fix" data-action="addBuildNotesSkipTag" data-pr="${pr.id}"
              title="Tag the PR when it has no changes testers should know about">${escapeHtml(
                actionLabel ?? 'Add tag'
              )}</button>`
          : ''
      }${
        action === 'retarget'
          ? `<button class="button small mypr-fix" data-action="retargetMyPullRequest" data-pr="${pr.id}"
              title="Change the branch the PR merges into">${escapeHtml(actionLabel ?? 'Retarget')}</button>`
          : ''
      }</li>`
  );
  return `<li class="mypr tone-${pr.tone}${pr.isCompleted ? ' completed' : ''}${
    pr.readyToMerge ? ' ready-to-merge' : ''
  }${needsAttention(pr) ? ' needs-attention' : ''}" data-mypr="${pr.id}">
    <div class="mypr-head${foldable ? ` foldable" data-action="toggleMyPullRequestRow" data-id="${pr.id}` : ''}">
      ${foldable ? rowChevron('toggleMyPullRequestRow', pr.id, true, `pull request ${pr.id}`) : ''}
      <button class="link id" data-action="openMyPullRequest" data-url="${escapeHtml(pr.url)}"
        title="Open the PR in Azure DevOps">PR ${pr.id}</button>
      <span class="mypr-badges">${
        pr.readyToMerge
          ? '<span class="pill ready-pill" title="Nothing stops the PR from being merged">Ready to merge</span>'
          : ''
      }<span class="pill tone-${pr.tone}">${escapeHtml(pr.status)}</span></span>
    </div>
    <div class="mypr-title" title="${escapeHtml(pr.title)}">${escapeHtml(pr.title)}</div>
    <div class="mypr-meta">${meta.join('<span aria-hidden="true">·</span>')}</div>
    ${pr.isCompleted ? renderPhaseTimeline(pr) : ''}
    ${pr.reviewers.length ? `<div class="reviewers">${pr.reviewers.map(renderReviewer).join('')}</div>` : ''}
    ${pr.isCompleted ? '' : renderSignals(pr)}
    ${warnings.length ? `<ul class="mypr-warnings">${warnings.join('')}</ul>` : ''}
    ${
      pr.next
        ? `<div class="mypr-next ${pr.nextTone}"><span class="mypr-next-label">Next</span>${
            pr.nextTone === 'danger' ? icon('warning') : ''
          }<span>${escapeHtml(pr.next)}</span></div>`
        : ''
    }
    ${renderMyActions(pr)}
  </li>`;
}

const COMPLETED_PERIOD_OPTIONS: { value: CompletedPeriod; label: string }[] = [
  { value: 'hidden', label: 'Completed: hidden' },
  { value: 'day', label: 'Completed: 24 h' },
  { value: 'week', label: 'Completed: 7 days' },
  { value: 'month', label: 'Completed: 30 days' },
];

function renderCompletedPeriod(period: CompletedPeriod): string {
  const title = 'Completed PRs to list (saved in your settings)';
  const options = COMPLETED_PERIOD_OPTIONS.map(
    ({ value, label }) => `<option value="${value}"${value === period ? ' selected' : ''}>${label}</option>`
  ).join('');
  return `<select class="period-select" data-setting="completedPeriod" title="${title}" aria-label="${title}">${options}</select>`;
}

/** Empty list: still loading (first check) or really no open PR */
function myPullRequestsEmpty(status: ViewModel['pullRequests']['status']): string {
  return status === 'loading'
    ? '<p class="muted panel-empty" role="status">Loading your pull requests…</p>'
    : '<p class="muted panel-empty">No open pull requests</p>';
}

function renderMyPullRequests(current: ViewModel): string {
  const { items, status, error, showDrafts, hiddenDrafts, completedPeriod, hiddenCompleted, layout, completedSummary } =
    current.pullRequests;
  const failure =
    status === 'error'
      ? `<div class="reviews-error muted">${icon('warning')}<span>Unable to check your pull requests: ${escapeHtml(
          error ?? ''
        )}</span><button class="link" data-action="checkMyPullRequests">Retry</button></div>`
      : '';
  const hasDrafts = hiddenDrafts > 0 || items.some((item) => item.isDraft);
  if (!items.length && !hiddenDrafts && !hiddenCompleted && completedPeriod === 'day') {
    return failure;
  }
  const repositories = new Set(items.map((item) => item.repository));
  const hidden = [
    hiddenDrafts ? `${hiddenDrafts} draft${hiddenDrafts === 1 ? '' : 's'}` : '',
    hiddenCompleted ? `${hiddenCompleted} completed` : '',
  ].filter(Boolean);
  const draftsButton = hasDrafts
    ? `<button class="button small ghost" data-action="toggleDrafts" title="${
        showDrafts ? 'Hide' : 'Show'
      } your draft pull requests (saved in your settings)">${showDrafts ? 'Hide drafts' : 'Show drafts'}</button>`
    : '';
  const completedSelect = renderCompletedPeriod(completedPeriod);
  const renderRow = (pr: MyPullRequestModel) =>
    layout === 'large' || expandedPullRequests.has(pr.id)
      ? renderMyPullRequest(pr, repositories.size > 1, layout === 'compact')
      : renderCompactMyPullRequest(pr);
  return (
    failure +
    renderPanel({
      className: `mine panel-tone-${myPullRequestsPanelTone(items)}`,
      collapsed: myPullRequestsCollapsed,
      toggle: 'toggleMyPullRequests',
      title: 'My Pull Requests',
      count: items.length,
      sub: escapeHtml(
        [hidden.length ? `${hidden.join(', ')} hidden` : '', completedSummary ?? ''].filter(Boolean).join(' · ')
      ),
      options: `${draftsButton}${completedSelect}${layoutButton('myPullRequests', layout, 'your pull requests')}`,
      tools: `<button class="icon-button" data-action="checkMyPullRequests" title="Check now" aria-label="Check your pull requests now">${icon(
        'refresh'
      )}</button>`,
      body: items.length
        ? `<ul class="mypr-list${layout === 'compact' ? ' compact' : ''}">${items.map(renderRow).join('')}</ul>`
        : myPullRequestsEmpty(status),
    })
  );
}

/** Expanded rows of PRs that are gone are forgotten, so the saved state does not grow */
function pruneExpandedPullRequests(current: ViewModel): void {
  const forget = (expanded: Set<number>, ids: number[]) =>
    [...expanded].filter((id) => !ids.includes(id)).forEach((id) => expanded.delete(id));
  if (current.reviews.status === 'ready') {
    forget(
      expandedReviews,
      current.reviews.requests.map((request) => request.id)
    );
  }
  if (current.pullRequests.status === 'ready') {
    forget(
      expandedPullRequests,
      current.pullRequests.items.map((pr) => pr.id)
    );
  }
}

/** The section opens again when a PR it has not shown yet arrives */
function trackNewReviews(current: ViewModel): void {
  const ids = current.reviews.requests.map((request) => request.id);
  if (current.reviews.status !== 'ready') {
    return;
  }
  if (seenReviews && ids.some((id) => !seenReviews?.includes(id))) {
    reviewsCollapsed = false;
  }
  seenReviews = ids;
  saveState();
}

/** Progress bars are sized with CSSOM: the CSP of the view blocks inline styles */
function sizeReviewBars(): void {
  document.querySelectorAll<HTMLElement>('.review-bar-zone').forEach((zone) => {
    zone.style.left = `${Math.round(Number(zone.dataset.zoneStart) * 1000) / 10}%`;
  });
  document.querySelectorAll<HTMLElement>('.review-bar-fill, .mini-bar-fill').forEach((fill) => {
    fill.style.width = `${Math.round(Number(fill.dataset.elapsed) * 100)}%`;
  });
}

/** Urgency each PR to review had when last rendered, to pulse the cards whose level changes */
const reviewUrgencies = new Map<number, ReviewUrgency>();
const PULSE_MS = 1200;

/** One-shot pulse on the cards whose urgency changed since the last render; not on the first one nor on new cards */
function pulseChangedReviews(current: ViewModel): void {
  if (current.reviews.status !== 'ready') {
    return;
  }
  document.querySelectorAll<HTMLElement>('.review[data-review]').forEach((card) => {
    const id = Number(card.dataset.review);
    const urgency = current.reviews.requests.find((request) => request.id === id)?.urgency;
    const previous = reviewUrgencies.get(id);
    if (urgency && previous && previous !== urgency) {
      card.classList.add('pulse');
      setTimeout(() => card.classList.remove('pulse'), PULSE_MS);
    }
  });
  reviewUrgencies.clear();
  current.reviews.requests.forEach((request) => reviewUrgencies.set(request.id, request.urgency));
}

/** Bands and dots of the phase timelines: widths and positions through CSSOM (the CSP blocks inline styles) */
function sizePhaseTimelines(): void {
  document.querySelectorAll<HTMLElement>('.pr-phases').forEach((timeline) => {
    const shares = (timeline.dataset.shares ?? '').split(',').map(Number);
    const bands = layoutBands(shares);
    timeline.querySelectorAll<HTMLElement>('.phase-band').forEach((band) => {
      const layout = bands[Number(band.dataset.band)];
      band.style.left = `${layout.from * 100}%`;
      band.style.width = `${layout.width * 100}%`;
    });
    timeline.querySelectorAll<HTMLElement>('.phase-dot').forEach((dot) => {
      dot.style.left = `${eventPosition(Number(dot.dataset.share), shares, bands) * 100}%`;
    });
  });
}

/** Speed of the light of the "runningBorder" animation, the same on every card whatever its size */
const RUNNING_LIGHT_PX_PER_S = 220;

/**
 * "runningBorder": a light that follows the border of the "here" cards at a constant speed. It moves along the border
 * (offset-path), so its duration depends on the card's perimeter (CSSOM: the CSP blocks inline styles); the delay keeps
 * its position across re-renders instead of restarting it
 */
function placeRunningLights(): void {
  const list = document.getElementById('list');
  if (!list?.classList.contains('anim-runningBorder')) {
    return;
  }
  list.querySelectorAll<HTMLElement>('.card.working-here').forEach((card) => {
    let track = card.querySelector<HTMLElement>(':scope > .run-track');
    if (!track) {
      track = document.createElement('span');
      track.className = 'run-track';
      track.setAttribute('aria-hidden', 'true');
      track.append(document.createElement('span'));
      card.append(track);
    }
    const perimeter = 2 * (card.offsetWidth + card.offsetHeight);
    const seconds = Math.max(1.5, perimeter / RUNNING_LIGHT_PX_PER_S);
    track.style.setProperty('--run-duration', `${seconds}s`);
    track.style.setProperty('--run-delay', `${-((performance.now() / 1000) % seconds)}s`);
  });
}

/** Same for the progress of the tasks */
function sizeTaskBars(): void {
  document.querySelectorAll<HTMLElement>('.tasks-bar-seg').forEach((segment) => {
    segment.style.flexGrow = String(Number(segment.dataset.share));
  });
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
    cards.filter((item) => isCardVisible(item, current)),
    current.stateOrder
  );
  const hidden = cards.length - visible.length;
  const split = splitWorkingOn(visible, current.workingOn.section);
  const hiddenNote = hidden
    ? `<p class="muted note">${
        filtersExpanded
          ? `${hidden} work item${hidden === 1 ? '' : 's'} hidden by filters`
          : `<button class="link-button" data-action="showFilters" title="Show the filters">${hidden} work item${
              hidden === 1 ? '' : 's'
            } hidden by filters</button>`
      }</p>`
    : '';
  // Group by iteration only when the teams are in different sprints
  let body: string;
  if (current.iterations.length > 1) {
    body = current.iterations
      .map((iteration) =>
        renderIteration(
          iteration,
          split.rest.filter((item) => item.iterationPath === iteration.path),
          current
        )
      )
      .join('');
  } else {
    body =
      renderCards(split.rest, current) ||
      (split.workingOn.length ? '' : '<p class="message muted">No work items match the filters.</p>');
  }
  return renderAlertsBanner(current) + renderWorkingOnSection(split.workingOn, current) + body + hiddenNote;
}

/* ---------- Page ---------- */

/** Next to the "My Work Items" title: the layout of the cards and folding all the task lists */
function renderListTools(current: ViewModel): string {
  const layoutButton = (layout: ViewModel['layout'], iconName: 'cards' | 'rows', label: string) =>
    `<button class="icon-button" data-action="setLayout" data-layout="${layout}" aria-pressed="${
      current.layout === layout
    }" title="${label}" aria-label="${label}">${icon(iconName)}</button>`;
  return `<span class="layout-switch" role="group" aria-label="Layout of the work items">${layoutButton(
    'compact',
    'rows',
    'Compact layout'
  )}${layoutButton('large', 'cards', 'Large layout')}</span>
    <button class="icon-button" data-action="expandAllTasks" title="Expand all tasks" aria-label="Expand all tasks">${icon(
      'expandAll'
    )}</button>
    <button class="icon-button" data-action="collapseAllTasks" title="Collapse all tasks" aria-label="Collapse all tasks">${icon(
      'collapseAll'
    )}</button>`;
}

/** Work item the extension asked to show; kept until its card is rendered (the list may still be loading) */
let revealId: number | undefined;
let flashTimer: ReturnType<typeof setTimeout> | undefined;
const FLASH_MS = 1500;

function findCard(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-card="${id}"]`);
}

/**
 * Scrolls to the card and flashes it. When the card is not listed because its iteration group is collapsed, the
 * group is opened and true is returned: the list must be rendered again
 */
function revealPending(): boolean {
  if (revealId === undefined || !model) {
    return false;
  }
  const id = revealId;
  const card = findCard(id);
  if (!card) {
    const item = model.workItems.find((candidate) => candidate.id === id);
    if (item && collapsedIterations.delete(item.iterationPath)) {
      saveState();
      return true;
    }
    // Hidden by the filters or the search: nothing to show, unless the list is still loading
    if (model.status !== 'loading') {
      revealId = undefined;
    }
    return false;
  }
  revealId = undefined;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  clearTimeout(flashTimer);
  document.querySelectorAll('.reveal-flash').forEach((flashing) => flashing.classList.remove('reveal-flash'));
  // Reading the layout restarts the animation when the same card is revealed twice in a row
  void card.offsetWidth;
  card.classList.add('reveal-flash');
  flashTimer = setTimeout(() => findCard(id)?.classList.remove('reveal-flash'), FLASH_MS);
  return false;
}

/** Funnel button next to the search box. The badge counts the filters hiding work items, also while they are folded */
function renderFiltersToggle(current: ViewModel): void {
  const button = document.getElementById('filters-toggle') as HTMLButtonElement;
  const active = activeFilterCount(current.filter, cardItems(current));
  const label = filtersExpanded ? 'Hide filters' : 'Show filters';
  const full = active ? `${label} (${active} active)` : label;
  button.title = full;
  button.setAttribute('aria-label', full);
  button.setAttribute('aria-expanded', String(filtersExpanded));
  button.innerHTML = `${icon('filter')}${
    active ? `<span class="filters-badge" aria-hidden="true">${active}</span>` : ''
  }`;
}

/** Margin that the popovers keep from the edges of the view */
const VIEW_MARGIN = 8;

interface PlacedPopover {
  popover: HTMLElement;
  left: number;
  width: number;
}

/**
 * Where a popover goes: `data-popover-width` and `data-popover-align` of its anchor say how wide it wants to be and
 * which edge of the first element of the anchor (the button) it follows; the pure placePopover keeps it inside the
 * view (documentElement.clientWidth: innerWidth and 100vw include the scrollbar). The left is relative to the
 * containing block of the popover (offsetParent: the anchor, or the row for the anchor that is `display: contents`)
 */
function measurePopover(anchor: HTMLElement): PlacedPopover | undefined {
  const preferredWidth = Number(anchor.dataset.popoverWidth);
  const popover = anchor.querySelector<HTMLElement>(':scope > .popover');
  const trigger = anchor.firstElementChild;
  const block = popover?.offsetParent;
  if (!popover || !trigger || !block || !(preferredWidth > 0)) {
    return undefined;
  }
  const rect = trigger.getBoundingClientRect();
  const { width, left } = placePopover({
    anchorLeft: rect.left,
    anchorRight: rect.right,
    viewWidth: document.documentElement.clientWidth,
    preferredWidth,
    margin: VIEW_MARGIN,
    align: anchor.dataset.popoverAlign === 'end' ? 'end' : 'start',
  });
  return { popover, width, left: left - block.getBoundingClientRect().left - block.clientLeft };
}

/** Measures them all, then writes (no layout thrash) */
function placePopovers(anchors: Element[]): void {
  const placed = anchors
    .filter((anchor): anchor is HTMLElement => anchor instanceof HTMLElement)
    .map(measurePopover)
    .filter((item): item is PlacedPopover => item !== undefined);
  for (const { popover, left, width } of placed) {
    popover.style.setProperty('--popover-left', `${left}px`);
    popover.style.setProperty('--popover-width', `${width}px`);
  }
}

/**
 * After a render and when the view is resized: every popover that needs a place, hidden or not (a hidden popover
 * still counts for the scroll width of the view). The outer ones first: a badge inside the card of a pill moves with it
 */
function placeAllPopovers(): void {
  const anchors = Array.from(document.querySelectorAll('.popover-anchor[data-popover-width]'));
  placePopovers(anchors.filter((anchor) => !anchor.closest('.popover')));
  placePopovers(anchors.filter((anchor) => anchor.closest('.popover')));
}

/** The pointer or the focus enters an anchor: its popover (and the ones around it) is placed again before it shows */
function placePopoversAround(target: EventTarget | null): void {
  const chain: Element[] = [];
  let anchor = target instanceof Element ? target.closest('.popover-anchor') : null;
  while (anchor) {
    chain.unshift(anchor);
    anchor = anchor.parentElement?.closest('.popover-anchor') ?? null;
  }
  for (const item of chain) {
    placePopovers([item]);
  }
}

/** The pointer is over (or left) something: ends the wait after a click on a pill */
function onTaskCardPointer(target: EventTarget | null): void {
  const wrap = target instanceof Element ? target.closest('.task-pr-wrap') : null;
  if (suppressedTaskCard === undefined) {
    return;
  }
  const suppressed = document.querySelector('.task-pr-wrap.card-suppressed');
  if (!wrap || wrap !== suppressed) {
    // No render: only the class of the wrap (the next render takes it from the variable)
    suppressedTaskCard = undefined;
    suppressed?.classList.remove('card-suppressed');
  }
}

function render(): void {
  const app = document.getElementById('app');
  if (!app || !model) {
    return;
  }
  if (!app.childElementCount) {
    app.innerHTML = `<div id="panels"><div id="reviews"></div><div id="my-prs"></div></div>
      <div class="toolbar">
        <div class="list-head"><h2 class="list-title">My Work Items</h2><span id="list-tools" class="list-tools"></span></div>
        <div class="search-row">
          <input id="search" type="search" placeholder="Search by ID, title or branch" aria-label="Search work items">
          <button id="filters-toggle" class="icon-button filters-toggle" data-action="toggleFilters" aria-controls="filters"></button>
        </div>
      </div>
      <p id="scope" class="scope"></p>
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
  // Hover style of the cards and PR tiles, switched by a class (strict CSP: no inline styles)
  for (const style of HOVER_STYLES) {
    app.classList.toggle(hoverStyleClass(style), style === model.hoverStyle);
  }
  // Rule MYPR-PULSE-4: effect of the My Pull Requests tiles that need the user (class on the tile, switched here)
  for (const effect of ATTENTION_EFFECTS) {
    app.classList.toggle(attentionEffectClass(effect), effect === model.pullRequests.attentionEffect);
  }
  // Delay of the popovers (a CSS variable: strict CSP, no inline styles)
  app.style.setProperty('--popover-delay', `${model.popoverDelay}ms`);
  // Same for the look of the counts on the bar of the Tasks header
  for (const style of TASK_COUNT_STYLES) {
    app.classList.toggle(taskCountStyleClass(style), style === model.tasksCountStyle);
  }
  const scope = describeScope(model.iterations);
  const scopeElement = document.getElementById('scope') as HTMLElement;
  scopeElement.textContent = scope.text;
  scopeElement.title = scope.tooltip;
  (app.querySelector('.progress') as HTMLElement).hidden = model.status !== 'loading';
  (document.getElementById('filters') as HTMLElement).innerHTML =
    filtersExpanded && cardItems(model).length ? renderFilters(model) : '';
  renderFiltersToggle(model);
  const list = document.getElementById('list') as HTMLElement;
  // Animations of the "here" cards and the pulse of their ● are switched by classes (strict CSP: no inline styles)
  list.className = ['list', ...workingOnAnimationClasses(model.workingOn.animation, model.workingOn.pulseBadge)].join(
    ' '
  );
  list.innerHTML = renderList(model);
  (document.getElementById('list-tools') as HTMLElement).innerHTML = renderListTools(model);
  (document.getElementById('reviews') as HTMLElement).innerHTML = renderReviews(model);
  (document.getElementById('my-prs') as HTMLElement).innerHTML = renderMyPullRequests(model);
  sizeReviewBars();
  sizePhaseTimelines();
  pulseChangedReviews(model);
  sizeTaskBars();
  placeRunningLights();
  placeAllPopovers();
  if (revealPending()) {
    render();
  }
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
  } else if (kind === 'predecessor') {
    filter.hiddenPredecessorStates = toggle(filter.hiddenPredecessorStates, value);
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

/** Elements that morph between their compact and large forms, with the name of their view transition */
const MORPHING = [
  ['card', 'wi'],
  ['review', 'review'],
  ['mypr', 'mypr'],
  ['reviewed', 'reviewed'],
] as const;

/** View Transitions API (Chromium 111+), not yet in the TypeScript DOM types of this project */
type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => { finished: Promise<void> };
};

/** Gives every card / PR row a view-transition-name (CSSOM: the CSP blocks inline styles), once each */
function nameMorphingItems(names: boolean, items = true): void {
  // The blocks around them slide to their new place too, instead of cross-fading (their text would show twice)
  [
    ['reviews', '#reviews'],
    ['my-prs', '#my-prs'],
    ['toolbar', '.toolbar'],
    ['scope', '#scope'],
    ['filters', '#filters'],
    ['list', '#list'],
  ].forEach(([name, selector]) =>
    document
      .querySelector<HTMLElement>(selector)
      ?.style.setProperty('view-transition-name', names ? `block-${name}` : '')
  );
  const seen = new Set<string>();
  MORPHING.forEach(([data, prefix]) => {
    document.querySelectorAll<HTMLElement>(`[data-${data}]`).forEach((element) => {
      const name = `${prefix}-${element.dataset[data]}`;
      // A duplicated name aborts the whole transition: the second one is left out
      element.style.setProperty('view-transition-name', names && items && !seen.has(name) ? name : '');
      seen.add(name);
    });
  });
}

/**
 * Renders again, morphing the cards and PR rows from their old form to the new one (switch between compact and large,
 * a compact row unfolded or folded back). Uses the View Transitions API; without it, or with reduced motion, the view
 * is simply rendered. `after` runs once the new view is in the page (e.g. to put the focus back)
 */
function renderMorphing(after?: () => void, { items = true }: { items?: boolean } = {}): void {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { startViewTransition } = document as ViewTransitionDocument;
  if (reduced || !startViewTransition) {
    render();
    after?.();
    return;
  }
  nameMorphingItems(true, items);
  const transition = startViewTransition.call(document, () => {
    render();
    nameMorphingItems(true, items);
    after?.();
  });
  // The names are only needed during the transition
  void transition.finished.finally(() => nameMorphingItems(false));
}

/** The choice of the user wins over the automatic opening caused by task alerts */
function toggleTasks(id: number): void {
  const item = model?.workItems.find((candidate) => candidate.id === id);
  if (!item) {
    return;
  }
  if (isTasksOpen(item)) {
    expandedTasks.delete(id);
    collapsedTasks.add(id);
  } else {
    collapsedTasks.delete(id);
    expandedTasks.add(id);
  }
  saveState();
  // The card grows or shrinks with its tasks; the focus stays on the toggle for keyboard users
  renderMorphing(() => document.querySelector<HTMLElement>(`.tasks-toggle[data-id="${id}"]`)?.focus());
}

/** Compact layout: expands a row into the full card, or folds it back */
function toggleCard(id: number, after?: () => void): void {
  if (!expandedCards.delete(id)) {
    expandedCards.add(id);
  }
  saveState();
  renderMorphing(after);
}

/** Compact layout of the PR boxes: expands a row into the full card, or folds it back */
function toggleRow(expanded: Set<number>, id: number, chevronAction: string): void {
  if (!expanded.delete(id)) {
    expanded.add(id);
  }
  saveState();
  // Rendering again drops the focus of the chevron, which keyboard users need to stay on
  renderMorphing(() =>
    document.querySelector<HTMLElement>(`.card-chevron[data-action="${chevronAction}"][data-id="${id}"]`)?.focus()
  );
}

/** The most recent unfolded reviewed PRs are remembered: the older ones fold back, so the saved state stays small */
const MAX_EXPANDED_REVIEWED = 50;
/** What the extension was last told about the unfolded reviewed PRs, so it is told only when it changes */
let postedReviewedKey: string | undefined;

/** Tells the extension which reviewed PRs are unfolded: it fetches the details of those only */
function syncReviewedExpanded(): void {
  const ids = [...expandedReviewed];
  const key = ids.join(',');
  if (key !== postedReviewedKey) {
    postedReviewedKey = key;
    post({ type: 'setReviewedExpanded', ids });
  }
}

/** Unfolds a reviewed PR into its details, or folds it back */
function toggleReviewedRow(id: number): void {
  toggleRow(expandedReviewed, id, 'toggleReviewedRow');
  while (expandedReviewed.size > MAX_EXPANDED_REVIEWED) {
    expandedReviewed.delete(expandedReviewed.values().next().value as number);
  }
  syncReviewedExpanded();
}

/** Layout of a PR box: shown right away; the extension saves it and posts the view again */
function setPanelLayout(panel: PanelId, layout: Layout): void {
  if (!model) {
    return;
  }
  if (panel === 'reviews' && model.reviews.layout !== layout) {
    model = { ...model, reviews: { ...model.reviews, layout } };
  } else if (panel === 'myPullRequests' && model.pullRequests.layout !== layout) {
    model = { ...model, pullRequests: { ...model.pullRequests, layout } };
  } else {
    return;
  }
  renderMorphing();
  post({ type: 'setPanelLayout', panel, layout });
}

/** From the view menu. Closing also closes the lists opened because of task alerts */
function setTasksExpanded(expanded: boolean): void {
  expandedTasks.clear();
  collapsedTasks.clear();
  if (model) {
    for (const item of cardItems(model)) {
      (expanded ? expandedTasks : collapsedTasks).add(item.id);
    }
  }
  saveState();
  renderMorphing();
}

document.addEventListener('pointerover', (event) => placePopoversAround(event.target));
document.addEventListener('focusin', (event) => placePopoversAround(event.target));
window.addEventListener('resize', placeAllPopovers);
document.addEventListener('change', (event) => {
  const select = event.target;
  if (!(select instanceof HTMLSelectElement)) {
    return;
  }
  if (select.dataset.setting === 'completedPeriod') {
    const period = COMPLETED_PERIOD_OPTIONS.find((option) => option.value === select.value)?.value;
    if (period) {
      post({ type: 'setCompletedPeriod', period });
    }
  } else if (select.dataset.setting === 'reviewedPeriod') {
    const period = REVIEWED_PERIOD_OPTIONS.find((option) => option.value === select.value)?.value;
    if (period) {
      post({ type: 'setReviewedPeriod', period });
    }
  }
});

// Escape closes the popovers (WCAG 1.4.13): they only show while the pointer or the focus is on the anchor, until it moves
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') {
    return;
  }
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && active.closest('.popover-anchor') ? active : undefined;
  if (focused || document.querySelector('.popover-anchor:hover')) {
    focused?.blur();
    document.body.classList.add('no-popovers');
  }
});
// Esc holds the popovers closed until the pointer moves or the focus goes to something else
document.addEventListener('pointermove', () => document.body.classList.remove('no-popovers'));
document.addEventListener('focusin', () => document.body.classList.remove('no-popovers'));
document.addEventListener('pointerover', (event) => onTaskCardPointer(event.target));
// The pointer left the view: the card may show again when it comes back
document.addEventListener('pointerout', (event) => {
  if (!event.relatedTarget) {
    onTaskCardPointer(null);
  }
});
/** Asks the extension for the native picker of a trigger; nothing happens when there is nothing to choose */
function showActions(request: ActionsRequest | undefined): void {
  if (request) {
    post({ type: 'showActions', ...request });
  }
}

/** Click on the pill of a task row */
function showTaskActions(taskId: number, parentId: number, byPointer: boolean): void {
  if (!model) {
    return;
  }
  if (byPointer) {
    // The card that the pill shows on hover would stay under the picker: it waits until the pointer leaves
    suppressedTaskCard = taskId;
    document
      .querySelector(`button.task-pill[data-id="${taskId}"]`)
      ?.closest('.task-pr-wrap')
      ?.classList.add('card-suppressed');
  }
  const parent = model.workItems.find((item) => item.id === parentId);
  const children = model.workItems.filter((child) => child.parentId === parentId);
  const task = parent && taskRowsOf(children, parent, model.stateOrder).find((row) => row.id === taskId);
  if (task) {
    showActions(taskActionsRequest(task, parentId));
  }
}

/** Click on the ... of a Checkout / Open worktree button: the branch of a card, a branch row, or a PR */
function showCheckoutActions(kind: CheckoutKind, id: number, branch: string | undefined): void {
  if (!model) {
    return;
  }
  const requests: Record<CheckoutKind, () => ActionsRequest | undefined> = {
    workItem: () => {
      const card = model?.workItems.find((item) => item.id === id);
      return card && workItemActionsRequest(card, branch);
    },
    review: () => {
      const request = model?.reviews.requests.find((candidate) => candidate.id === id);
      return request && pullRequestActionsRequest('review', request);
    },
    myPullRequest: () => {
      const pr = model?.pullRequests.items.find((candidate) => candidate.id === id);
      return pr && pullRequestActionsRequest('myPullRequest', pr);
    },
    // The icons of a task row open the pill's picker, not a Checkout button
    task: () => undefined,
  };
  showActions(requests[kind]());
}

document.addEventListener('click', (event) => {
  const file = (event.target as HTMLElement).closest<HTMLElement>('[data-action="openFile"]');
  if (file?.dataset.path) {
    post({ type: 'openFile', path: file.dataset.path });
    return;
  }
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action], [data-filter]');
  // The text of a popover is not the row behind it: clicking it must not fold the row
  const popover = '.popover';
  if (!target || ((event.target as HTMLElement).closest(popover) && !target.closest(popover))) {
    return;
  }
  const { action, filter, value, id, pr, run, url, path, view, kind, layout, branch, panel, task, parent } =
    target.dataset;
  if (filter && value !== undefined) {
    toggleFilter(filter as FilterKind, value);
  } else if (action === 'taskActions' && id) {
    // detail 0: the click comes from the keyboard (Enter, Space): the card of the pill is not in the way then
    showTaskActions(Number(id), Number(parent), event.detail > 0);
  } else if ((action === 'checkoutMenu' || action === 'worktreeMenu') && kind && id) {
    showCheckoutActions(kind as CheckoutKind, Number(id), branch);
  } else if ((action === 'checkoutHere' || action === 'openWorktree' || action === 'removeWorktree') && kind && id) {
    post({ type: action, kind: kind as CheckoutKind, id: Number(id), branch });
  } else if (action === 'refresh') {
    post({ type: 'refresh' });
  } else if (action === 'toggleIteration' && path !== undefined) {
    if (!collapsedIterations.delete(path)) {
      collapsedIterations.add(path);
    }
    saveState();
    render();
  } else if (action === 'toggleCard' && id) {
    // Rendering again drops the focus of the chevron, which keyboard users need to stay on
    const fromChevron = target.classList.contains('card-chevron');
    toggleCard(
      Number(id),
      fromChevron ? () => document.querySelector<HTMLElement>(`.card-chevron[data-id="${id}"]`)?.focus() : undefined
    );
  } else if (action === 'setLayout' && (layout === 'compact' || layout === 'large')) {
    // Shown right away; the extension saves it and posts the view again
    if (model && model.layout !== layout) {
      model = { ...model, layout };
      renderMorphing();
      post({ type: 'setLayout', layout });
    }
  } else if (action === 'setPanelLayout' && (panel === 'reviews' || panel === 'myPullRequests')) {
    if (layout === 'compact' || layout === 'large') {
      setPanelLayout(panel, layout);
    }
  } else if (action === 'toggleReviewRow' && id) {
    toggleRow(expandedReviews, Number(id), 'toggleReviewRow');
  } else if (action === 'toggleReviewedRow' && id) {
    toggleReviewedRow(Number(id));
  } else if (action === 'toggleMyPullRequestRow' && id) {
    toggleRow(expandedPullRequests, Number(id), 'toggleMyPullRequestRow');
  } else if (action === 'toggleOptional' && model) {
    post({ type: 'setShowOptional', show: !model.reviews.includeOptional });
  } else if (action === 'expandAllTasks' || action === 'collapseAllTasks') {
    setTasksExpanded(action === 'expandAllTasks');
  } else if (action === 'toggleTasks' && id) {
    toggleTasks(Number(id));
  } else if (action === 'toggleFilters' || action === 'showFilters') {
    filtersExpanded = action === 'showFilters' ? true : !filtersExpanded;
    saveState();
    render();
  } else if (action === 'toggleReviews') {
    reviewsCollapsed = !reviewsCollapsed;
    saveState();
    // The box itself grows or shrinks, its rows are part of it (named on their own they would spill out of it)
    renderMorphing(undefined, { items: false });
  } else if (action === 'toggleMyPullRequests') {
    myPullRequestsCollapsed = !myPullRequestsCollapsed;
    saveState();
    renderMorphing(undefined, { items: false });
  } else if (action === 'checkMyPullRequests') {
    post({ type: 'checkMyPullRequests' });
  } else if (action === 'toggleDrafts' && model) {
    post({ type: 'setShowDrafts', show: !model.pullRequests.showDrafts });
  } else if (action === 'checkoutMyPullRequest' && pr) {
    post({ type: 'checkoutMyPullRequest', pullRequestId: Number(pr) });
  } else if (action === 'addBuildNotesSkipTag' && pr) {
    post({ type: 'addBuildNotesSkipTag', pullRequestId: Number(pr) });
  } else if (action === 'retargetMyPullRequest' && pr) {
    post({ type: 'retargetMyPullRequest', pullRequestId: Number(pr) });
  } else if (action === 'publishMyPullRequest' && pr) {
    post({ type: 'publishMyPullRequest', pullRequestId: Number(pr) });
  } else if (action === 'openMyPullRequest' && url) {
    post({ type: 'openMyPullRequest', url });
  } else if (action === 'checkReviewRequests') {
    post({ type: 'checkReviewRequests' });
  } else if (action === 'checkoutReviewRequest' && pr) {
    post({ type: 'checkoutReviewRequest', pullRequestId: Number(pr) });
  } else if (action === 'openReviewRequest' && url) {
    post({ type: 'openReviewRequest', url });
  } else if (action === 'toggleAlerts') {
    onlyAlerts = !onlyAlerts;
    saveState();
    render();
  } else if (action && id) {
    post({
      type: action as WorkItemActionMessage['type'],
      id: Number(id),
      pullRequestId: pr ? Number(pr) : undefined,
      runId: run ? Number(run) : undefined,
      view: view === 'tests' || view === 'coverage' ? view : undefined,
      branch,
      taskId: task ? Number(task) : undefined,
    });
  }
});

// The width of the sidebar changes the perimeter of the cards, hence the duration of their running light
window.addEventListener('resize', placeRunningLights);

window.addEventListener('message', ({ data }: MessageEvent<ExtensionMessage>) => {
  if (data.type === 'setTasksExpanded') {
    setTasksExpanded(data.expanded);
    return;
  }
  if (data.type === 'revealWorkItem') {
    revealId = data.id;
    if (revealPending()) {
      render();
    }
    return;
  }
  // While the last filter is not saved, the extension still sends older filters: keep the user's one
  if (pendingFilter && changedFilterKeys(data.model.filter, pendingFilter).length) {
    model = { ...data.model, filter: pendingFilter };
  } else {
    pendingFilter = undefined;
    ({ model } = data);
  }
  trackNewReviews(model);
  pruneExpandedPullRequests(model);
  render();
  syncReviewedExpanded();
});

post({ type: 'ready' });
