/** Personal coverage records of the user's PRs. Pure, so no "vscode" import */

export interface CoverageResult {
  pullRequestId: number;
  /** Build of the latest successful run of the PR seen so far */
  runId: number;
  percent: number;
}

export interface CoverageRecords {
  best?: CoverageResult & {
    /** The best before this one; undefined when it was the first one ever seen */
    previous?: number;
  };
  /** One entry per PR, in the order they were first seen. A re-run of a PR replaces its entry */
  results: CoverageResult[];
}

export const EMPTY_RECORDS: CoverageRecords = { results: [] };

/** PRs remembered: far more than any streak */
const MAX_RESULTS = 100;

/**
 * Records the latest successful run of a PR. The same run twice, or an older run than the one known, changes nothing;
 * a newer run of a known PR replaces its value instead of adding a streak step
 */
export function recordResult(records: CoverageRecords, result: CoverageResult): CoverageRecords {
  const index = records.results.findIndex((entry) => entry.pullRequestId === result.pullRequestId);
  if (index >= 0 && records.results[index].runId >= result.runId) {
    return records;
  }
  const results =
    index >= 0
      ? records.results.map((entry, i) => (i === index ? result : entry))
      : [...records.results, result].slice(-MAX_RESULTS);
  const best =
    !records.best || result.percent > records.best.percent
      ? { ...result, previous: records.best?.percent }
      : records.best;
  return { best, results };
}

/** PRs in a row, counting back from the latest one, at or above the target */
export function currentStreak(records: CoverageRecords, target: number): number {
  let streak = 0;
  for (let i = records.results.length - 1; i >= 0 && records.results[i].percent >= target; i -= 1) {
    streak += 1;
  }
  return streak;
}

/** The run set the personal best, beating an earlier one */
export function isNewBest(records: CoverageRecords, runId: number): boolean {
  return records.best?.runId === runId && records.best.previous !== undefined;
}

/** Percentage points the run gained over the PR recorded before its own; undefined for the first PR or an unknown run */
export function gainOverPreviousPullRequest(records: CoverageRecords, runId: number): number | undefined {
  const index = records.results.findIndex((entry) => entry.runId === runId);
  const previous = index > 0 ? records.results[index - 1] : undefined;
  return previous ? records.results[index].percent - previous.percent : undefined;
}

/** "Your best: 98% · streak: 4 PRs ≥ 80%" */
export function describeRecords(records: CoverageRecords, target: number): string | undefined {
  if (!records.best) {
    return undefined;
  }
  const streak = currentStreak(records, target);
  return `Your best: ${Math.round(records.best.percent)}% · streak: ${streak} PR${
    streak === 1 ? '' : 's'
  } ≥ ${Math.round(target)}%`;
}
