/**
 * Days left in a sprint and the mood of its countdown. Azure DevOps gives the dates of an iteration as midnight UTC
 * of its first and last day ("2026-10-27T00:00:00Z" for a sprint whose last day is the 27th), so only the date part
 * counts, compared with the local date. Pure, no "vscode" import
 */

const MS_PER_DAY = 86_400_000;

/** The calendar day of an iteration date, as a UTC timestamp; undefined when it cannot be read */
function iterationDay(date: string | undefined): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : undefined;
}

/** Today in the local time zone, as a UTC timestamp of the same calendar day */
function localDay(now: Date): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Calendar days from today to the last day of the sprint: 0 on the last day, negative once it is over */
export function daysUntil(finishDate: string | undefined, now: Date): number | undefined {
  const finish = iterationDay(finishDate);
  return finish === undefined ? undefined : Math.round((finish - localDay(now)) / MS_PER_DAY);
}

/** Working days left, today and the last day included */
export function workingDaysLeft(finishDate: string | undefined, now: Date, workingDays: readonly number[]): number {
  const days = daysUntil(finishDate, now);
  if (days === undefined || days < 0) {
    return 0;
  }
  const working = workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  let count = 0;
  for (let offset = 0; offset <= days; offset += 1) {
    const weekday = new Date(localDay(now) + offset * MS_PER_DAY).getUTCDay();
    if (working.includes(weekday)) {
      count += 1;
    }
  }
  return count;
}

export type CountdownMood = 'calm' | 'hurry' | 'last';

export interface SprintCountdown {
  mood: CountdownMood;
  /** "🌱 6 days left", "🏃 2 days left", "🔥 Last day" */
  text: string;
  tooltip: string;
}

const HURRY_DAYS = 2;
const MOOD_EMOJI: Record<CountdownMood, string> = { calm: '🌱', hurry: '🏃', last: '🔥' };

/** "Tue 27 Oct" */
function formatDay(day: number): string {
  return new Date(day).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// Rules FUN-COUNTDOWN-1..3
/** The countdown of the sprint; undefined without a finish date or once the sprint is over */
export function sprintCountdown(
  finishDate: string | undefined,
  now: Date,
  workingDays: readonly number[]
): SprintCountdown | undefined {
  const days = daysUntil(finishDate, now);
  const finish = iterationDay(finishDate);
  if (days === undefined || finish === undefined || days < 0) {
    return undefined;
  }
  const left = workingDaysLeft(finishDate, now, workingDays);
  let mood: CountdownMood = 'calm';
  if (days === 0) {
    mood = 'last';
  } else if (left <= HURRY_DAYS) {
    mood = 'hurry';
  }
  const text = mood === 'last' ? 'Last day' : `${String(left)} day${left === 1 ? '' : 's'} left`;
  return {
    mood,
    text: `${MOOD_EMOJI[mood]} ${text}`,
    tooltip: `The sprint ends on ${formatDay(finish)}: ${String(left)} working day${
      left === 1 ? '' : 's'
    } left, today included`,
  };
}

/** Whether today is the last day of the sprint */
export function isLastSprintDay(finishDate: string | undefined, now: Date): boolean {
  return daysUntil(finishDate, now) === 0;
}

/** Whether a date (ISO) falls within the sprint, first and last days included */
export function isInSprint(date: string, startDate: string | undefined, finishDate: string | undefined): boolean {
  const start = iterationDay(startDate);
  const finish = iterationDay(finishDate);
  const at = Date.parse(date);
  if (start === undefined || finish === undefined || Number.isNaN(at)) {
    return false;
  }
  return at >= start && at < finish + MS_PER_DAY;
}

export interface SprintProgress {
  /** Working days of the sprint, first and last day included */
  total: number;
  /** Working days already over (before today) */
  passed: number;
  /** "4 days left", "Last day" */
  text: string;
  /** Under 3 working days left: the text is highlighted */
  hurry: boolean;
  tooltip: string;
}

/** Working days from one calendar day to another (UTC timestamps), both included */
function workingDaysBetween(from: number, to: number, workingDays: readonly number[]): number {
  const working = workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  let count = 0;
  for (let day = from; day <= to; day += MS_PER_DAY) {
    if (working.includes(new Date(day).getUTCDay())) {
      count += 1;
    }
  }
  return count;
}

// Rules SPRINT-1..3
/**
 * The strip of the sprint above the sidebar tabs: one segment per working day, the ones already over filled.
 * Undefined without both dates, or once the sprint is over
 */
export function sprintProgress(
  startDate: string | undefined,
  finishDate: string | undefined,
  now: Date,
  workingDays: readonly number[]
): SprintProgress | undefined {
  const start = iterationDay(startDate);
  const finish = iterationDay(finishDate);
  const today = localDay(now);
  if (start === undefined || finish === undefined || finish < start || today > finish) {
    return undefined;
  }
  const total = workingDaysBetween(start, finish, workingDays);
  // Rule SPRINT-1: the days before today are over; before the sprint starts, none is
  const passed = today <= start ? 0 : workingDaysBetween(start, today - MS_PER_DAY, workingDays);
  const left = workingDaysLeft(finishDate, now, workingDays);
  // Rule SPRINT-2
  const text = today === finish ? 'Last day' : `${String(left)} day${left === 1 ? '' : 's'} left`;
  return {
    total,
    passed,
    text,
    // Rule SPRINT-3
    hurry: left <= HURRY_DAYS,
    tooltip: `${formatDay(start)} – ${formatDay(finish)} · ${String(left)} of ${String(
      total
    )} working days left, today included`,
  };
}
