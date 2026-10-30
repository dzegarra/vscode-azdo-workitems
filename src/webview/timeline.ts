/** The Sprint timeline webview (redesign): the work of the sprint on a working-days axis, with the reviews and develop */
import { escapeHtml } from '../html';
import { icon } from '../icons';
import { lookClass } from '../look';
import type { TimelineUpdate } from '../sprintTimeline';
import type {
  DevelopSpan,
  PullRequestChild,
  RowLabel,
  TaskChild,
  TimelineChild,
  TimelineMarker,
  TimelineMessage,
  TimelineModel,
  TimelinePopover,
  TimelineRow,
  TimelineSection,
  TimelineSegment,
  TimelineTeam,
} from '../sprintTimelineModel';
import { EMPTY_PEOPLE_HINT } from '../teamPeople';
import { packMarks } from '../timelineLayout';
import {
  collapseAll,
  expandedIds,
  isExpanded,
  parseChoices,
  sameIds,
  toggleRow,
  type ExpansionChoices,
} from '../timelineExpansion';
import type { BoardAction } from '../trackBoardModel';
import {
  avatarHtml,
  closePickerOnEscape,
  rememberPicker,
  renderPeoplePicker,
  renderScope,
  restorePicker,
  startPeoplePicker,
} from './peoplePicker';
import { renderSprintTeams } from './sprintTeams';
import type { TimelineDuplicate } from '../duplicates';
import { isTimelineViewSwitch, type TimelineViewSwitch } from '../timelineView';
import { asleepKnown, loadingText, workItemsLoading } from '../timelineFooter';
import {
  canZoomOut,
  dayMinWidth,
  DEFAULT_ZOOM,
  drawnDayWidth,
  easeOut,
  fitZoom,
  isZoomWheel,
  MAX_ZOOM,
  nextZoomIn,
  nextZoomOut,
  scrollAfterZoom,
  wheelZoom,
  zoomKeyName,
  ZOOM_SAVE_DELAY_MS,
  ZOOM_TRANSITION_MS,
} from '../timelineZoom';

