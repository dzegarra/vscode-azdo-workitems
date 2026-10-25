/** The Track board webview (redesign): six columns of cards, a drawer with the selected card and hover summaries */
import { escapeHtml } from '../html';
import { icon } from '../icons';
import { lookClass } from '../look';
import type { BoardUpdate } from '../trackBoard';
import {
  ALL_KINDS,
  type BoardAction,
  type BoardColumn,
  type BoardColumnId,
  type BoardFact,
  type BoardKind,
  type BoardMessage,
  type BoardModel,
  type BoardPullRequest,
  type BoardReviewCard,
  type BoardStation,
  type BoardTask,
  type BoardWhy,
  type BoardWorkCard,
} from '../trackBoardModel';

interface VsCodeApi {
  postMessage(message: BoardMessage): void;
  getState(): Partial<SavedState> | undefined;
  setState(state: SavedState): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

interface SavedState {
  kinds: BoardKind[];
}

interface Selection {
  kind: 'review' | 'work';
  id: number;
}

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const saved = vscode.getState();

let model: BoardModel | undefined;
let kinds: BoardKind[] = ALL_KINDS.filter((kind) => saved?.kinds?.includes(kind) ?? true);
let selected: Selection | undefined;
/** The buttons of the last render: the markup only names them */
let actions = new Map<string, BoardAction>();
let hoverTimer: number | undefined;
let lastModel: string | undefined;

const post = (message: BoardMessage): void => vscode.postMessage(message);

/* ---------- Small pieces ---------- */

const SHORT_STATIONS: Record<string, string> = { 'Pull request': 'PR', 'Ready to be merged': 'Ready' };

function actionButton(action: BoardAction, className: string): string {
  const key = `a${String(actions.size)}`;
  actions.set(key, action);
  return `<button class="${className}" data-act="${key}">${escapeHtml(action.label)}</button>`;
}

function factRows(facts: BoardFact[]): string {
  return facts
    .map(
      (fact) =>
        `<dt>${escapeHtml(fact.label)}</dt><dd${fact.tone ? ` class="tone-${fact.tone}"` : ''}>${escapeHtml(
          fact.value
        )}</dd>`
    )
    .join('');
}

/** The six segments of the track; `named`: the name of each station under it */
function trackBars(stations: BoardStation[], named: boolean): string {
  const items = stations
    .map((station) => {
      const label = SHORT_STATIONS[station.label] ?? station.label;
      const title = `${station.label}${station.detail ? ` · ${station.detail}` : ''}`;
      return `<li class="bd-station station-${station.state}${station.current ? ' current' : ''}" title="${escapeHtml(
        title
      )}"><span class="bd-bar" aria-hidden="true"></span>${
        named ? `<span class="bd-station-name">${escapeHtml(label)}</span>` : ''
      }<span class="visually-hidden">${escapeHtml(`${title}: ${station.state}`)}</span></li>`;
    })
    .join('');
  return `<ol class="bd-track${named ? ' named' : ''}">${items}</ol>`;
}

/* ---------- Cards ---------- */

function renderWorkCard(card: BoardWorkCard): string {
  const classes = ['bd-card', `tone-${card.tone}`];
  if (card.current) {
    classes.push('is-current');
  }
  if (selected?.kind === 'work' && selected.id === card.id) {
    classes.push('is-selected');
  }
  const asleep = card.asleep
    ? `<span class="asleep" role="img" aria-label="${escapeHtml(card.asleep.text)}" title="${escapeHtml(
        card.asleep.text
      )}">${icon('sleep')}<span aria-hidden="true">${String(card.asleep.days)}d</span></span>`
    : '';
  const here = card.here ? '<span class="bd-here">● here</span>' : '';
  const verb = card.verb ? `<span class="bd-verb">${escapeHtml(card.verb)}</span>` : '';
  const status = card.status
    ? `<span class="bd-status tone-${card.status.tone}">${escapeHtml(card.status.text)}</span>`
    : '';
  const action = card.action ? actionButton(card.action, `bd-button${card.tone === 'ship' ? ' primary' : ''}`) : '';
  return `<article class="${classes.join(' ')}" role="listitem" tabindex="0" data-kind="work" data-id="${String(
    card.id
  )}"${card.current ? ' aria-current="true"' : ''} aria-label="${escapeHtml(`${card.header} ${card.title}`)}">
    <div class="bd-card-head"><span class="bd-id">${escapeHtml(card.header)}</span>${asleep}${here}${verb}</div>
    <span class="bd-title">${escapeHtml(card.title)}</span>${status}${action}</article>`;
}

function renderReviewCard(card: BoardReviewCard): string {
  const classes = ['bd-card', 'bd-review', `urgency-${card.urgency}`];
  if (card.ciRunning) {
    classes.push('is-muted');
  }
  if (card.current) {
    classes.push('is-current');
  }
  if (selected?.kind === 'review' && selected.id === card.id) {
    classes.push('is-selected');
  }
  const body = card.ciRunning
    ? '<span class="bd-status tone-normal">CI running · clock started</span>'
    : `<span class="bd-title">${escapeHtml(
        card.title
      )}</span><span class="bd-bar-track" aria-hidden="true"><span class="bd-bar-fill" data-elapsed="${String(
        card.elapsed
      )}"></span></span>`;
  const status = card.status
    ? `<span class="bd-status tone-${card.status.tone}">${escapeHtml(card.status.text)}</span>`
    : '';
  return `<article class="${classes.join(' ')}" role="listitem" tabindex="0" data-kind="review" data-id="${String(
    card.id
  )}"${card.current ? ' aria-current="true"' : ''} aria-label="${escapeHtml(`${card.header} ${card.title}`)}">
    <div class="bd-card-head"><span class="bd-id">${escapeHtml(
      card.header
    )}</span><span class="bd-deadline">${escapeHtml(card.deadline)}</span></div>${body}${
    card.ciRunning ? '' : status
  }</article>`;
}

function renderSummaryCard(ids: number[]): string {
  return `<article class="bd-card bd-summary" role="listitem"><span class="bd-id">${ids
    .map((id) => `#${String(id)}`)
    .join(' · ')}</span><span class="bd-summary-text">${String(ids.length)} Done this sprint</span></article>`;
}

/* ---------- Board ---------- */

function columnCounts(column: BoardColumn): string {
  return column.reviewCount ? `${String(column.count)} · ${String(column.reviewCount)}` : String(column.count);
}

function renderColumnHeads(columns: BoardColumn[]): string {
  return `<div class="bd-grid bd-heads">${columns
    .map(
      (column) =>
        `<div class="bd-head col-${column.id}"><span class="bd-head-title">${escapeHtml(
          column.title
        )}<span class="bd-count">${columnCounts(column)}</span></span><span class="bd-hint">${escapeHtml(
          column.hint
        )}</span></div>`
    )
    .join('')}</div>`;
}

function renderRow(columns: BoardColumn[], cell: (id: BoardColumnId) => string): string {
  return `<div class="bd-grid">${columns
    .map(
      (column) => `<div class="bd-col" role="list" aria-label="${escapeHtml(column.title)}">${cell(column.id)}</div>`
    )
    .join('')}</div>`;
}

function renderBoard(current: BoardModel): string {
  const work = (id: BoardColumnId): string => {
    const cards = current.work.filter((card) => card.column === id).map(renderWorkCard);
    const summary = id === 'done' && current.summary.ids.length ? [renderSummaryCard(current.summary.ids)] : [];
    return [...cards, ...summary].join('');
  };
  const reviews = (id: BoardColumnId): string =>
    current.reviews
      .filter((card) => card.column === id)
      .map(renderReviewCard)
      .join('');
  const notes = current.notes.map((note) => `<p class="message muted">${escapeHtml(note)}</p>`).join('');
  return `<div class="bd-table">${renderColumnHeads(current.columns)}
    <h2 class="bd-row-label">My work</h2>${renderRow(current.columns, work)}
    <h2 class="bd-row-label bd-row-reviews">Pull Requests you review</h2>${notes}${renderRow(
    current.columns,
    reviews
  )}</div>`;
}

function renderHeader(current: BoardModel): string {
  const chip = (kind: BoardKind, label: string): string =>
    `<button class="bd-chip chip-${kind}" data-kind-chip="${kind}" aria-pressed="${String(
      kinds.includes(kind)
    )}">${label}</button>`;
  const left = current.header.left
    ? `<span class="bd-left${current.header.hurry ? ' hurry' : ''}" title="${escapeHtml(
        current.header.tooltip ?? ''
      )}">${escapeHtml(current.header.left)}</span>`
    : '';
  return `<header class="bd-header"><h1 class="bd-sprint">${escapeHtml(current.header.sprint)}</h1>${left}
    <span class="bd-scope">Mine + my reviews</span>
    <div class="bd-chips" role="group" aria-label="Type">${chip('backlog', 'Backlog Items')}${chip('bug', 'Bugs')}</div>
    <button class="bd-icon-button" data-refresh title="Refresh" aria-label="Refresh">${icon('sync')}</button></header>`;
}

