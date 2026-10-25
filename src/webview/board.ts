/** The Track board webview (redesign): six columns of cards, a drawer with the selected card and hover summaries */
import { escapeHtml } from '../html';
import { icon } from '../icons';
import { lookClass } from '../look';
import type { BoardUpdate } from '../trackBoard';
import type { TeamBoardModel, TeamCard, TeamLane, TeamMarker } from '../teamBoardModel';
import { EMPTY_PEOPLE_HINT, pickerRows, shortSignIn, togglePerson, type PickedPerson } from '../teamPeople';
import { avatarColour, initials, shortPersonName } from '../teamView';
import {
  ALL_KINDS,
  COMPLETED_TOOLTIP,
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
  /** BoardWorkCard.key, or the PR id of a review (a work item has several cards when it is split, BOARD-20) */
  key: string;
}

const keyOf = (card: BoardReviewCard | BoardWorkCard): string => (card.kind === 'work' ? card.key : String(card.id));

/** The element of a card */
const cardSelector = (kind: string, key: string): string => `.bd-card[data-kind="${kind}"][data-key="${key}"]`;

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
/** The People picker is open, and what was typed in its filter box (UI only) */
let peopleOpen = false;
let peopleFilter = '';

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
  if (card.merged) {
    classes.push('is-merged');
  }
  if (card.current) {
    classes.push('is-current');
  }
  if (selected?.kind === 'work' && selected.key === card.key) {
    classes.push('is-selected');
  }
  const asleep = card.asleep
    ? `<span class="asleep" role="img" aria-label="${escapeHtml(card.asleep.text)}" title="${escapeHtml(
        card.asleep.text
      )}">${icon('sleep')}<span aria-hidden="true">${String(card.asleep.days)}d</span></span>`
    : '';
  const here = card.here ? '<span class="bd-here">● here</span>' : '';
  const verb = card.verb ? `<span class="bd-verb">${escapeHtml(card.verb)}</span>` : '';
  const tag = card.tag ? `<span class="bd-tag">${escapeHtml(card.tag)}</span>` : '';
  const note = card.note ? `<span class="bd-note">${escapeHtml(card.note)}</span>` : '';
  const status = card.status
    ? `<span class="bd-status tone-${card.status.tone}">${escapeHtml(card.status.text)}</span>`
    : '';
  const action = card.action ? actionButton(card.action, `bd-button${card.tone === 'ship' ? ' primary' : ''}`) : '';
  return `<article class="${classes.join(' ')}" role="listitem" tabindex="0" data-kind="work" data-id="${String(
    card.id
  )}" data-key="${escapeHtml(card.key)}"${card.current ? ' aria-current="true"' : ''} aria-label="${escapeHtml(
    `${card.header} ${card.title}`
  )}">
    <div class="bd-card-head"><span class="bd-id">${escapeHtml(card.header)}</span>${asleep}${here}${verb}${tag}</div>
    <span class="bd-title">${escapeHtml(card.title)}</span>${status}${note}${action}</article>`;
}

function renderReviewCard(card: BoardReviewCard): string {
  const classes = ['bd-card', 'bd-review', `urgency-${card.urgency}`];
  if (card.ciRunning) {
    classes.push('is-muted');
  }
  if (card.current) {
    classes.push('is-current');
  }
  if (selected?.kind === 'review' && selected.key === String(card.id)) {
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
  )}" data-key="${String(card.id)}"${card.current ? ' aria-current="true"' : ''} aria-label="${escapeHtml(
    `${card.header} ${card.title}`
  )}">
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

/* ---------- Whole team (Rules BOARD-26..30) ---------- */

function markerHtml(marker: TeamMarker): string {
  return `<span class="bd-marker tone-${marker.tone}" title="${escapeHtml(marker.title)}">${escapeHtml(
    marker.text
  )}</span>`;
}

