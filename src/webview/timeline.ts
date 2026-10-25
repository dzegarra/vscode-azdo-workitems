/** The Sprint timeline webview (redesign): the work of the sprint on a working-days axis, with the reviews and develop */
import { escapeHtml } from '../html';
import { icon } from '../icons';
import { lookClass } from '../look';
import type { TimelineUpdate } from '../sprintTimeline';
import type {
  DevelopSpan,
  GroupInfo,
  RowLabel,
  TimelineMessage,
  TimelineModel,
  TimelinePopover,
  TimelineRow,
  TimelineSection,
  TimelineSegment,
  TimelineTeam,
} from '../sprintTimelineModel';
import { EMPTY_PEOPLE_HINT } from '../teamPeople';
import { toggleCollapsed, visibleRows } from '../timelineGroups';
import { COMPLETED_TOOLTIP, type BoardAction } from '../trackBoardModel';
import {
  avatarHtml,
  closePickerOnEscape,
  rememberPicker,
  renderPeoplePicker,
  renderScope,
  restorePicker,
  startPeoplePicker,
} from './peoplePicker';

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
/** The groups the user collapsed, by work item id (Rule TIMELINE-18): UI-only, kept with the webview state */
let collapsed: number[] = [];

function loadCollapsed(): number[] {
  const state = vscode.getState();
  const saved = state && typeof state === 'object' && 'collapsed' in state ? state.collapsed : undefined;
  return Array.isArray(saved) ? saved.filter((id): id is number => typeof id === 'number') : [];
}
collapsed = loadCollapsed();

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

const tagHtml = (tag: NonNullable<RowLabel['tag']>): string =>
  `<span class="tl-tag tag-${tag.tone}">${escapeHtml(tag.text)}</span>`;

const pillHtml = (pr: NonNullable<RowLabel['pr']>): string =>
  `<span class="tl-pr${pr.merged ? ' merged' : ''}${pr.text.startsWith('draft') ? ' draft' : ''}">${
    pr.merged ? '✓ ' : ''
  }${escapeHtml(pr.text)}</span>`;

/** Rule TIMELINE-15: the first line of a label starts with the tag that says whose title follows */
function renderLabel(row: TimelineRow, isCollapsed: boolean): string {
  const label = row.label;
  const open = `data-msg="${named(row.open)}" title="Open #${String(row.id)}"`;
  const here = row.here ? '<span class="tl-here">● here</span>' : '';
  if (!label) {
    return `<div class="tl-label" tabindex="0" role="button" ${open}><span class="tl-id${
      row.bug ? ' bug' : ''
    }">${escapeHtml(row.header)}</span><span class="tl-title">${escapeHtml(row.title)}</span></div>`;
  }
  const head = [
    label.tag ? tagHtml(label.tag) : '',
    // The id takes the colour of its tag: red for a Bug, blue for a Backlog Item
    label.id
      ? `<span class="tl-id${label.tag && label.tag.tone !== 'task' ? ` id-${label.tag.tone}` : ''}">${escapeHtml(
          label.id
        )}</span>`
      : '',
    label.pr ? pillHtml(label.pr) : '',
    label.state ? `<span class="tl-state">${escapeHtml(label.state)}</span>` : '',
    label.meta ? `<span class="tl-meta">${escapeHtml(label.meta)}</span>` : '',
  ].join('');
  if (row.group) {
    const verb = isCollapsed ? 'Expand' : 'Collapse';
    return `<div class="tl-label group"><button class="tl-chev" data-toggle="${String(row.id)}" aria-expanded="${String(
      !isCollapsed
    )}" aria-label="${verb} #${String(row.id)}" title="${verb} the group">${
      isCollapsed ? '▸' : '▾'
    }</button><div class="tl-ltext" tabindex="0" role="button" ${open}><span class="tl-l1">${head}</span><span class="tl-title strong">${escapeHtml(
      row.title
    )}</span></div></div>`;
  }
  if (row.readOnly && row.groupId === undefined) {
    // Rule TIMELINE-23: the rows of others are one line: the id, the short title and the PR
    return `<div class="tl-label compact" tabindex="0" role="button" ${open}><span class="tl-id${
      label.tag?.tone === 'bug' ? ' id-bug' : ' id-pbi'
    }">${escapeHtml(label.id ?? '')}</span><span class="tl-title">${escapeHtml(row.title)}</span>${
      label.pr ? pillHtml(label.pr) : ''
    }</div>`;
  }
  if (row.groupId !== undefined) {
    return `<div class="tl-label child${
      row.lastChild ? ' last' : ''
    }" tabindex="0" role="button" ${open}>${head}<span class="tl-title">${escapeHtml(row.title)}</span>${here}</div>`;
  }
  return `<div class="tl-label" tabindex="0" role="button" ${open}><span class="tl-l1">${head}${here}</span><span class="tl-title">${escapeHtml(
    row.title
  )}</span></div>`;
}