/* ---------- Drawer ---------- */

function renderNeed(card: BoardWorkCard): string {
  const need = card.need;
  if (!need) {
    return '';
  }
  const tests = need.tests.length
    ? `<ul class="bd-need-tests">${need.tests.map((test) => `<li>${escapeHtml(test)}</li>`).join('')}</ul>`
    : '';
  const buttons = need.actions.map((action, index) =>
    actionButton(action, `bd-button${index === 0 ? ' primary' : ''}`)
  );
  return `<section class="bd-need" aria-label="Needs you"><span class="bd-label">NEEDS YOU · ${escapeHtml(
    need.title
  )}</span><span>${escapeHtml(need.text)}</span>${tests}<div class="bd-buttons">${buttons.join('')}</div></section>`;
}

function footer(buttons: (BoardAction | undefined)[]): string {
  return `<footer class="bd-d-foot">${buttons
    .filter((action): action is BoardAction => action !== undefined)
    .map((action) => actionButton(action, 'bd-button wide'))
    .join('')}</footer>`;
}

function section(title: string, body: string, className = ''): string {
  return `<section class="bd-sec${className ? ` ${className}` : ''}"><h3 class="bd-sec-title">${escapeHtml(
    title
  )}</h3>${body}</section>`;
}

/** "Why CI": one sentence, the reason the card is in its column */
function renderWhy(why: BoardWhy): string {
  return section(why.title, `<p class="bd-why-text">${escapeHtml(why.text)}</p>`, 'bd-why');
}

