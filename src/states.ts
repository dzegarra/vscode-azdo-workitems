/** Pure helpers about work item states. Shared by the extension and the webviews, so no "vscode" import */

export const DEFAULT_STATE_ORDER = [
  'Done',
  'Ready to Test',
  'In review',
  'Committed',
  'In Progress',
  'Approved',
  'ReOpened',
  'New',
  'To Do',
];

/** State the filters, chips and sorting work with: the shown one (Rule STATE-10) when the item has it */
export function shownStateOf(item: { state: string; displayState?: string }): string {
  return item.displayState ?? item.state;
}

// Rule STATE-1
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

// Rules STATE-2..5
/** Colour family of a state: green when done, blue when in progress, grey when proposed, red when removed */
export function stateCategory(state: string): StateCategory {
  if (isOneOf(state, ['Done', 'Ready to Test', 'Closed', 'Resolved', 'Completed'])) {
    return 'done';
  }
  if (isOneOf(state, ['Committed', 'In Progress', 'Active', 'In review'])) {
    return 'in-progress';
  }
  return isOneOf(state, ['Removed']) ? 'removed' : 'proposed';
}

// Rule STATE-6
/**
 * Done, Ready to Test… The work is finished: no more branches or PRs are created for it, and its branch
 * should be deleted (the team deletes the branches once their PR is merged)
 */
export function isFinishedState(state: string): boolean {
  return stateCategory(state) === 'done';
}

/**
 * Rule STATE-7: Done-like or Removed. No more branches, checkouts or PRs are offered for the work item (the
 * rules for tasks, `canCreate*ForTask`, exclude done or removed parents as well); only cleanup remains
 */
export function isClosedState(state: string): boolean {
  const category = stateCategory(state);
  return category === 'done' || category === 'removed';
}

/** States in which work on the item has not started yet. ReOpened: a Bug the testers reopened behaves like Approved */
const NOT_STARTED_STATES = ['New', 'Approved', 'ReOpened', 'To Do'];

// Rule STATE-8
export function isNotStartedState(state: string): boolean {
  return isOneOf(state, NOT_STARTED_STATES);
}

// Rule STATE-9
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
