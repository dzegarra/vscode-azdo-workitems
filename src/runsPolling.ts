/**
 * Decides when the CI runs are reloaded and keeps what is needed to tell which runs finished.
 * No "vscode" import
 */
import { BranchRun, finishedRuns, MergeRun, RunModel } from './pipelines';

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

/** A run that finished since the previous reload, with what it validated */
export type FinishedRun =
  | { kind: 'pullRequest'; pullRequestId: number; run: RunModel }
  | { kind: 'merge'; pullRequestId: number; targetBranch: string; run: RunModel }
  | { kind: 'branch'; branch: string; run: RunModel };

/** A PR followed besides the ones linked to the work items (the user's own) */
export interface FollowedPullRequest {
  id: number;
  title: string;
  /** E.g. "refs/heads/feature/x" */
  sourceRefName?: string;
  webUrl?: string;
}

/** What one reload fetched. The manual and merge runs are undefined when they could not be fetched */
export interface RunsSnapshot {
  pullRequests: Map<number, RunModel[]>;
  branchRuns?: BranchRun[];
  mergeRuns?: MergeRun[];
}

function keysChanged(next: Map<number, unknown>, previous: Map<number, unknown>): boolean {
  return next.size !== previous.size || [...next.keys()].some((id) => !previous.has(id));
}

/** The last runs of the followed PRs. A refresh in progress makes the next one return undefined (skipped) */
export class RunsTracker {
  runs = new Map<number, RunModel[]>();
  /** Runs queued by hand on a branch, without a PR */
  branchRuns: BranchRun[] = [];
  /** Runs queued by the merge of one of the user's PRs */
  mergeRuns: MergeRun[] = [];
  /** PRs followed besides the ones linked to the work items */
  private extra = new Map<number, FollowedPullRequest>();
  /** Completed PRs of the user, whose merge runs are shown */
  private completed = new Map<number, FollowedPullRequest>();
  private busy = false;

  get extraIds(): number[] {
    return [...this.extra.keys()];
  }

  /** The user's PRs, active and completed: the merges whose runs are shown */
  get ownIds(): number[] {
    return [...new Set([...this.extra.keys(), ...this.completed.keys()])];
  }

  titleOf(pullRequestId: number): string | undefined {
    return this.pullRequestOf(pullRequestId)?.title;
  }

  pullRequestOf(pullRequestId: number): FollowedPullRequest | undefined {
    return this.extra.get(pullRequestId) ?? this.completed.get(pullRequestId);
  }

  /** Replaces the registered PRs (active ones, and completed ones for their merge runs). True when the ids changed */
  follow(pullRequests: FollowedPullRequest[], completed: FollowedPullRequest[] = []): boolean {
    const next = new Map(pullRequests.map((pr) => [pr.id, pr]));
    const nextCompleted = new Map(completed.map((pr) => [pr.id, pr]));
    const changed = keysChanged(next, this.extra) || keysChanged(nextCompleted, this.completed);
    this.extra = next;
    this.completed = nextCompleted;
    return changed;
  }

  /** Reloads the runs and returns the ones that finished since the previous reload */
  async refresh(ids: number[], fetch: (ids: number[]) => Promise<RunsSnapshot>): Promise<FinishedRun[] | undefined> {
    if (this.busy) {
      return undefined;
    }
    this.busy = true;
    try {
      const previous = new Map(
        [
          ...[...this.runs.values()].flat(),
          ...this.branchRuns.map(({ run }) => run),
          ...this.mergeRuns.map(({ run }) => run),
        ].map((run) => [run.id, run.state])
      );
      const snapshot = await fetch(ids);
      const runs = snapshot.pullRequests;
      // A PR whose runs could not be fetched this time keeps its last known runs: they do not vanish from the
      // views, and a run that finishes during the outage is still detected on the next successful tick
      for (const id of ids) {
        const known = this.runs.get(id);
        if (!runs.has(id) && known) {
          runs.set(id, known);
        }
      }
      this.runs = runs;
      this.branchRuns = snapshot.branchRuns ?? this.branchRuns;
      this.mergeRuns = snapshot.mergeRuns ?? this.mergeRuns;
      const finished = (run: RunModel) => finishedRuns(previous, [run]).length > 0;
      return [
        ...[...runs].flatMap(([pullRequestId, prRuns]) =>
          finishedRuns(previous, prRuns).map((run): FinishedRun => ({ kind: 'pullRequest', pullRequestId, run }))
        ),
        ...this.mergeRuns.filter(({ run }) => finished(run)).map((entry): FinishedRun => ({ kind: 'merge', ...entry })),
        ...this.branchRuns
          .filter(({ run }) => finished(run))
          .map((entry): FinishedRun => ({ kind: 'branch', ...entry })),
      ];
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
