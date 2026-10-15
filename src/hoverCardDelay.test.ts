import { describe, expect, it } from 'vitest';
import { normalizeHoverCardDelay } from './hoverCardDelay';

describe('normalizeHoverCardDelay', () => {
  it('keeps values in range', () => {
    expect(normalizeHoverCardDelay(0)).toBe(0);
    expect(normalizeHoverCardDelay(500)).toBe(500);
    expect(normalizeHoverCardDelay(3000)).toBe(3000);
  });

  it('clamps to 0..3000 and rounds', () => {
    expect(normalizeHoverCardDelay(-20)).toBe(0);
    expect(normalizeHoverCardDelay(99999)).toBe(3000);
    expect(normalizeHoverCardDelay(120.6)).toBe(121);
  });

  it('uses 500 for anything that is not a number', () => {
    expect(normalizeHoverCardDelay('300')).toBe(500);
    expect(normalizeHoverCardDelay(undefined)).toBe(500);
    expect(normalizeHoverCardDelay(null)).toBe(500);
    expect(normalizeHoverCardDelay(Number.NaN)).toBe(500);
    expect(normalizeHoverCardDelay(Number.POSITIVE_INFINITY)).toBe(500);
  });
});
