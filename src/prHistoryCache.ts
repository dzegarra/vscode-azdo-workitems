/**
 * What the Sprint timeline asks Azure DevOps about a PR when its work item row is expanded (Rule TIMELINE-29): the
 * threads (votes, pushes, reviewers, comments) and the whole history of its CI runs. Which PRs are asked, and when
 * again, is decided here from immutable keys, so a redraw never asks twice. Pure, so no "vscode" import
 */
import type { RunModel } from './pipelines';
import type { ThreadResponse } from './reviewThreads';

/** A PR whose history may be wanted, with the facts the keys are made of */
export interface HistoryRef {
  id: number;
  /** Undefined: the threads cannot be read (the PR was not listed with its repository) */
  repositoryId?: string;
  /** Merged or abandoned: its history does not change any more */
  closed: boolean;
  /** `lastMergeSourceCommit`: a push changes it */
  commit?: string;
  /** The votes and the draft flag of the listing ("Ana:10;Jonas:-5;draft"): a vote changes it */
  state: string;
}

export interface HistoryEntry {
  threads?: ThreadResponse[];
  /** The key the threads were read for (an open PR is read again when it changes) */
  threadsKey?: string;
  runs?: RunModel[];
  runsKey?: string;
  /** No run is queued or running: an open PR is not read again until its key changes */
  runsFinal: boolean;
  /** When the runs were read */
  runsAt: number;
}

export type HistoryState = 'error' | 'idle' | 'loading' | 'ready';

/** What the model gets of a PR: the history read so far and how it is going */
export interface HistoryView {
  state: HistoryState;
  threads?: readonly ThreadResponse[];
  runs?: readonly RunModel[];
}

/** An open PR's runs are read again at most this often while one of them is not finished */
export const RUNS_REFRESH_MS = 60_000;
/** A read that failed is tried again after this long */
export const HISTORY_RETRY_MS = 10 * 60_000;

// Rule TIMELINE-29
/** The key an open PR's history is read for: its last commit and its votes; a closed PR has one key for good */
export const historyKey = (ref: HistoryRef): string => (ref.closed ? 'closed' : `${ref.commit ?? ''}|${ref.state}`);

/** "Ana:10;Jonas:-5;draft": the part of the listing a vote or a publication changes */
export function stateSignature(reviewers: readonly { name: string; vote: string }[], isDraft: boolean): string {
  return `${reviewers.map((reviewer) => `${reviewer.name}:${reviewer.vote}`).join(';')}${isDraft ? ';draft' : ''}`;
}

export interface HistoryToLoad {
  threads: HistoryRef[];
  runs: HistoryRef[];
}

export interface HistoryContext {
  now: number;
  /** PRs whose threads another reader already has (My Pull Requests): no request */
  knownThreads: ReadonlySet<number>;
  /** "threads:123" / "runs:123" being read now, or that failed (the moment it did) */
  inFlight: ReadonlySet<string>;
  failed: ReadonlyMap<string, number>;
}

// Rule TIMELINE-29
/**
 * What to read now for the PRs of the expanded rows. Threads: once for a closed PR, again for an open one when its
 * commit or votes changed, never for a PR whose threads My Pull Requests has. Runs: once for a closed PR; for an open
 * one when its key changed, and while a run is not finished at most once a minute. Nothing already being read, nothing
 * that failed less than ten minutes ago
 */
export function historyToLoad(
  refs: readonly HistoryRef[],
  cache: ReadonlyMap<number, HistoryEntry>,
  context: HistoryContext
): HistoryToLoad {
  const unique = [...new Map(refs.map((ref) => [ref.id, ref])).values()];
  const allowed = (kind: 'runs' | 'threads', id: number): boolean => {
    const name = `${kind}:${String(id)}`;
    const failedAt = context.failed.get(name);
    return !context.inFlight.has(name) && (failedAt === undefined || context.now - failedAt >= HISTORY_RETRY_MS);
  };
  return {
    threads: unique.filter((ref) => {
      if (ref.repositoryId === undefined || context.knownThreads.has(ref.id) || !allowed('threads', ref.id)) {
        return false;
      }
      const entry = cache.get(ref.id);
      return entry?.threads === undefined || (!ref.closed && entry.threadsKey !== historyKey(ref));
    }),
    runs: unique.filter((ref) => {
      if (!allowed('runs', ref.id)) {
        return false;
      }
      const entry = cache.get(ref.id);
      if (entry?.runs === undefined) {
        return true;
      }
      if (ref.closed) {
        return false;
      }
      return entry.runsKey !== historyKey(ref) || (!entry.runsFinal && context.now - entry.runsAt >= RUNS_REFRESH_MS);
    }),
  };
}

/** No run is queued or running (a PR without runs is final too: nothing will come) */
export const runsFinished = (runs: readonly Pick<RunModel, 'state'>[]): boolean =>
  runs.every((run) => run.state !== 'queued' && run.state !== 'running');

/**
 * What the model gets of each PR (Rule TIMELINE-28): the threads another reader has, the history read so far, and how it
 * is going: being read, read, or failed (and nothing to show). Pure, so the class that reads is only a wrapper
 */
export function historyViews(
  entries: ReadonlyMap<number, HistoryEntry>,
  context: {
    knownThreads: ReadonlyMap<number, ThreadResponse[]>;
    inFlight: ReadonlySet<string>;
    failed: ReadonlyMap<string, number>;
  }
): Map<number, HistoryView> {
  const idOf = (name: string): number => Number(name.split(':')[1]);
  const views = new Map<number, HistoryView>();
  for (const [id, threads] of context.knownThreads) {
    views.set(id, { state: 'idle', threads });
  }
  for (const [id, entry] of entries) {
    views.set(id, { state: 'ready', threads: entry.threads ?? views.get(id)?.threads, runs: entry.runs });
  }
  for (const name of context.failed.keys()) {
    const id = idOf(name);
    const view = views.get(id);
    if (view?.runs === undefined) {
      views.set(id, { ...view, state: 'error' });
    }
  }
  for (const name of context.inFlight) {
    const id = idOf(name);
    views.set(id, { ...views.get(id), state: 'loading' });
  }
  return views;
}
