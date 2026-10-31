/** CI pipeline runs of pull requests. Pure, so no "vscode" import */
import type { CoverageSummary } from './coverage';

/** Build as returned by the Azure DevOps Builds API */
export interface BuildRun {
  id: number;
  definition: { id: number; name: string };
  status: 'all' | 'cancelling' | 'completed' | 'inProgress' | 'none' | 'notStarted' | 'postponed';
  result?: 'canceled' | 'failed' | 'none' | 'partiallySucceeded' | 'succeeded';
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  webUrl: string;
  /** E.g. "refs/heads/develop", "refs/pull/13713/merge" */
  sourceBranch?: string;
  /** What queued it: "pullRequest", "manual", "individualCI", "batchedCI"… */
  reason?: string;
  /** "ci.message" of the runs queued by a push: the commit message, "Merged PR 13837: …" after a merge */
  triggerInfo?: Record<string, string>;
  /** Commit the run built: for a batched CI run of a branch, its head when the run was queued */
  sourceVersion?: string;
  /** Who the run is for: whoever completed the PR for a run queued by its merge */
  requestedFor?: { displayName: string };
}

export interface FailedTest {
  title: string;
  /** Test file, as reported by the test run */
  file: string;
  /** First line of the error, without colour codes */
  error: string;
}

export interface TestSummary {
  /** Tests that ran (the skipped ones are not counted) */
  total: number;
  failed: number;
  /** The first failures, up to a few */
  failedTests: FailedTest[];
}

export type RunState = 'canceled' | 'failed' | 'partial' | 'queued' | 'running' | 'succeeded';

export interface RunModel {
  id: number;
  pipeline: string;
  state: RunState;
  url: string;
  startTime?: string;
  finishTime?: string;
  /** Finished runs only, when Azure DevOps has the information */
  tests?: TestSummary;
  /** Task that failed when the run failed without failed tests (e.g. "Linting") */
  failedStep?: string;
  coverage?: CoverageSummary;
}

/** Branch Azure DevOps builds for the validation of a pull request */
export function pullRequestBranch(pullRequestId: number): string {
  return `refs/pull/${pullRequestId}/merge`;
}

export function runState(build: Pick<BuildRun, 'result' | 'status'>): RunState {
  if (build.status === 'notStarted' || build.status === 'postponed') {
    return 'queued';
  }
  if (build.status !== 'completed') {
    return 'running';
  }
  switch (build.result) {
    case 'succeeded':
      return 'succeeded';
    case 'partiallySucceeded':
      return 'partial';
    case 'canceled':
      return 'canceled';
    case 'failed':
    case 'none':
    case undefined:
      return 'failed';
  }
}

export function isActive(state: RunState): boolean {
  return state === 'queued' || state === 'running';
}

const HEADS_PREFIX = 'refs/heads/';

/** "develop" from "refs/heads/develop" */
export function shortBranchName(refName: string): string {
  return refName.startsWith(HEADS_PREFIX) ? refName.slice(HEADS_PREFIX.length) : refName;
}

export function toRunModel(build: BuildRun): RunModel {
  return {
    id: build.id,
    pipeline: build.definition.name,
    state: runState(build),
    url: build.webUrl,
    startTime: build.startTime,
    finishTime: build.finishTime,
  };
}

/** The last run of each pipeline: older runs were replaced by a new push */
export function latestRuns(builds: BuildRun[]): RunModel[] {
  const latest = new Map<number, BuildRun>();
  for (const build of builds) {
    const current = latest.get(build.definition.id);
    if (!current || (build.queueTime ?? '') > (current.queueTime ?? '')) {
      latest.set(build.definition.id, build);
    }
  }
  return [...latest.values()].sort((a, b) => a.definition.name.localeCompare(b.definition.name)).map(toRunModel);
}

/** Last run of a pipeline on a branch, queued by hand (no pull request) */
export interface BranchRun {
  /** Without "refs/heads/" */
  branch: string;
  run: RunModel;
}

/** Last run of a pipeline on the target branch after a pull request was merged */
export interface MergeRun {
  pullRequestId: number;
  /** Without "refs/heads/", e.g. "develop" */
  targetBranch: string;
  run: RunModel;
}

/** Newest entry per key (by the queue time of its build), sorted by key */
function newestBy<T extends { build: BuildRun }>(entries: T[], key: (entry: T) => string): T[] {
  const latest = new Map<string, T>();
  for (const entry of entries) {
    const current = latest.get(key(entry));
    if (!current || (entry.build.queueTime ?? '') > (current.build.queueTime ?? '')) {
      latest.set(key(entry), entry);
    }
  }
  return [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, entry]) => entry);
}

/** Rule STATUSBAR-CI-6: the last run of each pipeline on each branch (a branch must not hide another) */
export function latestBranchRuns(builds: BuildRun[]): BranchRun[] {
  // Rule STATUSBAR-CI-6
  return newestBy(
    builds.flatMap((build) => (build.sourceBranch ? [{ build, branch: shortBranchName(build.sourceBranch) }] : [])),
    ({ build, branch }) => `${branch}\n${build.definition.name}`
  ).map(({ build, branch }) => ({ branch, run: toRunModel(build) }));
}

const MERGED_PULL_REQUEST = /^Merged PR (\d+):/;

/** PR whose merge queued the build ("Merged PR 13837: …" in its trigger message); undefined for other pushes */
export function mergedPullRequestId(build: Pick<BuildRun, 'triggerInfo'>): number | undefined {
  const match = MERGED_PULL_REQUEST.exec(build.triggerInfo?.['ci.message'] ?? '');
  return match ? Number(match[1]) : undefined;
}

/**
 * Rule STATUSBAR-CI-8: the runs queued by the merge of one of the given PRs, the last one per PR and pipeline.
 * Matched by the PR number of the merge message: the build is requested for whoever completed the PR
 */
