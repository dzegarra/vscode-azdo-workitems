/**
 * Duplicates: a work item linked "Duplicate Of" another one (its original). Team rule: a duplicate is planned in the
 * same iteration as its original and both are in the same state (Rules ALERT-9, ALERT-10 in src/alerts.ts).
 * Pure, so no "vscode" import
 */
import type { ScheduledIteration } from './schedule';
import { stateCategory, type StateCategory } from './states';

export interface DuplicateLink {
  id: number;
  title: string;
  type: string;
  state: string;
  stateCategory: StateCategory;
  /** Name of its iteration; undefined: not planned (project root) */
  iterationName?: string;
}

interface LinkedItem {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath: string;
}

export interface DuplicateLinks {
  /** The originals this work item duplicates (at most one: the link type is a tree). Undefined: unknown */
  duplicateOf?: DuplicateLink[];
  /** The work items that duplicate this one. Undefined: unknown */
  duplicates?: DuplicateLink[];
}

/**
 * Name of an iteration as the sprint lists show it: the schedule's name, else the last part of the path.
 * Undefined when the path is the project root (the work item is not planned)
 */
export function iterationLabel(path: string, schedule: ScheduledIteration[] | undefined): string | undefined {
  if (!path.includes('\\')) {
    return undefined;
  }
  return schedule?.find((iteration) => iteration.path === path)?.name ?? path.split('\\').at(-1);
}

function toDuplicateLink(item: LinkedItem, schedule: ScheduledIteration[] | undefined): DuplicateLink {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    state: item.state,
    stateCategory: stateCategory(item.state),
    iterationName: iterationLabel(item.iterationPath, schedule),
  };
}

/** Duplicate links of a work item. Undefined lists (the related work items could not be loaded) stay undefined */
export function duplicateLinks(
  duplicateOf: LinkedItem[] | undefined,
  duplicates: LinkedItem[] | undefined,
  schedule: ScheduledIteration[] | undefined
): DuplicateLinks {
  return {
    duplicateOf: duplicateOf?.map((item) => toDuplicateLink(item, schedule)),
    duplicates: duplicates?.map((item) => toDuplicateLink(item, schedule)),
  };
}

/** Value of the "Duplicates" filter chip */
export const DUPLICATES = 'Duplicates';

// Rule FILTER-8
/** Value of the filter chip; undefined when the work item is not a known duplicate: the filter never hides it */
export function duplicateFilterValue(item: { duplicateOf?: unknown[] }): string | undefined {
  return item.duplicateOf?.length ? DUPLICATES : undefined;
}

/** "Duplicate of" / "Duplicated by" tooltip lines: "#66301 New · Sprint 122 · title" */
export function duplicateLinksTooltip(heading: string, links: DuplicateLink[]): string {
  return [
    heading,
    ...links.map((link) => `#${link.id} ${link.state} · ${link.iterationName ?? 'not planned'} · ${link.title}`),
  ].join('\n');
}
