/**
 * When coding starts on the Sprint timeline (Rule TIMELINE-20): the first commit of the PR, the activation of the task
 * linked to the PR, or the earlier of the two, as the user chose. Pure, so no "vscode" import
 */

export const CODING_START_VALUES = ['earliest', 'firstCommit', 'taskActivated'] as const;
export type CodingStartSetting = (typeof CODING_START_VALUES)[number];

export const normalizeCodingStart = (value: unknown): CodingStartSetting =>
  CODING_START_VALUES.find((candidate) => candidate === value) ?? 'earliest';

/** Where the start of the coding span comes from (the tooltip says it) */
export type CodingStartSource = 'firstCommit' | 'task' | 'workItem';

export interface CodingStart {
  at: number;
  source: CodingStartSource;
  /** The task whose activation it is (source `task`) */
  taskId?: number;
  /** The start is a guess (the work item's activation: it says nothing of the PR) */
  approximate: boolean;
}

export interface CodingStartInput {
  setting: CodingStartSetting;
  /** Creation of the PR: coding never starts after it, so a source that is later is ignored */
  prCreated?: number;
  /** Author date of the oldest commit of the PR (not known: not read yet, or the setting does not need it) */
  firstCommit?: number;
  /** The Task linked to the PR, activated at */
  task?: { id: number; activated: number };
  workItemActivated?: number;
}

// Rule TIMELINE-20
/**
 * The start of the coding of a PR. `earliest`: the earlier of the first commit and the task's activation; `firstCommit`
 * and `taskActivated`: that one, else the other. Neither: the activation of the work item, approximate. Undefined: the
 * sprint starts it (approximate, decided by the caller)
 */
export function codingStartOf(input: CodingStartInput): CodingStart | undefined {
  const usable = (at: number | undefined): number | undefined =>
    at !== undefined && (input.prCreated === undefined || at <= input.prCreated) ? at : undefined;
  const commit = usable(input.firstCommit);
  const task = usable(input.task?.activated);
  const fromCommit: CodingStart | undefined =
    commit === undefined ? undefined : { at: commit, source: 'firstCommit', approximate: false };
  const fromTask: CodingStart | undefined =
    task === undefined ? undefined : { at: task, source: 'task', taskId: input.task?.id, approximate: false };
  let chosen: CodingStart | undefined;
  switch (input.setting) {
    case 'firstCommit':
      chosen = fromCommit ?? fromTask;
      break;
    case 'taskActivated':
      chosen = fromTask ?? fromCommit;
      break;
    case 'earliest':
      if (fromCommit && fromTask) {
        chosen = fromTask.at < fromCommit.at ? fromTask : fromCommit;
      } else {
        chosen = fromCommit ?? fromTask;
      }
      break;
  }
  if (chosen) {
    return chosen;
  }
  const workItem = usable(input.workItemActivated);
  return workItem === undefined ? undefined : { at: workItem, source: 'workItem', approximate: true };
}

/** Which PRs are asked for their first commit: only when the setting reads commits (not `taskActivated`) */
export const needsFirstCommit = (setting: CodingStartSetting): boolean => setting !== 'taskActivated';

/** A commit of `pullRequests/{id}/commits` (the fields read) */
export interface CommitRef {
  author?: { date?: string };
  committer?: { date?: string };
}

/** The oldest author date (ISO) of the commits of the pages of `pullRequests/{id}/commits`; the committer date as fallback */
export function oldestCommitDate(commits: readonly CommitRef[]): string | undefined {
  return commits
    .flatMap((commit) => {
      const date = commit.author?.date ?? commit.committer?.date;
      return date && !Number.isNaN(Date.parse(date)) ? [date] : [];
    })
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(0);
}

export interface FirstCommitEntry {
  /** The last merge source commit when it was read: a push asks again (an open PR) */
  commit?: string;
  date: string;
}

export interface FirstCommitCandidate {
  id: number;
  completed: boolean;
  /** `lastMergeSourceCommit` of the PR */
  commit?: string;
}

/**
 * The PRs whose first commit is asked now: not in the cache (a merged PR is cached for good; an open one until its last
 * merge source commit changes), not being read, and not failed within `retryMs`
 */
export function firstCommitsToAsk(
  ids: readonly number[],
  known: readonly FirstCommitCandidate[],
  cache: ReadonlyMap<number, FirstCommitEntry>,
  failed: ReadonlyMap<number, number>,
  now: number,
  retryMs: number
): FirstCommitCandidate[] {
  return [...new Set(ids)].flatMap((id) => {
    const pr = known.find((candidate) => candidate.id === id);
    if (!pr) {
      return [];
    }
    const cached = cache.get(id);
    if (cached && (pr.completed || cached.commit === pr.commit)) {
      return [];
    }
    const failedAt = failed.get(id);
    return failedAt === undefined || now - failedAt >= retryMs ? [pr] : [];
  });
}