/** The lane of a group: the bracket of its life and its tasks, or (collapsed) one thin line per PR and the chips */
function renderGroupLane(group: GroupInfo, isCollapsed: boolean): string {
  if (isCollapsed) {
    const lines = group.lines
      .map(
        (line) =>
          `<span class="tl-line${line.faded ? ' faded' : ''}">${line.segments
            .map(
              (segment) =>
                `<span class="tl-lseg seg-${segment.kind}${
                  segment.approximate ? ' approximate' : ''
                }" data-from="${String(segment.start)}" data-to="${String(segment.end)}"></span>`
            )
            .join('')}</span>`
      )
      .join('');
    const chips = [
      group.needsYou ? `<span class="tl-gchip needs-you">${String(group.needsYou)} needs you</span>` : '',
      group.ready ? `<span class="tl-gchip ready">${String(group.ready)} ready</span>` : '',
    ].join('');
    return `<span class="tl-lines">${lines}</span>${
      chips ? `<span class="tl-after" data-from="${String(group.bracket.end)}">${chips}</span>` : ''
    }`;
  }
  const { bracket, tasks } = group;
  const bar = tasks
    ? `<span class="tl-tbar" aria-hidden="true">${[
        ['done', tasks.done],
        ['in-progress', tasks.inProgress],
        ['to-do', tasks.toDo],
      ]
        .filter(([, count]) => Number(count) > 0)
        .map(([cls, count]) => `<span class="tl-tseg ${String(cls)}" data-grow="${String(count)}"></span>`)
        .join('')}</span><span class="tl-ttext">${escapeHtml(tasks.text)}</span>`
    : '';
  return `<span class="tl-bracket${bracket.approximate ? ' approximate' : ''}" data-from="${String(
    bracket.start
  )}" data-to="${String(bracket.end)}"></span>${
    bracket.text ? `<span class="tl-btext" data-from="${String(bracket.start)}">${escapeHtml(bracket.text)}</span>` : ''
  }${bar ? `<span class="tl-after" data-from="${String(bracket.end)}">${bar}</span>` : ''}`;
}

function renderRow(row: TimelineRow): string {
  const isCollapsed = collapsed.includes(row.id);
  const label = renderLabel(row, isCollapsed);
  let popoverKey: string | undefined;
  if (row.popover) {
    popoverKey = `p${String(popovers.size)}`;
    popovers.set(popoverKey, row.popover);
  }
  const classes = ['tl-row'];
  if (row.readOnly && row.groupId === undefined && !row.group) {
    classes.push('compact');
  }
  if (row.group) {
    classes.push('group', 'in-group');
  } else if (row.groupId !== undefined) {
    classes.push('child', 'in-group');
    if (row.lastChild) {
      classes.push('last');
    }
  }
  if (row.faded) {
    classes.push('faded');
  }
  if (row.group) {
    return `<div class="${classes.join(' ')}">${label}<div class="tl-lane">${renderGroupLane(
      row.group,
      isCollapsed
    )}</div></div>`;
  }
  const segments = row.segments
    .map((segment) => renderSegment(segment, segment.kind === 'asleep' ? popoverKey : undefined))
    .join('');
  const chip =
    row.chip && row.segments.at(0) && row.segments[0].start > 1.3
      ? `<span class="tl-chip">${escapeHtml(row.chip)}</span>`
      : '';
  const note = row.note ? `<span class="tl-note tone-${row.note.tone}">${escapeHtml(row.note.text)}</span>` : '';
  const merged = row.merged
    ? `<span class="tl-note tone-merged" data-from="${String(row.merged.at)}">${escapeHtml(row.merged.text)}</span>`
    : '';
  const action = row.action
    ? actionButton(row.action, row.segments.some((segment) => segment.kind === 'needsYou') ? 'needsYou' : 'plain')
    : '';
  if (row.outline) {
    // Rule TIMELINE-9: the outline and its button share the lane (the outline gives way), so nothing overflows it
    const outline = `<span class="tl-outline${row.outline.broken ? ' broken' : ''}">${escapeHtml(
      row.outline.text
    )}</span>`;
    return `<div class="${classes.join(
      ' '
    )}">${label}<div class="tl-lane">${chip}<div class="tl-fill">${outline}${action}</div></div></div>`;
  }
  const after = note || action ? `<span class="tl-after" data-from="${String(row.end)}">${note}${action}</span>` : '';
  return `<div class="${classes.join(
    ' '
  )}">${label}<div class="tl-lane">${chip}${segments}${merged}${after}</div></div>`;
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

