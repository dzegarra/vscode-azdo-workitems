import { describe, expect, it } from 'vitest';
import { addWorkingMs, parseWorkingDays, workingMsBetween } from './workingTime';

const HOUR = 60 * 60 * 1000;
const WEEK = [1, 2, 3, 4, 5];
const ALL = [0, 1, 2, 3, 4, 5, 6];

// Local dates (month is 0-based): Friday 9 October 2026 is new Date(2026, 9, 9)
describe('workingMsBetween', () => {
  it('counts a period within one working day', () => {
    expect(workingMsBetween(new Date(2026, 9, 8, 9), new Date(2026, 9, 8, 14), WEEK)).toBe(5 * HOUR);
  });

  it('does not count the weekend: Friday 15:00 to Monday 12:00 is 21 h', () => {
    expect(workingMsBetween(new Date(2026, 9, 9, 15), new Date(2026, 9, 12, 12), WEEK)).toBe(21 * HOUR);
  });

  it('counts from Monday 00:00 for a PR published on Saturday', () => {
    expect(workingMsBetween(new Date(2026, 9, 10, 10), new Date(2026, 9, 12, 6), WEEK)).toBe(6 * HOUR);
  });

  it('is 0 inside a weekend', () => {
    expect(workingMsBetween(new Date(2026, 9, 10, 10), new Date(2026, 9, 11, 20), WEEK)).toBe(0);
  });

  it('spans two weekends', () => {
    // Fri 2 Oct 12:00 to Mon 12 Oct 12:00: 12 h of Friday, Mon-Fri, 12 h of Monday
    const hours = workingMsBetween(new Date(2026, 9, 2, 12), new Date(2026, 9, 12, 12), WEEK) / HOUR;
    expect(hours).toBe(12 + 5 * 24 + 12);
  });

  it('is 0 when the end is not after the start', () => {
    expect(workingMsBetween(new Date(2026, 9, 8, 9), new Date(2026, 9, 8, 9), WEEK)).toBe(0);
    expect(workingMsBetween(new Date(2026, 9, 8, 9), new Date(2026, 9, 7, 9), WEEK)).toBe(0);
  });

  it('is calendar time when every day is a working day, or the list is empty', () => {
    const start = new Date(2026, 9, 9, 15);
    const end = new Date(2026, 9, 12, 12);
    expect(workingMsBetween(start, end, ALL)).toBe(end.getTime() - start.getTime());
    expect(workingMsBetween(start, end, [])).toBe(end.getTime() - start.getTime());
  });

  it('respects other working days', () => {
    // Sunday to Thursday: Friday and Saturday do not count
    const sunToThu = [0, 1, 2, 3, 4];
    expect(workingMsBetween(new Date(2026, 9, 9, 15), new Date(2026, 9, 11, 12), sunToThu)).toBe(12 * HOUR);
  });

  it('follows the local days across a daylight saving change', () => {
    // Whatever the zone, the span between two local midnights of working days is the sum of the days' lengths
    const start = new Date(2026, 2, 25);
    const end = new Date(2026, 3, 2);
    expect(workingMsBetween(start, end, ALL)).toBe(end.getTime() - start.getTime());
    // 25 March (Wed) to 2 April (Thu): 6 working days (Wed-Fri, Mon-Wed) = local days, not 24 h multiples
    const expected = [25, 26, 27, 30, 31].map(
      (day) => new Date(2026, 2, day + 1).getTime() - new Date(2026, 2, day).getTime()
    );
    expected.push(new Date(2026, 3, 2).getTime() - new Date(2026, 3, 1).getTime());
    expect(workingMsBetween(start, end, WEEK)).toBe(expected.reduce((a, b) => a + b, 0));
  });
});

describe('addWorkingMs', () => {
  it('adds within a working day', () => {
    expect(addWorkingMs(new Date(2026, 9, 8, 9), 5 * HOUR, WEEK)).toEqual(new Date(2026, 9, 8, 14));
  });

  it('skips the weekend: Friday 15:00 + 24 h is Monday 15:00', () => {
    expect(addWorkingMs(new Date(2026, 9, 9, 15), 24 * HOUR, WEEK)).toEqual(new Date(2026, 9, 12, 15));
  });

  it('starts counting on Monday 00:00 when published on Saturday', () => {
    expect(addWorkingMs(new Date(2026, 9, 10, 10), 24 * HOUR, WEEK)).toEqual(new Date(2026, 9, 13, 0));
  });

  it('is calendar time when every day is a working day, or the list is empty', () => {
    const start = new Date(2026, 9, 9, 15);
    expect(addWorkingMs(start, 24 * HOUR, ALL)).toEqual(new Date(2026, 9, 10, 15));
    expect(addWorkingMs(start, 24 * HOUR, [])).toEqual(new Date(2026, 9, 10, 15));
  });

  it('is the inverse of workingMsBetween', () => {
    const start = new Date(2026, 9, 7, 8, 30);
    const due = addWorkingMs(start, 60 * HOUR, WEEK);
    expect(workingMsBetween(start, due, WEEK)).toBe(60 * HOUR);
  });
});

describe('parseWorkingDays', () => {
  it('maps the setting values to weekday numbers', () => {
    expect(parseWorkingDays(['mon', 'wed', 'sun'])).toEqual([1, 3, 0]);
  });

  it('ignores unknown names and repeated days, and defaults to Monday-Friday', () => {
    expect(parseWorkingDays(['mon', 'xyz', 'mon'])).toEqual([1]);
    expect(parseWorkingDays(undefined)).toEqual(WEEK);
  });
});