function renderTeamCard(card: TeamCard): string {
  const classes = ['bd-card', 'bd-tcard', `tone-${card.tone}`, `kind-${card.itemKind}`];
  if (card.merged) {
    classes.push('is-merged');
  }
  if (card.needsYou) {
    classes.push('needs-you');
  }
  const asleep = card.asleep
    ? `<span class="asleep" role="img" aria-label="${escapeHtml(card.asleep.text)}" title="${escapeHtml(
        card.asleep.text
      )}">${icon('sleep')}<span aria-hidden="true">${String(card.asleep.days)}d</span></span>`
    : '';
  const part = card.part ? `<span class="bd-part">${escapeHtml(card.part)}</span>` : '';
  const badge = card.team ? `<span class="bd-team-badge" title="Team">${escapeHtml(card.team)}</span>` : '';
  const tag = card.tag ? `<span class="bd-tag">${escapeHtml(card.tag)}</span>` : '';
  const status = card.status
    ? `<span class="bd-status tone-${card.status.tone}">${escapeHtml(card.status.text)}</span>`
    : '';
  const note = card.note ? `<span class="bd-note">${escapeHtml(card.note)}</span>` : '';
  const markers = card.markers.length ? `<div class="bd-markers">${card.markers.map(markerHtml).join('')}</div>` : '';
  return `<article class="${classes.join(' ')}" role="listitem" tabindex="0" data-kind="team" data-id="${String(
    card.id
  )}" data-key="${escapeHtml(card.key)}" aria-label="${escapeHtml(`${card.idText} ${card.title}`)}">
    <div class="bd-card-head"><span class="bd-id">${escapeHtml(card.idText)}</span>${part}${asleep}${tag}${badge}</div>
    <span class="bd-title">${escapeHtml(card.title)}</span>${status}${note}${markers}</article>`;
}

function renderLane(lane: TeamLane, current: BoardModel, team: TeamBoardModel): string {
  const cell = (id: BoardColumnId): string => {
    const own = lane.you ? current.work.filter((card) => card.column === id).map(renderWorkCard) : [];
    const cards = lane.cards.filter((card) => card.column === id).map(renderTeamCard);
    const loose = lane.you
      ? current.reviews
          .filter((card) => card.column === id && team.looseReviews.includes(card.id))
          .map(renderReviewCard)
      : [];
    const ids = lane.you ? [...current.summary.ids, ...lane.collapsedIds] : lane.collapsedIds;
    const summary = id === 'done' && ids.length ? [renderSummaryCard(ids)] : [];
    return [...own, ...cards, ...loose, ...summary].join('');
  };
  return `<section class="bd-lane${lane.you ? ' is-you' : ''}" aria-label="${escapeHtml(
    lane.name
  )}"><div class="bd-lane-head"><span class="bd-avatar colour-${String(lane.colour)}" aria-hidden="true">${escapeHtml(
    lane.initials
  )}</span><span class="bd-lane-who"><b>${escapeHtml(lane.name)}</b><span class="bd-lane-sum">${escapeHtml(
    lane.summary
  )}</span></span></div>${current.columns
    .map(
      (column) => `<div class="bd-col" role="list" aria-label="${escapeHtml(column.title)}">${cell(column.id)}</div>`
    )
    .join('')}</section>`;
}

