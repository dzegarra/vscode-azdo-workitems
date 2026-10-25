/**
 * The people of the Whole team view (redesign phase 7): the ones the user picks one by one, the candidates of the
 * picker and the filter box. Teams are large and mixed, and only the user knows who works on the UI. Pure, so no
 * "vscode" import. Shared by the Track board and, later, the Sprint timeline
 */
import { shortPersonName } from './teamView';

/** A person of the setting `totalflowx.teamView.people` */
export interface PickedPerson {
  /** Identity id: the `System.AssignedTo` id of a work item */
  id: string;
  /** Display name, kept so that the setting is readable and the picker can show people not seen this sprint */
  name: string;
  /** Sign-in name (an email): what the work item query matches best. Optional when the setting is edited by hand */
  uniqueName?: string;
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

// Rule TEAM-1
/** The people of the setting: entries without an id or a name are ignored, and so are repeated ids */
export function parsePeople(value: unknown): PickedPerson[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const people: PickedPerson[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = text(record.id);
    const name = text(record.name);
    if (!id || !name || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const uniqueName = text(record.uniqueName);
    people.push(uniqueName ? { id, name, uniqueName } : { id, name });
  }
  return people;
}

const byName = (a: PickedPerson, b: PickedPerson): number =>
  shortPersonName(a.name).localeCompare(shortPersonName(b.name));

// Rule TEAM-2
/** The text of the query for a person: the sign-in name when known, else the display name */
export const queryIdentity = (person: PickedPerson): string => person.uniqueName ?? person.name;

// Rule TEAM-1
/** The person ticked or unticked; the list keeps the order of the setting */
export function togglePerson(selected: readonly PickedPerson[], person: PickedPerson): PickedPerson[] {
  return selected.some((entry) => entry.id === person.id)
    ? selected.filter((entry) => entry.id !== person.id)
    : [...selected, person];
}

// Rule TEAM-1
/**
 * Who the picker offers: the members of the user's teams, the ones assigned to the work items already known and the
 * people of the setting, without repeats (the first one seen wins, so the setting keeps its spelling), the user
 * excluded (their lane always shows)
 */
export function mergeCandidates(
  sources: readonly (readonly PickedPerson[])[],
  myId: string | undefined
): PickedPerson[] {
  const byId = new Map<string, PickedPerson>();
  for (const person of sources.flat()) {
    if (person.id !== myId && !byId.has(person.id)) {
      byId.set(person.id, person);
    }
  }
  return [...byId.values()];
}

/** Does the person match what was typed? Case-insensitive, every word of the filter must be found in the name */
export function matchesFilter(person: PickedPerson, filter: string): boolean {
  const haystack = `${person.name} ${person.uniqueName ?? ''}`.toLowerCase();
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

// Rule TEAM-1
/** The rows of the picker: the people chosen first (by name), then the candidates by name; the filter applies to both */
export function pickerRows(
  selected: readonly PickedPerson[],
  candidates: readonly PickedPerson[],
  filter = ''
): { selected: PickedPerson[]; candidates: PickedPerson[] } {
  const chosen = new Set(selected.map((person) => person.id));
  return {
    selected: selected.filter((person) => matchesFilter(person, filter)).sort(byName),
    candidates: candidates.filter((person) => !chosen.has(person.id) && matchesFilter(person, filter)).sort(byName),
  };
}

/** "People 3" */
export const peopleLabel = (count: number): string => `People ${String(count)}`;

/** "ana.ruiz@abb.com" -> "ana.ruiz": a hint to tell two people with the same name apart */
export const shortSignIn = (uniqueName: string | undefined): string => uniqueName?.replace(/@.*$/, '') ?? '';

/** The hint of the empty Whole team view */
export const EMPTY_PEOPLE_HINT = 'Pick the people to show with People ▾';