interface VsCodeApi {
  postMessage(message: TimelineMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
let model: TimelineModel | undefined;
let lastModel: string | undefined;
/** The buttons and clicks of the last render: the markup only names them */
let messages = new Map<string, TimelineMessage>();
let popovers = new Map<string, TimelinePopover>();
let tips = new Map<string, { tip: TimelineMarker['tip']; tone: string }>();
/** The rows the user expanded or collapsed, by work item id (Rule TIMELINE-18): UI-only, kept with the webview state */
let choices: ExpansionChoices = {};
/** The expanded work items the panel was told about (it reads the history of their PRs): posted only when they change */
let postedIds: number[] = [];
/** Rule TIMELINE-34: the legend panel is open (closed by default, UI-only) */
let legendOpen = false;
/** Rule TIMELINE-45: the panel of the view options is open */
let optionsOpen = false;
/** Rule TIMELINE-46: the setting of the model drawn */
let dimCompleted = true;
/** Rule TIMELINE-40: the menu of sprints on the title is open */
let sprintMenuOpen = false;
/** Rule TIMELINE-48: the zoom drawn (percent of the width of a day): applied at once, saved after a pause */
let zoom = DEFAULT_ZOOM;
/** Rule TIMELINE-49: the zoom at which the whole axis fits the lanes (measured after drawing and on resize) */
let fit = 0;
/** Rule TIMELINE-49: the day width (px) drawn while the transition of a zoom button runs; undefined otherwise */
let dayWidthShown: number | undefined;
let zoomFrame: number | undefined;
let zoomTimer: number | undefined;
/** The width under which a bar is drawn wider than its days: its padding and its text need room (media/timeline.css) */
const MIN_BAR_PX = 16;
/** Rule TIMELINE-49: a zoom animation (and the re-layout after it) is running: the zoom buttons are disabled */
let zoomBusy = false;
/** Rule TIMELINE-48: the zoom last written to the setting, and the one the last model carried (to tell a change made elsewhere) */
let lastPostedZoom: number | undefined;
let lastModelZoom: number | undefined;
/** Rule TIMELINE-49: the zoom wheel is gathered here and applied once per frame */
let wheelDelta = 0;
let wheelX = 0;
let wheelFrame: number | undefined;

function savedState(): Record<string, unknown> {
  const state = vscode.getState();
  return state && typeof state === 'object' ? { ...state } : {};
}
choices = parseChoices(savedState().expansion);

const post = (message: TimelineMessage): void => vscode.postMessage(message);

/** A message behind a name that the markup carries */
function named(message: TimelineMessage): string {
  const key = `m${String(messages.size)}`;
  messages.set(key, message);
  return key;
}

function actionButton(action: BoardAction & { primary: boolean }, kind: 'needsYou' | 'plain'): string {
  return `<button class="tl-act${action.primary ? ' primary' : ''}${
    kind === 'needsYou' ? ' needs-you' : ''
  }" data-msg="${named(action.message)}">${escapeHtml(action.label)}</button>`;
}

function renderSegment(segment: TimelineSegment, popoverKey?: string): string {
  const classes = ['tl-seg', `seg-${segment.kind}`];
  if (segment.approximate) {
    classes.push('approximate');
  }
  if (segment.dashed) {
    classes.push('dashed');
  }
  if (segment.after) {
    // Rule TIMELINE-31: past the end of the sprint, faded under the hatch of the margin
    classes.push('after');
  }
  const attrs = popoverKey ? ` data-popover="${popoverKey}" tabindex="0" role="button"` : '';
  // Rule TIMELINE-8: no update: the text of the bar ends with a bold orange zZ (the bar keeps the colour of its state)
  const zz = segment.asleep ? `${segment.text ? ' · ' : ''}<b class="tl-zz">zZ</b>` : '';
  return `<span class="${classes.join(' ')}" data-from="${String(segment.start)}" data-to="${String(
    segment.end
  )}" title="${escapeHtml(segment.tip)}"${attrs}>${escapeHtml(segment.text ?? '')}${zz}</span>`;
}

const tagHtml = (tag: NonNullable<RowLabel['tag']>): string =>
  `<span class="tl-tag tag-${tag.tone}">${escapeHtml(tag.text)}</span>`;

const pillHtml = (pr: { text: string; merged?: boolean }): string =>
  `<span class="tl-pr${pr.merged ? ' merged' : ''}${pr.text.startsWith('draft') ? ' draft' : ''}">${
    pr.merged ? '✓ ' : ''
  }${escapeHtml(pr.text)}</span>`;

/* ---------- Markers (Rule TIMELINE-27) ---------- */

/** What a marker looks like: the classes the CSS paints and the text inside */
function markerHtml(marker: TimelineMarker, positioned: boolean): string {
  const classes = ['tl-mk', `mk-${marker.kind}`];
  if (marker.tone) {
    classes.push(`mk-${marker.tone}`);
  }
  if ((marker.count ?? 1) > 1 && ['comments', 'commit', 'push'].includes(marker.kind)) {
    // Rule TIMELINE-42: a burst of commits, pushes or comments is one bigger mark
    classes.push('many');
  }
  if (marker.atRest) {
    // Rule TIMELINE-33: a problem is shown at rest; the other marks on the hover of the row
    classes.push('at-rest');
  }
  const key = `t${String(tips.size)}`;
  tips.set(key, { tip: marker.tip, tone: marker.tone === 'fail' ? 'reject' : marker.kind });
  const label = [marker.tip.title, ...marker.tip.lines].join('. ');
  const place = positioned ? ` data-from="${String(marker.at)}"` : '';
  return `<span class="${classes.join(' ')}"${place} data-tip="${key}" tabindex="0" role="img" aria-label="${escapeHtml(
    label
  )}">${escapeHtml(marker.text)}</span>`;
}

/* ---------- Rows ---------- */

/** Rule TIMELINE-15: the first line of a label starts with the tag that says whose title follows */
function renderLabel(row: TimelineRow, expanded: boolean): string {
  const label = row.label;
  const open = `data-msg="${named(row.open)}" title="Open #${String(row.id)}"`;
  const here = row.here
    ? '<span class="tl-here" title="Its branch is checked out in this window" aria-label="Its branch is checked out in this window">● here</span>'
    : '';
  const chevron = row.expandable ? `<span class="tl-chev" aria-hidden="true">${expanded ? '▾' : '▸'}</span>` : '';
  const toggle = row.expandable
    ? ` data-row="${String(row.id)}" tabindex="0" role="button" aria-expanded="${String(expanded)}" aria-label="${
        expanded ? 'Collapse' : 'Expand'
      } #${String(row.id)}"`
    : '';
  if (!label) {
    return `<div class="tl-label" tabindex="0" role="button" ${open}><span class="tl-id${
      row.bug ? ' bug' : ''
    }">${escapeHtml(row.header)}</span><span class="tl-title">${escapeHtml(row.title)}</span></div>`;
  }
  const idTone = label.tag && label.tag.tone !== 'task' ? ` id-${label.tag.tone}` : '';
  const id = label.id
    ? `<span class="tl-id link${idTone}" ${open} tabindex="0" role="link">${escapeHtml(label.id)}</span>`
    : '';
  const head = [
    label.tag ? tagHtml(label.tag) : '',
    id,
    label.pr ? pillHtml(label.pr) : '',
    label.state ? `<span class="tl-state">${escapeHtml(label.state)}</span>` : '',
    label.meta ? `<span class="tl-meta">${escapeHtml(label.meta)}</span>` : '',
  ].join('');
  if (row.expandable) {
    return `<div class="tl-label wi"${toggle}><span class="tl-l1">${chevron}${head}${here}</span><span class="tl-title strong">${escapeHtml(
      row.title
    )}</span></div>`;
  }
  return `<div class="tl-label" tabindex="0" role="button" ${open}><span class="tl-l1">${head}${here}</span><span class="tl-title">${escapeHtml(
    row.title
  )}</span></div>`;
}

// Rule TIMELINE-28
/** The row of a PR: while its history is read it is busy and says so; when it could not be read it says that */
function renderPullRequestChild(child: PullRequestChild, last: boolean): string {
  // Rules TIMELINE-28, TIMELINE-39: while something of the PR is read a soft light sweeps along the row; no visible
  // text (near the end of the sprint it would fall off the right edge), only a status for screen readers
  const loading = child.history === 'loading' || child.detailsLoading === true;
  const open = `data-msg="${named(child.open)}" title="Open PR ${String(child.prId)}"`;
  const segments = child.segments.map((segment) => renderSegment(segment)).join('');
  const markers = child.markers.map((marker) => markerHtml(marker, true)).join('');
  const merged = child.merged
    ? `<span class="tl-note tone-merged" data-from="${String(child.merged.at)}">${escapeHtml(child.merged.text)}</span>`
    : '';
  const action = child.action ? actionButton(child.action, 'plain') : '';
  const after = merged || action ? `<span class="tl-after" data-from="${String(child.end)}">${action}</span>` : '';
  let status = '';
  if (loading) {
    status = `<span class="visually-hidden" role="status">Loading the history of PR ${String(child.prId)}</span>`;
  } else if (child.history === 'error') {
    status = '<span class="tl-loading error">History could not be read</span>';
  } else if (child.undated) {
    status = '<span class="tl-loading start">dates not known</span>';
  }
  return `<div class="tl-row child pr${child.merged && dimCompleted ? ' faded' : ''}${
    loading ? ' loading' : ''
  }" data-pr="${String(child.prId)}" aria-busy="${String(loading)}"><div class="tl-label child${
    last ? ' last' : ''
  }" tabindex="0" role="button" ${open}><span class="tl-l1">${pillHtml(child.pill)}<span class="tl-title">${escapeHtml(
    child.title
  )}</span></span><span class="tl-sub">${escapeHtml(
    child.sub
  )}</span></div><div class="tl-lane"><div class="tl-strip">${markers}</div>${segments}${merged}${after}${status}</div></div>`;
}

function renderTaskChild(child: TaskChild, last: boolean): string {
  const open = `data-msg="${named(child.open)}" title="Open task ${String(child.taskId)}"`;
  const segments = child.segments.map((segment) => renderSegment(segment)).join('');
  const action = child.action ? actionButton(child.action, 'plain') : '';
  return `<div class="tl-row child task${child.done && dimCompleted ? ' faded' : ''}"><div class="tl-label child${
    last ? ' last' : ''
  }" tabindex="0" role="button" ${open}><span class="tl-l1">${tagHtml({
    text: 'Task',
    tone: 'task',
  })}<span class="tl-title">${escapeHtml(child.title)}</span></span><span class="tl-sub">${escapeHtml(
    child.sub
  )}</span></div><div class="tl-lane">${segments}${
    action ? `<span class="tl-after" data-from="${String(child.end)}">${action}</span>` : ''
  }</div></div>`;
}

function renderChild(child: TimelineChild, last: boolean): string {
  switch (child.kind) {
    case 'pr':
      return renderPullRequestChild(child, last);
    case 'task':
      return renderTaskChild(child, last);
    case 'placeholder':
      return `<div class="tl-row child placeholder"><div class="tl-label child last"><span class="tl-title empty">${escapeHtml(
        child.text
      )}</span></div><div class="tl-lane"><span class="tl-hint">${escapeHtml(child.hint)}</span></div></div>`;
  }
}

function renderRow(row: TimelineRow): string {
  const expanded = isExpanded(row, choices);
  const label = renderLabel(row, expanded);
  let popoverKey: string | undefined;
  if (row.popover) {
    popoverKey = `p${String(popovers.size)}`;
    popovers.set(popoverKey, row.popover);
  }
  const classes = ['tl-row'];
  if (row.expandable) {
    classes.push('wi');
    if (expanded) {
      classes.push('expanded');
    }
  }
  if (row.readOnly) {
    // Rule TIMELINE-23: the same row as the user's, without buttons
    classes.push('read-only');
  }
  // Rule TIMELINE-46: the completed rows are dimmed unless the setting says no; a work item moved out always is
  if (row.faded && (dimCompleted || row.movedOut)) {
    classes.push('faded');
  }
  if (row.vote) {
    classes.push('tl-voted');
  }
  if (row.loading) {
    classes.push('loading');
  }
  const segments = row.segments
    .map((segment) => renderSegment(segment, segment.asleep ? popoverKey : undefined))
    .join('');
  const chip =
    row.chip && row.segments.at(0) && row.segments[0].start > 1.3
      ? `<span class="tl-chip">${escapeHtml(row.chip)}</span>`
      : '';
  // Rule TIMELINE-44: where a work item of a past sprint went is a pill ("→ Sprint 124"), its detail after it
  let note = '';
  if (row.note?.tone === 'moved') {
    const detail = row.note.detail ? `<span class="tl-dest-detail">· ${escapeHtml(row.note.detail)}</span>` : '';
    note = `<span class="tl-note tone-moved"><span class="tl-dest">${escapeHtml(row.note.text)}</span>${detail}</span>`;
  } else if (row.note) {
    note = `<span class="tl-note tone-${row.note.tone}">${escapeHtml(row.note.text)}</span>`;
  }
  // Rule TIMELINE-35: the badge of a final state at the moment it changed; what the row says follows it
  const finish = row.finish
    ? `<span class="tl-fin fin-${row.finish.kind}" data-from="${String(row.finish.at)}" title="${escapeHtml(
        row.finish.tip
      )}" tabindex="0" role="img" aria-label="${escapeHtml(row.finish.tip)}">${escapeHtml(row.finish.text)}</span>`
    : '';
  const merged = row.merged
    ? `<span class="tl-note tone-merged${row.finish ? ' badged' : ''}${
        row.merged.almostDone ? ' almost-done' : ''
      }" data-from="${String(row.merged.at)}">${escapeHtml(row.merged.text)}</span>`
    : '';
  // Rule TIMELINE-37: the user's vote on a PR they reviewed
  const vote = row.vote
    ? markerHtml({ kind: row.vote.kind, at: row.vote.at, text: row.vote.text, tip: row.vote.tip, atRest: true }, true)
    : '';
  const action = row.action
    ? actionButton(row.action, row.segments.some((segment) => segment.kind === 'needsYou') ? 'needsYou' : 'plain')
    : '';
  const rowAttrs = row.expandable ? ` data-row="${String(row.id)}" data-wi="${String(row.id)}"` : '';
  let lane: string;
  if (row.outline) {
    // Rule TIMELINE-9: the outline and its button share the lane (the outline gives way), so nothing overflows it
    const outline = `<span class="tl-outline${row.outline.broken ? ' broken' : ''}">${escapeHtml(
      row.outline.text
    )}</span>`;
    lane = `${chip}<div class="tl-fill">${outline}${action}</div>`;
  } else {
    const after = note || action ? `<span class="tl-after" data-from="${String(row.end)}">${note}${action}</span>` : '';
    lane = `${chip}${segments}${vote}${finish}${merged}${after}`;
  }
  const children =
    expanded && row.children
      ? `<div class="tl-children">${row.children
          .map((child, index, all) => renderChild(child, index === all.length - 1))
          .join('')}</div>`
      : '';
  return `<div class="${classes.join(' ')}"${rowAttrs}>${label}<div class="tl-lane">${lane}</div></div>${children}`;
}

function renderDevelop(develop: TimelineModel['develop']): string {
  const spans = develop.spans
    .map(
      (span: DevelopSpan) =>
        `<span class="tl-dev ${span.red ? 'red' : 'green'}" data-from="${String(span.start)}" data-to="${String(
          span.end
        )}" title="${escapeHtml(span.tip)}"></span>`
    )
    .join('');
  const label = develop.label
    ? `<span class="tl-note tone-overdue" data-from="${String(develop.label.at)}">${escapeHtml(
        develop.label.text
      )}</span>`
    : '';
  const note = develop.note ? `<span class="tl-empty">${escapeHtml(develop.note)}</span>` : '';
  // Rule TIMELINE-38: a tick per merged PR, and the PR merged before each red span
  const merges = develop.merges
    .map(
      (merge) =>
        `<span class="tl-dev-tick" data-from="${String(merge.at)}" title="${escapeHtml(
          merge.tip
        )}" aria-label="${escapeHtml(merge.tip)}"></span>`
    )
    .join('');
  const culprits = develop.culprits
    .map(
      (culprit) => `<span class="tl-dev-culprit" data-from="${String(culprit.at)}">${escapeHtml(culprit.text)}</span>`
    )
    .join('');
  return `<div class="tl-row tl-row-develop"><div class="tl-label plain"><span class="tl-title">Pipelines on ${escapeHtml(
    develop.branch
  )}</span></div><div class="tl-lane">${spans}${merges}${culprits}${label}${note}</div></div>`;
}

const MOVED_OUT_HINT = 'in this sprint for a while, then moved to another iteration or to someone else before it ended';

function section(title: string, body: string, note?: string, sub = false, hint?: string): string {
  const hintHtml = hint ? `<span class="tl-section-hint">${escapeHtml(hint)}</span>` : '';
  return `<h2 class="tl-section${sub ? ' sub' : ''}">${escapeHtml(title)}${hintHtml}</h2>${
    note ? `<p class="tl-empty-row">${escapeHtml(note)}</p>` : ''
  }${body}`;
}

// Rule TIMELINE-34
/**
 * The legend, behind the Legend button of the header: work item rows, then PR rows (phases, what the hover shows, the
 * problems), then reviews
 */
function renderLegend(team: boolean): string {
  const item = (cls: string, label: string): string =>
    `<span class="tl-key"><span class="tl-swatch seg-${cls}"></span>${label}</span>`;
  const sample = (marker: Pick<TimelineMarker, 'kind' | 'text' | 'tone'>, label: string): string =>
    `<span class="tl-key"><span class="tl-mk static mk-${marker.kind}${
      marker.tone ? ` mk-${marker.tone}` : ''
    }">${escapeHtml(marker.text)}</span>${label}</span>`;
  // Rule TIMELINE-35: the badge of a final state
  const badge = (kind: 'done' | 'removed', text: string, label: string): string =>
    `<span class="tl-key"><span class="tl-fin static fin-${kind}">${text}</span>${label}</span>`;
  const group = (title: string, lines: string[]): string =>
    `<div class="tl-legend-group"><span class="tl-legend-title">${title}</span>${lines
      .map((line) => `<div class="tl-legend-line">${line}</div>`)
      .join('')}</div>`;
  // Rule TIMELINE-35: the work item rows draw states
  const workItems = group('WORK ITEM ROWS', [
    `${item('stateNew', 'New')}${item('stateApproved', 'Approved')}${item('stateCommitted', 'Committed')}${item(
      'stateInReview',
      'In review (from the first PR published)'
    )}${item('stateReadyToTest', 'Ready to Test (Bug) · almost done')}${item('stateReopened', 'ReOpened')}`,
    `${badge('done', '✓', 'Done / Closed, at the moment it changed')}${badge(
      'removed',
      '✕',
      'Removed'
    )}<span class="tl-key"><b class="tl-zz">zZ</b> in a segment's text: no update for days</span><span class="tl-key dep">⛓ dependency</span>`,
  ]);
  const pullRequests = group('PR ROWS', [
    `${item('taskToDo', 'task to do')}${item('implementation', 'Implementation · task in progress')}${item(
      'draft',
      'Draft'
    )}${item('review', 'Review')}${item('ready', 'Ready to merge')}<span class="tl-key">✓ Merged</span>`,
    `${sample({ kind: 'commit', text: '', tone: undefined }, 'commit')}${sample(
      { kind: 'push', text: '', tone: undefined },
      'push'
    )}${sample({ kind: 'ci', text: '✓', tone: 'pass' }, 'CI run')}${sample(
      { kind: 'ci', text: '', tone: 'running' },
      'running'
    )}${sample({ kind: 'reviewers', text: 'MN', tone: undefined }, 'reviewer added')}${sample(
      { kind: 'approve', text: 'AR', tone: undefined },
      'approved'
    )}${sample({ kind: 'wait', text: 'JB', tone: undefined }, 'waits for author')}${sample(
      { kind: 'reject', text: 'MN', tone: undefined },
      'rejected'
    )}${sample({ kind: 'autoComplete', text: 'A', tone: undefined }, 'auto-complete')}${sample(
      { kind: 'comments', text: '', tone: undefined },
      'comment'
    )}`,
    `${sample({ kind: 'ci', text: '✕', tone: 'fail' }, 'latest CI run failed')}${sample(
      { kind: 'conflicts', text: '⚠', tone: undefined },
      'conflicts now'
    )}`,
  ]);
  const reviews = group('REVIEWS', [
    `${item('wait', 'waiting for your review')}${item('dueSoon', 'due soon')}${item('overdue', 'overdue')}${
      team ? item('overdue', 'review overdue (others)') : ''
    }`,
  ]);
  return `<div class="tl-legend" id="tl-legend" role="dialog" aria-label="Legend">${workItems}${pullRequests}${reviews}</div>`;
}

/** The rows that can be expanded, wherever they are drawn */
function expandableRows(current: TimelineModel): TimelineRow[] {
  const team = current.scope === 'team' ? current.team : undefined;
  return [
    ...current.work,
    ...current.finished,
    ...(team?.sections.flatMap((person) => [...person.rows, ...person.finished]) ?? []),
  ].filter((row) => row.expandable);
}

// Rule TIMELINE-40
/** ‹ title › : the previous and next sprints, and a menu of the current one and the 4 before it on the title */
function renderSprintSwitch(current: TimelineModel, teams: string): string {
  const offsets = current.sprints.map((sprint) => sprint.offset);
  const older = offsets.includes(current.sprintOffset + 1);
  const newer = current.sprintOffset > 0;
  const step = (direction: 'newer' | 'older', enabled: boolean, label: string, glyph: string): string =>
    `<button class="bd-icon-button tl-sprint-step" data-sprint-step="${direction}" aria-label="${label}" title="${label}"${
      enabled ? '' : ' disabled'
    }>${glyph}</button>`;
  const menu = sprintMenuOpen
    ? `<div class="tl-sprint-list" role="listbox" aria-label="Sprints"><span class="tl-sprint-head" aria-hidden="true">THIS SPRINT AND THE 4 BEFORE</span>${current.sprints
        .map(
          (sprint) =>
            `<button class="tl-sprint-option" role="option" data-sprint="${String(
              sprint.offset
            )}" aria-selected="${String(sprint.offset === current.sprintOffset)}"><span class="tl-sprint-check">${
              sprint.offset === current.sprintOffset ? '✓' : ''
            }</span><span class="tl-sprint-name">${escapeHtml(sprint.title)}${
              sprint.offset === 0 ? ' · current' : ''
            }</span><span class="tl-sprint-when">${escapeHtml(sprint.dates ?? '')}</span></button>`
        )
        .join('')}</div>`
    : '';
  return `<div class="tl-sprint-switch">${step(
    'older',
    older,
    'Previous sprint',
    '‹'
  )}<h1 class="bd-sprint"><button class="tl-sprint-title" data-sprint-menu aria-haspopup="listbox" aria-expanded="${String(
    sprintMenuOpen
  )}" title="Choose the sprint">${escapeHtml(
    current.header.sprint
  )}${teams}<span class="tl-sprint-caret" aria-hidden="true">▾</span></button></h1>${step(
    'newer',
    newer,
    'Next sprint',
    '›'
  )}${menu}</div>`;
}

