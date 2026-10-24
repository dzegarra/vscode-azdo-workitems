/**
 * Reminders of the work in progress (DEVELOPMENT_APPROACH §10): a started work item not updated for a while, shown
 * as a "zZ" badge before its title, the card pulsing in orange (it does not keep the item from being completed, so
 * not in the completion caution). No reminder about the end of the sprint: the days left are already shown and the team does
 * not want it. Pure, so no "vscode" import
 */
import { stateCategory } from './states';
import { workingMsBetween } from './workingTime';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CHANGED_DATE_FIELD = 'System.ChangedDate';

export interface ReminderInput {
  state: string;
  /** Latest `System.ChangedDate` of the work item and its tasks (ISO); undefined: unknown */
  lastChanged?: string;
}

export interface ReminderOptions {
  /** Working days without a change before the reminder; 0: off */
  staleAfterWorkingDays: number;
  workingDays: readonly number[];
}

/** The latest of the change dates (ISO); undefined when none is known */
export function latestChange(dates: unknown[]): string | undefined {
  return dates
    .filter((date): date is string => typeof date === 'string' && !Number.isNaN(Date.parse(date)))
    .reduce<string | undefined>(
      (latest, date) => (!latest || Date.parse(date) > Date.parse(latest) ? date : latest),
      undefined
    );
}

/** A work item in progress not updated for a while: how long, and the text of its badge's tooltip */
export interface NotUpdated {
  days: number;
  text: string;
}

// Rule REMIND-1
/** Status, tasks and effort are updated daily (§10): only work in progress is checked */
export function notUpdated(input: ReminderInput, now: Date, options: ReminderOptions): NotUpdated | undefined {
  if (stateCategory(input.state) !== 'in-progress' || !options.staleAfterWorkingDays || !input.lastChanged) {
    return undefined;
  }
  const days = Math.floor(workingMsBetween(new Date(input.lastChanged), now, options.workingDays) / MS_PER_DAY);
  return days >= options.staleAfterWorkingDays
    ? {
        days,
        text: `Not updated for ${days} working day${
          days === 1 ? '' : 's'
        } (team rule: update status, tasks and effort daily)`,
      }
    : undefined;
}

// Rule REMIND-3
/**
 * The card of a forgotten work item pulses in orange, so it is not forgotten for good. Not when it has alerts or is
 * being worked on: those already have their own, stronger look, and working on it means it is not forgotten
 */
export function asleepPulses(item: { notUpdated?: NotUpdated; alerts: unknown[]; workingOn?: unknown }): boolean {
  return !!item.notUpdated && !item.alerts.length && !item.workingOn;
}