function section(title: string, body: string, note?: string, sub = false): string {
  return `<h2 class="tl-section${sub ? ' sub' : ''}">${escapeHtml(title)}</h2>${
    note ? `<p class="tl-empty-row">${escapeHtml(note)}</p>` : ''
  }${body}`;
}

function renderLegend(team: boolean): string {
  const item = (cls: string, label: string): string =>
    `<span class="tl-key"><span class="tl-swatch seg-${cls}"></span>${label}</span>`;
  // Rule TIMELINE-15: the key to the first line of a label
  const key = `<span class="tl-key tl-tagkey" aria-label="What the first line of a label says">${tagHtml({
    text: 'PBI',
    tone: 'pbi',
  })}${tagHtml({ text: 'BUG', tone: 'bug' })}work item title${pillHtml({ text: 'PR …' })}PR title${tagHtml({
    text: 'Task',
    tone: 'task',
  })}task title</span>`;
  return `<div class="tl-legend" aria-label="Legend">${item('coding', 'coding')}${item(
    'draft',
    'draft · self-review'
  )}${item('review', 'CI · review')}${item('needsYou', team ? 'needs its owner' : 'needs you')}${item(
    'ready',
    'ready to be merged'
  )}${team ? item('overdue', 'review overdue') : ''}${item(
    'asleep',
    'no update (zZ)'
  )}<span class="tl-key"><span class="tl-swatch bracket"></span>life of a work item with several PRs</span><span class="tl-key dep">⛓ dependency</span>${key}</div>`;
}