// Rule TIMELINE-45
/** The panel of the view options: one switch per option (personal settings), and where the dimming is set */
function renderViewOptions(current: TimelineModel): string {
  const option = (id: TimelineViewSwitch, title: string, sub: string): string =>
    `<button class="tl-switch" role="switch" data-view-option="${id}" aria-checked="${String(
      current.options[id]
    )}"><span class="tl-switch-text"><span class="tl-switch-title">${escapeHtml(
      title
    )}</span><span class="tl-switch-sub">${escapeHtml(
      sub
    )}</span></span><span class="tl-switch-track" aria-hidden="true"><span class="tl-switch-knob"></span></span></button>`;
  return `<div class="tl-legend tl-options" id="tl-options" role="dialog" aria-label="View options"><h2>VIEW OPTIONS · MINE AND WHOLE TEAM</h2>${option(
    'showReviewed',
    'Display your PRs to review',
    'The PRs of others you already voted on, under the reviews you owe'
  )}${option(
    'groupDone',
    'Group completed Work Items',
    'In "DONE THIS SPRINT". Off: each in its place among the open ones'
  )}${option(
    'groupMovedOut',
    'Group re-scheduled Work Items',
    'Past sprints: in "MOVED OUT DURING THE SPRINT". Off: each in its place among the others, still faded, with its → pill'
  )}${option(
    'showDevelop',
    `Display the status of the "${current.develop.branch}" branch`,
    'The runs of the protected branch under the work'
  )}${option(
    'alwaysShowPrEvents',
    'PR events always visible',
    'Show the commits, pushes, comments, CI runs and reviews on every PR row, without hovering it'
  )}<p class="tl-options-foot">Completed rows dimmed or not: <button class="tl-link" data-open-dim-setting>Dim completed rows</button> in Settings</p></div>`;
}

