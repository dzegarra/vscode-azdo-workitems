import { describe, expect, it } from 'vitest';
import { normalizePopoverDelay } from './popoverDelay';

describe('normalizePopoverDelay', () => {
  it('keeps values in range', () => {
    expect(normalizePopoverDelay(0)).toBe(0);
    expect(normalizePopoverDelay(500)).toBe(500);
    expect(normalizePopoverDelay(3000)).toBe(3000);
  });

  it('clamps and rounds', () => {
    expect(normalizePopoverDelay(-20)).toBe(0);
    expect(normalizePopoverDelay(99999)).toBe(3000);
    expect(normalizePopoverDelay(120.6)).toBe(121);
  });

  it('falls back to the default for anything that is not a finite number', () => {
    expect(normalizePopoverDelay('300')).toBe(500);
    expect(normalizePopoverDelay(undefined)).toBe(500);
    expect(normalizePopoverDelay(null)).toBe(500);
    expect(normalizePopoverDelay(Number.NaN)).toBe(500);
    expect(normalizePopoverDelay(Number.POSITIVE_INFINITY)).toBe(500);
  });
});
