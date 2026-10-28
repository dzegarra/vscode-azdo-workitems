import { describe, expect, it } from 'vitest';
import { iterationDates, sprintTitle } from './sprintTitle';

const platform = {
  name: 'Platform Sprint 122',
  teams: ['Platform'],
  startDate: '2026-10-14T00:00:00Z',
  finishDate: '2026-10-27T00:00:00Z',
};

describe('sprintTitle (Rule SPRINT-TITLE-1)', () => {
  it('keeps the trailing "Sprint <n>" of a single team, without a chip', () => {
    expect(sprintTitle([platform], platform)).toEqual({ title: 'Sprint 122' });
  });

  it('shares the number of several teams and lists them in the chip', () => {
    const apps = { ...platform, name: 'Measurement Apps Sprint 122', teams: ['Measurement Apps'] };
    const title = sprintTitle([platform, apps], platform);
    expect(title.title).toBe('Sprint 122');
    expect(title.teams?.text).toBe('2 teams');
    expect(title.teams?.lines).toEqual([
      'Platform · Platform Sprint 122 · 14 Oct – 27 Oct',
      'Measurement Apps · Measurement Apps Sprint 122 · 14 Oct – 27 Oct',
    ]);
  });

  it('uses the dates of the sprint that ends first when the numbers differ, and counts the other dates', () => {
    const ux = {
      name: 'UX Sprint 40',
      teams: ['UX', 'Design'],
      startDate: '2026-10-15T00:00:00Z',
      finishDate: '2026-10-28T00:00:00Z',
    };
    const title = sprintTitle([platform, ux], platform);
    expect(title.title).toBe('14 Oct – 27 Oct');
    expect(title.teams?.text).toBe('3 teams · 2 with other dates');
    expect(title.teams?.lines.at(-1)).toBe('Design · UX Sprint 40 · 15 Oct – 28 Oct · (other dates)');
  });

  it('keeps the name of an iteration without a number', () => {
    expect(sprintTitle([{ name: 'Hardening' }], undefined).title).toBe('Hardening');
    expect(sprintTitle([], undefined).title).toBe('Sprint');
  });

  it('writes the dates of an iteration', () => {
    expect(iterationDates(platform)).toBe('14 Oct – 27 Oct');
    expect(iterationDates({ startDate: platform.startDate })).toBeUndefined();
  });
});
