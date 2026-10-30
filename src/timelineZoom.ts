/**
 * The horizontal zoom of the Sprint timeline (Rules TIMELINE-48, TIMELINE-49): the width of a day, in percent of the
 * default one. Personal setting `totalflowx.appearance.timelineZoom`, the same for Mine and Whole team. Pure, so no
 * "vscode" import
 */

export const MIN_ZOOM = 50;
export const MAX_ZOOM = 1000;
export const DEFAULT_ZOOM = 100;
/** Every step of − / + (and of a wheel notch of 100) multiplies or divides the zoom drawn by this: 25 % wider or narrower */
export const ZOOM_FACTOR = 1.25;
/** The delta of one notch of a mouse wheel: one notch is one step */
export const WHEEL_NOTCH = 100;
/** The minimum width of a day at 100 %, in pixels */
export const DAY_MIN_PX = 64;

// Rule TIMELINE-48
/** The setting as a whole percent from 50 to 1000 (anything that is not a number is 100) */
export function normalizeZoom(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value)))
    : DEFAULT_ZOOM;
}

// Rule TIMELINE-48
/** The width of a day at this zoom (the `--tl-day-min` of the grid) */
export const dayMinWidth = (zoom: number): number => (DAY_MIN_PX * normalizeZoom(zoom)) / 100;

// Rule TIMELINE-48
/**
 * The scroll position that keeps the day under the pointer where it was after the lanes changed width by `ratio`
 * (new width / old width). `cursorX` is the pointer from the left edge of the scrolling area, `laneStart` where the lanes
 * begin in the content (the label column and the padding); the label column does not scale
 */
export function scrollAfterZoom(scrollLeft: number, cursorX: number, laneStart: number, ratio: number): number {
  const underCursor = scrollLeft + cursorX - laneStart;
  return Math.max(0, laneStart + underCursor * ratio - cursorX);
}

// Rule TIMELINE-48
/**
 * The zoom at which the whole axis fits the lanes (no sideways scroll): lane width / (days × the day width at 100 %),
 * in percent, rounded down so the grid never overflows the panel (the days stretch to the lanes). Unknown sizes give the lowest zoom
 */
export function fitZoom(laneWidth: number, days: number): number {
  return laneWidth > 0 && days > 0 ? Math.floor((laneWidth / (days * DAY_MIN_PX)) * 100) : MIN_ZOOM;
}

// Rule TIMELINE-49
/** − is useful only above the "fit" zoom: at or below it the timeline already shows everything */
export const canZoomOut = (zoom: number, fit: number): boolean => zoom > Math.max(fit, MIN_ZOOM);

// Rule TIMELINE-49
/** The zoom that is drawn: a stored value at or below "fit" draws as "fit" (and nothing is drawn above the maximum) */
export const effectiveZoom = (zoom: number, fit: number): number =>
  Math.max(normalizeZoom(zoom), Math.min(Math.floor(fit), MAX_ZOOM));

// Rule TIMELINE-49
/** The zoom after multiplying the zoom drawn by `factor`: whole percent, at least one point of change, within [max(fit, 50), 1000] */
function scaled(zoom: number, fit: number, factor: number): number {
  const current = effectiveZoom(zoom, fit);
  const raw = current * factor;
  const rounded = Math.round(raw);
  const moved = rounded === current && raw !== current ? current + Math.sign(raw - current) : rounded;
  return Math.min(MAX_ZOOM, Math.max(Math.floor(fit), MIN_ZOOM, moved));
}

// Rule TIMELINE-49
/** The zoom after −: the zoom drawn ÷ 1.25, never below "fit" (nor 50); at the minimum, itself */
export const nextZoomOut = (zoom: number, fit: number): number => scaled(zoom, fit, 1 / ZOOM_FACTOR);

// Rule TIMELINE-49
/** The zoom after +: the zoom drawn (so the first press changes what is seen, even when the setting is below "fit") × 1.25 */
export const nextZoomIn = (zoom: number, fit: number): number => scaled(zoom, fit, ZOOM_FACTOR);

// Rule TIMELINE-49
/** The zoom after a wheel delta (negative zooms in): one notch of 100 is one step of 1.25, small deltas of a trackpad add up */
export const wheelZoom = (zoom: number, fit: number, delta: number): number =>
  scaled(zoom, fit, ZOOM_FACTOR ** (-delta / WHEEL_NOTCH));

// Rule TIMELINE-49
/** The width of a day as drawn: a zoom at or below "fit" is stretched to it (the days share the lanes) */
export const drawnDayWidth = (zoom: number, fit: number): number =>
  (DAY_MIN_PX * Math.max(normalizeZoom(zoom), fit)) / 100;

// Rule TIMELINE-49
/** Eases the zoom transition out: fast at the start, slow at the end */
export const easeOut = (progress: number): number => 1 - (1 - Math.min(1, Math.max(0, progress))) ** 3;

/** The duration of the zoom transition of the buttons (ms) */
export const ZOOM_TRANSITION_MS = 150;

/** Rule TIMELINE-48: how long after the write of the zoom setting its change event is still taken for the webview's own echo (ms) */
export const OWN_WRITE_WINDOW_MS = 5000;

// Rule TIMELINE-48
/**
 * Whether a change of the zoom setting is the echo of what the webview wrote itself (a recent write of the same value):
 * the webview already draws it, so the tab is not rebuilt nor redrawn (a redraw in the middle of a zoom made it jump)
 */
export function isOwnZoomEcho(
  written: { zoom: number; at: number } | undefined,
  now: number,
  current: unknown
): boolean {
  return written !== undefined && now - written.at <= OWN_WRITE_WINDOW_MS && normalizeZoom(current) === written.zoom;
}

/** Rule TIMELINE-48: the zoom is written to the setting this long after the last change (remembering it is not urgent) */
export const ZOOM_SAVE_DELAY_MS = 1500;

/** Rule TIMELINE-49: the key held with the mouse wheel to zoom (`appearance.timelineZoomModifier`) */
export type ZoomModifier = 'ctrl' | 'shift';

/** Rule TIMELINE-49: anything but "shift" is "ctrl" (the default) */
export const normalizeZoomModifier = (value: unknown): ZoomModifier => (value === 'shift' ? 'shift' : 'ctrl');

// Rule TIMELINE-49
/**
 * Whether a wheel event is a zoom: with "ctrl", Ctrl (a trackpad pinch arrives as a wheel with Ctrl) or, on macOS, Cmd,
 * and no Shift; with "shift", Shift alone (Ctrl and Cmd are left to the browser)
 */
export function isZoomWheel(
  keys: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  modifier: ZoomModifier,
  isMac: boolean
): boolean {
  if (modifier === 'shift') {
    return keys.shiftKey && !keys.ctrlKey && !keys.metaKey;
  }
  return (keys.ctrlKey || (isMac && keys.metaKey)) && !keys.shiftKey;
}

/** Rule TIMELINE-49: how the key is named in the tooltips ("Ctrl" or "Shift"; Cmd on macOS) */
export function zoomKeyName(modifier: ZoomModifier, isMac: boolean): string {
  if (modifier === 'shift') {
    return 'Shift';
  }
  return isMac ? 'Cmd' : 'Ctrl';
}