function renderTeamBoard(current: BoardModel, team: TeamBoardModel): string {
  const heads = current.columns
    .map((column) => {
      const numbers = team.columns.find((candidate) => candidate.id === column.id);
      const overdue = numbers?.overdue
        ? `<span class="bd-count overdue">${String(numbers.count)} · ${String(numbers.overdue)} overdue</span>`
        : `<span class="bd-count">${String(numbers?.count ?? 0)}</span>`;
      return `<div class="bd-head col-${column.id}"><span class="bd-head-title">${escapeHtml(
        column.title
      )}${overdue}</span><span class="bd-hint">${escapeHtml(column.hint)}</span></div>`;
    })
    .join('');
  const insights = team.insights
    .map(
      (insight) =>
        `<p class="bd-insight kind-${insight.kind}"><span class="bd-insight-label">${escapeHtml(
          insight.label
        )}</span>${escapeHtml(insight.text)}</p>`
    )
    .join('');
  const notes = current.notes.map((note) => `<p class="message muted">${escapeHtml(note)}</p>`).join('');
  let status = '';
  if (team.status === 'loading') {
    status = '<p class="message muted">Loading the work of the teams…</p>';
  } else if (team.status === 'error') {
    status = `<p class="message error">The work of the team could not be loaded: ${escapeHtml(
      team.error ?? 'error'
    )} <button class="bd-chip" data-refresh>Retry</button></p>`;
  }
  const hint = team.noPeople ? `<p class="message muted bd-people-hint">${escapeHtml(EMPTY_PEOPLE_HINT)}</p>` : '';
  return `<div class="bd-table bd-team">${status}${hint}${notes}<div class="bd-tgrid bd-heads"><span></span>${heads}</div>${team.lanes
    .map((lane) => renderLane(lane, current, team))
    .join(
      ''
    )}<footer class="bd-insights">${insights}<p class="bd-insight kind-note">Others' cards are read-only here: click opens the details panel (or the PR), actions stay with their owner.</p></footer></div>`;
}

