import { describe, expect, it } from 'vitest';
import {
  HISTORY_RETRY_MS,
  historyKey,
  historyToLoad,
  historyViews,
  RUNS_REFRESH_MS,
  runsFinished,
  stateSignature,
  type HistoryContext,
  type HistoryEntry,
  type HistoryRef,
} from './prHistoryCache';

const ref = (id: number, overrides: Partial<HistoryRef> = {}): HistoryRef => ({
  id,
  repositoryId: 'repo',
  closed: false,
  commit: 'c1',
  state: 'Ana:none',
  ...overrides,
});

const context = (overrides: Partial<HistoryContext> = {}): HistoryContext => ({
  now: 1_000_000,
  knownThreads: new Set(),
  inFlight: new Set(),
  failed: new Map(),
  ...overrides,
});

const entry = (overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  threads: [],
  threadsKey: 'c1|Ana:none',
  runs: [],
  runsKey: 'c1|Ana:none',
  runsFinal: true,
  runsAt: 0,
  ...overrides,
});

describe('keys of the history of a PR (TIMELINE-29)', () => {
  it('is one key for good for a closed PR, and the commit and the votes for an open one', () => {
    expect(historyKey(ref(1, { closed: true, commit: 'x' }))).toBe('closed');
    expect(historyKey(ref(1))).toBe('c1|Ana:none');
    expect(historyKey(ref(1, { state: 'Ana:approved' }))).not.toBe(historyKey(ref(1)));
  });

  it('puts the votes and the draft flag in a signature', () => {
    expect(
      stateSignature(
        [
          { name: 'Ana', vote: 'approved' },
          { name: 'Jonas', vote: 'none' },
        ],
        true
      )
    ).toBe('Ana:approved;Jonas:none;draft');
  });
});

describe('what is asked when a row is expanded (TIMELINE-29)', () => {
  it('asks the threads and the runs of a PR never read', () => {
    const wanted = historyToLoad([ref(1), ref(2)], new Map(), context());
    expect(wanted.threads.map((r) => r.id)).toEqual([1, 2]);
    expect(wanted.runs.map((r) => r.id)).toEqual([1, 2]);
  });

  it('asks nothing for a PR already read, nor twice for the same PR in the list', () => {
    expect(historyToLoad([ref(1)], new Map([[1, entry()]]), context())).toEqual({ threads: [], runs: [] });
    expect(historyToLoad([ref(1), ref(1)], new Map(), context()).runs).toHaveLength(1);
  });

  it('does not ask the threads that My Pull Requests already has, only the runs', () => {
    const wanted = historyToLoad([ref(1)], new Map(), context({ knownThreads: new Set([1]) }));
    expect(wanted.threads).toEqual([]);
    expect(wanted.runs.map((r) => r.id)).toEqual([1]);
  });

  it('never reads a closed PR again', () => {
    const closed = ref(1, { closed: true, commit: 'other' });
    expect(
      historyToLoad([closed], new Map([[1, entry({ threadsKey: 'closed', runsKey: 'closed' })]]), context())
    ).toEqual({
      threads: [],
      runs: [],
    });
  });

  it('reads an open PR again after a push or a vote, because its key changed', () => {
    const cache = new Map([[1, entry()]]);
    expect(historyToLoad([ref(1, { commit: 'c2' })], cache, context())).toEqual({
      threads: [expect.objectContaining({ id: 1 })],
      runs: [expect.objectContaining({ id: 1 })],
    });
    expect(historyToLoad([ref(1, { state: 'Ana:approved' })], cache, context()).threads).toHaveLength(1);
  });

  it('reads the runs again while one is not finished, at most once a minute', () => {
    const cache = new Map([[1, entry({ runsFinal: false, runsAt: 1_000_000 - RUNS_REFRESH_MS + 1 })]]);
    expect(historyToLoad([ref(1)], cache, context()).runs).toEqual([]);
    const later = new Map([[1, entry({ runsFinal: false, runsAt: 1_000_000 - RUNS_REFRESH_MS })]]);
    expect(historyToLoad([ref(1)], later, context()).runs).toHaveLength(1);
    expect(historyToLoad([ref(1)], later, context()).threads).toEqual([]);
  });

  it('does not ask what is being read, nor what failed less than ten minutes ago', () => {
    const wanted = historyToLoad(
      [ref(1), ref(2)],
      new Map(),
      context({
        inFlight: new Set(['threads:1', 'runs:1']),
        failed: new Map([['runs:2', 1_000_000 - HISTORY_RETRY_MS + 1]]),
      })
    );
    expect(wanted.threads.map((r) => r.id)).toEqual([2]);
    expect(wanted.runs).toEqual([]);
    const retry = historyToLoad(
      [ref(2)],
      new Map(),
      context({ failed: new Map([['runs:2', 1_000_000 - HISTORY_RETRY_MS]]) })
    );
    expect(retry.runs.map((r) => r.id)).toEqual([2]);
  });

  it('cannot read the threads of a PR without its repository, but reads its runs', () => {
    const wanted = historyToLoad([ref(1, { repositoryId: undefined })], new Map(), context());
    expect(wanted.threads).toEqual([]);
    expect(wanted.runs).toHaveLength(1);
  });

  it('says whether the runs are all finished', () => {
    expect(runsFinished([{ state: 'succeeded' }, { state: 'failed' }])).toBe(true);
    expect(runsFinished([{ state: 'succeeded' }, { state: 'running' }])).toBe(false);
    expect(runsFinished([])).toBe(true);
  });
});

describe('what the rows are told of the history (TIMELINE-28)', () => {
  const threads = [{ id: 1, publishedDate: '2026-10-20T10:00:00Z' }];
  const known = new Map([[1, threads]]);
  const noContext = { knownThreads: new Map(), inFlight: new Set<string>(), failed: new Map<string, number>() };

  it('gives the threads another reader has, idle: nothing was asked', () => {
    expect(historyViews(new Map(), { ...noContext, knownThreads: known }).get(1)).toEqual({ state: 'idle', threads });
  });

  it('says ready with what was read, keeping the known threads when none were asked', () => {
    const views = historyViews(new Map([[1, entry({ threads: undefined })]]), { ...noContext, knownThreads: known });
    expect(views.get(1)).toEqual({ state: 'ready', threads, runs: [] });
  });

  it('says loading while something is being read, even when something was read before', () => {
    const views = historyViews(new Map([[1, entry()]]), { ...noContext, inFlight: new Set(['runs:1']) });
    expect(views.get(1)?.state).toBe('loading');
    expect(historyViews(new Map(), { ...noContext, inFlight: new Set(['threads:2']) }).get(2)).toEqual({
      state: 'loading',
    });
  });

  it('says error for a read that failed and left nothing, and not for one that has its runs', () => {
    const failed = new Map([['runs:1', 0]]);
    expect(historyViews(new Map(), { ...noContext, failed }).get(1)).toEqual({ state: 'error' });
    expect(historyViews(new Map([[1, entry()]]), { ...noContext, failed }).get(1)?.state).toBe('ready');
  });
});
