/**
 * Work items of the checked out branch, for the status bar: which ones, in which order, how they read in the text,
 * the tooltip and the picker. Pure: no "vscode" import
 */
import { iterationLabel } from './duplicates';
import { iterationKind, ScheduledIteration } from './schedule';
import {
  CurrentWorkItemInfo,
  CurrentWorkItemView,
  shortTitle,
  StatusBarLabel,
  statusBarText,
  statusBarTypeIcon,
} from './currentWorkItem';
import { workItemsOfBranch, WorkingOnEntry } from './workingOn';

export const DEFAULT_MAX_STATUS_BAR_ITEMS = 3;

const MAX_TITLE_LENGTH = 40;
const DAY_MS = 86_400_000;

// Rule STATUSBAR-WI-1
/**
 * IDs of the work items of the list linked to the branch (ID in its name, Development link of the work item or of
 * its tasks, active PR from the branch), plus the one named in the branch even when it is not in the list
 */
export function branchWorkItemIds(branch: string, entries: WorkingOnEntry[], namedId: number | undefined): number[] {
  const ids = workItemsOfBranch(branch, entries, true);
  return namedId === undefined || ids.includes(namedId) ? ids : [namedId, ...ids];
}

/** A work item of the branch with what the order and the texts need */
export interface BranchWorkItem extends CurrentWorkItemInfo {
  iterationPath: string;
  /** State to show (STATE-10 applied) when the work item is in the list */
  displayState?: string;
  /** Parent work item (from its relations), when it has one */
  parentId?: number;
  view: CurrentWorkItemView;
}

// Rule STATUSBAR-WI-1
/**
 * Drops the Tasks whose parent is also in the set: the parent already stands for its tasks. A Task whose parent is
 * not in the set, or unknown, stays; the parent is never dropped
 */
export function dropTasksOfLinkedParents<T extends { id: number; type: string; parentId?: number }>(items: T[]): T[] {
  const ids = new Set(items.map((item) => item.id));
  return items.filter((item) => item.type !== 'Task' || item.parentId === undefined || !ids.has(item.parentId));
}

function toDay(value: string): number {
  return Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
}

interface IterationDistance {
  /** Days between today and the iteration's dates; 0 inside it */
  days: number;
  position: 'current' | 'future' | 'past';
}

/** Undefined when the iteration is not a sprint or its dates are unknown */
function iterationDistance(
  path: string,
  schedule: ScheduledIteration[] | undefined,
  today: Date
): IterationDistance | undefined {
  if (iterationKind(path) !== 'sprint') {
    return undefined;
  }
  const iteration = schedule?.find((candidate) => candidate.path === path);
  if (!iteration?.start || !iteration.finish) {
    return undefined;
  }
  const now = toDay(today.toISOString());
  const start = toDay(iteration.start);
  const finish = toDay(iteration.finish);
  if (now < start) {
    return { days: Math.round((start - now) / DAY_MS), position: 'future' };
  }
  return now > finish
    ? { days: Math.round((now - finish) / DAY_MS), position: 'past' }
    : { days: 0, position: 'current' };
}

// Rule STATUSBAR-WI-2
/**
 * Closest iteration first (distance in days to its dates, 0 inside it); at the same distance the future before the
 * past; in the same iteration the work item named in the branch first, then the lower ID. Work items without a
 * sprint with dates (none, a release container) go last
 */
export function orderBranchWorkItems<T extends { id: number; iterationPath: string }>(
  items: T[],
  namedId: number | undefined,
  schedule: ScheduledIteration[] | undefined,
  today: Date
): T[] {
  const keyed = items.map((item) => ({
    item,
    distance: iterationDistance(item.iterationPath, schedule, today),
  }));
  const side = (distance: IterationDistance) => (distance.position === 'past' ? 1 : 0);
  return keyed
    .sort((a, b) => {
      if (a.distance && b.distance) {
        const byDistance = a.distance.days - b.distance.days || side(a.distance) - side(b.distance);
        if (byDistance) {
          return byDistance;
        }
      } else if (a.distance || b.distance) {
        return a.distance ? -1 : 1;
      }
      return Number(b.item.id === namedId) - Number(a.item.id === namedId) || a.item.id - b.item.id;
    })
    .map(({ item }) => item);
}

// Rule STATUSBAR-WI-4
/** Tag of an iteration in the tooltip and the picker: "current", "starts in 3 days", "ended 1 day ago" */
export function iterationTag(
  path: string,
  schedule: ScheduledIteration[] | undefined,
  today: Date
): string | undefined {
  const distance = iterationDistance(path, schedule, today);
  if (!distance) {
    return undefined;
  }
  const days = `${distance.days} ${distance.days === 1 ? 'day' : 'days'}`;
  switch (distance.position) {
    case 'current':
      return 'current';
    case 'future':
      return `starts in ${days}`;
    case 'past':
      return `ended ${days} ago`;
  }
}

/** "Platform Sprint 122 (current)"; just the name without dates, nothing for a work item that is not planned */
export function iterationDescription(
  path: string,
  schedule: ScheduledIteration[] | undefined,
  today: Date
): string | undefined {
  const name = iterationLabel(path, schedule);
  const tag = iterationTag(path, schedule, today);
  return name && (tag ? `${name} (${tag})` : name);
}

// Rule STATUSBAR-WI-6
/** totalflowx.workingOn.statusBarMaxItems: an integer of at least 1; anything else is the default */
export function normalizeMaxItems(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : DEFAULT_MAX_STATUS_BAR_ITEMS;
}

// Rule STATUSBAR-WI-3
/**
 * Text of the status bar item: the first `max` work items (icon of the type and ID, the title only on the first one
 * with the label idAndTitle), then `+M` for the rest. If any is not the user's, the eye in front and the owner after
 * a dot. One work item reads exactly like `statusBarText`
 */
export function branchStatusBarText(items: BranchWorkItem[], label: StatusBarLabel, max: number): string {
  const first = items.at(0);
  if (!first) {
    return '';
  }
  if (items.length === 1) {
    return statusBarText(first, first.view, label);
  }
  const shown = items.slice(0, Math.max(1, max));
  const ids = shown.map((item, index) => {
    const title = index === 0 && label === 'idAndTitle' ? ` ${shortTitle(item.title, MAX_TITLE_LENGTH)}` : '';
    return `${statusBarTypeIcon(item.type)} ${item.id}${title}`;
  });
  const rest = items.length - shown.length;
  const base = rest > 0 ? `${ids.join(' ')} +${rest}` : ids.join(' ');
  const others = items.find((item) => !item.view.isMine);
  return others ? `$(eye) ${base} · ${others.view.ownerLabel}` : base;
}

// Rule STATUSBAR-WI-5
/** What the picker of the click lists, in the order of the status bar */
export interface BranchPickItem {
  id: number;
  label: string;
  description: string;
  detail?: string;
}

export function branchPickItems(
  items: BranchWorkItem[],
  schedule: ScheduledIteration[] | undefined,
  today: Date
): BranchPickItem[] {
  return items.map((item) => ({
    id: item.id,
    label: `${statusBarTypeIcon(item.type)} ${item.id} ${item.title}`,
    description: item.type,
    detail: iterationDescription(item.iterationPath, schedule, today),
  }));
}