/** Rule TIMELINE-49: on macOS the "ctrl" modifier is Cmd too */
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

// Rule TIMELINE-48
/** One of the three zoom buttons of the header: an icon, named by its tooltip, disabled at its limit */
function zoomButton(
  id: 'in' | 'out' | 'reset',
  text: string,
  name: 'zoomIn' | 'zoomOut' | 'zoomReset',
  off: boolean
): string {
  return `<button class="icon-only" data-zoom="${id}" aria-label="${text}" title="${text}"${
    off ? ' disabled' : ''
  }>${icon(name)}</button>`;
}

function renderHeader(current: TimelineModel): string {
  const key = zoomKeyName(current.zoomModifier, IS_MAC);
  const left = current.header.left
    ? `<span class="bd-left${current.header.hurry ? ' hurry' : ''}">${escapeHtml(current.header.left)}</span>`
    : '';
  const team = current.scope === 'team' ? current.team : undefined;
  const stats = team
    ? `<span class="bd-stats">${String(team.sections.length)} ${
        team.sections.length === 1 ? 'person' : 'people'
      } shown · ${String(team.openItems)} open items</span>`
    : '';
  const teams = !current.header.teams && team && team.teamCount > 1 ? ` · ${String(team.teamCount)} teams` : '';
  const anyExpanded = expandedIds(expandableRows(current), choices).length > 0;
  // Rule TIMELINE-32: the row style of the view shown. Rule TIMELINE-45: the buttons of the header are icons
  const density = (id: TimelineModel['density'], text: string, name: 'rows' | 'rowsCompact'): string =>
    `<button class="icon-only" data-density="${id}" aria-pressed="${String(
      current.density === id
    )}" aria-label="${text}" title="${text}">${icon(name)}</button>`;
  return `<header class="bd-header">${renderSprintSwitch(current, teams)}${
    current.header.dates ? `<span class="bd-left">${escapeHtml(current.header.dates)}</span>` : ''
  }${renderSprintTeams(current.header.teams)}${left}${stats}
    <div class="tl-tools">${renderScope(current.scope, true)}${renderPeoplePicker(team?.picker)}
    <div class="bd-segment" role="group" aria-label="Row style of this view">${density(
      'normal',
      'Normal rows',
      'rows'
    )}${density('compact', 'Compact rows', 'rowsCompact')}</div>
    <div class="bd-segment tl-zoom" role="group" aria-label="Zoom of the timeline">${zoomButton(
      'out',
      `Zoom out (${key} + wheel)`,
      'zoomOut',
      zoomBusy || !canZoomOut(zoom, fit)
    )}${zoomButton('in', `Zoom in (${key} + wheel)`, 'zoomIn', zoomBusy || zoom >= MAX_ZOOM)}${zoomButton(
    'reset',
    `Reset zoom (${String(DEFAULT_ZOOM)} %)`,
    'zoomReset',
    zoomBusy || zoom === DEFAULT_ZOOM
  )}</div>
    <div class="tl-legend-anchor"><button class="tl-tool" data-legend aria-expanded="${String(
      legendOpen
    )}" aria-controls="tl-legend" aria-label="Legend" title="Legend">${icon('info')}</button>${
    legendOpen ? renderLegend(team !== undefined) : ''
  }</div>
    <button class="tl-tool" data-collapse-all aria-label="Collapse all" title="Collapse every work item row"${
      anyExpanded ? '' : ' disabled'
    }>${icon('collapseAll')}</button>
    <button class="tl-tool" data-refresh title="Refresh" aria-label="Refresh">${icon('sync')}</button>
    <div class="tl-legend-anchor"><button class="tl-tool" data-view-options aria-haspopup="dialog" aria-expanded="${String(
      optionsOpen
    )}" aria-controls="tl-options" aria-label="View options" title="View options: sections and the ${escapeHtml(
    current.develop.branch
  )} bar">${icon('sliders')}</button>${optionsOpen ? renderViewOptions(current) : ''}</div></div></header>`;
}

function renderDays(current: TimelineModel): string {
  return current.days
    .map(
      (day) =>
        `<span title="${escapeHtml(day.date)}" class="tl-day${day.weekStart ? ' week' : ''}${
          day.today ? ' today' : ''
        }${day.after ? ' after' : ''}${day.before ? ' before' : ''}">${escapeHtml(day.label)}${
          day.last ? ' · end' : ''
        }</span>`
    )
    .join('');
}

/** Rule TIMELINE-21: the header of a person's section: avatar, name, what they have, and a sentence in the lane */
function renderPersonHeader(person: TimelineSection): string {
  return `<div class="tl-row tl-person${person.you ? ' you' : ''}"><div class="tl-plabel">${avatarHtml(
    person.initials,
    person.colour
  )}<b class="tl-pname">${escapeHtml(person.name)}</b><span class="tl-pmeta">${escapeHtml(
    person.meta
  )}</span></div><div class="tl-psummary">${escapeHtml(person.summary)}</div></div>`;
}

/** The lines under the header while the data of the team is not there yet, or could not be read */
function teamStatusHtml(team: TimelineTeam): string {
  // Rule TIMELINE-50: the loading of the team is said by the footer and drawn as skeleton rows
  if (team.status === 'error') {
    return `<p class="message error">The work of the team could not be loaded: ${escapeHtml(
      team.error ?? 'error'
    )} <button class="bd-chip" data-refresh>Retry</button></p>`;
  }
  return team.noPeople ? `<p class="message muted bd-people-hint">${escapeHtml(EMPTY_PEOPLE_HINT)}</p>` : '';
}

// Rules TIMELINE-25, TIMELINE-50
/** The footer of both views: what is loading (the only place that says it), what is asleep, and the note of the view */
function renderFooter(current: TimelineModel): string {
  const team = current.scope === 'team' ? current.team : undefined;
  const text = loadingText(current);
  const loading = text
    ? `<span class="tl-fload" role="status" aria-live="polite"><span class="tl-spinner" aria-hidden="true"></span>${escapeHtml(
        text
      )}</span>`
    : '';
  // Rule TIMELINE-51: each id is a button that scrolls to its row and flashes it
  const link = (id: number, text: string): string =>
    `<button class="tl-link" data-flash-row="${String(id)}">${text}</button>`;
  const entries = team
    ? team.asleep.map((entry) => link(entry.id, `#${String(entry.id)} (${escapeHtml(entry.owner)})`))
    : current.asleep.map((id) => link(id, `#${String(id)}`));
  const asleep = !asleepKnown(current)
    ? ''
    : `<span class="tl-fkey">ASLEEP</span><span class="tl-fasleep">${
        entries.length ? entries.join(' · ') : 'nothing: every item in progress was updated'
      }</span>`;
  const note = `${
    team ? 'Rows of other people are read-only · ' : ''
  }click a row to see its PRs · hover a bar or a mark for its details`;
  return `<footer class="tl-footer">${loading}${asleep}<span class="tl-fnote">${note}</span></footer>`;
}

// Rule TIMELINE-50
/** Grey bars at varied places of a lane (percent of its width), one pattern per skeleton row */
const SKELETON_BARS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [3, 22],
    [28, 30],
    [62, 18],
  ],
  [
    [8, 40],
    [52, 28],
  ],
  [
    [0, 18],
    [22, 16],
    [44, 34],
  ],
  [
    [14, 30],
    [50, 20],
    [74, 14],
  ],
  [
    [5, 26],
    [36, 44],
  ],
  [
    [20, 18],
    [42, 26],
    [72, 20],
  ],
];

