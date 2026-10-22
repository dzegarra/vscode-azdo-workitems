/** Texts of the small celebrations of totalflowx.fun.enabled. Pure, so no "vscode" import */

/** "1st", "2nd", "3rd", "4th", "11th", "21st" */
export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${String(value)}th`;
  }
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Partial<Record<number, string>>)[value % 10] ?? 'th';
  return `${String(value)}${suffix}`;
}

/** At least 3 digits, the same read backwards: 12321, 4554 */
export function isPalindromeNumber(value: number): boolean {
  const digits = String(value);
  return digits.length >= 3 && digits === Array.from(digits).reverse().join('');
}

// Rule FUN-EGG-1
/** A fun fact about the number of a PR; undefined for most of them */
export function pullRequestEasterEgg(id: number): string | undefined {
  if (id >= 1000 && id % 1000 === 0) {
    return `🎯 A round number: PR ${String(id)}!`;
  }
  return isPalindromeNumber(id) ? `🪞 PR ${String(id)} reads the same backwards!` : undefined;
}

/** Below MAX_JOURNAL_ENTRIES (500): once the journal is full its length stops growing, a milestone there would repeat */
const MERGE_MILESTONES = [10, 25, 50, 100, 150, 200, 250, 300, 400];

// Rule FUN-EGG-2
/** A milestone of the merged PRs the extension has seen; undefined between milestones */
export function mergeMilestone(total: number): string | undefined {
  return MERGE_MILESTONES.includes(total) ? `🏅 That makes ${String(total)} merged pull requests!` : undefined;
}

// Rule FUN-MERGE-1
/**
 * "🚀 PR 1234 shipped: Title. Your 3rd this sprint!" plus the easter egg and the milestone, when there are any.
 * `thisSprint` is undefined when the dates of the sprint are not known
 */
export function mergedCelebration(
  pullRequest: { id: number; title: string },
  counts: { thisSprint?: number; total: number }
): string {
  const sprint = counts.thisSprint ? ` Your ${ordinal(counts.thisSprint)} this sprint!` : '';
  return [
    `🚀 PR ${String(pullRequest.id)} shipped: ${pullRequest.title}.${sprint}`,
    pullRequestEasterEgg(pullRequest.id),
    mergeMilestone(counts.total),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Approvals within this many minutes of the publication get a note */
export const FAST_APPROVAL_MINUTES = 60;
const LIGHTNING_MINUTES = 15;

// Rule FUN-APPROVAL-1
/** The note added to the first approval of a PR when it came fast; undefined otherwise */
export function approvalSpeedNote(minutes: number | undefined): string | undefined {
  if (minutes === undefined || minutes > FAST_APPROVAL_MINUTES) {
    return undefined;
  }
  const after = `${String(minutes)} min after publishing`;
  return minutes <= LIGHTNING_MINUTES ? `⚡ Lightning review: ${after}!` : `⚡ First approval ${after}.`;
}

/** Below this, a gain over the previous PR is noise */
const MIN_COVERAGE_GAIN = 0.1;

// Rule FUN-COVERAGE-1
/** "🎯 +1.8 pts over your previous PR." when the coverage went up; undefined otherwise */
export function coverageGainNote(gain: number | undefined): string | undefined {
  if (gain === undefined || gain < MIN_COVERAGE_GAIN) {
    return undefined;
  }
  return `🎯 +${gain.toFixed(1)} pts of coverage over your previous PR.`;
}
