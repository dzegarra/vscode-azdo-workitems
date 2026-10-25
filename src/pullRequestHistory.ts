import { resolveContext } from './config';
import { mapLimit, MAX_IN_FLIGHT } from './concurrency';
import { toRunModel } from './pipelines';
import {
  historyKey,
  historyToLoad,
  historyViews,
  runsFinished,
  type HistoryEntry,
  type HistoryRef,
  type HistoryView,
} from './prHistoryCache';
import { withFeature } from './requestContext';
import type { ThreadResponse } from './reviewThreads';
import type { WorkItemsStore } from './workItemsStore';

/**
 * The history of the PRs of the expanded rows of the Sprint timeline (Rule TIMELINE-29): their threads and the whole
 * history of their CI runs, read when a row is expanded and kept. A PR whose threads My Pull Requests already has costs
 * one request (its runs); the others two. At most six requests are in flight; what is asked again, and when, is decided
 * by `historyToLoad` (src/prHistoryCache.ts)
 */
export class PullRequestHistory {
  private readonly entries = new Map<number, HistoryEntry>();
  private readonly inFlight = new Set<string>();
  private readonly failed = new Map<string, number>();
  /** Requests made so far, for the report of a session */
  requests = 0;

  constructor(
    private readonly store: WorkItemsStore,
    /** The threads another reader has (My Pull Requests), by PR id: no request for them */
    private readonly knownThreads: () => ReadonlyMap<number, ThreadResponse[]>,
    /** Something was read (or failed): the timeline draws again */
    private readonly onChange: () => void
  ) {}

  /** What the model gets: every PR that is being read or was read, and the threads others already have */
  snapshot(): Map<number, HistoryView> {
    return historyViews(this.entries, {
      knownThreads: this.knownThreads(),
      inFlight: this.inFlight,
      failed: this.failed,
    });
  }

  // Rule TIMELINE-29
  /** Starts what the expanded rows need and is not known yet. True when something started: draw the loading state */
  request(refs: readonly HistoryRef[]): boolean {
    const known = this.knownThreads();
    const wanted = historyToLoad(refs, this.entries, {
      now: Date.now(),
      knownThreads: new Set(known.keys()),
      inFlight: this.inFlight,
      failed: this.failed,
    });
    if (!wanted.threads.length && !wanted.runs.length) {
      return false;
    }
    wanted.threads.forEach((ref) => this.inFlight.add(`threads:${String(ref.id)}`));
    wanted.runs.forEach((ref) => this.inFlight.add(`runs:${String(ref.id)}`));
    void this.load(wanted.threads, wanted.runs);
    return true;
  }

  private entry(id: number): HistoryEntry {
    const entry = this.entries.get(id) ?? { runsFinal: false, runsAt: 0 };
    this.entries.set(id, entry);
    return entry;
  }

  private load(threads: readonly HistoryRef[], runs: readonly HistoryRef[]): Promise<void> {
    return withFeature('sprintTimeline', async () => {
      try {
        await this.store.whenRepositoryReady();
        const { client } = resolveContext(this.store.repository());
        await mapLimit(
          [
            ...threads.map((ref) => ({ ref, kind: 'threads' as const })),
            ...runs.map((ref) => ({ ref, kind: 'runs' as const })),
          ],
          MAX_IN_FLIGHT,
          async ({ ref, kind }) => {
            const name = `${kind}:${String(ref.id)}`;
            try {
              this.requests += 1;
              if (kind === 'threads') {
                const read = await client.getPullRequestThreads(ref.repositoryId ?? '', ref.id);
                Object.assign(this.entry(ref.id), { threads: read, threadsKey: historyKey(ref) });
              } else {
                const read = (await client.getPullRequestBuildHistory(ref.id)).map(toRunModel);
                Object.assign(this.entry(ref.id), {
                  runs: read,
                  runsKey: historyKey(ref),
                  runsFinal: runsFinished(read),
                  runsAt: Date.now(),
                });
              }
              this.failed.delete(name);
            } catch {
              this.failed.set(name, Date.now());
            } finally {
              this.inFlight.delete(name);
            }
          }
        );
      } catch {
        // The repository could not be resolved: nothing was asked; every wanted read counts as failed
        [...threads.map((ref) => `threads:${String(ref.id)}`), ...runs.map((ref) => `runs:${String(ref.id)}`)].forEach(
          (name) => {
            this.inFlight.delete(name);
            this.failed.set(name, Date.now());
          }
        );
      }
      this.onChange();
    });
  }
}
