/**
 * The "Whose work" switch and the People picker of the Whole team view, shared by the Track board and the Sprint
 * timeline (Rules TEAM-1, TIMELINE-21): the same markup, the same classes (media/board.css) and the same messages, so the
 * two tabs choose the people the same way. UI state only (open, filter text); the choice is the setting
 * `totalflowx.teamView.people`, written by the extension when it receives `setTeamPeople`
 */
import { escapeHtml } from '../html';
import type { PeoplePicker } from '../teamBoardModel';
import { pickerRows, shortSignIn, togglePerson, type PickedPerson } from '../teamPeople';
import { avatarColour, initials, shortPersonName, type TeamScope } from '../teamView';

/** The messages the picker and the switch post (members of the unions of both tabs) */
export type PeopleMessage =
  | { type: 'setTeamScope'; scope: TeamScope }
  | { type: 'setTeamPeople'; people: PickedPerson[] };

export interface PeoplePickerHost {
  post(message: PeopleMessage): void;
  /** The picker of the model on screen; undefined: none */
  picker(): PeoplePicker | undefined;
  /** Draws the page again (the picker keeps its state across it) */
  render(): void;
}

let open = false;
let filter = '';

/** Avatar of a person: initials on a colour that follows the name (a class, no inline style) */
export const avatarHtml = (initialsText: string, colour: number, mini = false): string =>
  `<span class="bd-avatar${mini ? ' mini' : ''} colour-${String(colour)}" aria-hidden="true">${escapeHtml(
    initialsText
  )}</span>`;

function personRow(person: PickedPerson, checked: boolean): string {
  const hint = shortSignIn(person.uniqueName);
  return `<label class="bd-person-row"><input type="checkbox" data-person="${escapeHtml(person.id)}"${
    checked ? ' checked' : ''
  }>${avatarHtml(
    initials(person.name),
    avatarColour(shortPersonName(person.name)),
    true
  )}<span class="bd-person-name">${escapeHtml(shortPersonName(person.name))}</span>${
    hint ? `<span class="bd-person-hint">${escapeHtml(hint)}</span>` : ''
  }</label>`;
}

/** The rows for what is typed: the chosen people first, then the candidates (Rule TEAM-1) */
function rowsHtml(picker: PeoplePicker): string {
  const rows = pickerRows(picker.selected, picker.candidates, filter);
  const chosen = rows.selected.map((person) => personRow(person, true)).join('');
  const others = rows.candidates.map((person) => personRow(person, false)).join('');
  const empty =
    !chosen && !others
      ? `<p class="bd-people-empty">${picker.loading ? 'Reading the members of your teams…' : 'Nobody matches'}</p>`
      : '';
  return `${chosen}${chosen && others ? '<hr class="bd-people-sep">' : ''}${others}${empty}`;
}

/** "Mine + my reviews | Whole team" */
export const renderScope = (scope: TeamScope): string =>
  `<div class="bd-segment" role="group" aria-label="Whose work"><button data-scope="mine" aria-pressed="${String(
    scope === 'mine'
  )}">Mine + my reviews</button><button data-scope="team" aria-pressed="${String(
    scope === 'team'
  )}">Whole team</button></div>`;

/** The button "People N ▾" and its dropdown; nothing without a picker (the scope is "Mine + my reviews") */
export function renderPeoplePicker(picker: PeoplePicker | undefined): string {
  if (!picker) {
    return '';
  }
  return `<div class="bd-people"><button class="bd-people-button" data-people-toggle aria-haspopup="true" aria-expanded="${String(
    open
  )}">People<span class="bd-pill-count">${String(
    picker.selected.length
  )}</span><span aria-hidden="true">▾</span></button><div class="bd-people-menu" role="dialog" aria-label="Choose people"${
    open ? '' : ' hidden'
  }><div class="bd-people-top"><input type="search" class="bd-people-filter" data-people-filter placeholder="Filter people" aria-label="Filter people" autocomplete="off" value="${escapeHtml(
    filter
  )}"><button class="bd-link" data-people-clear${
    picker.selected.length ? '' : ' disabled'
  }>Clear</button></div><div class="bd-people-list" data-people-list>${rowsHtml(picker)}</div></div></div>`;
}

/** What a redraw must keep of the picker: its scroll and its focus (the filter box, or the person just ticked) */
export interface PickerMemory {
  scroll: number;
  typing: boolean;
  person?: string;
}

export function rememberPicker(): PickerMemory {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  return {
    scroll: document.querySelector('[data-people-list]')?.scrollTop ?? 0,
    typing: focused?.matches('[data-people-filter]') === true,
    person: focused?.dataset.person,
  };
}

export function restorePicker(root: HTMLElement, memory: PickerMemory): void {
  const list = root.querySelector<HTMLElement>('[data-people-list]');
  if (!list || !open) {
    return;
  }
  list.scrollTop = memory.scroll;
  const box = root.querySelector<HTMLInputElement>('[data-people-filter]');
  if (memory.typing && box) {
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  } else if (memory.person) {
    root
      .querySelector<HTMLElement>(`input[data-person="${CSS.escape(memory.person)}"]`)
      ?.focus({ preventScroll: true });
  }
}

/** Escape closes the dropdown: true when it was open (the page then does nothing else with the key) */
export function closePickerOnEscape(host: Pick<PeoplePickerHost, 'render'>): boolean {
  if (!open) {
    return false;
  }
  open = false;
  host.render();
  return true;
}

/** Listens to the clicks, ticks and typing of the switch and the picker. Call once */
export function startPeoplePicker(host: PeoplePickerHost): void {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const scope = target?.closest<HTMLElement>('[data-scope]');
    if (scope) {
      host.post({ type: 'setTeamScope', scope: scope.dataset.scope === 'team' ? 'team' : 'mine' });
      return;
    }
    if (target?.closest('[data-people-toggle]')) {
      open = !open;
      host.render();
      if (open) {
        document.querySelector<HTMLInputElement>('[data-people-filter]')?.focus();
      }
      return;
    }
    if (target?.closest('[data-people-clear]')) {
      host.post({ type: 'setTeamPeople', people: [] });
      return;
    }
    if (open && !target?.closest('.bd-people')) {
      open = false;
      host.render();
    }
  });
  document.addEventListener('change', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const picker = host.picker();
    if (!target?.dataset.person || !picker) {
      return;
    }
    const person = [...picker.selected, ...picker.candidates].find(
      (candidate) => candidate.id === target.dataset.person
    );
    if (person) {
      // Rule TEAM-1: the setting is written at once; the page redraws when it changes
      host.post({ type: 'setTeamPeople', people: togglePerson(picker.selected, person) });
    }
  });
  document.addEventListener('input', (event) => {
    const target = event.target instanceof HTMLInputElement ? event.target : null;
    const picker = host.picker();
    if (!target?.matches('[data-people-filter]') || !picker) {
      return;
    }
    filter = target.value;
    const list = document.querySelector('[data-people-list]');
    if (list) {
      list.innerHTML = rowsHtml(picker);
    }
  });
}