function renderHeader(current: TimelineModel): string {
  const range = (id: 'sprint' | 'sprintAndNext', text: string, title?: string): string =>
    `<button class="bd-chip" data-range="${id}" aria-pressed="${String(current.range === id)}"${
      title ? ` title="${escapeHtml(title)}"` : ''
    }>${text}</button>`;
  const left = current.header.left
    ? `<span class="bd-left${current.header.hurry ? ' hurry' : ''}">${escapeHtml(current.header.left)}</span>`
    : '';
  const team = current.scope === 'team' ? current.team : undefined;
  const stats = team
    ? `<span class="bd-stats">${String(team.sections.length)} ${
        team.sections.length === 1 ? 'person' : 'people'
      } shown · ${String(team.openItems)} open items</span>`
    : '';
  const teams = team && team.teamCount > 1 ? ` · ${String(team.teamCount)} teams` : '';
  return `<header class="bd-header"><h1 class="bd-sprint">${escapeHtml(current.header.sprint)}${teams}</h1>${
    current.header.dates ? `<span class="bd-left">${escapeHtml(current.header.dates)}</span>` : ''
  }${left}${stats}
    <div class="bd-tabs" role="group" aria-label="View"><button class="bd-chip" data-open-board aria-pressed="false">Track board</button><button class="bd-chip" aria-pressed="true">Sprint timeline</button></div>
    ${renderScope(current.scope)}${renderPeoplePicker(team?.picker)}
    <div class="bd-chips" role="group" aria-label="Range">${range('sprint', 'This sprint')}${range(
    'sprintAndNext',
    'This + next sprint',
    'Widen the view to the next sprint too: what is already planned there and what will spill over'
  )}</div>
    <div class="bd-chips" role="group" aria-label="Completed"><button class="bd-chip chip-completed" data-completed aria-pressed="${String(
      current.showCompleted
    )}" title="${escapeHtml(COMPLETED_TOOLTIP)}">Completed</button></div>
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
  if (team.status === 'loading') {
    return '<p class="message muted">Loading the work of the teams…</p>';
  }
  if (team.status === 'error') {
    return `<p class="message error">The work of the team could not be loaded: ${escapeHtml(
      team.error ?? 'error'
    )} <button class="bd-chip" data-refresh>Retry</button></p>`;
  }
  return team.noPeople ? `<p class="message muted bd-people-hint">${escapeHtml(EMPTY_PEOPLE_HINT)}</p>` : '';
}

/** Rule TIMELINE-25: what is asleep, and who owns the read-only rows */
function renderFooter(team: TimelineTeam): string {
  const asleep = team.asleep.length
    ? team.asleep.map((entry) => `#${String(entry.id)} (${escapeHtml(entry.owner)})`).join(' · ')
    : 'nothing: every item in progress was updated';
  return `<footer class="tl-footer"><span class="tl-fkey">ASLEEP</span><span class="tl-fasleep">${asleep}</span><span class="tl-fnote">Rows of other people are read-only · hover a bar for its details</span></footer>`;
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
  const team = current.scope === 'team' ? current.team : undefined;
  const youSection = team?.sections.find((person) => person.you);
  const mine = (row: TimelineRow): string => renderRow(row);
  const work = current.work.length
    ? visibleRows(current.work, collapsed).map(mine).join('')
    : `<p class="tl-empty-row">${
        current.finished.length ? 'No open work item' : 'None of your work items is in the sprint'
      }</p>`;
  // Rule TIMELINE-19
  const finished = current.finished.length
    ? section('DONE THIS SPRINT', visibleRows(current.finished, collapsed).map(renderRow).join(''), undefined, !!team)
    : '';
  const planned =
    current.range === 'sprintAndNext'
      ? section(
          'PLANNED IN THE NEXT SPRINT',
          current.planned.rows.map(renderRow).join(''),
          current.planned.note,
          !!team
        )
      : '';
  const reviews = current.reviews.length
    ? current.reviews.map(renderRow).join('')
    : '<p class="tl-empty-row">No review is waiting for you</p>';
  const notes = current.notes.map((note) => `<p class="message muted">${escapeHtml(note)}</p>`).join('');
  const days = `<div class="tl-row tl-row-days"><div class="tl-label plain"></div><div class="tl-days">${renderDays(
    current
  )}</div></div>`;
  const develop = section('DEVELOP', renderDevelop(current.develop), undefined, !!team);
  const reviewsSection = section(current.reviewsTitle, reviews, undefined, !!team);
  if (!team) {
    return `<div class="tl-grid">${days}<div class="tl-body"><div class="tl-overlay" aria-hidden="true"></div>
    ${section('MY WORK ITEMS', work)}${finished}${planned}${notes}${reviewsSection}${develop}</div></div>`;
  }
  // Rule TIMELINE-21: one section per person, the user's first with the rows, buttons and popovers of the "mine" timeline
  const others = team.sections
    .filter((person) => !person.you)
    .map((person) => {
      const done = person.finished.length
        ? section('DONE THIS SPRINT', visibleRows(person.finished, collapsed).map(renderRow).join(''), undefined, true)
        : '';
      return `${renderPersonHeader(person)}${visibleRows(person.rows, collapsed).map(renderRow).join('')}${done}`;
    })
    .join('');
  const extra = youSection ? visibleRows(youSection.rows, collapsed).map(renderRow).join('') : '';
  return `<div class="tl-grid">${days}<div class="tl-body"><div class="tl-overlay" aria-hidden="true"></div>
    ${teamStatusHtml(team)}${
    youSection ? renderPersonHeader(youSection) : ''
  }${work}${extra}${finished}${planned}${notes}${reviewsSection}${others}${develop}</div></div>`;
}

