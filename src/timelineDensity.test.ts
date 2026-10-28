import { describe, expect, it } from 'vitest';
import { densityOf, normalizeTimelineDensity } from './timelineDensity';

describe('timeline row style (Rule TIMELINE-32)', () => {
  it('keeps a known value and falls back to the default of the view', () => {
    expect(normalizeTimelineDensity('compact', 'normal')).toBe('compact');
    expect(normalizeTimelineDensity('dense', 'normal')).toBe('normal');
    expect(normalizeTimelineDensity(undefined, 'compact')).toBe('compact');
  });

  it('reads the setting of the view shown', () => {
    const settings = { mine: 'normal', team: 'compact' } as const;
    expect(densityOf('mine', settings)).toBe('normal');
    expect(densityOf('team', settings)).toBe('compact');
  });
});
