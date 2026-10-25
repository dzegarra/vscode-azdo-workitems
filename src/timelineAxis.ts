/**
 * The working-days axis of the Sprint timeline (Rule TIMELINE-2) and the next sprint of a team (Rule TIMELINE-10).
 * Pure, so no "vscode" import
 */
import { iterationKind, type ScheduledIteration } from './schedule';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export interface TimelineDay {
  /** YYYY-MM-DD */
  date: string;
  /** "We 14" */
  label: string;
  /** First working day of a week: a separator before it */
  weekStart: boolean;
  today: boolean;
  /** A day of the next sprint ("This + next sprint") */
  next: boolean;
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

// Rule TIMELINE-2
/**
 * The working days from `start` to `finish` (YYYY-MM-DD, both included); weekends and the days off are skipped. The
 * days of `nextFinish` after `finish` belong to the next sprint
 */
export function buildAxis(
  start: string,
  finish: string,
  workingDays: readonly number[],
  now: Date,
  next?: { start: string; finish: string }
): TimelineDay[] {
  const from = iterationDay(start);
  const to = iterationDay(next?.finish ?? finish);
  const thisLast = iterationDay(finish);
  if (!from || !to || !thisLast) {
    return [];
  }
  const working = workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  const last = Date.UTC(...thisLast);
  const days: TimelineDay[] = [];
  let previousWeekday = -1;
  const today = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  for (let day = Date.UTC(...from); day <= Date.UTC(...to); day += 86_400_000) {
    const date = new Date(day);
    const weekday = date.getUTCDay();
    if (!working.includes(weekday)) {
      continue;
    }
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
    const iso = `${String(y)}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      date: iso,
      label: `${WEEKDAYS[weekday]} ${String(d)}`,
      weekStart: days.length > 0 && weekday <= previousWeekday,
      today: iso === today,
      next: day > last,
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

/** The sprint after the given one: same team (same name without its number), starting later; the earliest */
export function nextIteration(
  current: { name: string; finishDate?: string },
  schedule: readonly ScheduledIteration[] | undefined
): { name: string; start: string; finish: string; path: string } | undefined {
  const prefix = current.name.replace(/\s*\d+$/, '');
  const finish = current.finishDate?.slice(0, 10);
  if (!schedule || !finish) {
    return undefined;
  }
  return schedule
    .flatMap((iteration) =>
      iterationKind(iteration.path) === 'sprint' &&
      iteration.start &&
      iteration.finish &&
      iteration.name.replace(/\s*\d+$/, '') === prefix &&
      iteration.start.slice(0, 10) > finish
        ? [
            {
              name: iteration.name,
              start: iteration.start.slice(0, 10),
              finish: iteration.finish.slice(0, 10),
              path: iteration.path,
            },
          ]
        : []
    )
    .sort((a, b) => a.start.localeCompare(b.start))
    .at(0);
}