// Rule TIMELINE-50
/** Rows that stand where the data will appear: a label (two short pills and a longer line) and a few bars, shimmering */
function skeletonRows(count: number, from = 0): string {
  return Array.from({ length: count }, (_, index) => {
    const at = from + index;
    const bars = SKELETON_BARS[at % SKELETON_BARS.length]
      .map(
        ([left, width]) => `<i class="sk sk-bar" data-sk-left="${String(left)}" data-sk-width="${String(width)}"></i>`
      )
      .join('');
    return `<div class="tl-row tl-skel" aria-hidden="true"><div class="tl-label plain"><span class="tl-skel-l1"><i class="sk sk-pill"></i><i class="sk sk-pill short"></i></span><i class="sk sk-line w${String(
      at % 3
    )}"></i></div><div class="tl-lane">${bars}</div></div>`;
  }).join('');
}

// Rule TIMELINE-50
/** The first load: the header and the axis at once (when the days are known) over skeleton rows, with no text */
function renderSkeletonBody(current: TimelineModel): string {
  return `<div class="tl-grid density-${
    current.density
  }"><div class="tl-row tl-row-days"><div class="tl-label plain"></div><div class="tl-days">${renderDays(
    current
  )}</div></div><div class="tl-body"><div class="tl-overlay" aria-hidden="true"></div>${skeletonRows(6)}</div></div>`;
}

/** Nothing drawn yet in any view */
function noRows(current: TimelineModel): boolean {
  const team = current.scope === 'team' ? current.team : undefined;
  return (
    !current.work.length &&
    !current.finished.length &&
    !current.movedOut.length &&
    !current.reviews.length &&
    !current.reviewed.length &&
    (team?.sections.every((person) => !person.rows.length && !person.finished.length && !person.movedOut.length) ??
      true)
  );
}

function renderBody(current: TimelineModel): string {
  if (current.status === 'loading' && noRows(current)) {
    return renderSkeletonBody(current);
  }
  if (current.status === 'error') {
    return `<p class="message error">${escapeHtml(current.error ?? 'Could not load the work items')}</p>`;
  }
  if (!current.days.length) {
    return `<p class="message muted">${escapeHtml(current.notes.at(0) ?? 'Nothing to draw')}</p>`;
  }
  const team = current.scope === 'team' ? current.team : undefined;
  const youSection = team?.sections.find((person) => person.you);
  // Rule TIMELINE-50: work items still being read: skeleton rows, never the "none" message
  const noWork = current.finished.length ? 'No open work item' : 'None of your work items is in the sprint';
  const openRows = current.work.length ? current.work.map(renderRow).join('') : `<p class="tl-empty-row">${noWork}</p>`;
  const work = workItemsLoading(current) ? skeletonRows(3) : openRows;
  // Rule TIMELINE-19
  const finished = current.finished.length
    ? section('DONE THIS SPRINT', current.finished.map(renderRow).join(''), undefined, !!team)
    : '';
  // Rule TIMELINE-44: in a past sprint, the work items that left it before it ended
  const movedOut = (rows: readonly TimelineRow[]): string =>
    rows.length
      ? section('MOVED OUT DURING THE SPRINT', rows.map(renderRow).join(''), undefined, true, MOVED_OUT_HINT)
      : '';
  const reviews = current.reviews.length
    ? current.reviews.map(renderRow).join('')
    : '<p class="tl-empty-row">No review is waiting for you</p>';
  const notes = current.notes.map((note) => `<p class="message muted">${escapeHtml(note)}</p>`).join('');
  const days = `<div class="tl-row tl-row-days"><div class="tl-label plain"></div><div class="tl-days">${renderDays(
    current
  )}</div></div>`;
  // Rule TIMELINE-45: the bar of the protected branch can be hidden
  const develop = current.options.showDevelop
    ? section('DEVELOP', renderDevelop(current.develop), undefined, !!team)
    : '';
  // Rule TIMELINE-37: the PRs already reviewed, faded, under the ones owed
  const reviewed = current.reviewed.length
    ? section('REVIEWED BY YOU · THIS SPRINT', current.reviewed.map(renderRow).join(''), undefined, true)
    : '';
  // Rule TIMELINE-41: a past sprint has no reviews owed, only the ones done
  const reviewsSection = `${
    current.sprintOffset > 0 ? '' : section(current.reviewsTitle, reviews, undefined, !!team)
  }${reviewed}`;
  // Rule TIMELINE-39: with "PR events always visible" every mark shows at rest, not only on hover
  // Rules TIMELINE-31, TIMELINE-41: a past sprint's margin looks like the one before the sprint (`past`)
  const grid = `tl-grid density-${current.density}${current.options.alwaysShowPrEvents ? ' marks-always' : ''}${
    current.sprintOffset > 0 ? ' past' : ''
  }`;
  if (!team) {
    return `<div class="${grid}">${days}<div class="tl-body"><div class="tl-overlay" aria-hidden="true"></div>
    ${section('MY WORK ITEMS', work)}${finished}${movedOut(
      current.movedOut
    )}${notes}${reviewsSection}${develop}</div></div>`;
  }
  // Rule TIMELINE-21: one section per person, the user's first with the rows, buttons and popovers of the "mine" timeline
  const others = team.sections
    .filter((person) => !person.you)
    .map((person) => {
      const done = person.finished.length
        ? section('DONE THIS SPRINT', person.finished.map(renderRow).join(''), undefined, true)
        : '';
      // Rule TIMELINE-23: the rows of a person are indented under their header, with a rail in their colour
      return `${renderPersonHeader(person)}<div class="tl-person-rows colour-${String(person.colour)}">${person.rows
        .map(renderRow)
        .join('')}${done}${movedOut(person.movedOut)}</div>`;
    })
    .join('');
  // Rule TIMELINE-50: a person whose work is not read yet: their header and a few skeleton rows
  const pending = team.pending
    .map(
      (person, index) =>
        `<div class="tl-row tl-person"><div class="tl-plabel">${avatarHtml(
          person.initials,
          person.colour
        )}<b class="tl-pname">${escapeHtml(
          person.name
        )}</b><span class="tl-pmeta">loading…</span></div><div class="tl-psummary"></div></div><div class="tl-person-rows colour-${String(
          person.colour
        )}">${skeletonRows(3, index)}</div>`
    )
    .join('');
  const extra = youSection ? youSection.rows.map(renderRow).join('') : '';
  return `<div class="${grid}">${days}<div class="tl-body"><div class="tl-overlay" aria-hidden="true"></div>
    ${teamStatusHtml(team)}${youSection ? renderPersonHeader(youSection) : ''}${work}${extra}${finished}${movedOut([
    ...current.movedOut,
    ...(youSection?.movedOut ?? []),
  ])}${notes}${reviewsSection}${others}${pending}${develop}</div></div>`;
}

// Rule TIMELINE-30
/** The marks of a PR sit on one line; the ones that would touch are spread sideways (pixels: redone when the width changes) */
function packStrips(root: HTMLElement, total: number): void {
  root.querySelectorAll<HTMLElement>('.tl-strip').forEach((strip) => {
    const width = strip.getBoundingClientRect().width;
    const marks = Array.from(strip.querySelectorAll<HTMLElement>('.tl-mk[data-from]'))
      .map((element) => ({ element, at: Number(element.dataset.from), size: element.offsetWidth }))
      .sort((a, b) => a.at - b.at);
    const lefts = packMarks(
      marks.map((mark) => ({ left: (mark.at / total) * width - mark.size / 2, width: mark.size })),
      2,
      width
    );
    marks.forEach((mark, index) => {
      // The marks are centred on their left (translateX(-50%))
      mark.element.style.left = `${String(lefts[index] + mark.size / 2)}px`;
    });
  });
}

// Rules TIMELINE-17, TIMELINE-19
/**
 * Keeps the notes and buttons after a bar ("✓ merged Fr 16", "Done We 21", Complete…) to the right of the bar. A bar
 * is never narrower than its padding (16 px), so a short last bar (a PR merged an hour after its last vote) ends past
 * the day where its note is anchored: the note moves to the end of the bar. In pixels, so it runs again after a zoom
 */
function placeNotes(root: HTMLElement, total: number): void {
  root.querySelectorAll<HTMLElement>('.tl-row:not(.tl-row-develop) > .tl-lane').forEach((lane) => {
    const width = lane.clientWidth;
    // The bar that ends last, and whether it is a short one (its own width is below what its padding and text need)
    let end = 0;
    let short = false;
    lane.querySelectorAll<HTMLElement>(':scope > .tl-seg').forEach((segment) => {
      const right = segment.offsetLeft + segment.offsetWidth;
      if (right >= end) {
        end = right;
        short = ((Number(segment.dataset.to) - Number(segment.dataset.from)) / total) * width < MIN_BAR_PX * 3;
      }
    });
    lane
      .querySelectorAll<HTMLElement>(':scope > .tl-note[data-from], :scope > .tl-after[data-from]')
      .forEach((note) => {
        const anchor = (Number(note.dataset.from) / total) * width;
        // Only a short bar can be drawn wider than its days; a bar that goes on deliberately is left alone
        note.style.left = short && end > anchor ? `${String(end)}px` : `${String((anchor / width) * 100)}%`;
      });
  });
}

