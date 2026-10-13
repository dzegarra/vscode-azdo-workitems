/** Priority (1–4) and Severity ("1 - Critical" … "4 - Low") of work items. Pure, so no "vscode" import */
import { stateRank } from './states';

export const PRIORITY_FIELD = 'Microsoft.VSTS.Common.Priority';
export const SEVERITY_FIELD = 'Microsoft.VSTS.Common.Severity';
export const NO_PRIORITY = 'No priority';

/** Urgency from 1 (most urgent) to 4, used to colour the pills */
export type Urgency = 1 | 2 | 3 | 4;

function toUrgency(value: number): Urgency | undefined {
  return [1, 2, 3, 4].includes(value) ? (value as Urgency) : undefined;
}

export function parsePriority(value: unknown): Urgency | undefined {
  return toUrgency(Number(value));
}

/** "2 - High" → 2 */
export function severityLevel(severity: string | undefined): Urgency | undefined {
  return toUrgency(Number(/^\s*(\d)/.exec(severity ?? '')?.[1]));
}

/** "2 - High" → "High" */
export function severityName(severity: string): string {
  return severity.replace(/^\s*\d\s*-\s*/, '');
}

/** Value of the priority filter chips: "P1" … "P4" or "No priority" */
export function priorityFilterValue(item: { priority?: number }): string {
  return item.priority ? `P${item.priority}` : NO_PRIORITY;
}

const LAST = Number.MAX_SAFE_INTEGER;

// Rule SORT-1
/**
 * Sorts by state (following the given order), then by priority, then by severity.
 * Missing values go last; otherwise the original order is kept
 */
export function sortWorkItems<T extends { state: string; priority?: number; severity?: string }>(
  items: T[],
  stateOrder: string[]
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        stateRank(a.item.state, stateOrder) - stateRank(b.item.state, stateOrder) ||
        (a.item.priority ?? LAST) - (b.item.priority ?? LAST) ||
        (severityLevel(a.item.severity) ?? LAST) - (severityLevel(b.item.severity) ?? LAST) ||
        a.index - b.index
    )
    .map(({ item }) => item);
}
