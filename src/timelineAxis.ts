/**
 * The working-days axis of the Sprint timeline (Rules TIMELINE-2, TIMELINE-31). Pure, so no "vscode" import
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface TimelineDay {
  /** YYYY-MM-DD */
  date: string;
  /** "We 14" */
  label: string;
  /** First working day of a week: a separator before it */
  weekStart: boolean;
  today: boolean;
  /** Rule TIMELINE-31: a day of the margin after the sprint */
  after: boolean;
  /** Rule TIMELINE-2: a day of the margin before the sprint (added as the PRs that start before it need) */
  before: boolean;
  /** The last day of the sprint */
  last: boolean;
  /** Local start and end of the day (ms) */
  startMs: number;
  endMs: number;
}

export const iterationDay = (date: string): [number, number, number] | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : undefined;
};

/** Rule TIMELINE-31: the working days drawn after the last day of the sprint */
export const AFTER_SPRINT_DAYS = 2;

const DAY_MS = 86_400_000;

/** Rule TIMELINE-2: most working days that can be added before the sprint */
export const MAX_DAYS_BEFORE_SPRINT = 10;

/** Rule TIMELINE-2: the setting `appearance.timelineDaysBeforeSprint` as a whole number from 0 to 10 (default 1) */
export function normalizeDaysBeforeSprint(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_DAYS_BEFORE_SPRINT, Math.max(0, Math.round(value)))
    : 1;
}

// Rule TIMELINE-2
/**
 * How many working days before the sprint the axis needs to show a PR that started at `earliest` (ms): the working day
 * that contains it (a start on a day off belongs to the next working day), never more than `max`. 0 when it started
 * within the sprint (or there is none)
 */
export function daysBeforeStart(
  start: string,
  earliest: number | undefined,
  workingDays: readonly number[],
  max: number
): number {
  const from = iterationDay(start);
  if (!from || earliest === undefined || max <= 0) {
    return 0;
  }
  const working = workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  const first = Date.UTC(...from);
  let count = 0;
  // A bound on the calendar days looked at, in case no weekday is a working day
  for (let offset = 1; offset <= 14 * (max + 1) && count < max; offset += 1) {
    const date = new Date(first - offset * DAY_MS);
    if (!working.includes(date.getUTCDay())) {
      continue;
    }
    const startMs = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime();
    const endMs = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1).getTime();
    if (earliest >= endMs) {
      // It starts after this day (on a day off): the working day after it is the first one needed
      return count;
    }
    count += 1;
    if (earliest >= startMs) {
      return count;
    }
  }
  return count;
}

// Rules TIMELINE-2, TIMELINE-31
/**
 * The working days from `start` to `finish` (YYYY-MM-DD, both included), then `after` more working days (the margin
 * after the sprint); weekends and the days off are skipped. `before` working days go ahead of `start` (the margin
 * before the sprint, flagged `before`)
 */
export function buildAxis(
  start: string,
  finish: string,
  workingDays: readonly number[],
  now: Date,
  after = 0,
  before = 0
): TimelineDay[] {
  const from = iterationDay(start);
  const to = iterationDay(finish);
  if (!from || !to) {
    return [];
  }
  const working = workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  const first = Date.UTC(...from);
  // Back to the first of the `before` working days ahead of the sprint
  let begin = first;
  for (let found = 0, offset = 1; found < before && offset <= 14 * (before + 1); offset += 1) {
    if (working.includes(new Date(first - offset * DAY_MS).getUTCDay())) {
      found += 1;
      begin = first - offset * DAY_MS;
    }
  }
  const last = Date.UTC(...to);
  const days: TimelineDay[] = [];
  let previousWeekday = -1;
  let margin = 0;
  const today = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  for (let day = begin; day <= last || margin < after; day += DAY_MS) {
    const date = new Date(day);
    const weekday = date.getUTCDay();
    if (!working.includes(weekday)) {
      continue;
    }
    if (day > last) {
      margin += 1;
    }
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
    const iso = `${String(y)}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      date: iso,
      label: `${WEEKDAYS[weekday]} ${String(d)}`,
      weekStart: days.length > 0 && weekday <= previousWeekday,
      today: iso === today,
      after: day > last,
      before: day < first,
      last: day === last,
      startMs: new Date(y, m, d).getTime(),
      endMs: new Date(y, m, d + 1).getTime(),
    });
    previousWeekday = weekday;
  }
  return days;
}

/**
 * Where a moment falls on the axis, in days from its start (1.5: the middle of the second day). A moment on a day off
 * is the start of the next working day; before the first day 0, after the last one the number of days
 */
export function axisPosition(ms: number, days: readonly TimelineDay[]): number {
  for (const [index, day] of days.entries()) {
    if (ms < day.startMs) {
      return index;
    }
    if (ms < day.endMs) {
      return index + (ms - day.startMs) / (day.endMs - day.startMs);
    }
  }
  return days.length;
}
