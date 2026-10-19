import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunModel } from './pipelines';
import { followedPullRequestIds, nextRunsPollDelay, RunsPoller, RunsTracker } from './runsPolling';

const run = (id: number, state: RunModel['state']): RunModel => ({
  id,
  pipeline: 'PR',
  state,
  url: `https://build/${id}`,
});

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
    let release: (value: Map<number, RunModel[]>) => void = () => undefined;
    const slow = tracker.refresh([1], () => new Promise((resolve) => (release = resolve)));
    expect(await tracker.refresh([1], () => Promise.resolve(new Map<number, RunModel[]>()))).toBeUndefined();
    release(new Map<number, RunModel[]>());
    expect(await slow).toEqual([]);
  });

  it('keeps the runs of a PR whose fetch failed, and still reports the run finishing after the outage', async () => {
    const tracker = new RunsTracker();
    await tracker.refresh([1, 2], () =>
      Promise.resolve(
        new Map([
          [1, [run(10, 'running')]],
          [2, [run(20, 'running')]],
        ])
      )
    );
    // PR 1 cannot be fetched this time: its running run stays
    await tracker.refresh([1, 2], () => Promise.resolve(new Map([[2, [run(20, 'running')]]])));
    expect(tracker.runs.get(1)).toEqual([run(10, 'running')]);
    const finished = await tracker.refresh([1, 2], () =>
      Promise.resolve(
        new Map([
          [1, [run(10, 'succeeded')]],
          [2, [run(20, 'running')]],
        ])
      )
    );
    expect(finished).toEqual([{ pullRequestId: 1, run: run(10, 'succeeded') }]);
    // A PR no longer followed is dropped
    await tracker.refresh([2], () => Promise.resolve(new Map<number, RunModel[]>()));
    expect([...tracker.runs.keys()]).toEqual([2]);
  });
});

describe('RunsPoller with a fake builds API', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps checking when idle, speeds up for a new run and reports it once when it finishes', async () => {
    const tracker = new RunsTracker();
    let builds: RunModel[] = [run(1, 'succeeded')];
    const api = vi.fn(() => Promise.resolve(new Map([[7, builds]])));
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
    expect(onFinished).toHaveBeenCalledWith([{ pullRequestId: 7, run: run(2, 'succeeded') }]);
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