/** A button that looks like a link: the buttons are posted by the same code as the footer ones */
function linkButton(action: BoardAction, text: string, title: string): string {
  const key = `a${String(actions.size)}`;
  actions.set(key, action);
  return `<button class="bd-link" data-act="${key}" title="${escapeHtml(title)}">${escapeHtml(text)}</button>`;
}

function renderStations(card: BoardWorkCard): string {
  const rows = card.detail.stations
    .map((station) => {
      const detail = station.detail ? ` · ${station.detail}` : '';
      const lines = station.notes.filter((note) => note !== station.detail);
      const notes = lines.length
        ? `<span class="bd-st-notes">${lines.map((note) => escapeHtml(note)).join(' · ')}</span>`
        : '';
      return `<li class="bd-st station-${station.state}${station.current ? ' current' : ''}"${
        station.current ? ' aria-current="step"' : ''
      }><span class="bd-st-dot" aria-hidden="true"></span><span class="bd-st-name">${escapeHtml(
        station.label
      )}</span><span class="bd-st-state">${escapeHtml(station.stateText + detail)}</span>${notes}</li>`;
    })
    .join('');
  return section('Stations', `<ol class="bd-stations">${rows}</ol>`);
}

function renderPullRequest(pr: BoardPullRequest): string {
  const pill = `<span class="bd-pill tone-${pr.tone}">${escapeHtml(pr.status)}</span>`;
  const followed = pr.followed ? '<span class="bd-followed" title="The track follows this PR">tracked</span>' : '';
  const repository = pr.repository ? `<span class="bd-meta">${escapeHtml(pr.repository)}</span>` : '';
  const lines = [
    pr.ci
      ? `<span class="bd-line${pr.ci.tone ? ` tone-${pr.ci.tone}` : ''}">CI · ${escapeHtml(pr.ci.text)}</span>`
      : '',
    pr.reviewers ? `<span class="bd-line">Reviewers · ${escapeHtml(pr.reviewers)}</span>` : '',
    pr.flags.length ? `<span class="bd-line">${escapeHtml(pr.flags.join(' · '))}</span>` : '',
    ...pr.warnings.map((warning) => `<span class="bd-line tone-needsYou">${escapeHtml(warning)}</span>`),
  ].join('');
  return `<li class="bd-row${pr.followed ? ' followed' : ''}"><div class="bd-row-head">${linkButton(
    pr.open,
    `PR ${String(pr.id)}`,
    'Open the PR'
  )}${pill}${followed}${repository}</div><span class="bd-row-title">${escapeHtml(pr.title)}</span>${lines}</li>`;
}

