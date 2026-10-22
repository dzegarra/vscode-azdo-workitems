/**
 * Personal journal of the "fun" features: what the extension saw happen to the user's work (CI runs, merged and
 * opened PRs, reviews, first approvals). Kept in the global state, so several windows write to it: every recorder is
 * idempotent and returns the same object when nothing changed. Pure, so no "vscode" import
 */
import type { RunState } from './pipelines';
import type { PullRequestEvent } from './pullRequestEvents';

/** A finished CI run of the user: ok when it succeeded */
export interface JournalRun {
  id: number;
  ok: boolean;
  /** When it finished (ISO) */
  at: string;
}

export interface JournalMerge {
  id: number;
  title: string;
  /** When the PR left draft (or was created) */
  publishedAt?: string;
  mergedAt: string;
}

/** A PR opened by the user, or a PR of someone else the user voted on */
export interface JournalEntry {
  id: number;
  at: string;
}

/** The first approval of one of the user's PRs */
export interface JournalApproval {
  pullRequestId: number;
  by: string;
  /** Minutes from publication to the approval; undefined when the publication date was unknown */
  minutes?: number;
  at: string;
}

export interface FunJournal {
  runs: JournalRun[];
  merged: JournalMerge[];
  opened: JournalEntry[];
  reviewed: JournalEntry[];
  approvals: JournalApproval[];
  /** Iteration paths whose recap was already offered */
  recapOffered: string[];
}

export const EMPTY_JOURNAL: FunJournal = {
  runs: [],
  merged: [],
  opened: [],
  reviewed: [],
  approvals: [],
  recapOffered: [],
};

/** Entries kept per list: far more than a sprint needs, small enough for the global state */
export const MAX_JOURNAL_ENTRIES = 500;
const MAX_RECAPS = 20;

/** Lists missing from a stored journal (an older version, or a broken value) are empty */
export function normalizeJournal(stored: Partial<FunJournal> | undefined): FunJournal {
  return {
    runs: Array.isArray(stored?.runs) ? stored.runs : [],
    merged: Array.isArray(stored?.merged) ? stored.merged : [],
    opened: Array.isArray(stored?.opened) ? stored.opened : [],
    reviewed: Array.isArray(stored?.reviewed) ? stored.reviewed : [],
    approvals: Array.isArray(stored?.approvals) ? stored.approvals : [],
    recapOffered: Array.isArray(stored?.recapOffered) ? stored.recapOffered : [],
  };
}

function append<T>(list: T[], added: T[], max = MAX_JOURNAL_ENTRIES): T[] {
  return [...list, ...added].slice(-max);
}

// Rules FUN-RUN-1..3
/**
 * Records finished runs. Queued / running ones and canceled ones are left out (a cancel says nothing about the
 * code). A run already known keeps its place; its outcome is replaced when it changed (a re-run of the failed jobs
 * of a build keeps the build id)
 */
export function recordRuns(
  journal: FunJournal,
  runs: { id: number; state: RunState; finishTime?: string }[],
  now: Date
): FunJournal {
  let changed = false;
  let list = journal.runs;
  const added: JournalRun[] = [];
  for (const run of runs) {
    if (run.state === 'queued' || run.state === 'running' || run.state === 'canceled') {
      continue;
    }
    const ok = run.state === 'succeeded';
    const index = list.findIndex((entry) => entry.id === run.id);
    if (index >= 0) {
      if (list[index].ok !== ok) {
        list = list.map((entry, i) => (i === index ? { ...entry, ok } : entry));
        changed = true;
      }
    } else if (!added.some((entry) => entry.id === run.id)) {
      added.push({ id: run.id, ok, at: run.finishTime ?? now.toISOString() });
    }
  }
  if (!changed && !added.length) {
    return journal;
  }
  return { ...journal, runs: append(list, added) };
}

/** Records a merged PR once */
export function recordMerge(journal: FunJournal, merge: JournalMerge): FunJournal {
  return journal.merged.some((entry) => entry.id === merge.id)
    ? journal
    : { ...journal, merged: append(journal.merged, [merge]) };
}

function recordEntries(list: JournalEntry[], entries: JournalEntry[]): JournalEntry[] | undefined {
  const known = new Set(list.map((entry) => entry.id));
  const added = entries.filter((entry) => {
    if (known.has(entry.id)) {
      return false;
    }
    known.add(entry.id);
    return true;
  });
  return added.length ? append(list, added) : undefined;
}

/** Records the PRs the user opened (at: their creation), once each */
export function recordOpened(journal: FunJournal, entries: JournalEntry[]): FunJournal {
  const opened = recordEntries(journal.opened, entries);
  return opened ? { ...journal, opened } : journal;
}

/** Records the PRs of others the user voted on (at: when it was first seen), once each */
export function recordReviewed(journal: FunJournal, entries: JournalEntry[]): FunJournal {
  const reviewed = recordEntries(journal.reviewed, entries);
  return reviewed ? { ...journal, reviewed } : journal;
}

/** Records the first approval of a PR; later approvals of the same PR change nothing */
export function recordApproval(journal: FunJournal, approval: JournalApproval): FunJournal {
  return journal.approvals.some((entry) => entry.pullRequestId === approval.pullRequestId)
    ? journal
    : { ...journal, approvals: append(journal.approvals, [approval]) };
}

export function hasApproval(journal: FunJournal, pullRequestId: number): boolean {
  return journal.approvals.some((entry) => entry.pullRequestId === pullRequestId);
}

export function markRecapOffered(journal: FunJournal, iterationPath: string): FunJournal {
  return journal.recapOffered.includes(iterationPath)
    ? journal
    : { ...journal, recapOffered: append(journal.recapOffered, [iterationPath], MAX_RECAPS) };
}

/** Whole minutes between two ISO dates; undefined when one cannot be read or the order is wrong */
export function minutesBetween(from: string | undefined, to: string): number | undefined {
  const start = Date.parse(from ?? '');
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return undefined;
  }
  return Math.floor((end - start) / 60_000);
}

/** Votes that approve a PR */
const APPROVING_VOTES = [5, 10];

// Rules FUN-APPROVAL-2, FUN-MERGE-2
/**
 * Records what the events of the user's PRs tell: the merges, and the first approval of each PR. Returns the journal
 * and, per PR whose first approval it recorded now, the minutes since its publication
 */
export function recordPullRequestEvents(
  journal: FunJournal,
  events: PullRequestEvent[],
  now: Date
): { journal: FunJournal; firstApprovals: Map<number, number | undefined> } {
  const firstApprovals = new Map<number, number | undefined>();
  const at = now.toISOString();
  let next = journal;
  for (const event of events) {
    const { pullRequest } = event;
    if (event.kind === 'merged') {
      next = recordMerge(next, {
        id: pullRequest.id,
        title: pullRequest.title,
        publishedAt: pullRequest.publishedAt,
        mergedAt: pullRequest.closedAt ?? at,
      });
    } else if (
      event.kind === 'vote' &&
      APPROVING_VOTES.includes(event.reviewer.vote) &&
      !hasApproval(next, pullRequest.id)
    ) {
      const minutes = minutesBetween(pullRequest.publishedAt, at);
      next = recordApproval(next, { pullRequestId: pullRequest.id, by: event.reviewer.name, minutes, at });
      firstApprovals.set(pullRequest.id, minutes);
    }
  }
  return { journal: next, firstApprovals };
}
