/**
 * The PRs that were merged, as the Sprint timeline draws them (Rule TIMELINE-17): the list My Pull Requests already
 * reads, or the closed PRs of the whole-team snapshot. Pure, so no "vscode" import
 */
import type { AuthoredPullRequest } from './myPullRequests';
import { publicationDate, pullRequestStamps } from './pullRequestTimeline';
import type { ThreadResponse } from './reviewThreads';

/** A PR of the user that was merged: what the timeline needs to draw it, from the list My Pull Requests already reads */
export interface CompletedPullRequestInfo {
  id: number;
  title: string;
  repository: string;
  repositoryId: string;
  creationDate: string;
  closedDate: string;
  isDraft: boolean;
  /** When it left draft for the last time (from its threads); undefined: it was never a draft, or `threadsKnown` is false */
  publishedAt?: string;
  /** Latest vote of any kind (from its threads): the PR was ready to be merged from then (Rule TIMELINE-16) */
  lastVoteAt?: string;
  /** The threads of the PR are known, so `publishedAt` and `lastVoteAt` are reliable */
  threadsKnown: boolean;
}

// Rule TIMELINE-17
/** The completed PRs of the list (with the threads that are known) in the shape the timeline draws; no request */
export function completedPullRequestInfos(
  list: readonly { pr: AuthoredPullRequest; threads?: ThreadResponse[] }[]
): CompletedPullRequestInfo[] {
  return list.flatMap(({ pr, threads }) =>
    pr.status === 'completed' && pr.closedDate
      ? [
          {
            id: pr.pullRequestId,
            title: pr.title,
            repository: pr.repository.name,
            repositoryId: pr.repository.id,
            creationDate: pr.creationDate,
            closedDate: pr.closedDate,
            isDraft: false,
            publishedAt: threads ? publicationDate(threads) : undefined,
            lastVoteAt: threads ? pullRequestStamps(pr, threads).lastVoteAt : undefined,
            threadsKnown: threads !== undefined,
          },
        ]
      : []
  );
}

/** Merged within the axis (from the start of its first day to the end of its last): the only ones that are drawn */
export function mergedInRange(pr: Pick<CompletedPullRequestInfo, 'closedDate'>, from: number, to: number): boolean {
  const closed = Date.parse(pr.closedDate);
  return !Number.isNaN(closed) && closed >= from && closed < to;
}
