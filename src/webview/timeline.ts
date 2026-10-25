/** The Sprint timeline webview (redesign): the work of the sprint on a working-days axis, with the reviews and develop */
import { escapeHtml } from '../html';
import { icon } from '../icons';
import { lookClass } from '../look';
import type { TimelineUpdate } from '../sprintTimeline';
import type {
  DevelopSpan,
  TimelineMessage,
  TimelineModel,
  TimelinePopover,
  TimelineRow,
  TimelineSegment,
} from '../sprintTimelineModel';
import type { BoardAction } from '../trackBoardModel';

interface VsCodeApi {
  postMessage(message: TimelineMessage): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
let model: TimelineModel | undefined;
let lastModel: string | undefined;
/** The buttons and clicks of the last render: the markup only names them */
let messages = new Map<string, TimelineMessage>();
let popovers = new Map<string, TimelinePopover>();

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
  const attrs = popoverKey ? ` data-popover="${popoverKey}" tabindex="0" role="button"` : '';
  return `<span class="${classes.join(' ')}" data-from="${String(segment.start)}" data-to="${String(
    segment.end
  )}" title="${escapeHtml(segment.tip)}"${attrs}>${escapeHtml(segment.text ?? '')}</span>`;
}

function renderRow(row: TimelineRow): string {
  const label = `<div class="tl-label" tabindex="0" role="button" data-msg="${named(row.open)}" title="Open #${String(
    row.id
  )}"><span class="tl-id${row.bug ? ' bug' : ''}${row.here ? ' here' : ''}">${escapeHtml(row.header)}${
    row.here ? ' · ● here' : ''
  }</span><span class="tl-title">${escapeHtml(row.title)}</span></div>`;
  let popoverKey: string | undefined;
  if (row.popover) {
    popoverKey = `p${String(popovers.size)}`;
    popovers.set(popoverKey, row.popover);
  }
  const segments = row.segments
    .map((segment) => renderSegment(segment, segment.kind === 'asleep' ? popoverKey : undefined))
    .join('');
  const outline = row.outline
    ? `<span class="tl-outline${row.outline.broken ? ' broken' : ''}">${escapeHtml(row.outline.text)}</span>`
    : '';
  const chip =
    row.chip && row.segments.at(0) && row.segments[0].start > 1.3
      ? `<span class="tl-chip">${escapeHtml(row.chip)}</span>`
      : '';
  const note = row.note ? `<span class="tl-note tone-${row.note.tone}">${escapeHtml(row.note.text)}</span>` : '';
  const action = row.action
    ? actionButton(row.action, row.segments.some((segment) => segment.kind === 'needsYou') ? 'needsYou' : 'plain')
    : '';
  const after =
    note || action
      ? `<span class="tl-after${row.outline ? ' at-end' : ''}" data-from="${String(row.end)}">${note}${action}</span>`
      : '';
  return `<div class="tl-row">${label}<div class="tl-lane">${chip}${segments}${outline}${after}</div></div>`;
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
  return `<div class="tl-row tl-row-develop"><div class="tl-label plain"><span class="tl-title">Pipelines on ${escapeHtml(
    develop.branch
  )}</span></div><div class="tl-lane">${spans}${label}${note}</div></div>`;
}

function section(title: string, body: string, note?: string): string {
  return `<h2 class="tl-section">${escapeHtml(title)}</h2>${
    note ? `<p class="tl-empty-row">${escapeHtml(note)}</p>` : ''
  }${body}`;
}

function renderLegend(): string {
  const item = (cls: string, label: string): string =>
    `<span class="tl-key"><span class="tl-swatch seg-${cls}"></span>${label}</span>`;
  return `<div class="tl-legend" aria-label="Legend">${item('coding', 'coding')}${item(
    'draft',
    'draft · self-review'
  )}${item('review', 'CI · review')}${item('needsYou', 'needs you')}${item('ready', 'ready to be merged')}${item(
    'asleep',
    'no update (zZ)'
  )}<span class="tl-key dep">⛓ dependency</span></div>`;
}

function renderHeader(current: TimelineModel): string {
  const range = (id: 'sprint' | 'sprintAndNext', text: string, title?: string): string =>
    `<button class="bd-chip" data-range="${id}" aria-pressed="${String(current.range === id)}"${
      title ? ` title="${escapeHtml(title)}"` : ''
    }>${text}</button>`;
  const left = current.header.left
    ? `<span class="bd-left${current.header.hurry ? ' hurry' : ''}">${escapeHtml(current.header.left)}</span>`
    : '';
  return `<header class="bd-header"><h1 class="bd-sprint">${escapeHtml(current.header.sprint)}</h1>${
    current.header.dates ? `<span class="bd-left">${escapeHtml(current.header.dates)}</span>` : ''
  }${left}
    <div class="bd-tabs" role="group" aria-label="View"><button class="bd-chip" data-open-board aria-pressed="false">Track board</button><button class="bd-chip" aria-pressed="true">Sprint timeline</button></div>
    <span class="bd-scope">Mine + my reviews</span>
    <div class="bd-chips" role="group" aria-label="Range">${range('sprint', 'This sprint')}${range(
    'sprintAndNext',
    'This + next sprint',
    'Widen the view to the next sprint too: what is already planned there and what will spill over'
  )}</div>
    <button class="bd-icon-button" data-refresh title="Refresh" aria-label="Refresh">${icon('sync')}</button></header>`;
}

function renderDays(current: TimelineModel): string {
  return current.days
    .map(
      (day) =>
        `<span title="${escapeHtml(day.date)}" class="tl-day${day.weekStart ? ' week' : ''}${
          day.today ? ' today' : ''
        }${day.next ? ' next' : ''}">${escapeHtml(day.label)}${day.last ? ' · end' : ''}</span>`
    )
    .join('');
}

