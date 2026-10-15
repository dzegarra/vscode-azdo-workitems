import { describe, expect, it } from 'vitest';
import { placePopover } from './popoverPlacement';

const base = { viewWidth: 300, preferredWidth: 200, margin: 8 };

describe('placePopover', () => {
  it('aligns the left edges when there is room', () => {
    expect(placePopover({ ...base, anchorLeft: 20, anchorRight: 60, align: 'start' })).toEqual({
      width: 200,
      left: 20,
    });
  });

  it('shifts left when the popover would pass the right margin', () => {
    expect(placePopover({ ...base, anchorLeft: 250, anchorRight: 290, align: 'start' })).toEqual({
      width: 200,
      left: 92,
    });
  });

  it('aligns the right edges when there is room', () => {
    expect(placePopover({ ...base, anchorLeft: 200, anchorRight: 260, align: 'end' })).toEqual({
      width: 200,
      left: 60,
    });
  });

  it('shifts right when the right-aligned popover would pass the left margin', () => {
    expect(placePopover({ ...base, anchorLeft: 10, anchorRight: 40, align: 'end' })).toEqual({ width: 200, left: 8 });
  });

  it('limits the width to the view minus the margins', () => {
    expect(
      placePopover({ viewWidth: 160, preferredWidth: 360, margin: 8, anchorLeft: 100, anchorRight: 140, align: 'end' })
    ).toEqual({
      width: 144,
      left: 8,
    });
  });

  it('keeps the margin on both sides for every anchor position', () => {
    for (const align of ['start', 'end'] as const) {
      for (let left = -20; left <= 340; left += 10) {
        const { width, left: placed } = placePopover({ ...base, anchorLeft: left, anchorRight: left + 30, align });
        expect(placed).toBeGreaterThanOrEqual(8);
        expect(placed + width).toBeLessThanOrEqual(292);
      }
    }
  });

  it('never returns a negative width in a view narrower than the margins', () => {
    expect(placePopover({ ...base, viewWidth: 10, anchorLeft: 0, anchorRight: 5, align: 'start' }).width).toBe(0);
  });
});
