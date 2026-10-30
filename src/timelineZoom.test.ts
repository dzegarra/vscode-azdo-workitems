import { describe, expect, it } from 'vitest';
import {
  canZoomOut,
  dayMinWidth,
  drawnDayWidth,
  easeOut,
  fitZoom,
  nextZoomIn,
  nextZoomOut,
  normalizeZoom,
  scrollAfterZoom,
  effectiveZoom,
  isOwnZoomEcho,
  wheelZoom,
  isZoomWheel,
  normalizeZoomModifier,
  zoomKeyName,
} from './timelineZoom';

describe('timeline zoom (Rule TIMELINE-48)', () => {
  it('clamps the setting from 50 to 1000 and defaults to 100', () => {
    expect(normalizeZoom(10)).toBe(50);
    expect(normalizeZoom(900)).toBe(900);
    expect(normalizeZoom(5000)).toBe(1000);
    expect(normalizeZoom(133.4)).toBe(133);
    expect(normalizeZoom('150')).toBe(100);
    expect(normalizeZoom(undefined)).toBe(100);
    expect(normalizeZoom(Number.NaN)).toBe(100);
  });

  it('gives the width of a day', () => {
    expect(dayMinWidth(100)).toBe(64);
    expect(dayMinWidth(200)).toBe(128);
    expect(dayMinWidth(50)).toBe(32);
  });

  it('keeps the day under the pointer where it is', () => {
    // lanes start at 320; the pointer is 200 px into the lane (x = 520) with no scroll; the lanes double
    expect(scrollAfterZoom(0, 520, 320, 2)).toBe(200);
    // already scrolled by 100: the same pointer is over content at 320 + 300
    expect(scrollAfterZoom(100, 520, 320, 2)).toBe(400);
    // zooming out never scrolls before the start
    expect(scrollAfterZoom(10, 400, 320, 0.5)).toBe(0);
  });
});

describe('the minimum zoom is "fit" (Rule TIMELINE-49)', () => {
  it('computes the zoom at which the axis fits the lanes, rounded down', () => {
    expect(fitZoom(896, 10)).toBe(140);
    expect(fitZoom(640, 10)).toBe(100);
    expect(fitZoom(639, 10)).toBe(99);
    expect(fitZoom(0, 10)).toBe(50);
    expect(fitZoom(500, 0)).toBe(50);
  });

  it('allows zooming out only above fit (and the lowest step)', () => {
    expect(canZoomOut(150, 140)).toBe(true);
    expect(canZoomOut(140, 140)).toBe(false);
    expect(canZoomOut(100, 140)).toBe(false);
    expect(canZoomOut(80, 40)).toBe(true);
    expect(canZoomOut(50, 40)).toBe(false);
  });

  it('zooms out dividing the zoom drawn by 1.25, clamped to fit', () => {
    expect(nextZoomOut(200, 140)).toBe(160);
    expect(nextZoomOut(150, 140)).toBe(140);
    expect(nextZoomOut(100, 140)).toBe(140);
    expect(nextZoomOut(100, 40)).toBe(80);
    expect(nextZoomOut(50, 40)).toBe(50);
    expect(nextZoomOut(52, 10)).toBe(50);
  });

  it('zooms in multiplying the zoom drawn by 1.25: the first press changes the width at least 20 %', () => {
    // the setting (100) is below fit (140): it draws as 140, so + goes from 140, not to the first fixed step above
    expect(effectiveZoom(100, 140)).toBe(140);
    expect(nextZoomIn(100, 140)).toBe(175);
    expect(nextZoomIn(100, 60)).toBe(125);
    expect(nextZoomIn(175, 140)).toBe(219);
    expect(nextZoomIn(250, 140)).toBe(313);
    expect(nextZoomIn(900, 140)).toBe(1000);
    expect(nextZoomIn(1000, 140)).toBe(1000);
    for (const start of [50, 60, 100, 140, 175, 220]) {
      expect(nextZoomIn(start, 40) / Math.max(start, 40)).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('follows the wheel by notches of 100 and always moves at least one point', () => {
    expect(wheelZoom(100, 60, -100)).toBe(125);
    expect(wheelZoom(100, 60, 100)).toBe(80);
    expect(wheelZoom(100, 60, -300)).toBe(195);
    expect(wheelZoom(100, 60, -1)).toBe(101);
    expect(wheelZoom(100, 60, 1)).toBe(99);
    expect(wheelZoom(100, 140, 100)).toBe(140);
    expect(wheelZoom(300, 60, -100)).toBe(375);
    expect(wheelZoom(1000, 60, -100)).toBe(1000);
  });

  it('knows its own echo: the same value, written a moment ago', () => {
    expect(isOwnZoomEcho({ zoom: 175, at: 1000 }, 1500, 175)).toBe(true);
    expect(isOwnZoomEcho({ zoom: 175, at: 1000 }, 1500, 150)).toBe(false);
    expect(isOwnZoomEcho({ zoom: 175, at: 1000 }, 9000, 175)).toBe(false);
    expect(isOwnZoomEcho(undefined, 1500, 175)).toBe(false);
  });

  it('draws a zoom below fit as fit, and eases the transition', () => {
    expect(drawnDayWidth(100, 140)).toBeCloseTo(89.6);
    expect(drawnDayWidth(200, 140)).toBe(128);
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe('the key of the wheel zoom (Rule TIMELINE-49)', () => {
  const keys = (k: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }>) => ({
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...k,
  });

  it('with ctrl: Ctrl zooms (Cmd too on macOS), Shift and the plain wheel do not', () => {
    expect(isZoomWheel(keys({ ctrlKey: true }), 'ctrl', false)).toBe(true);
    expect(isZoomWheel(keys({ metaKey: true }), 'ctrl', false)).toBe(false);
    expect(isZoomWheel(keys({ metaKey: true }), 'ctrl', true)).toBe(true);
    expect(isZoomWheel(keys({ shiftKey: true }), 'ctrl', false)).toBe(false);
    expect(isZoomWheel(keys({ ctrlKey: true, shiftKey: true }), 'ctrl', false)).toBe(false);
    expect(isZoomWheel(keys({}), 'ctrl', true)).toBe(false);
  });

  it('with shift: only Shift alone zooms', () => {
    expect(isZoomWheel(keys({ shiftKey: true }), 'shift', false)).toBe(true);
    expect(isZoomWheel(keys({ ctrlKey: true }), 'shift', false)).toBe(false);
    expect(isZoomWheel(keys({ shiftKey: true, ctrlKey: true }), 'shift', true)).toBe(false);
    expect(isZoomWheel(keys({}), 'shift', false)).toBe(false);
  });

  it('reads the setting (anything but shift is ctrl) and names the key', () => {
    expect(normalizeZoomModifier('shift')).toBe('shift');
    expect(normalizeZoomModifier('alt')).toBe('ctrl');
    expect(normalizeZoomModifier(undefined)).toBe('ctrl');
    expect(zoomKeyName('ctrl', false)).toBe('Ctrl');
    expect(zoomKeyName('ctrl', true)).toBe('Cmd');
    expect(zoomKeyName('shift', true)).toBe('Shift');
  });
});