/** Positions and sizes come from the model in days: they are set after the markup is in place (strict CSP) */
function place(root: HTMLElement, current: TimelineModel): void {
  const total = current.days.length;
  root.style.setProperty('--tl-days', String(total || 10));
  // Rule TIMELINE-48: the width of a day, so the grid is wider than the panel when zoomed in
  root.style.setProperty('--tl-day-min', `${String(dayWidthShown ?? dayMinWidth(zoom))}px`);
  root.querySelectorAll<HTMLElement>('[data-sk-left]').forEach((element) => {
    element.style.left = `${element.dataset.skLeft ?? '0'}%`;
    element.style.width = `${element.dataset.skWidth ?? '10'}%`;
  });
  const percent = (days: number): string => `${String((days / total) * 100)}%`;
  root.querySelectorAll<HTMLElement>('[data-from]').forEach((element) => {
    const from = Number(element.dataset.from);
    element.style.left = percent(from);
    if (element.dataset.to !== undefined) {
      element.style.width = percent(Number(element.dataset.to) - from);
    }
  });
  packStrips(root, total);
  placeNotes(root, total);
  const overlay = root.querySelector<HTMLElement>('.tl-overlay');
  if (overlay) {
    const mark = (className: string, from: number, width: number): void => {
      const element = document.createElement('span');
      element.className = className;
      element.style.left = percent(from);
      element.style.width = width ? percent(width) : '';
      overlay.append(element);
    };
    current.days.forEach((day, index) => {
      if (day.weekStart) {
        mark('tl-weeksep', index, 0);
      } else if (index > 0) {
        // Rule TIMELINE-42: the days are separated too, barely visible until the pointer is on the timeline
        mark('tl-daysep', index, 0);
      }
      if (day.today) {
        mark('tl-todaycol', index, 1);
      }
    });
    // Rule TIMELINE-2: the days before the sprint (added as the PRs that start earlier need) are hatched, as the margin after it
    if (current.sprintStart > 0) {
      mark('tl-aftersprint tl-beforesprint', 0, current.sprintStart);
      const caption = document.createElement('span');
      caption.className = 'tl-after-caption';
      caption.textContent = 'BEFORE THE SPRINT';
      overlay.lastElementChild?.append(caption);
    }
    // Rule TIMELINE-31: the margin after the sprint is hatched; past the end of the sprint NOW fades behind the text
    if (current.sprintEnd < total) {
      mark('tl-aftersprint', current.sprintEnd, total - current.sprintEnd);
      const caption = document.createElement('span');
      caption.className = 'tl-after-caption';
      caption.textContent = 'AFTER THE SPRINT';
      overlay.lastElementChild?.append(caption);
    }
    overlay.classList.toggle('over', current.over);
    if (current.now !== undefined) {
      mark('tl-now', current.now, 0);
      // The flag sits at the foot of the sticky row of the days, so it stays visible while the rows scroll under it
      const flag = document.createElement('span');
      flag.className = `tl-now-flag${current.over ? ' over' : ''}`;
      flag.textContent = 'NOW';
      flag.style.left = percent(current.now);
      (root.querySelector('.tl-days') ?? overlay).append(flag);
    }
  }
}

let popover: HTMLElement | undefined;
let tip: HTMLElement | undefined;

function hidePopover(): void {
  popover?.remove();
  popover = undefined;
}

function hideTip(): void {
  tip?.remove();
  tip = undefined;
}

// Rules TIMELINE-18, TIMELINE-29
/** Tells the panel which work items are expanded now, when that changed: it reads the history of their PRs */
function postExpanded(current: TimelineModel): void {
  const ids = expandedIds(expandableRows(current), choices);
  if (!sameIds(ids, postedIds)) {
    postedIds = ids;
    post({ type: 'setExpanded', ids });
  }
}

// Rule TIMELINE-39: the first hover (or focus) of a PR row asks for its details, once per PR in this tab
const hoveredPullRequests = new Set<number>();
function hoverPullRequest(target: EventTarget | null): void {
  const row = target instanceof Element ? target.closest<HTMLElement>('.tl-row.pr[data-pr]') : null;
  const id = Number(row?.dataset.pr);
  if (row && Number.isInteger(id) && !hoveredPullRequests.has(id)) {
    hoveredPullRequests.add(id);
    post({ type: 'hoverPullRequest', prId: id });
  }
}

// Rules TIMELINE-39, TIMELINE-45: with "PR events always visible" the PR rows drawn and on screen ask for their
// details as if hovered (the same message, once per PR and tab)
let prObserver: IntersectionObserver | undefined;
function observePullRequestRows(root: HTMLElement, always: boolean): void {
  prObserver?.disconnect();
  prObserver = undefined;
  if (!always || typeof IntersectionObserver === 'undefined') {
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        hoverPullRequest(entry.target);
        observer.unobserve(entry.target);
      }
    }
  });
  prObserver = observer;
  for (const row of Array.from(root.querySelectorAll('.tl-row.pr[data-pr]'))) {
    observer.observe(row);
  }
}

// Rule TIMELINE-47: hovering (or focusing) a work item row highlights the rows of the work items linked to it by the
// Duplicate link; a linked work item that is not drawn is said in the tooltip of the row
let duplicateLinks = new Map<number, TimelineDuplicate[]>();
function describeDuplicates(root: HTMLElement, current: TimelineModel): void {
  duplicateLinks = new Map();
  const drawn = new Set(
    Array.from(root.querySelectorAll<HTMLElement>('.tl-row[data-wi]'), (row) => Number(row.dataset.wi))
  );
  for (const row of expandableRows(current)) {
    if (!row.duplicates) {
      continue;
    }
    duplicateLinks.set(row.id, row.duplicates);
    const lines = row.duplicates
      .filter((link) => !drawn.has(link.id))
      .map(
        (link) =>
          `${link.role === 'original' ? 'Duplicate of' : 'Duplicated by'} #${String(link.id)} (not in this view)`
      );
    const label = root.querySelector<HTMLElement>(`.tl-row[data-wi="${String(row.id)}"] > .tl-label`);
    if (lines.length && label) {
      label.title = [label.title, ...lines].filter(Boolean).join('\n');
    }
  }
}

function highlightDuplicates(target: EventTarget | null): void {
  const row = target instanceof Element ? target.closest<HTMLElement>('.tl-row[data-wi]') : null;
  const linked = row ? duplicateLinks.get(Number(row.dataset.wi)) : undefined;
  for (const lit of Array.from(document.querySelectorAll('.dup-hl'))) {
    lit.classList.remove('dup-hl');
  }
  for (const link of linked ?? []) {
    for (const other of Array.from(document.querySelectorAll(`.tl-row[data-wi="${String(link.id)}"]`))) {
      other.classList.add('dup-hl');
    }
  }
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Rule TIMELINE-49
/** Disables the zoom buttons at their limits and while a zoom animation runs (no redraw) */
function updateZoomButtons(): void {
  const set = (id: string, off: boolean): void => {
    const button = app?.querySelector<HTMLButtonElement>(`[data-zoom="${id}"]`);
    if (button) {
      button.disabled = zoomBusy || off;
    }
  };
  set('out', !canZoomOut(zoom, fit));
  set('in', zoom >= MAX_ZOOM);
  set('reset', zoom === DEFAULT_ZOOM);
}

// Rule TIMELINE-49
/** Measures the zoom at which the whole axis fits the lanes, and updates the − button (no redraw) */
function updateFit(): void {
  const area = app?.querySelector<HTMLElement>('.tl-scroll');
  const days = model?.days.length ?? 0;
  if (!area || !days) {
    return;
  }
  const style = getComputedStyle(area);
  const label = app?.querySelector<HTMLElement>('.tl-row-days > .tl-label')?.getBoundingClientRect().width ?? 300;
  const lanes = area.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - label;
  fit = fitZoom(lanes, days);
  updateZoomButtons();
}

// Rule TIMELINE-51
let flashTimer: number | undefined;
/**
 * Scrolls the row of a work item into view (smooth, centred) and flashes it for 1.5 s with the look of the duplicate
 * highlight; with reduced motion the scroll is instant and the highlight static. Nothing happens if it is not drawn
 */
function flashRow(id: number): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(`.tl-row[data-wi="${String(id)}"]`));
  const first = rows.at(0);
  if (!first) {
    return;
  }
  const still = reducedMotion();
  first.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  window.clearTimeout(flashTimer);
  for (const lit of Array.from(document.querySelectorAll('.row-flash'))) {
    lit.classList.remove('row-flash');
  }
  // Restarts the animation when the same row is clicked twice
  void first.offsetWidth;
  for (const row of rows) {
    row.classList.add('row-flash');
    row.addEventListener('animationend', () => row.classList.remove('row-flash'), { once: true });
  }
  flashTimer = window.setTimeout(() => {
    for (const row of rows) {
      row.classList.remove('row-flash');
    }
  }, 1600);
}

