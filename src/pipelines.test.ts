import { describe, expect, it } from 'vitest';
import {
  BuildRun,
  countRunStates,
  describeRun,
  finishedRuns,
  formatDuration,
  latestRuns,
  pullRequestBranch,
  runState,
} from './pipelines';

const build = (id: number, overrides: Partial<BuildRun> = {}): BuildRun => ({
  id,
  definition: { id: 1, name: 'User-Interface-PR-Pipeline' },
  status: 'completed',
  result: 'succeeded',
  queueTime: `2026-10-0${id % 9}T10:00:00Z`,
  webUrl: `https://build/${id}`,
  ...overrides,
});

describe('pipelines', () => {
  it('uses the merge branch of the pull request', () => {
    expect(pullRequestBranch(13713)).toBe('refs/pull/13713/merge');
  });

  it.each([
    [{ status: 'notStarted' }, 'queued'],
    [{ status: 'inProgress' }, 'running'],
    [{ status: 'cancelling' }, 'running'],
    [{ status: 'completed', result: 'succeeded' }, 'succeeded'],
    [{ status: 'completed', result: 'partiallySucceeded' }, 'partial'],
    [{ status: 'completed', result: 'failed' }, 'failed'],
    [{ status: 'completed', result: 'canceled' }, 'canceled'],
  ] as const)('%o is %s', (run, state) => {
    expect(runState(run)).toBe(state);
  });

  it('keeps the last run of each pipeline', () => {
    const runs = latestRuns([
      build(1, { result: 'failed' }),
      build(3, { status: 'inProgress', result: undefined }),
      build(2),
      build(4, { definition: { id: 2, name: 'Docs' }, queueTime: '2026-09-01T00:00:00Z' }),
    ]);
    expect(runs.map((run) => [run.pipeline, run.id, run.state])).toEqual([
      ['Docs', 4, 'succeeded'],
      ['User-Interface-PR-Pipeline', 3, 'running'],
    ]);
  });

  it('formats durations', () => {
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(12 * 60_000 + 30_000)).toBe('12m');
    expect(formatDuration(65 * 60_000)).toBe('1h 05m');
  });

  it('describes runs with their elapsed time', () => {
    const now = new Date('2026-10-06T01:32:13Z');
    expect(describeRun({ state: 'running', startTime: '2026-10-06T01:20:13Z' }, now)).toBe('Running 12m');
    expect(
      describeRun({ state: 'failed', startTime: '2026-10-05T20:36:01Z', finishTime: '2026-10-05T20:57:29Z' }, now)
    ).toBe('Failed in 21m');
    expect(describeRun({ state: 'queued' }, now)).toBe('Queued');
  });

  it('detects the runs that finished since the last check', () => {
    const previous = new Map([
      [3, 'running' as const],
      [4, 'succeeded' as const],
    ]);
    const current = latestRuns([
      build(3, { result: 'failed' }),
      build(4, { definition: { id: 2, name: 'Docs' } }),
      build(5, { definition: { id: 9, name: 'X' } }),
    ]);
    expect(finishedRuns(previous, current).map((run) => run.id)).toEqual([3]);
  });

  it('counts the runs per state, failures first', () => {
    expect(countRunStates(['succeeded', 'running', 'failed', 'succeeded'])).toEqual([
      { state: 'failed', count: 1 },
      { state: 'running', count: 1 },
      { state: 'succeeded', count: 2 },
    ]);
    expect(countRunStates([])).toEqual([]);
  });
});
