/**
 * Decides when the CI runs are reloaded and keeps what is needed to tell which runs finished.
 * No "vscode" import
 */
import { finishedRuns, RunModel } from './pipelines';

export interface PollSettings {
  hasActive: boolean;
  fastSeconds: number;
  /** 0 disables the discovery checks */
  idleSeconds: number;
}

/** Seconds until the next reload: fast while a run is queued or running, idle otherwise; undefined: no checks */
export function nextRunsPollDelay({ hasActive, fastSeconds, idleSeconds }: PollSettings): number | undefined {
  if (hasActive) {
    return fastSeconds;
  }
  return idleSeconds > 0 ? idleSeconds : undefined;
}

/** PR ids to follow: the ones linked to the work items plus the registered ones, without repeating */
export function followedPullRequestIds(linked: number[], extra: Iterable<number>): number[] {
  return [...new Set([...linked, ...extra])];
}

export interface FinishedRun {
  pullRequestId: number;
  run: RunModel;
}

/** The last runs of the followed PRs. A refresh in progress makes the next one return undefined (skipped) */
export class RunsTracker {
  runs = new Map<number, RunModel[]>();
  /** PRs followed besides the ones linked to the work items, with their title */
  private extra = new Map<number, string>();
  private busy = false;

  get extraIds(): number[] {
    return [...this.extra.keys()];
  }

  titleOf(pullRequestId: number): string | undefined {
    return this.extra.get(pullRequestId);
  }

  /** Replaces the registered PRs. True when the set of ids changed */
  follow(pullRequests: { id: number; title: string }[]): boolean {
    const next = new Map(pullRequests.map(({ id, title }) => [id, title]));
    const changed = next.size !== this.extra.size || [...next.keys()].some((id) => !this.extra.has(id));
    this.extra = next;
    return changed;
  }

  /** Reloads the runs of the PRs and returns the ones that finished since the previous reload */
  async refresh(
    ids: number[],
    fetch: (ids: number[]) => Promise<Map<number, RunModel[]>>
  ): Promise<FinishedRun[] | undefined> {
    if (this.busy) {
      return undefined;
    }
    this.busy = true;
    try {
      const previous = new Map([...this.runs.values()].flat().map((run) => [run.id, run.state]));
      const runs = await fetch(ids);
      // A PR whose runs could not be fetched this time keeps its last known runs: they do not vanish from the
      // views, and a run that finishes during the outage is still detected on the next successful tick
      for (const id of ids) {
        const known = this.runs.get(id);
        if (!runs.has(id) && known) {
          runs.set(id, known);
        }
      }
      this.runs = runs;
      return [...runs].flatMap(([pullRequestId, prRuns]) =>
        finishedRuns(previous, prRuns).map((run) => ({ pullRequestId, run }))
      );
    } finally {
      this.busy = false;
    }
  }
}

export interface RunsPollerDeps {
  settings(): { fastSeconds: number; idleSeconds: number };
  hasActive(): boolean;
  /** Reloads the runs; undefined when skipped */
  refresh(): Promise<FinishedRun[] | undefined>;
  onFinished(finished: FinishedRun[]): Promise<void>;
}

const MS_PER_SECOND = 1000;

/** Fast ticks while runs are active, idle ticks to discover new runs otherwise. Never overlaps */
export class RunsPoller {
  private timer?: NodeJS.Timeout;
  private ticking = false;
  private disposed = false;

  constructor(private readonly deps: RunsPollerDeps) {}

  schedule(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.disposed || this.ticking) {
      return;
    }
    const seconds = nextRunsPollDelay({ hasActive: this.deps.hasActive(), ...this.deps.settings() });
    if (seconds !== undefined) {
      this.timer = setTimeout(() => void this.tick(), seconds * MS_PER_SECOND);
    }
  }

  /** Reloads now, e.g. because new PRs are followed */
  async tick(): Promise<void> {
    if (this.ticking || this.disposed) {
      return;
    }
    clearTimeout(this.timer);
    this.ticking = true;
    try {
      const finished = await this.deps.refresh();
      if (finished?.length) {
        await this.deps.onFinished(finished);
      }
    } catch {
      // Network hiccups: try again on the next tick
    } finally {
      this.ticking = false;
    }
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
  }
}
