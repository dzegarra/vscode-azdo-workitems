import { describe, expect, it } from 'vitest';
import { normalizePopoverDelay, resolvePopoverDelay } from './popoverDelay';

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

describe('resolvePopoverDelay', () => {
  it('uses the new setting when it is set, even to 0', () => {
    expect(resolvePopoverDelay(200, 900)).toBe(200);
    expect(resolvePopoverDelay(0, 900)).toBe(0);
  });

  it('reads the deprecated setting when the new one is not set', () => {
    expect(resolvePopoverDelay(undefined, 900)).toBe(900);
    expect(resolvePopoverDelay(undefined, 0)).toBe(0);
  });

  it('uses the default when neither is set', () => {
    expect(resolvePopoverDelay(undefined, undefined)).toBe(500);
  });
});
