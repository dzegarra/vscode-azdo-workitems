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

/** The last run of each pipeline: older runs were replaced by a new push */
export function latestRuns(builds: BuildRun[]): RunModel[] {
  const latest = new Map<number, BuildRun>();
  for (const build of builds) {
    const current = latest.get(build.definition.id);
    if (!current || (build.queueTime ?? '') > (current.queueTime ?? '')) {
      latest.set(build.definition.id, build);
    }
  }
  return [...latest.values()]
    .sort((a, b) => a.definition.name.localeCompare(b.definition.name))
    .map((build) => ({
      id: build.id,
      pipeline: build.definition.name,
      state: runState(build),
      url: build.webUrl,
      startTime: build.startTime,
      finishTime: build.finishTime,
    }));
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

/** Status bar order: what needs attention first */
const SUMMARY_ORDER: RunState[] = ['failed', 'partial', 'running', 'queued', 'canceled', 'succeeded'];

/** Count of runs per state, in SUMMARY_ORDER, skipping the states without runs */
export function countRunStates(states: RunState[]): { state: RunState; count: number }[] {
  return SUMMARY_ORDER.map((state) => ({ state, count: states.filter((s) => s === state).length })).filter(
    (entry) => entry.count > 0
  );
}
