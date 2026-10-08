/** Texts of the waiting-time bar of the PRs to review: due date, caption and accessible value. Pure, so no "vscode" import */

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** Up to this many days away, a day is told by its weekday ("Mon") instead of its date */
const WEEKDAY_RANGE_DAYS = 6;

interface LocalParts {
  /** Calendar day number, to count days between two dates */
  day: number;
  weekday: string;
  month: string;
  dayOfMonth: string;
  time: string;
}

function localParts(date: Date, timeZone?: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  const monthIndex = new Date(`${part('month')} 1, 2000`).getMonth();
  return {
    day: Math.round(Date.UTC(Number(part('year')), monthIndex, Number(part('day'))) / MS_PER_DAY),
    weekday: part('weekday'),
    month: part('month'),
    dayOfMonth: part('day'),
    time: `${part('hour')}:${part('minute')}`,
  };
}

/** "today 14:30", "tomorrow 09:10", "Mon 09:10", "Oct 12, 09:10"; "yesterday" for the past */
export function formatDueMoment(due: Date, now: Date, timeZone?: string): string {
  const target = localParts(due, timeZone);
  const days = target.day - localParts(now, timeZone).day;
  if (days === 0) {
    return `today ${target.time}`;
  }
  if (days === 1) {
    return `tomorrow ${target.time}`;
  }
  if (days === -1) {
    return `yesterday ${target.time}`;
  }
  if (Math.abs(days) <= WEEKDAY_RANGE_DAYS) {
    return `${target.weekday} ${target.time}`;
  }
  return `${target.month} ${target.dayOfMonth}, ${target.time}`;
}

/** "due today 14:30"; "was due today 10:30" once the PR is overdue */
export function describeDue(due: Date, now: Date, timeZone?: string): string {
  return `${due.getTime() > now.getTime() ? 'due' : 'was due'} ${formatDueMoment(due, now, timeZone)}`;
}

/** "19 h", "30 min": whole hours only, as the bar tells hours of the limit */
function shortHours(ms: number): string {
  return ms >= MS_PER_HOUR ? `${Math.floor(ms / MS_PER_HOUR)} h` : `${Math.floor(ms / MS_PER_MINUTE)} min`;
}

/**
 * "19 h of 24 h": the time waited out of the limit, also once overdue ("27 h of 24 h"): the card header already says
 * "overdue by 3 h", and the striped red bar tells it is over the limit
 */
export function describeBarCaption(waitedMs: number, maxWaitHours: number): string {
  return `${shortHours(waitedMs)} of ${maxWaitHours} h`;
}

function spoken(ms: number): string {
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? '' : 's'}`;
  return ms >= MS_PER_HOUR
    ? unit(Math.floor(ms / MS_PER_HOUR), 'hour')
    : unit(Math.floor(ms / MS_PER_MINUTE), 'minute');
}

/** Value text for screen readers: "Waited 19 hours of 24; due today at 14:30" or "Overdue by 3 hours" */
export function describeBarValue(
  waitedMs: number,
  maxWaitHours: number,
  overdueMs: number | undefined,
  dueText: string
): string {
  if (overdueMs !== undefined) {
    return `Overdue by ${spoken(overdueMs)}`;
  }
  return `Waited ${spoken(waitedMs)} of ${maxWaitHours}; ${dueText.replace(', ', ' ').replace(/ (\S+)$/, ' at $1')}`;
}

/** Where the "due soon" zone starts on the track, from 0 to 1 */
export function dueSoonZoneStart(maxWaitHours: number, dueSoonHours: number): number {
  if (maxWaitHours <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, (maxWaitHours - dueSoonHours) / maxWaitHours));
}
