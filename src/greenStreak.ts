/** Green streak: the user's CI runs that succeeded in a row (src/funJournal.ts keeps them). Pure, no "vscode" import */
import type { JournalRun } from './funJournal';

/** From this many green runs in a row the streak is shown (status bar, notifications) */
export const MIN_SHOWN_STREAK = 3;

export interface GreenStreak {
  /** Green runs in a row, counting back from the latest finished one */
  current: number;
  /** The longest streak of the journal */
  best: number;
}

function byFinishTime(runs: JournalRun[]): JournalRun[] {
  return [...runs].sort((a, b) => a.at.localeCompare(b.at) || a.id - b.id);
}

// Rule FUN-STREAK-1
export function greenStreak(runs: JournalRun[]): GreenStreak {
  let current = 0;
  let best = 0;
  for (const run of byFinishTime(runs)) {
    current = run.ok ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return { current, best };
}

// Rule FUN-STREAK-2
/** "$(flame) 7" next to the CI counts; empty below MIN_SHOWN_STREAK */
export function greenStreakLabel(streak: GreenStreak): string {
  return streak.current >= MIN_SHOWN_STREAK ? `$(flame) ${String(streak.current)}` : '';
}

/** Line of the CI tooltip; undefined below MIN_SHOWN_STREAK */
export function greenStreakTooltip(streak: GreenStreak): string | undefined {
  if (streak.current < MIN_SHOWN_STREAK) {
    return undefined;
  }
  const best = streak.best > streak.current ? ` (best: ${String(streak.best)})` : ' (your best so far)';
  return `🔥 ${String(streak.current)} green CI runs in a row${best}`;
}

// Rule FUN-STREAK-3
/**
 * The sentence that ends the notification of a finished run: the streak it extends, or the one it broke.
 * Undefined when there is nothing worth saying
 */
export function greenStreakNote(before: GreenStreak, after: GreenStreak): string | undefined {
  if (after.current > before.current && after.current >= MIN_SHOWN_STREAK) {
    return after.current > before.best && before.best >= MIN_SHOWN_STREAK
      ? `🔥 ${String(after.current)} green runs in a row: a new record!`
      : `🔥 ${String(after.current)} green runs in a row.`;
  }
  if (after.current === 0 && before.current >= MIN_SHOWN_STREAK) {
    return `💔 That ends a streak of ${String(before.current)} green runs.`;
  }
  return undefined;
}