function render(): void {
  if (!app || !model) {
    return;
  }
  hidePopover();
  hideTip();
  messages = new Map();
  popovers = new Map();
  tips = new Map();
  document.body.classList.toggle(
    'look-totalflow',
    lookClass(model.look, Array.from(document.body.classList)) !== undefined
  );
  dimCompleted = model.options.dimCompleted;
  const picker = rememberPicker();
  const scroll = app.querySelector('.tl-scroll');
  const scrollLeft = scroll?.scrollLeft ?? 0;
  const scrollTop = scroll?.scrollTop ?? 0;
  const team = model.scope === 'team' ? model.team : undefined;
  app.innerHTML = `${renderHeader(model)}${renderLegend(team !== undefined)}<div class="tl-scroll">${renderBody(
    model
  )}</div>${renderFooter(model)}`;
  restorePicker(app, picker);
  const grid = app.querySelector<HTMLElement>('.tl-grid');
  if (grid) {
    place(grid, model);
    // Wide ranges scroll sideways: the grid is as wide as its days need
    app.querySelector<HTMLElement>('.tl-scroll')?.scrollTo({ left: scrollLeft, top: scrollTop });
  }
  updateFit();
  observePullRequestRows(app, model.options.alwaysShowPrEvents);
  describeDuplicates(app, model);
  postExpanded(model);
}

/* ---------- The ASLEEP popover and the tooltip of a marker ---------- */

function showPopover(anchor: HTMLElement, content: TimelinePopover): void {
  hidePopover();
  const element = document.createElement('div');
  element.className = 'tl-popover';
  element.setAttribute('role', 'dialog');
  element.setAttribute('aria-label', `${content.title}: why it is flagged`);
  element.innerHTML = `<span class="tl-pop-title">${escapeHtml(
    content.title
  )}</span><span class="tl-pop-text">${escapeHtml(content.text)}</span><span class="tl-pop-rule">${escapeHtml(
    content.rule
  )}</span><div class="tl-pop-actions">${content.actions
    .map(
      (action) =>
        `<button class="bd-button${action.primary ? ' primary' : ''}" data-msg="${named(action.message)}">${escapeHtml(
          action.label
        )}</button>`
    )
    .join('')}</div>`;
  document.body.append(element);
  const box = anchor.getBoundingClientRect();
  const width = element.offsetWidth;
  element.style.left = `${String(Math.max(8, Math.min(window.innerWidth - width - 8, box.left)))}px`;
  element.style.top = `${String(Math.min(window.innerHeight - element.offsetHeight - 8, box.bottom + 6))}px`;
  popover = element;
  element.querySelector<HTMLElement>('button')?.focus();
}

// Rule TIMELINE-27
/** Who, when and what of a mark: a tooltip of our own (no inline style: the position is set through CSSOM) */
function showTip(anchor: HTMLElement): void {
  const found = anchor.dataset.tip ? tips.get(anchor.dataset.tip) : undefined;
  if (!found) {
    return;
  }
  const content = found.tip;
  hideTip();
  const element = document.createElement('div');
  element.className = `tl-tip tip-${found.tone}`;
  element.setAttribute('role', 'tooltip');
  element.innerHTML = `<span class="tl-tip-title">${escapeHtml(content.title)}</span>${content.lines
    .map((line) => `<span class="tl-tip-line">${escapeHtml(line)}</span>`)
    .join('')}`;
  document.body.append(element);
  const box = anchor.getBoundingClientRect();
  const width = element.offsetWidth;
  const height = element.offsetHeight;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, box.left + box.width / 2 - width / 2));
  const above = box.top - height - 8;
  element.style.left = `${String(left)}px`;
  element.style.top = `${String(above >= 8 ? above : box.bottom + 8)}px`;
  tip = element;
}

/* ---------- Events ---------- */

function run(target: Element | null): boolean {
  const control = target?.closest<HTMLElement>('[data-msg]');
  const message = control?.dataset.msg ? messages.get(control.dataset.msg) : undefined;
  if (!message) {
    return false;
  }
  hidePopover();
  post(message);
  return true;
}

// Rule TIMELINE-18
function toggleFromRow(id: number): void {
  const row = model && expandableRows(model).find((candidate) => candidate.id === id);
  if (!row) {
    return;
  }
  choices = toggleRow(row, choices);
  vscode.setState({ ...savedState(), expansion: choices });
  render();
}

// Rule TIMELINE-48
/**
 * Draws the zoom and saves it after a pause, so a wheel does not write the setting on every step. `cursorX`: the
 * pointer from the left of the scrolling area, whose day stays under it; without it, the middle of the lanes on screen.
 * Rule TIMELINE-49: with `animate` (the buttons) the width of the days moves to the new one in 150 ms, frame by frame,
 * and the anchor stays where it is on every frame; the wheel is instant
 */
function setZoom(next: number, cursorX?: number, animate = false): void {
  if (!model || next === zoom) {
    return;
  }
  if (zoomFrame !== undefined) {
    window.cancelAnimationFrame(zoomFrame);
    zoomFrame = undefined;
  }
  const scroll = app?.querySelector<HTMLElement>('.tl-scroll');
  const widthOf = (): number => app?.querySelector('.tl-days')?.getBoundingClientRect().width ?? 0;
  const before = widthOf();
  const left = scroll?.scrollLeft ?? 0;
  const laneStart =
    (app?.querySelector('.tl-days')?.getBoundingClientRect().left ?? 0) -
    (scroll?.getBoundingClientRect().left ?? 0) +
    left;
  const from = dayWidthShown ?? drawnDayWidth(zoom, fit);
  const to = drawnDayWidth(next, fit);
  const animated = animate && !reducedMotion() && from !== to;
  zoom = next;
  dayWidthShown = animated ? from : undefined;
  zoomBusy = animated;
  // Nothing is drawn again: only the width of the days changes (a redraw in the middle of a zoom lost the scroll and
  // the pointer's anchor), the marks placed in pixels follow it, once per frame at most
  const grid = app?.querySelector<HTMLElement>('.tl-grid');
  const applyWidth = (): void => {
    grid?.style.setProperty('--tl-day-min', `${String(dayWidthShown ?? dayMinWidth(zoom))}px`);
  };
  const anchor = (): void => {
    const after = widthOf();
    if (scroll && before > 0 && after > 0) {
      const x = cursorX ?? (laneStart + scroll.clientWidth) / 2;
      scroll.scrollTo({ left: scrollAfterZoom(left, x, laneStart, after / before), top: scroll.scrollTop });
    }
  };
  const relayout = (): void => {
    if (grid && model) {
      packStrips(grid, model.days.length || 10);
      placeNotes(grid, model.days.length || 10);
    }
  };
  applyWidth();
  anchor();
  relayout();
  if (animated) {
    const begin = performance.now();
    const frame = (time: number): void => {
      const progress = (time - begin) / ZOOM_TRANSITION_MS;
      const done = progress >= 1;
      dayWidthShown = done ? undefined : from + (to - from) * easeOut(progress);
      applyWidth();
      anchor();
      relayout();
      zoomFrame = done ? undefined : window.requestAnimationFrame(frame);
      if (done) {
        // Everything is in place: the buttons are safe to press again
        zoomBusy = false;
        updateZoomButtons();
      }
    };
    zoomFrame = window.requestAnimationFrame(frame);
  }
  updateZoomButtons();
  window.clearTimeout(zoomTimer);
  zoomTimer = window.setTimeout(() => {
    zoomTimer = undefined;
    lastPostedZoom = zoom;
    post({ type: 'setTimelineZoom', zoom });
  }, ZOOM_SAVE_DELAY_MS);
}

/** The zoom a button leads to (`in`, `out`, `reset`) */
function zoomTarget(how: string | undefined): number {
  if (how === 'in') {
    return nextZoomIn(zoom, fit);
  }
  return how === 'out' ? nextZoomOut(zoom, fit) : DEFAULT_ZOOM;
}

