/** Pure helpers about work item states. Shared by the extension and the webviews, so no "vscode" import */

export const DEFAULT_STATE_ORDER = ['Done', 'Ready to Test', 'Committed', 'In Progress', 'Approved', 'New', 'To Do'];

/**
 * Comparable form of a state name: case, spaces, dashes and doubled letters are ignored,
 * so "Ready-to-Test" matches "Ready to Test" and "Commited" matches "Committed"
 */
export function normalizeState(state: string): string {
  return state
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function isOneOf(state: string, states: string[]): boolean {
  const normalized = normalizeState(state);
  return states.some((candidate) => normalizeState(candidate) === normalized);
}

/** Position of the state in the given order. Unknown states go last */
export function stateRank(state: string, order: string[]): number {
  const normalized = normalizeState(state);
  const index = order.findIndex((candidate) => normalizeState(candidate) === normalized);
  return index === -1 ? order.length : index;
}

/** Sorts by state following the given order. Items with the same state keep their relative order */
export function sortByState<T extends { state: string }>(items: T[], order: string[]): T[] {
  return items
    .map((item, index) => ({ item, index, rank: stateRank(item.state, order) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

export type StateCategory = 'done' | 'in-progress' | 'proposed' | 'removed';

/** Colour family of a state: green when done, blue when in progress, grey when proposed, red when removed */
export function stateCategory(state: string): StateCategory {
  if (isOneOf(state, ['Done', 'Ready to Test', 'Closed', 'Resolved', 'Completed'])) {
    return 'done';
  }
  if (isOneOf(state, ['Committed', 'In Progress', 'Active'])) {
    return 'in-progress';
  }
  return isOneOf(state, ['Removed']) ? 'removed' : 'proposed';
}

/**
 * Done, Ready to Test… The work is finished: no more branches or PRs are created for it, and its branch
 * should be deleted (the team deletes the branches once their PR is merged)
 */
export function isFinishedState(state: string): boolean {
  return stateCategory(state) === 'done';
}

/** States in which work on the item has not started yet */
const NOT_STARTED_STATES = ['New', 'Approved', 'To Do'];

/**
 * State the work item should move to when a branch is created for it, if any.
 * Only items not started yet are moved, so an item is never moved backwards
 */
export function stateAfterBranchCreated(
  type: string,
  state: string,
  stateByType: Partial<Record<string, string>>
): string | undefined {
  const target = stateByType[type];
  return target && isOneOf(state, NOT_STARTED_STATES) && !isOneOf(state, [target]) ? target : undefined;
}
