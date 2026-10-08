import { describe, expect, it } from 'vitest';
import { describeBarCaption, describeBarValue, describeDue, dueSoonZoneStart, formatDueMoment } from './reviewDue';

const UTC = 'UTC';
const now = new Date('2026-10-08T10:00:00Z'); // Thursday

describe('due moment', () => {
  it('tells today, tomorrow, the weekday within a week and the date beyond', () => {
    expect(describeDue(new Date('2026-10-08T14:30:00Z'), now, UTC)).toBe('due today 14:30');
    expect(describeDue(new Date('2026-10-09T09:10:00Z'), now, UTC)).toBe('due tomorrow 09:10');
    expect(describeDue(new Date('2026-10-12T09:10:00Z'), now, UTC)).toBe('due Mon 09:10');
    expect(describeDue(new Date('2026-10-14T09:10:00Z'), now, UTC)).toBe('due Wed 09:10');
    expect(describeDue(new Date('2026-10-20T09:10:00Z'), now, UTC)).toBe('due Oct 20, 09:10');
  });

  it('says "was due" for the past', () => {
    expect(describeDue(new Date('2026-10-08T07:30:00Z'), now, UTC)).toBe('was due today 07:30');
    expect(describeDue(new Date('2026-10-07T23:05:00Z'), now, UTC)).toBe('was due yesterday 23:05');
    expect(describeDue(new Date('2026-10-05T09:10:00Z'), now, UTC)).toBe('was due Mon 09:10');
    expect(describeDue(new Date('2026-09-20T09:10:00Z'), now, UTC)).toBe('was due Sep 20, 09:10');
  });

  it('uses the calendar day and the 24 h clock of the time zone', () => {
    // 23:30 UTC is already tomorrow in Tokyo (+9)
    expect(formatDueMoment(new Date('2026-10-08T23:30:00Z'), now, 'Asia/Tokyo')).toBe(
      'today 08:30'.replace('today', 'tomorrow')
    );
    expect(formatDueMoment(new Date('2026-10-08T00:05:00Z'), now, UTC)).toBe('today 00:05');
  });
});

describe('bar texts', () => {
  it('writes the caption', () => {
    const hour = 3_600_000;
    expect(describeBarCaption(19.9 * hour, 24)).toBe('19 h of 24 h');
    expect(describeBarCaption(30 * 60_000, 24)).toBe('30 min of 24 h');
    expect(describeBarCaption(27 * hour, 24)).toBe('27 h of 24 h');
  });

  it('writes the value for screen readers', () => {
    const hour = 3_600_000;
    expect(describeBarValue(19 * hour, 24, undefined, 'due today 14:30')).toBe(
      'Waited 19 hours of 24; due today at 14:30'
    );
    expect(describeBarValue(1 * hour, 24, undefined, 'due Oct 12, 09:10')).toBe(
      'Waited 1 hour of 24; due Oct 12 at 09:10'
    );
    expect(describeBarValue(27 * hour, 24, 3 * hour, 'was due today 10:30')).toBe('Overdue by 3 hours');
  });

  it('places the due soon zone at the end of the track', () => {
    expect(dueSoonZoneStart(24, 6)).toBe(0.75);
    expect(dueSoonZoneStart(24, 0)).toBe(1);
    expect(dueSoonZoneStart(24, 48)).toBe(0);
    expect(dueSoonZoneStart(0, 6)).toBe(0);
  });
});