// Rule TIMELINE-49: the wheel with the key of the setting (Ctrl by default, a trackpad pinch included; or Shift) zooms
// around the pointer; any other wheel scrolls as always. The events of a burst
// are added up and applied once per frame (instant, nothing drawn again), so a fast wheel stays smooth
document.addEventListener(
  'wheel',
  (event) => {
    const area = event.target instanceof Element ? event.target.closest<HTMLElement>('.tl-scroll') : null;
    if (!area || !isZoomWheel(event, model?.zoomModifier ?? 'ctrl', IS_MAC)) {
      return;
    }
    event.preventDefault();
    // A wheel that scrolls by lines reports 3 per notch, by pages 1: both are brought to pixels
    const unit = [1, 33, 400].at(event.deltaMode) ?? 1;
    wheelDelta += (event.deltaY || event.deltaX) * unit;
    wheelX = event.clientX - area.getBoundingClientRect().left;
    wheelFrame ??= window.requestAnimationFrame(() => {
      wheelFrame = undefined;
      const delta = wheelDelta;
      wheelDelta = 0;
      if (delta) {
        setZoom(wheelZoom(zoom, fit, delta), wheelX);
      }
    });
  },
  { passive: false }
);

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const zoomControl = target?.closest<HTMLElement>('[data-zoom]');
  if (zoomControl) {
    const how = zoomControl.dataset.zoom;
    // Rule TIMELINE-49: the buttons animate the change of width
    setZoom(zoomTarget(how), undefined, true);
    return;
  }
  const flash = target?.closest<HTMLElement>('[data-flash-row]');
  if (flash) {
    flashRow(Number(flash.dataset.flashRow));
    return;
  }
  const trigger = target?.closest<HTMLElement>('[data-popover]');
  const content = trigger?.dataset.popover ? popovers.get(trigger.dataset.popover) : undefined;
  if (trigger && content) {
    showPopover(trigger, content);
    return;
  }
  if (run(target)) {
    return;
  }
  const density = target?.closest<HTMLElement>('[data-density]');
  if (density) {
    // Rule TIMELINE-32
    post({ type: 'setTimelineDensity', density: density.dataset.density === 'compact' ? 'compact' : 'normal' });
    return;
  }
  const viewOption = target?.closest<HTMLElement>('[data-view-option]');
  if (viewOption && model) {
    // Rule TIMELINE-45: the setting is written by the extension, whose change redraws the tab
    const option = viewOption.dataset.viewOption;
    if (isTimelineViewSwitch(option)) {
      post({ type: 'setTimelineViewOption', option, value: !model.options[option] });
    }
    return;
  }
  if (target?.closest('[data-open-dim-setting]')) {
    post({ type: 'openDimSetting' });
    return;
  }
  if (target?.closest('[data-view-options]')) {
    optionsOpen = !optionsOpen;
    legendOpen = false;
    render();
    app?.querySelector<HTMLElement>(optionsOpen ? '[data-view-option]' : '[data-view-options]')?.focus();
    return;
  }
  if (target?.closest('[data-legend]')) {
    // Rule TIMELINE-34: a click opens the legend, a second one closes it
    legendOpen = !legendOpen;
    render();
    app?.querySelector<HTMLElement>('[data-legend]')?.focus();
    return;
  }
  const sprintStep = target?.closest<HTMLElement>('[data-sprint-step]');
  if (sprintStep && model) {
    // Rule TIMELINE-40: ‹ goes back one sprint, › forward
    sprintMenuOpen = false;
    const offset = model.sprintOffset + (sprintStep.dataset.sprintStep === 'older' ? 1 : -1);
    post({ type: 'setSprint', offset: Math.max(0, offset) });
    return;
  }
  const sprintOption = target?.closest<HTMLElement>('[data-sprint]');
  if (sprintOption) {
    sprintMenuOpen = false;
    post({ type: 'setSprint', offset: Number(sprintOption.dataset.sprint) });
    render();
    return;
  }
  if (target?.closest('[data-sprint-menu]')) {
    sprintMenuOpen = !sprintMenuOpen;
    render();
    app
      ?.querySelector<HTMLElement>(sprintMenuOpen ? '.tl-sprint-option[aria-selected="true"]' : '[data-sprint-menu]')
      ?.focus();
    return;
  }
  if (sprintMenuOpen && !target?.closest('.tl-sprint-list')) {
    sprintMenuOpen = false;
    render();
  }
  if (optionsOpen && !target?.closest('.tl-options')) {
    // A click outside closes the view options
    optionsOpen = false;
    render();
  }
  if (legendOpen && !target?.closest('.tl-legend')) {
    // A click outside closes the legend
    legendOpen = false;
    render();
  }
  if (target?.closest('[data-collapse-all]') && model) {
    // Rule TIMELINE-18
    choices = collapseAll(expandableRows(model), choices);
    vscode.setState({ ...savedState(), expansion: choices });
    render();
    return;
  }
  if (target?.closest('[data-refresh]')) {
    post({ type: 'refresh' });
    return;
  }
  const row = target?.closest<HTMLElement>('[data-row]');
  if (row?.dataset.row && !target?.closest('.tl-popover, .tl-mk, .tl-act')) {
    // Rule TIMELINE-18: a click anywhere on the row of a work item expands or collapses it
    toggleFromRow(Number(row.dataset.row));
    return;
  }
  if (!target?.closest('.tl-popover')) {
    hidePopover();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideTip();
    if (sprintMenuOpen) {
      sprintMenuOpen = false;
      render();
      app?.querySelector<HTMLElement>('[data-sprint-menu]')?.focus();
      return;
    }
    if (optionsOpen) {
      // Rule TIMELINE-45
      optionsOpen = false;
      render();
      app?.querySelector<HTMLElement>('[data-view-options]')?.focus();
      return;
    }
    if (legendOpen) {
      // Rule TIMELINE-34
      legendOpen = false;
      render();
      app?.querySelector<HTMLElement>('[data-legend]')?.focus();
      return;
    }
    if (!closePickerOnEscape({ render })) {
      hidePopover();
    }
    return;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (
    (event.key === 'Enter' || event.key === ' ') &&
    target?.matches('.tl-label[data-row], .tl-label[data-msg], .tl-id[data-msg], .tl-seg[data-popover]')
  ) {
    event.preventDefault();
    target.click();
  }
});

document.addEventListener('mouseover', (event) => {
  hoverPullRequest(event.target);
  highlightDuplicates(event.target);
  const anchor = event.target instanceof Element ? event.target.closest<HTMLElement>('.tl-mk[data-tip]') : null;
  if (anchor) {
    showTip(anchor);
  }
});

document.addEventListener('mouseout', (event) => {
  highlightDuplicates(event.relatedTarget);
  if (event.target instanceof Element && event.target.closest('.tl-mk[data-tip]')) {
    hideTip();
  }
});

document.addEventListener('focusin', (event) => {
  hoverPullRequest(event.target);
  highlightDuplicates(event.target);
  const anchor = event.target instanceof Element ? event.target.closest<HTMLElement>('.tl-mk[data-tip]') : null;
  if (anchor) {
    showTip(anchor);
  }
});

document.addEventListener('focusout', () => {
  hideTip();
  highlightDuplicates(null);
});

window.addEventListener('message', (event: MessageEvent<TimelineUpdate>) => {
  const next = event.data.model;
  // The store posts on every CI poll: an identical model must not close the popover. The zoom is left out of the
  // comparison: the one that comes back after our own write (or a stale one) is not a reason to draw again
  const text = JSON.stringify({ ...next, zoom: 0 });
  const same = text === lastModel;
  lastModel = text;
  model = next;
  // Rule TIMELINE-48: the zoom of the setting is taken only when it changed elsewhere (the settings editor): never
  // while a change of ours waits to be written, is animating, or when it is what we wrote
  let zoomChanged = false;
  if (next.zoom !== lastModelZoom) {
    lastModelZoom = next.zoom;
    if (
      zoomTimer === undefined &&
      zoomFrame === undefined &&
      wheelFrame === undefined &&
      next.zoom !== lastPostedZoom &&
      next.zoom !== zoom
    ) {
      zoom = next.zoom;
      zoomChanged = true;
    }
  }
  if (same && !zoomChanged) {
    return;
  }
  render();
});

window.addEventListener('resize', () => {
  hidePopover();
  hideTip();
});

// Rule TIMELINE-49: the "fit" zoom follows the width of the panel; the marks placed in pixels follow the days
if (app && typeof ResizeObserver !== 'undefined') {
  let pending: number | undefined;
  new ResizeObserver(() => {
    if (pending !== undefined) {
      return;
    }
    pending = window.requestAnimationFrame(() => {
      pending = undefined;
      updateFit();
      const grid = app.querySelector<HTMLElement>('.tl-grid');
      if (grid && model && zoomFrame === undefined) {
        packStrips(grid, model.days.length || 10);
        placeNotes(grid, model.days.length || 10);
      }
    });
  }).observe(app);
}

startPeoplePicker({ post, picker: () => (model?.scope === 'team' ? model.team?.picker : undefined), render });

post({ type: 'ready' });
