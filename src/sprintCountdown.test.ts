import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  isInSprint,
  isLastSprintDay,
  sprintCountdown,
  sprintProgress,
  workingDaysLeft,
} from './sprintCountdown';

const WEEKDAYS = [1, 2, 3, 4, 5];
const FINISH = '2026-10-27T00:00:00Z'; // a Tuesday
/** Local noon of a day of October 2026 */
const day = (date: number) => new Date(2026, 9, date, 12);

describe('daysUntil', () => {
  it('compares the local date with the date part of the finish date', () => {
    expect(daysUntil(FINISH, day(21))).toBe(6);
    expect(daysUntil(FINISH, day(27))).toBe(0);
    expect(daysUntil(FINISH, new Date(2026, 9, 27, 23, 59))).toBe(0);
    expect(daysUntil(FINISH, day(28))).toBe(-1);
    expect(daysUntil(undefined, day(21))).toBeUndefined();
  });
});

describe('workingDaysLeft', () => {
  it('counts the working days from today to the last day, both included', () => {
    // Wed 21, Thu 22, Fri 23, Mon 26, Tue 27
    expect(workingDaysLeft(FINISH, day(21), WEEKDAYS)).toBe(5);
    expect(workingDaysLeft(FINISH, day(24), WEEKDAYS)).toBe(2);
    expect(workingDaysLeft(FINISH, day(28), WEEKDAYS)).toBe(0);
  });
});

describe('sprintCountdown', () => {
  it('is calm while there is time', () => {
    expect(sprintCountdown(FINISH, day(21), WEEKDAYS)).toEqual({
      mood: 'calm',
      text: '🌱 5 days left',
      tooltip: 'The sprint ends on Tue 27 Oct: 5 working days left, today included',
    });
  });

  it('hurries with 2 working days left or less', () => {
    expect(sprintCountdown(FINISH, day(26), WEEKDAYS)).toMatchObject({ mood: 'hurry', text: '🏃 2 days left' });
    // A weekend: Mon 26 and Tue 27 are left
    expect(sprintCountdown(FINISH, day(25), WEEKDAYS)?.mood).toBe('hurry');
  });

  it('burns on the last day', () => {
    expect(sprintCountdown(FINISH, day(27), WEEKDAYS)).toMatchObject({ mood: 'last', text: '🔥 Last day' });
    expect(isLastSprintDay(FINISH, day(27))).toBe(true);
    expect(isLastSprintDay(FINISH, day(26))).toBe(false);
  });

  it('is undefined without a finish date or once the sprint is over', () => {
    expect(sprintCountdown(undefined, day(21), WEEKDAYS)).toBeUndefined();
    expect(sprintCountdown(FINISH, day(28), WEEKDAYS)).toBeUndefined();
  });
});

describe('isInSprint', () => {
  it('includes the first and the last day', () => {
    const start = '2026-10-14T00:00:00Z';
    expect(isInSprint('2026-10-14T00:00:00Z', start, FINISH)).toBe(true);
    expect(isInSprint('2026-10-27T23:59:00Z', start, FINISH)).toBe(true);
    expect(isInSprint('2026-10-28T00:00:00Z', start, FINISH)).toBe(false);
    expect(isInSprint('2026-10-13T23:59:00Z', start, FINISH)).toBe(false);
    expect(isInSprint('2026-10-20T00:00:00Z', undefined, FINISH)).toBe(false);
  });
});

describe('sprintProgress', () => {
  it('counts the working days of the sprint and the ones already over', () => {
    // Rule SPRINT-1: Wed 14 Oct to Tue 27 Oct 2026 is 10 working days; on Fri 23 seven are over
    const progress = sprintProgress(
      '2026-10-14T00:00:00Z',
      '2026-10-27T00:00:00Z',
      new Date(2026, 9, 23, 10),
      WEEKDAYS
    );
    expect(progress).toMatchObject({ total: 10, passed: 7, text: '3 days left', hurry: false });
    expect(
      sprintProgress('2026-10-14T00:00:00Z', '2026-10-27T00:00:00Z', new Date(2026, 9, 10), WEEKDAYS)?.passed
    ).toBe(0);
  });

  it('says how many days are left, and the last day', () => {
    // Rules SPRINT-2, SPRINT-3
    const finish = '2026-10-27T00:00:00Z';
    expect(sprintProgress('2026-10-14T00:00:00Z', finish, new Date(2026, 9, 26, 9), WEEKDAYS)).toMatchObject({
      text: '2 days left',
      hurry: true,
    });
    expect(sprintProgress('2026-10-14T00:00:00Z', finish, new Date(2026, 9, 27, 9), WEEKDAYS)?.text).toBe('Last day');
    expect(sprintProgress('2026-10-14T00:00:00Z', finish, new Date(2026, 9, 28, 9), WEEKDAYS)).toBeUndefined();
    expect(sprintProgress(undefined, finish, new Date(2026, 9, 20), WEEKDAYS)).toBeUndefined();
  });
});
