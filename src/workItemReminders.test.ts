import { describe, expect, it } from 'vitest';
import { asleepPulses, latestChange, notUpdated } from './workItemReminders';

const MON_TO_FRI = [1, 2, 3, 4, 5];
const OPTIONS = { staleAfterWorkingDays: 1, workingDays: MON_TO_FRI };
// Wednesday 2026-10-07, local time
const NOW = new Date(2026, 9, 7, 12, 0);

describe('latestChange', () => {
  it('keeps the latest valid date', () => {
    expect(latestChange(['2026-10-05T10:00:00Z', undefined, 'x', '2026-10-06T09:00:00Z'])).toBe('2026-10-06T09:00:00Z');
    expect(latestChange([undefined])).toBeUndefined();
  });
});

describe('notUpdated (Rule REMIND-1)', () => {
  it('reminds of a work item in progress not updated for a working day', () => {
    const lastChanged = new Date(2026, 9, 6, 11, 0).toISOString();
    expect(notUpdated({ state: 'Committed', lastChanged }, NOW, OPTIONS)).toEqual({
      days: 1,
      text: 'Not updated for 1 working day (team rule: update status, tasks and effort daily)',
    });
    const today = new Date(2026, 9, 7, 9, 0).toISOString();
    expect(notUpdated({ state: 'Committed', lastChanged: today }, NOW, OPTIONS)).toBeUndefined();
  });

  it('does not count the weekend', () => {
    // Friday 17:00 to Monday 10:00: 17 working hours
    const friday = new Date(2026, 9, 2, 17, 0).toISOString();
    expect(
      notUpdated({ state: 'Committed', lastChanged: friday }, new Date(2026, 9, 5, 10, 0), OPTIONS)
    ).toBeUndefined();
  });

  it('only reminds of work in progress, and not with 0', () => {
    const old = new Date(2026, 8, 1).toISOString();
    for (const state of ['New', 'Ready to Test', 'Done']) {
      expect(notUpdated({ state, lastChanged: old }, NOW, OPTIONS)).toBeUndefined();
    }
    expect(
      notUpdated({ state: 'Committed', lastChanged: old }, NOW, { ...OPTIONS, staleAfterWorkingDays: 0 })
    ).toBeUndefined();
  });
});

describe('asleepPulses (Rule REMIND-3)', () => {
  const asleep = { days: 3, text: 'Not updated for 3 working days' };

  it('pulses a forgotten work item', () => {
    expect(asleepPulses({ notUpdated: asleep, alerts: [] })).toBe(true);
    expect(asleepPulses({ alerts: [] })).toBe(false);
  });

  it('leaves the work items with alerts or being worked on to their own look', () => {
    expect(asleepPulses({ notUpdated: asleep, alerts: [{}] })).toBe(false);
    expect(asleepPulses({ notUpdated: asleep, alerts: [], workingOn: 'here' })).toBe(false);
  });
});
