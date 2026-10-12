/** Working time: the part of a period that falls on working weekdays. Pure, local time, no "vscode" import */

/** Weekday numbers as in Date.getDay(): 0 is Sunday, 1 is Monday… 6 is Saturday */
export const DEFAULT_WORKING_DAYS: readonly number[] = [1, 2, 3, 4, 5];

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Setting values ("mon".."sun") to weekday numbers; unknown names are ignored, no setting means the default */
export function parseWorkingDays(names: readonly string[] | undefined): number[] {
  if (!names) {
    return [...DEFAULT_WORKING_DAYS];
  }
  return [...new Set(names.map((name) => WEEKDAY_NAMES.indexOf(name)).filter((day) => day >= 0))];
}

const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];

/** An empty list would make working time never pass: every day counts then */
function effectiveDays(workingDays: readonly number[]): readonly number[] {
  return workingDays.length > 0 ? workingDays : ALL_DAYS;
}

function localMidnight(date: Date, dayOffset = 0): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset);
}

/**
 * Milliseconds of [start, end) that fall on working weekdays of the local time zone. Days are walked from midnight
 * to midnight, so a day with a daylight saving change counts 23 or 25 hours. 0 when end is not after start
 */
export function workingMsBetween(start: Date, end: Date, workingDays: readonly number[]): number {
  const days = effectiveDays(workingDays);
  let total = 0;
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const day = new Date(cursor);
    const next = localMidnight(day, 1).getTime();
    const segmentEnd = Math.min(next, endMs);
    if (days.includes(day.getDay())) {
      total += segmentEnd - cursor;
    }
    cursor = next;
  }
  return total;
}

/**
 * The moment when `ms` of working time have passed since `start`. A start on a non-working day begins counting at
 * the next working day, 00:00
 */
export function addWorkingMs(start: Date, ms: number, workingDays: readonly number[]): Date {
  const days = effectiveDays(workingDays);
  let remaining = Math.max(0, ms);
  let cursor = start.getTime();
  for (;;) {
    const day = new Date(cursor);
    const next = localMidnight(day, 1).getTime();
    if (days.includes(day.getDay())) {
      const available = next - cursor;
      if (remaining < available) {
        return new Date(cursor + remaining);
      }
      remaining -= available;
    }
    cursor = next;
  }
}
