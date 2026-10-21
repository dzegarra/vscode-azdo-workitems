import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunModel } from './pipelines';
import { followedPullRequestIds, nextRunsPollDelay, RunsPoller, RunsSnapshot, RunsTracker } from './runsPolling';

const run = (id: number, state: RunModel['state']): RunModel => ({
  id,
  pipeline: 'PR',
  state,
  url: `https://build/${id}`,
});

const snapshot = (entries: [number, RunModel[]][], others: Omit<RunsSnapshot, 'pullRequests'> = {}) =>
  Promise.resolve<RunsSnapshot>({ pullRequests: new Map(entries), ...others });

describe('nextRunsPollDelay', () => {
  it('is fast while a run is active', () => {
    expect(nextRunsPollDelay({ hasActive: true, fastSeconds: 15, idleSeconds: 60 })).toBe(15);
    expect(nextRunsPollDelay({ hasActive: true, fastSeconds: 15, idleSeconds: 0 })).toBe(15);
  });

  it('is idle when nothing is active', () => {
    expect(nextRunsPollDelay({ hasActive: false, fastSeconds: 15, idleSeconds: 60 })).toBe(60);
  });

  it('is none when idle checks are disabled', () => {
    expect(nextRunsPollDelay({ hasActive: false, fastSeconds: 15, idleSeconds: 0 })).toBeUndefined();
  });
});

describe('followedPullRequestIds', () => {
  it('joins the linked and the registered PRs without repeating', () => {
    expect(followedPullRequestIds([1, 2], [2, 3])).toEqual([1, 2, 3]);
    expect(followedPullRequestIds([], [])).toEqual([]);
  });
});

describe('RunsTracker', () => {
  it('detects registration changes', () => {
    const tracker = new RunsTracker();
    expect(tracker.follow([{ id: 1, title: 'A' }])).toBe(true);
    expect(tracker.follow([{ id: 1, title: 'A2' }])).toBe(false);
    expect(tracker.titleOf(1)).toBe('A2');
    expect(tracker.follow([{ id: 2, title: 'B' }])).toBe(true);
    expect(tracker.extraIds).toEqual([2]);
  });

  it('skips a refresh while another is in progress', async () => {
    const tracker = new RunsTracker();
    let release: (value: RunsSnapshot) => void = () => undefined;
    const slow = tracker.refresh([1], () => new Promise((resolve) => (release = resolve)));
    expect(await tracker.refresh([1], () => snapshot([]))).toBeUndefined();
    release({ pullRequests: new Map<number, RunModel[]>() });
    expect(await slow).toEqual([]);
  });

  it('keeps the runs of a PR whose fetch failed, and still reports the run finishing after the outage', async () => {
    const tracker = new RunsTracker();
    await tracker.refresh([1, 2], () =>
      snapshot([
        [1, [run(10, 'running')]],
        [2, [run(20, 'running')]],
      ])
    );
    // PR 1 cannot be fetched this time: its running run stays
    await tracker.refresh([1, 2], () => snapshot([[2, [run(20, 'running')]]]));
    expect(tracker.runs.get(1)).toEqual([run(10, 'running')]);
    const finished = await tracker.refresh([1, 2], () =>
      snapshot([
        [1, [run(10, 'succeeded')]],
        [2, [run(20, 'running')]],
      ])
    );
    expect(finished).toEqual([{ kind: 'pullRequest', pullRequestId: 1, run: run(10, 'succeeded') }]);
    // A PR no longer followed is dropped
    await tracker.refresh([2], () => snapshot([]));
    expect([...tracker.runs.keys()]).toEqual([2]);
  });

  it('follows the completed PRs of the user for their merge runs', () => {
    const tracker = new RunsTracker();
    expect(tracker.follow([{ id: 1, title: 'A', sourceRefName: 'refs/heads/a' }])).toBe(true);
    expect(tracker.follow([{ id: 1, title: 'A' }], [{ id: 5, title: 'Merged' }])).toBe(true);
    expect(tracker.extraIds).toEqual([1]);
    expect(tracker.ownIds).toEqual([1, 5]);
    expect(tracker.titleOf(5)).toBe('Merged');
  });

  it('reports the manual and merge runs that finished, and keeps them when they could not be fetched', async () => {
    const tracker = new RunsTracker();
    const branch = (state: RunModel['state']) => ({ branch: 'exp/x', run: run(30, state) });
    const merge = (state: RunModel['state']) => ({ pullRequestId: 5, targetBranch: 'develop', run: run(40, state) });
    await tracker.refresh([], () => snapshot([], { branchRuns: [branch('running')], mergeRuns: [merge('queued')] }));
    // Not fetched this time: kept
    await tracker.refresh([], () => snapshot([]));
    expect(tracker.branchRuns).toEqual([branch('running')]);
    expect(tracker.mergeRuns).toEqual([merge('queued')]);
    const finished = await tracker.refresh([], () =>
      snapshot([], { branchRuns: [branch('failed')], mergeRuns: [merge('succeeded')] })
    );
    expect(finished).toEqual([
      { kind: 'merge', ...merge('succeeded') },
      { kind: 'branch', ...branch('failed') },
    ]);
  });
});

describe('RunsPoller with a fake builds API', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps checking when idle, speeds up for a new run and reports it once when it finishes', async () => {
    const tracker = new RunsTracker();
    let builds: RunModel[] = [run(1, 'succeeded')];
    const api = vi.fn(() => snapshot([[7, builds]]));
    const onFinished = vi.fn(() => Promise.resolve());
    const poller = new RunsPoller({
      settings: () => ({ fastSeconds: 15, idleSeconds: 60 }),
      hasActive: () => [...tracker.runs.values()].flat().some((r) => r.state === 'running' || r.state === 'queued'),
      refresh: () => tracker.refresh([7], api),
      onFinished,
    });

    await poller.tick();
    expect(api).toHaveBeenCalledTimes(1);

    // Everything finished: idle tick still calls the API, not before 60 s
    await vi.advanceTimersByTimeAsync(59_000);
    expect(api).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api).toHaveBeenCalledTimes(2);

    // A new run appears: the next idle tick finds it, then the fast interval is used
    builds = [run(2, 'running')];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api).toHaveBeenCalledTimes(5);
    expect(onFinished).not.toHaveBeenCalled();

    // The run finishes: reported once
    builds = [run(2, 'succeeded')];
    await vi.advanceTimersByTimeAsync(15_000);
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledWith([{ kind: 'pullRequest', pullRequestId: 7, run: run(2, 'succeeded') }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onFinished).toHaveBeenCalledTimes(1);

    poller.dispose();
    const calls = api.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(api).toHaveBeenCalledTimes(calls);
  });

  it('does not schedule when idle checks are disabled', async () => {
    const refresh = vi.fn(() => Promise.resolve([]));
    const poller = new RunsPoller({
      settings: () => ({ fastSeconds: 15, idleSeconds: 0 }),
      hasActive: () => false,
      refresh,
      onFinished: () => Promise.resolve(),
    });
    poller.schedule();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(refresh).not.toHaveBeenCalled();
    poller.dispose();
  });
});
