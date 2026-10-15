/** Delay before the details card of a task pill appears on hover (totalflowx.tasks.hoverCardDelay). Pure: no "vscode" import */

export const DEFAULT_HOVER_CARD_DELAY = 500;
export const MIN_HOVER_CARD_DELAY = 0;
export const MAX_HOVER_CARD_DELAY = 3000;

/** Milliseconds, whole, between 0 and 3000; anything that is not a finite number (a typo in settings.json) means the default */
export function normalizeHoverCardDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_HOVER_CARD_DELAY;
  }
  return Math.round(Math.min(MAX_HOVER_CARD_DELAY, Math.max(MIN_HOVER_CARD_DELAY, value)));
}
