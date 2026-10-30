/**
 * The view options of the Sprint timeline (Rules TIMELINE-45, TIMELINE-46): the switches behind the icon at the end of
 * its header (REVIEWED BY YOU, the completed and the moved-out work items grouped at the end, the develop bar) and the
 * setting that dims the completed rows. Personal choices, the same for Mine and Whole team. Pure, so no "vscode" import
 */

export interface TimelineViewOptions {
  /** "REVIEWED BY YOU · THIS SPRINT" (Rule TIMELINE-37) */
  showReviewed: boolean;
  /** The finished work items in "DONE THIS SPRINT" (Rule TIMELINE-19); off: in their place among the open ones */
  groupDone: boolean;
  /** The work items that left a past sprint in "MOVED OUT DURING THE SPRINT" (Rule TIMELINE-44); off: in their place */
  groupMovedOut: boolean;
  /** The bar of the protected branch (Rule TIMELINE-12) */
  showDevelop: boolean;
  /** Rules TIMELINE-39, TIMELINE-45: the details of the PR rows on screen are read without hovering them */
  alwaysShowPrEvents: boolean;
  /** The completed work item, PR and task rows, and the reviewed PRs, are faded */
  dimCompleted: boolean;
}

/** The switches of the panel (the dimming is a setting only) */
export type TimelineViewSwitch = Exclude<keyof TimelineViewOptions, 'dimCompleted'>;

export const TIMELINE_VIEW_SWITCHES: readonly TimelineViewSwitch[] = [
  'showReviewed',
  'groupDone',
  'groupMovedOut',
  'showDevelop',
  'alwaysShowPrEvents',
];

export const DEFAULT_VIEW_OPTIONS: TimelineViewOptions = {
  showReviewed: true,
  groupDone: true,
  groupMovedOut: true,
  showDevelop: true,
  alwaysShowPrEvents: false,
  dimCompleted: true,
};

/** The setting of each option, under `totalflowx.` */
export const VIEW_OPTION_SETTINGS: Record<keyof TimelineViewOptions, string> = {
  showReviewed: 'appearance.timelineShowReviewed',
  groupDone: 'appearance.timelineGroupDone',
  groupMovedOut: 'appearance.timelineGroupMovedOut',
  showDevelop: 'appearance.timelineShowDevelop',
  alwaysShowPrEvents: 'appearance.timelineAlwaysShowPrEvents',
  dimCompleted: 'appearance.timelineDimCompleted',
};

export const isTimelineViewSwitch = (value: unknown): value is TimelineViewSwitch =>
  typeof value === 'string' && (TIMELINE_VIEW_SWITCHES as readonly string[]).includes(value);

/** The options from the settings read (anything not a boolean keeps its default) */
export function normalizeViewOptions(read: Partial<Record<keyof TimelineViewOptions, unknown>>): TimelineViewOptions {
  const pick = (key: keyof TimelineViewOptions): boolean => {
    const value = read[key];
    return typeof value === 'boolean' ? value : DEFAULT_VIEW_OPTIONS[key];
  };
  return {
    showReviewed: pick('showReviewed'),
    groupDone: pick('groupDone'),
    groupMovedOut: pick('groupMovedOut'),
    showDevelop: pick('showDevelop'),
    alwaysShowPrEvents: pick('alwaysShowPrEvents'),
    dimCompleted: pick('dimCompleted'),
  };
}

// Rule TIMELINE-45
/**
 * The rows when the finished work items are not grouped: in the order of the work items of the sprint (the sidebar's),
 * so a finished one sits among the open ones instead of after them (the board order puts it last)
 */
export function inItemOrder<T extends { id: number }>(rows: readonly T[], itemIds: readonly number[]): T[] {
  const index = (row: T): number => {
    const found = itemIds.indexOf(row.id);
    return found < 0 ? Number.MAX_SAFE_INTEGER : found;
  };
  return rows
    .map((row, position) => ({ row, position }))
    .sort((a, b) => index(a.row) - index(b.row) || a.position - b.position)
    .map(({ row }) => row);
}

// Rule TIMELINE-45
/**
 * The rows of a section in their three groups. `ordered` is the order of the board; a finished or moved-out row that is
 * not grouped stays in its place among the open ones (a moved-out row is never in "DONE THIS SPRINT")
 */
export function arrangeRows<T extends { id: number }>(
  ordered: readonly T[],
  kind: { finished: (row: T) => boolean; movedOut: (row: T) => boolean },
  options: Pick<TimelineViewOptions, 'groupDone' | 'groupMovedOut'>
): { work: T[]; finished: T[]; movedOut: T[] } {
  const movedOut = options.groupMovedOut ? ordered.filter(kind.movedOut) : [];
  const finished = options.groupDone ? ordered.filter((row) => kind.finished(row) && !kind.movedOut(row)) : [];
  const grouped = new Set([...movedOut, ...finished]);
  return { work: ordered.filter((row) => !grouped.has(row)), finished, movedOut };
}