function renderBody(current: TimelineModel): string {
  if (current.status === 'loading' && !current.days.length) {
    return '<p class="message muted">Loading the sprint…</p>';
  }
  if (current.status === 'error') {
    return `<p class="message error">${escapeHtml(current.error ?? 'Could not load the work items')}</p>`;
  }
  if (!current.days.length) {
    return `<p class="message muted">${escapeHtml(current.notes.at(0) ?? 'Nothing to draw')}</p>`;
  }
  const work = current.work.length
    ? current.work.map(renderRow).join('')
    : '<p class="tl-empty-row">None of your work items is in the sprint</p>';
  const planned =
    current.range === 'sprintAndNext'
      ? section('PLANNED IN THE NEXT SPRINT', current.planned.rows.map(renderRow).join(''), current.planned.note)
      : '';
  const reviews = current.reviews.length
    ? current.reviews.map(renderRow).join('')
    : '<p class="tl-empty-row">No review is waiting for you</p>';
  const notes = current.notes.map((note) => `<p class="message muted">${escapeHtml(note)}</p>`).join('');
  return `<div class="tl-grid">
    <div class="tl-row tl-row-days"><div class="tl-label plain"></div><div class="tl-days">${renderDays(
      current
    )}</div></div>
    <div class="tl-body"><div class="tl-overlay" aria-hidden="true"></div>
    ${section('MY WORK ITEMS', work)}${planned}${notes}${section(current.reviewsTitle, reviews)}${section(
    'DEVELOP',
    renderDevelop(current.develop)
  )}</div></div>`;
}

/** Positions and sizes come from the model in days: they are set after the markup is in place (strict CSP) */
function place(root: HTMLElement, current: TimelineModel): void {
  const total = current.days.length;
  root.style.setProperty('--tl-days', String(total));
  const percent = (days: number): string => `${String((days / total) * 100)}%`;
  root.querySelectorAll<HTMLElement>('[data-from]').forEach((element) => {
    const from = Number(element.dataset.from);
    element.style.left = percent(from);
    if (element.classList.contains('at-end')) {
      // The button of a row that is only an outline sits at the right end of the lane
      element.style.left = 'auto';
      element.style.right = '6px';
    }
    if (element.dataset.to !== undefined) {
      element.style.width = percent(Number(element.dataset.to) - from);
    }
  });
  // No room for a note or a button after the bar: it goes over the right end of the lane
  root.querySelectorAll<HTMLElement>('.tl-note, .tl-after').forEach((element) => {
    const lane = element.parentElement?.getBoundingClientRect();
    if (lane && !element.classList.contains('at-end') && element.getBoundingClientRect().right > lane.right) {
      element.classList.add('flip');
      element.style.left = 'auto';
      element.style.right = '6px';
    }
  });
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
      }
      if (day.today) {
        mark('tl-todaycol', index, 1);
      }
      if (day.next && !current.days[index - 1]?.next) {
        mark('tl-nextsep', index, 0);
      }
    });
    if (current.now !== undefined) {
      mark('tl-now', current.now, 0);
      const flag = document.createElement('span');
      flag.className = 'tl-now-flag';
      flag.textContent = 'NOW';
      flag.style.left = percent(current.now);
      overlay.append(flag);
    }
  }
}

let popover: HTMLElement | undefined;

function hidePopover(): void {
  popover?.remove();
  popover = undefined;
}

function render(): void {
  if (!app || !model) {
    return;
  }
  hidePopover();
  messages = new Map();
  popovers = new Map();
  document.body.classList.toggle(
    'look-totalflow',
    lookClass(model.look, Array.from(document.body.classList)) !== undefined
  );
  const scroll = app.querySelector('.tl-scroll');
  const scrollLeft = scroll?.scrollLeft ?? 0;
  app.innerHTML = `${renderHeader(model)}${renderLegend()}<div class="tl-scroll">${renderBody(model)}</div>`;
  const grid = app.querySelector<HTMLElement>('.tl-grid');
  if (grid) {
    place(grid, model);
    // Wide ranges scroll sideways: the grid is as wide as its days need
    app.querySelector<HTMLElement>('.tl-scroll')?.scrollTo({ left: scrollLeft });
  }
}

/* ---------- The ASLEEP popover ---------- */

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

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const trigger = target?.closest<HTMLElement>('[data-popover]');
  const content = trigger?.dataset.popover ? popovers.get(trigger.dataset.popover) : undefined;
  if (trigger && content) {
    showPopover(trigger, content);
    return;
  }
  if (run(target)) {
    return;
  }
  const range = target?.closest<HTMLElement>('[data-range]');
  if (range) {
    post({ type: 'setTimelineRange', range: range.dataset.range === 'sprintAndNext' ? 'sprintAndNext' : 'sprint' });
    return;
  }
  if (target?.closest('[data-open-board]')) {
    post({ type: 'openBoard' });
    return;
  }
  if (target?.closest('[data-refresh]')) {
    post({ type: 'refresh' });
    return;
  }
  if (!target?.closest('.tl-popover')) {
    hidePopover();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hidePopover();
    return;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  if ((event.key === 'Enter' || event.key === ' ') && target?.matches('.tl-label[data-msg], .tl-seg[data-popover]')) {
    event.preventDefault();
    target.click();
  }
});

window.addEventListener('message', (event: MessageEvent<TimelineUpdate>) => {
  // The store posts on every CI poll: an identical model must not close the popover
  const text = JSON.stringify(event.data.model);
  if (text === lastModel) {
    return;
  }
  lastModel = text;
  model = event.data.model;
  render();
});

window.addEventListener('resize', hidePopover);

post({ type: 'ready' });