function renderTask(task: BoardTask): string {
  let flag = '';
  if (task.keepsOutOfDone) {
    flag = '<span class="bd-flag">keeps it out of Done</span>';
  } else if (task.open) {
    flag = '<span class="bd-flag soft">open</span>';
  }
  const who = task.assignee ? `<span class="bd-meta">${escapeHtml(task.assignee)}</span>` : '';
  return `<li class="bd-row task"><div class="bd-row-head"><span class="bd-dot cat-${
    task.category
  }" aria-hidden="true"></span>${linkButton(
    task.openDetails,
    `#${String(task.id)}`,
    'Open the Work Item Details panel'
  )}<span class="bd-meta">${escapeHtml(task.state)}</span>${who}${flag}</div><span class="bd-row-title">${escapeHtml(
    task.title
  )}</span></li>`;
}

function renderDetail(card: BoardWorkCard): string {
  const detail = card.detail;
  const prs = detail.pullRequests.length
    ? section(
        detail.pullRequests.length === 1 ? 'Pull request' : 'Pull requests',
        `<ul class="bd-rows">${detail.pullRequests.map(renderPullRequest).join('')}</ul>`
      )
    : '';
  const tasks = detail.tasks
    ? section(
        'Tasks',
        `<p class="bd-sum">${escapeHtml(detail.tasks.summary)}</p><ul class="bd-rows">${detail.tasks.items
          .map(renderTask)
          .join('')}</ul>`
      )
    : '';
  const checks = detail.checks.length
    ? section(
        detail.checksTitle,
        `<ul class="bd-checks">${detail.checks
          .map((check) => `<li class="${check.severity}">${escapeHtml(check.text)}</li>`)
          .join('')}</ul>`
      )
    : '';
  return `${renderStations(card)}${prs}${tasks}${section(
    'Facts',
    `<dl class="bd-facts">${factRows(detail.facts)}</dl>`
  )}${checks}`;
}

function renderWorkDrawer(card: BoardWorkCard): string {
  const details: BoardAction = { label: 'All details', message: { type: 'openDetails', id: card.id } };
  return `<div class="bd-d-head"><span class="bd-d-id">#${String(card.id)}</span><span class="bd-d-sub">${escapeHtml(
    card.subtitle
  )}</span><button class="bd-icon-button" data-close aria-label="Close">×</button></div>
    <h2 class="bd-d-title">${escapeHtml(card.title)}</h2>${trackBars(card.track, true)}${renderWhy(
    card.why
  )}${renderNeed(card)}${renderDetail(card)}${footer([card.checkout, card.openPullRequest, details])}`;
}

function renderReviewDrawer(card: BoardReviewCard): string {
  return `<div class="bd-d-head"><span class="bd-d-id">PR ${String(card.id)}</span><span class="bd-d-sub">${
    card.isRequired ? 'Required' : 'Optional'
  } review · ${escapeHtml(
    card.deadline
  )}</span><button class="bd-icon-button" data-close aria-label="Close">×</button></div>
    <h2 class="bd-d-title">${escapeHtml(card.title)}</h2>${renderWhy(card.why)}
    <div class="bd-deadline-box urgency-${
      card.urgency
    }"><span class="bd-bar-track" aria-hidden="true"><span class="bd-bar-fill" data-elapsed="${String(
    card.elapsed
  )}"></span></span><span class="bd-mono">${escapeHtml(card.deadlineText)}</span></div>
    <dl class="bd-facts">${factRows(card.facts)}</dl>${footer([card.checkout, card.openPullRequest])}`;
}

function selectedCard(): BoardReviewCard | BoardWorkCard | undefined {
  if (!model || !selected) {
    return undefined;
  }
  return selected.kind === 'work'
    ? model.work.find((card) => card.id === selected?.id)
    : model.reviews.find((card) => card.id === selected?.id);
}

/* ---------- Hover summary ---------- */

/** Widths cannot be inline styles under the CSP: they are set from the script */
function sizeBars(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.bd-bar-fill[data-elapsed]').forEach((fill) => {
    fill.style.width = `${String(Math.round(Math.min(1, Math.max(0, Number(fill.dataset.elapsed))) * 100))}%`;
  });
}

const popover = document.createElement('div');
popover.className = 'bd-pop';
popover.setAttribute('role', 'tooltip');
popover.hidden = true;
document.body.append(popover);

function popoverContent(card: BoardReviewCard | BoardWorkCard): string {
  if (card.kind === 'work') {
    return `<span class="bd-pop-title">${escapeHtml(card.title)}</span>${trackBars(card.track, true)}
      <dl class="bd-facts compact">${factRows(
        card.hover
      )}</dl><span class="bd-pop-hint">Click for details and actions</span>`;
  }
  return `<span class="bd-pop-title">${escapeHtml(card.title)}</span>
    <span class="bd-bar-track" aria-hidden="true"><span class="bd-bar-fill" data-elapsed="${String(
      card.elapsed
    )}"></span></span><span class="bd-mono">${escapeHtml(card.deadlineText)}</span>
    <dl class="bd-facts compact">${factRows(card.hover)}</dl><span class="bd-pop-hint">Click for details</span>`;
}

function hidePopover(): void {
  window.clearTimeout(hoverTimer);
  hoverTimer = undefined;
  popover.hidden = true;
}

function clearRelated(): void {
  document.querySelectorAll('.bd-card.is-related').forEach((element) => element.classList.remove('is-related'));
}

function cardOf(element: Element | null): { element: HTMLElement; card: BoardReviewCard | BoardWorkCard } | undefined {
  const target = element?.closest<HTMLElement>('.bd-card[data-id]');
  const id = Number(target?.dataset.id);
  if (!model || !target) {
    return undefined;
  }
  const card =
    target.dataset.kind === 'work'
      ? model.work.find((candidate) => candidate.id === id)
      : model.reviews.find((candidate) => candidate.id === id);
  return card ? { element: target, card } : undefined;
}

/** Next to the card: on its right when there is room, else on its left; always inside the page */
function placePopoverNear(target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const viewWidth = document.documentElement.clientWidth;
  const viewHeight = document.documentElement.clientHeight;
  const width = Math.min(340, viewWidth - 16);
  popover.style.width = `${String(width)}px`;
  const gap = 8;
  const fitsRight = rect.right + gap + width <= viewWidth - 8;
  const wanted = fitsRight ? rect.right + gap : rect.left - gap - width;
  popover.style.left = `${String(Math.max(8, Math.min(wanted, viewWidth - 8 - width)))}px`;
  const height = popover.offsetHeight;
  popover.style.top = `${String(Math.max(8, Math.min(rect.top, viewHeight - 8 - height)))}px`;
}

function showPopover(target: HTMLElement, card: BoardReviewCard | BoardWorkCard): void {
  popover.className = card.kind === 'review' ? `bd-pop urgency-${card.urgency}` : 'bd-pop';
  popover.innerHTML = popoverContent(card);
  popover.hidden = false;
  sizeBars(popover);
  placePopoverNear(target);
}

function highlightRelated(card: BoardReviewCard | BoardWorkCard): void {
  clearRelated();
  if (card.kind !== 'work') {
    return;
  }
  for (const id of card.related) {
    document.querySelector(`.bd-card[data-kind="work"][data-id="${String(id)}"]`)?.classList.add('is-related');
  }
}

function startHover(element: HTMLElement, card: BoardReviewCard | BoardWorkCard, immediately: boolean): void {
  hidePopover();
  highlightRelated(card);
  if (immediately || !model?.popoverDelay) {
    showPopover(element, card);
    return;
  }
  hoverTimer = window.setTimeout(() => showPopover(element, card), model.popoverDelay);
}

function endHover(): void {
  hidePopover();
  clearRelated();
}

/* ---------- Render ---------- */

function renderDrawer(): void {
  const drawer = document.getElementById('bd-drawer');
  if (!drawer) {
    return;
  }
  const card = selectedCard();
  if (!card) {
    selected = undefined;
    drawer.hidden = true;
    drawer.innerHTML = '';
    return;
  }
  drawer.hidden = false;
  drawer.innerHTML = card.kind === 'work' ? renderWorkDrawer(card) : renderReviewDrawer(card);
  sizeBars(drawer);
}

function renderBody(current: BoardModel): string {
  if (current.status === 'error') {
    return `<div class="message error"><p>${escapeHtml(current.error ?? 'Unknown error')}</p>
      <button class="button primary" data-refresh>Retry</button></div>`;
  }
  const empty = !current.work.length && !current.summary.ids.length && !current.reviews.length;
  if (current.status === 'loading' && empty) {
    return '<p class="message muted">Checking…</p>';
  }
  if (empty) {
    return `<p class="message muted">Nothing in this sprint${
      kinds.length < ALL_KINDS.length ? ' for the types chosen' : ''
    }.</p>`;
  }
  return renderBoard(current);
}

function render(): void {
  if (!app || !model) {
    return;
  }
  hidePopover();
  actions = new Map();
  // Rule LOOK-1: the look is a class of the body, so the page background follows it too
  document.body.classList.toggle(
    'look-totalflow',
    lookClass(model.look, Array.from(document.body.classList)) !== undefined
  );
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  const focusKey = focused?.closest<HTMLElement>('.bd-card[data-id]');
  const key = focusKey ? `${focusKey.dataset.kind ?? ''}:${focusKey.dataset.id ?? ''}` : undefined;
  app.innerHTML = `${renderHeader(model)}<div class="bd-main"><div class="bd-scroll">${renderBody(
    model
  )}</div><aside id="bd-drawer" class="bd-drawer" aria-label="Selected card" hidden></aside></div>`;
  sizeBars(app);
  renderDrawer();
  if (key) {
    const [kind, id] = key.split(':');
    app.querySelector<HTMLElement>(`.bd-card[data-kind="${kind}"][data-id="${id}"]`)?.focus({ preventScroll: true });
  }
}

/* ---------- Events ---------- */

function select(next: Selection | undefined): void {
  selected = next;
  document.querySelectorAll('.bd-card.is-selected').forEach((element) => element.classList.remove('is-selected'));
  if (next) {
    document
      .querySelector(`.bd-card[data-kind="${next.kind}"][data-id="${String(next.id)}"]`)
      ?.classList.add('is-selected');
  }
  renderDrawer();
}

function toggleKind(kind: BoardKind): void {
  kinds = kinds.includes(kind) ? kinds.filter((candidate) => candidate !== kind) : [...kinds, kind];
  vscode.setState({ kinds });
  post({ type: 'setBoardKinds', kinds });
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLElement>('[data-act]');
  const action = button?.dataset.act ? actions.get(button.dataset.act) : undefined;
  if (action) {
    post(action.message);
    return;
  }
  const chip = target?.closest<HTMLElement>('[data-kind-chip]');
  if (chip) {
    toggleKind(chip.dataset.kindChip === 'bug' ? 'bug' : 'backlog');
    return;
  }
  if (target?.closest('[data-refresh]')) {
    post({ type: 'refresh' });
    return;
  }
  if (target?.closest('[data-close]')) {
    select(undefined);
    return;
  }
  const found = cardOf(target);
  if (found && found.element.dataset.kind) {
    hidePopover();
    select({ kind: found.card.kind, id: found.card.id });
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!popover.hidden) {
      endHover();
    } else if (selected) {
      const kind = selected.kind;
      const id = selected.id;
      select(undefined);
      document.querySelector<HTMLElement>(`.bd-card[data-kind="${kind}"][data-id="${String(id)}"]`)?.focus();
    }
    return;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  if ((event.key === 'Enter' || event.key === ' ') && target?.matches('.bd-card[data-id]')) {
    event.preventDefault();
    const found = cardOf(target);
    if (found) {
      hidePopover();
      select({ kind: found.card.kind, id: found.card.id });
    }
  }
});

document.addEventListener('mouseover', (event) => {
  const found = cardOf(event.target instanceof Element ? event.target : null);
  const from = cardOf(event.relatedTarget instanceof Element ? event.relatedTarget : null);
  if (found && found.element !== from?.element) {
    startHover(found.element, found.card, false);
  } else if (!found) {
    endHover();
  }
});

// The pointer left the page
document.addEventListener('mouseout', (event) => {
  if (!event.relatedTarget) {
    endHover();
  }
});

document.addEventListener('focusin', (event) => {
  const found = cardOf(event.target instanceof Element ? event.target : null);
  if (found) {
    startHover(found.element, found.card, true);
  }
});

document.addEventListener('focusout', (event) => {
  if (cardOf(event.target instanceof Element ? event.target : null)) {
    endHover();
  }
});

window.addEventListener('message', (event: MessageEvent<BoardUpdate>) => {
  // The store posts on every CI poll: an identical model must not close the popover nor reset the drawer
  const text = JSON.stringify(event.data.model);
  if (text === lastModel) {
    return;
  }
  lastModel = text;
  model = event.data.model;
  render();
});

window.addEventListener('resize', hidePopover);

// The saved types first, so the first model already has them
post({ type: 'setBoardKinds', kinds });
post({ type: 'ready' });
