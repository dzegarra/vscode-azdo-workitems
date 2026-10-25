/**
 * The whole-team view (redesign phase 7): which teams are shown, the scope chip and the small names (badges,
 * initials, avatar colours) of the people and teams. Shared by the Track board and, later, the Sprint timeline.
 * Pure, so no "vscode" import
 */

/** `context.globalState` keys: UI choices, shared by both tabs (Rule TEAM-1) */
export const TEAM_SELECTION_KEY = 'totalflowx.teamView.teams';
export const TEAM_SCOPE_KEY = 'totalflowx.teamView.scope';

/** "mine": the user's work and reviews; "team": everybody's work in the teams chosen */
export type TeamScope = 'mine' | 'team';

export const parseScope = (value: unknown): TeamScope => (value === 'team' ? 'team' : 'mine');

// Rule TEAM-1
/**
 * The teams shown: the stored choice kept to the teams that still exist; without a (valid) choice, the teams the
 * sidebar lists (`totalflowx.teams`, or all the user's teams when none is set)
 */
export function resolveSelection(
  stored: readonly string[] | undefined,
  available: readonly string[],
  configured: readonly string[]
): string[] {
  const valid = (names: readonly string[]): string[] => available.filter((name) => names.includes(name));
  const chosen = valid(stored ?? []);
  if (chosen.length) {
    return chosen;
  }
  const defaults = valid(configured);
  return defaults.length ? defaults : [...available];
}

/** The team ticked or unticked; the last one stays (a view without teams shows nothing) */
export function toggleTeam(selection: readonly string[], available: readonly string[], name: string): string[] {
  const next = selection.includes(name) ? selection.filter((team) => team !== name) : [...selection, name];
  return next.length ? available.filter((team) => next.includes(team)) : [...selection];
}

/** "Teams 3 of 4" */
export const selectionLabel = (selected: number, total: number): string =>
  `Teams ${String(selected)} of ${String(total)}`;

const VOWELS = /[aeiou]/i;

/**
 * Three letters at most to tell a team: "UX", "Platform Team" -> "PLT", "Interface Apps" -> "IA", "UI Development
 * Team" -> "UD". A trailing "Team" is dropped
 */
export function teamBadge(name: string): string {
  const words = name
    .replace(/\bteam\b/gi, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const [first] = words;
  if (!first) {
    return name.slice(0, 3).toUpperCase();
  }
  if (words.length > 1) {
    return words
      .slice(0, 3)
      .map((word) => word.charAt(0))
      .join('')
      .toUpperCase();
  }
  if (first.length <= 3) {
    return first.toUpperCase();
  }
  const rest = first
    .slice(1)
    .split('')
    .filter((letter) => !VOWELS.test(letter))
    .slice(0, 2);
  return `${first.charAt(0)}${rest.join('')}`
    .padEnd(
      3,
      first
        .slice(1)
        .replace(/[^a-z]/gi, '')
        .charAt(0)
    )
    .toUpperCase();
}

/** The badges of the teams, made different when two teams would get the same ("MA", "MA2") */
export function teamBadges(names: readonly string[]): Map<string, string> {
  const used = new Map<string, number>();
  return new Map(
    names.map((name) => {
      const badge = teamBadge(name);
      const count = (used.get(badge) ?? 0) + 1;
      used.set(badge, count);
      return [name, count === 1 ? badge : `${badge}${String(count)}`];
    })
  );
}

/** "Daniel Zegarra EXT" -> "DZ"; one name -> its first two letters */
export function initials(name: string): string {
  const words = name
    .replace(/\s+EXT$/i, '')
    .split(/\s+/)
    .filter(Boolean);
  const first = words.at(0);
  const last = words.at(-1);
  if (!first || !last) {
    return '?';
  }
  return (words.length === 1 ? first.slice(0, 2) : `${first.charAt(0)}${last.charAt(0)}`).toUpperCase();
}

/** "Daniel Zegarra EXT" -> "Daniel Zegarra": the "EXT" of external accounts is noise on the board */
export const shortPersonName = (name: string): string => name.replace(/\s+EXT$/i, '');

export const AVATAR_COLOURS = 6;

/** A stable class number (0 to 5) for the avatar of a person, so a colour needs no inline style */
export function avatarColour(name: string): number {
  let hash = 0;
  for (const letter of name) {
    hash = (hash * 31 + letter.charCodeAt(0)) % 9973;
  }
  return hash % AVATAR_COLOURS;
}