function renderBoard(current: BoardModel): string {
  if (current.scope === 'team' && current.team) {
    return renderTeamBoard(current, current.team);
  }
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

function personRow(person: PickedPerson, checked: boolean): string {
  const hint = shortSignIn(person.uniqueName);
  return `<label class="bd-person-row"><input type="checkbox" data-person="${escapeHtml(person.id)}"${
    checked ? ' checked' : ''
  }><span class="bd-avatar mini colour-${String(
    avatarColour(shortPersonName(person.name))
  )}" aria-hidden="true">${escapeHtml(initials(person.name))}</span><span class="bd-person-name">${escapeHtml(
    shortPersonName(person.name)
  )}</span>${hint ? `<span class="bd-person-hint">${escapeHtml(hint)}</span>` : ''}</label>`;
}

/** The rows of the picker for what is typed: the chosen people first, then the candidates (Rule TEAM-1) */
function renderPeopleRows(team: TeamBoardModel): string {
  const rows = pickerRows(team.picker.selected, team.picker.candidates, peopleFilter);
  const chosen = rows.selected.map((person) => personRow(person, true)).join('');
  const others = rows.candidates.map((person) => personRow(person, false)).join('');
  const empty =
    !chosen && !others
      ? `<p class="bd-people-empty">${
          team.picker.loading ? 'Reading the members of your teams…' : 'Nobody matches'
        }</p>`
      : '';
  return `${chosen}${chosen && others ? '<hr class="bd-people-sep">' : ''}${others}${empty}`;
}

function renderPeoplePicker(current: BoardModel): string {
  const team = current.team;
  if (current.scope !== 'team' || !team) {
    return '';
  }
  return `<div class="bd-people"><button class="bd-people-button" data-people-toggle aria-haspopup="true" aria-expanded="${String(
    peopleOpen
  )}">People<span class="bd-pill-count">${String(
    team.picker.selected.length
  )}</span><span aria-hidden="true">▾</span></button><div class="bd-people-menu" role="dialog" aria-label="Choose people"${
    peopleOpen ? '' : ' hidden'
  }><div class="bd-people-top"><input type="search" class="bd-people-filter" data-people-filter placeholder="Filter people" aria-label="Filter people" autocomplete="off" value="${escapeHtml(
    peopleFilter
  )}"><button class="bd-link" data-people-clear${
    team.picker.selected.length ? '' : ' disabled'
  }>Clear</button></div><div class="bd-people-list" data-people-list>${renderPeopleRows(team)}</div></div></div>`;
}

function renderHeader(current: BoardModel): string {
  const chip = (kind: BoardKind, label: string): string =>
    `<button class="bd-chip chip-${kind}" data-kind-chip="${kind}" aria-pressed="${String(
      kinds.includes(kind)
    )}">${label}</button>`;
  const stats = current.team
    ? `<span class="bd-stats">${String(current.team.people)} ${
        current.team.people === 1 ? 'person' : 'people'
      } · ${String(current.team.workItems)} work items</span>`
    : '';
  const left = current.header.left
    ? `<span class="bd-left${current.header.hurry ? ' hurry' : ''}" title="${escapeHtml(
        current.header.tooltip ?? ''
      )}">${escapeHtml(current.header.left)}</span>`
    : '';
  return `<header class="bd-header"><h1 class="bd-sprint">${escapeHtml(current.header.sprint)}${
    current.team && current.team.teamCount > 1 ? ` · ${String(current.team.teamCount)} teams` : ''
  }</h1>${left}${stats}
    <div class="bd-tabs" role="group" aria-label="View"><button class="bd-chip" aria-pressed="true">Track board</button><button class="bd-chip" data-open-timeline aria-pressed="false">Sprint timeline</button></div>
    <div class="bd-segment" role="group" aria-label="Whose work"><button data-scope="mine" aria-pressed="${String(
      current.scope === 'mine'
    )}">Mine + my reviews</button><button data-scope="team" aria-pressed="${String(
    current.scope === 'team'
  )}">Whole team</button></div>${renderPeoplePicker(current)}
    <div class="bd-chips" role="group" aria-label="Type">${chip('backlog', 'Backlog Items')}${chip('bug', 'Bugs')}</div>
    <div class="bd-chips" role="group" aria-label="Completed"><button class="bd-chip chip-completed" data-completed aria-pressed="${String(
      current.showCompleted
    )}" title="${escapeHtml(COMPLETED_TOOLTIP)}">Completed</button></div>
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
  const closed = detail.closedPullRequests
    ? `<p class="bd-closed"><span class="bd-closed-label">${escapeHtml(
        detail.closedPullRequests.label
      )}</span> ${escapeHtml(detail.closedPullRequests.titles)}</p>`
    : '';
  const prs =
    detail.pullRequests.length || closed
      ? section(
          detail.pullRequestsTitle ?? (detail.pullRequests.length === 1 ? 'Pull request' : 'Pull requests'),
          `<ul class="bd-rows">${detail.pullRequests.map(renderPullRequest).join('')}</ul>${closed}`
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
  const facts = section('Facts', `<dl class="bd-facts">${factRows(detail.facts)}</dl>`);
  // Rule BOARD-23: the card of the tasks (or of a task) is about the tasks: they come first
  return card.part === 'tasks' || card.part === 'task'
    ? `${tasks}${renderStations(card)}${prs}${facts}${checks}`
    : `${renderStations(card)}${prs}${tasks}${facts}${checks}`;
}

function renderWorkDrawer(card: BoardWorkCard): string {
  const details: BoardAction = { label: 'All details', message: { type: 'openDetails', id: card.id } };
  return `<div class="bd-d-head"><span class="bd-d-id">#${String(card.id)}</span><span class="bd-d-sub">${escapeHtml(
    card.subtitle
  )}</span><button class="bd-icon-button" data-close aria-label="Close">×</button></div>
    <h2 class="bd-d-title">${escapeHtml(card.itemTitle)}</h2>${
    card.split ? section(card.split.title, `<p class="bd-why-text">${escapeHtml(card.split.text)}</p>`, 'bd-split') : ''
  }${trackBars(card.track, true)}${renderWhy(card.why)}${renderNeed(card)}${renderDetail(card)}${footer([
    card.checkout,
    card.openPullRequest,
    details,
  ])}`;
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
    ? model.work.find((card) => card.key === selected?.key)
    : model.reviews.find((card) => String(card.id) === selected?.key);
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

function popoverContent(card: AnyCard): string {
  if (card.kind === 'team') {
    return `<span class="bd-pop-title">${escapeHtml(card.title)}</span>${trackBars(card.track, true)}
      <dl class="bd-facts compact">${factRows(card.hover)}</dl><span class="bd-pop-hint">Read-only here: click opens ${
      card.prUrl && (card.part || card.merged) ? 'the PR' : 'the details'
    }</span>`;
  }
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

type AnyCard = BoardReviewCard | BoardWorkCard | (TeamCard & { kind: 'team' });

function teamCards(): TeamCard[] {
  return model?.team?.lanes.flatMap((lane) => lane.cards) ?? [];
}

function cardOf(element: Element | null): { element: HTMLElement; card: AnyCard } | undefined {
  const target = element?.closest<HTMLElement>('.bd-card[data-key]');
  const key = target?.dataset.key;
  if (!model || !target) {
    return undefined;
  }
  let card: AnyCard | undefined;
  if (target.dataset.kind === 'work') {
    card = model.work.find((candidate) => candidate.key === key);
  } else if (target.dataset.kind === 'team') {
    const found = teamCards().find((candidate) => candidate.key === key);
    card = found && { ...found, kind: 'team' };
  } else {
    card = model.reviews.find((candidate) => String(candidate.id) === key);
  }
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

function showPopover(target: HTMLElement, card: AnyCard): void {
  popover.className = card.kind === 'review' ? `bd-pop urgency-${card.urgency}` : 'bd-pop';
  popover.innerHTML = popoverContent(card);
  popover.hidden = false;
  sizeBars(popover);
  placePopoverNear(target);
}

function highlightRelated(card: AnyCard): void {
  clearRelated();
  if (card.kind === 'team') {
    for (const key of card.siblings) {
      document.querySelector(cardSelector('team', key))?.classList.add('is-related');
    }
    return;
  }
  if (card.kind !== 'work') {
    return;
  }
  // Rule BOARD-14: the other cards of the work item, and the cards of the work items linked to it
  for (const key of card.siblings) {
    document.querySelector(cardSelector('work', key))?.classList.add('is-related');
  }
  for (const id of card.related) {
    document
      .querySelectorAll(`.bd-card[data-kind="work"][data-id="${String(id)}"]`)
      .forEach((element) => element.classList.add('is-related'));
  }
}

function startHover(element: HTMLElement, card: AnyCard, immediately: boolean): void {
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
  if (current.scope === 'team' && current.team) {
    return renderBoard(current);
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
  const focusKey = focused?.closest<HTMLElement>('.bd-card[data-key]');
  const key = focusKey ? { kind: focusKey.dataset.kind ?? '', key: focusKey.dataset.key ?? '' } : undefined;
  // The People picker keeps its scroll and its focus (the filter box, or the person just ticked) across a redraw
  const pickerScroll = document.querySelector('[data-people-list]')?.scrollTop ?? 0;
  const typing = focused?.matches('[data-people-filter]') === true;
  const person = focused?.dataset.person;
  app.innerHTML = `${renderHeader(model)}<div class="bd-main"><div class="bd-scroll">${renderBody(
    model
  )}</div><aside id="bd-drawer" class="bd-drawer" aria-label="Selected card" hidden></aside></div>`;
  sizeBars(app);
  renderDrawer();
  if (key) {
    app.querySelector<HTMLElement>(cardSelector(key.kind, key.key))?.focus({ preventScroll: true });
  }
  const list = app.querySelector<HTMLElement>('[data-people-list]');
  if (list && peopleOpen) {
    list.scrollTop = pickerScroll;
    const filter = app.querySelector<HTMLInputElement>('[data-people-filter]');
    if (typing && filter) {
      filter.focus();
      filter.setSelectionRange(filter.value.length, filter.value.length);
    } else if (person) {
      app.querySelector<HTMLElement>(`input[data-person="${CSS.escape(person)}"]`)?.focus({ preventScroll: true });
    }
  }
}

/* ---------- Events ---------- */

function select(next: Selection | undefined): void {
  selected = next;
  document.querySelectorAll('.bd-card.is-selected').forEach((element) => element.classList.remove('is-selected'));
  if (next) {
    document.querySelector(cardSelector(next.kind, next.key))?.classList.add('is-selected');
  }
  renderDrawer();
}

function toggleKind(kind: BoardKind): void {
  kinds = kinds.includes(kind) ? kinds.filter((candidate) => candidate !== kind) : [...kinds, kind];
  vscode.setState({ kinds });
  post({ type: 'setBoardKinds', kinds });
}

/** Cards of the user open the drawer; the ones of the others are read-only: the details panel, or the PR (BOARD-26) */
function openCard(card: AnyCard): void {
  if (card.kind === 'team') {
    post(
      card.prUrl && (card.part || card.merged)
        ? { type: 'openTeamPullRequest', url: card.prUrl }
        : { type: 'openDetails', id: card.id }
    );
    return;
  }
  select({ kind: card.kind, key: keyOf(card) });
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLElement>('[data-act]');
  const action = button?.dataset.act ? actions.get(button.dataset.act) : undefined;
  if (action) {
    post(action.message);
    return;
  }
  const scope = target?.closest<HTMLElement>('[data-scope]');
  if (scope) {
    post({ type: 'setTeamScope', scope: scope.dataset.scope === 'team' ? 'team' : 'mine' });
    return;
  }
  if (target?.closest('[data-people-toggle]')) {
    peopleOpen = !peopleOpen;
    render();
    if (peopleOpen) {
      document.querySelector<HTMLInputElement>('[data-people-filter]')?.focus();
    }
    return;
  }
  if (target?.closest('[data-people-clear]')) {
    post({ type: 'setTeamPeople', people: [] });
    return;
  }
  if (peopleOpen && !target?.closest('.bd-people')) {
    peopleOpen = false;
    render();
  }
  const chip = target?.closest<HTMLElement>('[data-kind-chip]');
  if (chip) {
    toggleKind(chip.dataset.kindChip === 'bug' ? 'bug' : 'backlog');
    return;
  }
  if (target?.closest('[data-completed]')) {
    // Rule BOARD-25: the setting is shared with the Sprint timeline; both tabs redraw from it
    post({ type: 'setShowCompleted', show: !(model?.showCompleted ?? true) });
    return;
  }
  if (target?.closest('[data-open-timeline]')) {
    post({ type: 'openTimeline' });
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
    openCard(found.card);
  }
});

document.addEventListener('change', (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  const picker = model?.team?.picker;
  if (!target?.dataset.person || !picker) {
    return;
  }
  const person = [...picker.selected, ...picker.candidates].find((candidate) => candidate.id === target.dataset.person);
  if (person) {
    // Rule TEAM-1: the setting is written at once; the board redraws when it changes
    post({ type: 'setTeamPeople', people: togglePerson(picker.selected, person) });
  }
});

document.addEventListener('input', (event) => {
  const target = event.target instanceof HTMLInputElement ? event.target : null;
  if (!target?.matches('[data-people-filter]') || !model?.team) {
    return;
  }
  peopleFilter = target.value;
  const list = document.querySelector('[data-people-list]');
  if (list) {
    list.innerHTML = renderPeopleRows(model.team);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (peopleOpen) {
      peopleOpen = false;
      render();
    } else if (!popover.hidden) {
      endHover();
    } else if (selected) {
      const { kind, key } = selected;
      select(undefined);
      document.querySelector<HTMLElement>(cardSelector(kind, key))?.focus();
    }
    return;
  }
  const target = event.target instanceof HTMLElement ? event.target : null;
  if ((event.key === 'Enter' || event.key === ' ') && target?.matches('.bd-card[data-key]')) {
    event.preventDefault();
    const found = cardOf(target);
    if (found) {
      hidePopover();
      openCard(found.card);
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
  // "Open on board" of the Sprint timeline: the card is selected and brought into view
  if (event.data.type === 'select') {
    select({ kind: 'work', key: event.data.key });
    document.querySelector(cardSelector('work', event.data.key))?.scrollIntoView({ block: 'center' });
    return;
  }
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