/** Positions and sizes come from the model in days: they are set after the markup is in place (strict CSP) */
function place(root: HTMLElement, current: TimelineModel): void {
  const total = current.days.length;
  root.style.setProperty('--tl-days', String(total));
  const percent = (days: number): string => `${String((days / total) * 100)}%`;
  root.querySelectorAll<HTMLElement>('[data-from]').forEach((element) => {
    const from = Number(element.dataset.from);
    element.style.left = percent(from);
    if (element.dataset.to !== undefined) {
      element.style.width = percent(Number(element.dataset.to) - from);
    }
  });
  // No room for a note or a button after the bar: it goes over the right end of the lane
  root.querySelectorAll<HTMLElement>('.tl-note, .tl-after').forEach((element) => {
    const lane = element.parentElement?.getBoundingClientRect();
    if (lane && element.getBoundingClientRect().right > lane.right) {
      element.classList.add('flip');
      element.style.left = 'auto';
      element.style.right = '6px';
    }
  });
  root.querySelectorAll<HTMLElement>('[data-grow]').forEach((element) => {
    element.style.flexGrow = element.dataset.grow ?? '1';
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
  const picker = rememberPicker();
  const scroll = app.querySelector('.tl-scroll');
  const scrollLeft = scroll?.scrollLeft ?? 0;
  const scrollTop = scroll?.scrollTop ?? 0;
  const team = model.scope === 'team' ? model.team : undefined;
  app.innerHTML = `${renderHeader(model)}${renderLegend(team !== undefined)}<div class="tl-scroll">${renderBody(
    model
  )}</div>${team ? renderFooter(team) : ''}`;
  restorePicker(app, picker);
  const grid = app.querySelector<HTMLElement>('.tl-grid');
  if (grid) {
    place(grid, model);
    // Wide ranges scroll sideways: the grid is as wide as its days need
    app.querySelector<HTMLElement>('.tl-scroll')?.scrollTo({ left: scrollLeft, top: scrollTop });
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
  const toggle = target?.closest<HTMLElement>('[data-toggle]');
  if (toggle?.dataset.toggle) {
    // Rule TIMELINE-18
    collapsed = toggleCollapsed(collapsed, Number(toggle.dataset.toggle));
    vscode.setState({ collapsed });
    render();
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
  if (target?.closest('[data-completed]')) {
    // Rule TIMELINE-19
    post({ type: 'setShowCompleted', show: !(model?.showCompleted ?? true) });
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
    if (!closePickerOnEscape({ render })) {
      hidePopover();
    }
    return;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (
    (event.key === 'Enter' || event.key === ' ') &&
    target?.matches('.tl-label[data-msg], .tl-ltext[data-msg], .tl-seg[data-popover]')
  ) {
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

startPeoplePicker({ post, picker: () => (model?.scope === 'team' ? model.team?.picker : undefined), render });

post({ type: 'ready' });