export function mergeRuns(builds: BuildRun[], pullRequestIds: Iterable<number>): MergeRun[] {
  const mine = new Set(pullRequestIds);
  // Rule STATUSBAR-CI-8
  const merges = builds.flatMap((build) => {
    const pullRequestId = mergedPullRequestId(build);
    return pullRequestId !== undefined && mine.has(pullRequestId) ? [{ pullRequestId, build }] : [];
  });
  return newestBy(merges, ({ pullRequestId, build }) => `${String(pullRequestId)}\n${build.definition.name}`).map(
    ({ pullRequestId, build }) => ({
      pullRequestId,
      targetBranch: shortBranchName(build.sourceBranch ?? ''),
      run: toRunModel(build),
    })
  );
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** "45s", "12m", "1h 05m" */
export function formatDuration(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  if (ms < MINUTE) {
    return `${Math.floor(ms / SECOND)}s`;
  }
  if (ms < HOUR) {
    return `${Math.floor(ms / MINUTE)}m`;
  }
  return `${Math.floor(ms / HOUR)}h ${String(Math.floor((ms % HOUR) / MINUTE)).padStart(2, '0')}m`;
}

const STATE_LABELS: Record<RunState, string> = {
  queued: 'Queued',
  running: 'Running',
  succeeded: 'Succeeded',
  partial: 'Partially succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
};

/** "Running 12m", "Failed in 34m", "Queued" */
export function describeRun(run: Pick<RunModel, 'finishTime' | 'startTime' | 'state'>, now: Date): string {
  const label = STATE_LABELS[run.state];
  if (!run.startTime) {
    return label;
  }
  const start = Date.parse(run.startTime);
  if (run.state === 'running') {
    return `${label} ${formatDuration(now.getTime() - start)}`;
  }
  return run.finishTime ? `${label} in ${formatDuration(Date.parse(run.finishTime) - start)}` : label;
}

/** Runs that were active before and are finished now, to notify the user */
export function finishedRuns(previous: Map<number, RunState>, current: RunModel[]): RunModel[] {
  return current.filter((run) => {
    const before = previous.get(run.id);
    return before !== undefined && isActive(before) && !isActive(run.state);
  });
}

/** Status bar order: what needs attention first; canceled runs are the least interesting */
const SUMMARY_ORDER: RunState[] = ['failed', 'partial', 'running', 'queued', 'succeeded', 'canceled'];

/** Count of runs per state, in SUMMARY_ORDER, skipping the states without runs */
export function countRunStates(states: RunState[]): { state: RunState; count: number }[] {
  return SUMMARY_ORDER.map((state) => ({ state, count: states.filter((s) => s === state).length })).filter(
    (entry) => entry.count > 0
  );
}

export type RunCount = { state: RunState; count: number };

/**
 * Icon of each state in the status bar item, its tooltip and its picker. Emojis carry their own colour (the status
 * bar cannot colour one codicon), so a failure stands out from a success; running keeps the animated codicon
 */
export const STATE_ICONS: Record<RunState, string> = {
  failed: '❌',
  partial: '⚠️',
  running: '$(sync~spin)',
  queued: '⏳',
  canceled: '🚫',
  succeeded: '✅',
};

/**
 * Text of the CI status bar item: "CI  ❌ 1  ✅ 3". Rule STATUSBAR-CI-1: the states go by severity
 * (as countRunStates returns them) and the canceled runs are left out, since they need nothing from the user.
 * Rule STATUSBAR-CI-2: when only canceled runs exist they are shown, so the item is not empty
 */
export function ciStatusText(counts: RunCount[]): string {
  // Rule STATUSBAR-CI-1
  const shown = counts.filter(({ state }) => state !== 'canceled');
  // Rule STATUSBAR-CI-2
  const entries = shown.length ? shown : counts;
  return `CI  ${entries.map(({ state, count }) => `${STATE_ICONS[state]} ${count}`).join('  ')}`;
}

/** "failed", "partially succeeded"… */
export function runStateLabel(state: RunState): string {
  return STATE_LABELS[state].toLowerCase();
}

/** Title line of the CI tooltip: the totals per state, canceled included */
export function ciTooltipTitle(counts: RunCount[]): string {
  // Rule STATUSBAR-CI-4
  const totals = counts.map(({ state, count }) => `${count} ${runStateLabel(state)}`).join(' · ');
  return `CI runs: ${totals}`;
}

/** Colours of the CI item. Only these two backgrounds exist for status bar items; the text takes any theme colour */
export interface CiItemColors {
  background?: 'statusBarItem.errorBackground' | 'statusBarItem.warningBackground';
  /** Id of a colour contributed in package.json */
  foreground?: string;
}

/**
 * Colours of the CI item from the state of the runs of the checked out branch; undefined (no run): none.
 * Rule STATUSBAR-CI-3: failed and partially succeeded fill the item (red, orange).
 * Rule STATUSBAR-CI-9: the other states tint its text
 */
export function ciItemColors(state: RunState | undefined): CiItemColors {
  switch (state) {
    case undefined:
      return {};
    // Rule STATUSBAR-CI-3
    case 'failed':
      return { background: 'statusBarItem.errorBackground' };
    case 'partial':
      return { background: 'statusBarItem.warningBackground' };
    // Rule STATUSBAR-CI-9
    case 'running':
      return { foreground: 'totalflowx.ci.runningForeground' };
    case 'queued':
      return { foreground: 'totalflowx.ci.queuedForeground' };
    case 'succeeded':
      return { foreground: 'totalflowx.ci.succeededForeground' };
    case 'canceled':
      return { foreground: 'totalflowx.ci.canceledForeground' };
  }
}
