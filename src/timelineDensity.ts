/** The row style of the Sprint timeline, per view (Rule TIMELINE-32). Pure, so no "vscode" import */

/** Normal: two-line rows; Compact: one-line rows */
export type TimelineDensity = 'compact' | 'normal';

// Rule TIMELINE-32
/** The value of a setting `appearance.timelineDensity*`; anything else is the default of its view */
export function normalizeTimelineDensity(value: unknown, fallback: TimelineDensity): TimelineDensity {
  return value === 'compact' || value === 'normal' ? value : fallback;
}

/** The setting of the view shown: Mine + my reviews (default Normal) or Whole team (default Compact) */
export const densityOf = (
  scope: 'mine' | 'team',
  settings: Record<'mine' | 'team', TimelineDensity>
): TimelineDensity => settings[scope];
