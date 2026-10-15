/** Delay before the popovers (task details, coverage, predecessors, PR history) appear on hover (totalflowx.popovers.hoverDelay). Pure: no "vscode" import */

export const DEFAULT_POPOVER_DELAY = 500;
export const MIN_POPOVER_DELAY = 0;
export const MAX_POPOVER_DELAY = 3000;

/** Milliseconds, whole, between 0 and 3000; anything that is not a finite number (a typo in settings.json) means the default */
export function normalizePopoverDelay(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_POPOVER_DELAY;
  }
  return Math.round(Math.min(MAX_POPOVER_DELAY, Math.max(MIN_POPOVER_DELAY, value)));
}

/**
 * The value the user set explicitly in `totalflowx.popovers.hoverDelay`, else the one of the deprecated
 * `totalflowx.tasks.hoverCardDelay`, else the default. Both arguments are `undefined` when the setting is not set
 */
export function resolvePopoverDelay(explicit: unknown, deprecatedExplicit: unknown): number {
  return normalizePopoverDelay(explicit !== undefined ? explicit : deprecatedExplicit);
}
