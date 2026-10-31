/**
 * The PRs merged into the base branch, read from its commits (Rule TIMELINE-38). Since 2026-10-22 the develop pipeline
 * runs as batched CI: a run no longer carries the "Merged PR n: …" message of the merge that queued it, so the runs
 * cannot say which PR was merged when. The squash merge commits do. No "vscode" import
 */

/** What is used of a commit of `git/repositories/{id}/commits` */
export interface BranchCommit {
  commitId: string;
  /** First line "Merged PR 14002: [67560] …" (the API truncates it) */
  comment?: string;
  committer?: { date?: string };
  author?: { date?: string };
}

/** A PR merged into the base branch, with the squash commit that merged it */
export interface BaseMerge {
  pullRequestId: number;
  /** Committer date (ISO) of the merge commit */
  at: string;
  commit: string;
}

const MERGED_PULL_REQUEST = /^Merged PR (\d+):/;

/** PR number of a squash merge commit message ("Merged PR 14002: …"); undefined for any other commit */
export function mergedPullRequestOfMessage(message: string | undefined): number | undefined {
  const match = MERGED_PULL_REQUEST.exec(message ?? '');
  return match ? Number(match[1]) : undefined;
}

/** The merges among the commits, in the order given (the API lists the newest first) */
export function mergesOfCommits(commits: readonly BranchCommit[]): BaseMerge[] {
  return commits.flatMap((commit) => {
    const pullRequestId = mergedPullRequestOfMessage(commit.comment);
    const at = commit.committer?.date ?? commit.author?.date;
    return pullRequestId !== undefined && at !== undefined && !Number.isNaN(Date.parse(at))
      ? [{ pullRequestId, at, commit: commit.commitId }]
      : [];
  });
}

/**
 * The merges between two heads of the branch: after `previous` (exclusive) up to `head` (inclusive), newest first.
 * `merges` is newest first. Undefined when either head is not among them (the range cannot be told); empty when both
 * are the same commit
 */
export function mergesBetween(
  merges: readonly BaseMerge[],
  previous: string,
  head: string
): readonly BaseMerge[] | undefined {
  const newer = merges.findIndex((merge) => merge.commit === head);
  const older = merges.findIndex((merge) => merge.commit === previous);
  return newer < 0 || older < 0 || newer > older ? undefined : merges.slice(newer, older);
}
