import { describe, expect, it } from 'vitest';
import {
  BuildRun,
  ciItemColors,
  ciStatusText,
  ciTooltipTitle,
  countRunStates,
  describeRun,
  finishedRuns,
  formatDuration,
  latestBranchRuns,
  latestRuns,
  mergedPullRequestId,
  mergeRuns,
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

  it('keeps the last run of each pipeline on each branch', () => {
    // Rule STATUSBAR-CI-6
    const runs = latestBranchRuns([
      build(1, { sourceBranch: 'refs/heads/exp/a', result: 'failed' }),
      build(2, { sourceBranch: 'refs/heads/exp/a' }),
      build(3, { sourceBranch: 'refs/heads/exp/b', status: 'inProgress', result: undefined }),
      build(4, { sourceBranch: 'refs/heads/exp/a', definition: { id: 2, name: 'Docs' } }),
    ]);
    expect(runs.map(({ branch, run }) => [branch, run.pipeline, run.id, run.state])).toEqual([
      ['exp/a', 'Docs', 4, 'succeeded'],
      ['exp/a', 'User-Interface-PR-Pipeline', 2, 'succeeded'],
      ['exp/b', 'User-Interface-PR-Pipeline', 3, 'running'],
    ]);
  });

  it('reads the PR of a merge from the trigger message', () => {
    expect(mergedPullRequestId({ triggerInfo: { 'ci.message': 'Merged PR 13837: [66068] FUI Common: x' } })).toBe(
      13837
    );
    expect(mergedPullRequestId({ triggerInfo: { 'ci.message': 'Fix the build' } })).toBeUndefined();
    expect(mergedPullRequestId({ triggerInfo: {} })).toBeUndefined();
    expect(mergedPullRequestId({})).toBeUndefined();
  });

  it('keeps the runs queued by the merge of my PRs only, the last one per PR and pipeline', () => {
    // Rule STATUSBAR-CI-8
    const merge = (id: number, pr: number, overrides: Partial<BuildRun> = {}) =>
      build(id, {
        sourceBranch: 'refs/heads/develop',
        triggerInfo: { 'ci.message': `Merged PR ${String(pr)}: Title` },
        ...overrides,
      });
    const runs = mergeRuns(
      [
        merge(1, 13837, { result: 'failed' }),
        merge(2, 13837),
        merge(3, 13900),
        build(4, { sourceBranch: 'refs/heads/develop', triggerInfo: { 'ci.message': 'Direct push' } }),
      ],
      [13837, 13001]
    );
    expect(runs).toEqual([
      { pullRequestId: 13837, targetBranch: 'develop', run: expect.objectContaining({ id: 2, state: 'succeeded' }) },
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

  describe('CI status bar item', () => {
    const counts = (...states: Parameters<typeof countRunStates>[0]) => countRunStates(states);

    it('labels the item CI and orders the states by severity', () => {
      // Rule STATUSBAR-CI-1
      expect(ciStatusText(counts('succeeded', 'queued', 'running', 'partial', 'failed', 'succeeded'))).toBe(
        'CI  ❌ 1  ⚠️ 1  $(sync~spin) 1  ⏳ 1  ✅ 2'
      );
      expect(ciStatusText(counts('succeeded', 'succeeded', 'succeeded', 'queued'))).toBe('CI  ⏳ 1  ✅ 3');
    });

    it('leaves the canceled runs out of the text', () => {
      // Rule STATUSBAR-CI-1
      expect(ciStatusText(counts('canceled', 'succeeded', 'canceled'))).toBe('CI  ✅ 1');
    });

    it('shows the canceled runs when they are the only ones', () => {
      // Rule STATUSBAR-CI-2
      expect(ciStatusText(counts('canceled', 'canceled'))).toBe('CI  🚫 2');
    });

    it('fills the item red when the branch failed and orange when it partially succeeded', () => {
      // Rule STATUSBAR-CI-3
      expect(ciItemColors('failed')).toEqual({ background: 'statusBarItem.errorBackground' });
      expect(ciItemColors('partial')).toEqual({ background: 'statusBarItem.warningBackground' });
    });

    it('tints the text for the other states, and leaves the item alone without runs', () => {
      // Rule STATUSBAR-CI-9
      expect(ciItemColors('running')).toEqual({ foreground: 'totalflowx.ci.runningForeground' });
      expect(ciItemColors('queued')).toEqual({ foreground: 'totalflowx.ci.queuedForeground' });
      expect(ciItemColors('succeeded')).toEqual({ foreground: 'totalflowx.ci.succeededForeground' });
      expect(ciItemColors('canceled')).toEqual({ foreground: 'totalflowx.ci.canceledForeground' });
      expect(ciItemColors(undefined)).toEqual({});
    });

    it('totals every state, canceled included, in the tooltip title', () => {
      // Rule STATUSBAR-CI-4
      expect(ciTooltipTitle(counts('failed', 'succeeded', 'succeeded', 'canceled'))).toBe(
        'CI runs: 1 failed · 2 succeeded · 1 canceled'
      );
    });
  });
});
