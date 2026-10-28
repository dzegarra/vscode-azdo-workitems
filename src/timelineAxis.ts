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

// Rules TIMELINE-2, TIMELINE-31
/**
 * The working days from `start` to `finish` (YYYY-MM-DD, both included), then `after` more working days (the margin
 * after the sprint); weekends and the days off are skipped
 */
export function buildAxis(
  start: string,
  finish: string,
  workingDays: readonly number[],
  now: Date,
  after = 0
): TimelineDay[] {
  const from = iterationDay(start);
  const to = iterationDay(finish);
  if (!from || !to) {
    return [];
  }
  const working = workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  const last = Date.UTC(...to);
  const days: TimelineDay[] = [];
  let previousWeekday = -1;
  let margin = 0;
  const today = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  for (let day = Date.UTC(...from); day <= last || margin < after; day += 86_400_000) {
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
