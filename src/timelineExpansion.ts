/**
 * Which work item rows of the Sprint timeline are expanded (Rule TIMELINE-18): the model says which ones need the user
 * (they start expanded), the user's own clicks override that and are remembered in the webview state. Pure, so no
 * "vscode" import
 */

/** What the model says of a row for the expansion */
export interface Expandable {
  id: number;
  /** The row can be expanded (a work item row with its PRs and tasks) */
  expandable?: boolean;
  /** It starts expanded: its station needs the user, and it is the user's own row */
  defaultExpanded?: boolean;
}

/** The user's clicks: true expanded, false collapsed, by work item id */
export type ExpansionChoices = Readonly<Record<number, boolean>>;

// Rule TIMELINE-18
/** Is the row expanded? The user's choice wins; without one the model's default */
export function isExpanded(row: Expandable, choices: ExpansionChoices): boolean {
  if (row.expandable === false) {
    return false;
  }
  return row.id in choices ? choices[row.id] : row.defaultExpanded ?? false;
}

// Rule TIMELINE-18
/** The choices after a click on the chevron of `row` */
export function toggleRow(row: Expandable, choices: ExpansionChoices): Record<number, boolean> {
  return { ...choices, [row.id]: !isExpanded(row, choices) };
}

// Rule TIMELINE-18
/** "Collapse all": every row of the list collapsed, whatever the default says */
export function collapseAll(rows: readonly Expandable[], choices: ExpansionChoices): Record<number, boolean> {
  const next: Record<number, boolean> = { ...choices };
  for (const row of rows) {
    if (row.expandable !== false) {
      next[row.id] = false;
    }
  }
  return next;
}

/** The ids of the expanded rows, sorted: what the webview tells the panel so it reads their history */
export function expandedIds(rows: readonly Expandable[], choices: ExpansionChoices): number[] {
  return [...new Set(rows.filter((row) => isExpanded(row, choices)).map((row) => row.id))].sort((a, b) => a - b);
}

/** The choices that were saved in the webview state: only booleans of numeric ids are kept */
export function parseChoices(saved: unknown): Record<number, boolean> {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    return {};
  }
  const choices: Record<number, boolean> = {};
  for (const [key, value] of Object.entries(saved)) {
    const id = Number(key);
    if (Number.isInteger(id) && typeof value === 'boolean') {
      choices[id] = value;
    }
  }
  return choices;
}

/** The same ids in the same order: the webview posts the expanded set only when it changed (no loop) */
export const sameIds = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);
