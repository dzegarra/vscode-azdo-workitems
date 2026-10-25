/**
 * The groups of the Sprint timeline: a work item with several PRs drawn (open ones and merged ones) becomes one group
 * (the work item row with its PRs and tasks under it). Pure and per work item, so the "Whole team" view can reuse it for
 * the cards of each person. No "vscode" import
 */
import type { AuthoredPullRequest } from './myPullRequests';
import { publicationDate, pullRequestStamps } from './pullRequestTimeline';
import type { ThreadResponse } from './reviewThreads';
import { isFinishedState } from './states';
import { openPullRequests } from './track';
import type { BoardWorkCard } from './trackBoardModel';
import type { WorkItemModel } from './viewModel';

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
  /** Latest vote of any kind (from its threads): the PR was ready to be merged from then (Rule TIMELINE-7) */
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

// Rule TIMELINE-17
/**
 * Which of the merged PRs drawn without their threads are asked now: each one is asked once (a completed PR does not
 * change); one whose request failed is asked again only after `retryMs`
 */
export function mergedThreadsToAsk(
  ids: readonly number[],
  completed: readonly CompletedPullRequestInfo[],
  failed: ReadonlyMap<number, number>,
  now: number,
  retryMs: number
): CompletedPullRequestInfo[] {
  return [...new Set(ids)].flatMap((id) => {
    const pr = completed.find((candidate) => candidate.id === id);
    const failedAt = failed.get(id);
    return pr && !pr.threadsKnown && (failedAt === undefined || now - failedAt >= retryMs) ? [pr] : [];
  });
}

/** What the timeline draws for a work item that becomes a group */
export interface GroupPlan {
  item: WorkItemModel;
  /** The board cards that are rows of the group, in board order */
  cards: BoardWorkCard[];
  /** The merged PRs drawn (merged within the axis), oldest creation first */
  merged: CompletedPullRequestInfo[];
  /** All the merged PRs of the work item, also those merged before the sprint (they are only counted) */
  mergedTotal: number;
  /** PRs open now */
  openCount: number;
}

export interface GroupInput {
  /** The cards of the board, in order (one person's cards: the whole team view calls this once per person) */
  cards: readonly BoardWorkCard[];
  workItems: readonly WorkItemModel[];
  completed: readonly CompletedPullRequestInfo[];
  /** The axis: start of its first day, end of its last day */
  from: number;
  to: number;
  /** Rule TIMELINE-19: false, the merged PRs are only counted: no row, and no group that only they made */
  showCompleted?: boolean;
}

// Rules TIMELINE-16, TIMELINE-19
/**
 * The work items that become a group: 2+ PRs drawn (open ones and merged within the axis), or at least one PR merged
 * within the axis while the work item is not finished (the board sends it back to To start / Branch, TRACK-7). A
 * finished work item with a single PR keeps its one row. With the merged PRs hidden (TIMELINE-19) they do not count
 * for the group, so a work item that was a group only because of them has its one row. Keyed by work item id, in the order of its first card
 */
export function planGroups(input: GroupInput): Map<number, GroupPlan> {
  const plans = new Map<number, GroupPlan>();
  const ids = [...new Set(input.cards.map((card) => card.id))];
  for (const id of ids) {
    const item = input.workItems.find((candidate) => candidate.id === id);
    if (!item) {
      continue;
    }
    const cards = input.cards.filter((card) => card.id === id);
    const mergedPrs = item.pullRequests.filter((pr) => pr.tone === 'completed');
    const merged = (input.showCompleted === false ? [] : mergedPrs)
      .flatMap((pr) => input.completed.find((candidate) => candidate.id === pr.id) ?? [])
      .filter((pr) => mergedInRange(pr, input.from, input.to))
      .sort((a, b) => a.creationDate.localeCompare(b.creationDate));
    const openCount = openPullRequests(item).length;
    const split = cards.some((card) => card.part !== undefined);
    const finished = isFinishedState(item.state);
    const isGroup = split || openCount + merged.length >= 2 || (merged.length > 0 && !finished);
    if (!isGroup) {
      continue;
    }
    // The work item's own card is a row of the group when it stands for a PR or for work still to do; a finished work
    // item with merged PRs only has the merged rows
    const keepsOwnCard = split || openCount > 0 || !finished;
    plans.set(id, {
      item,
      cards: keepsOwnCard ? cards : [],
      merged,
      mergedTotal: mergedPrs.length,
      openCount,
    });
  }
  return plans;
}

/** Order of the rows of a group: PR rows (open and merged, oldest first), the work item itself, tasks, tasks to do */
export function childRank(card: Pick<BoardWorkCard, 'part'>, hasPullRequest: boolean): number {
  if (card.part === 'pr' || (card.part === undefined && hasPullRequest)) {
    return 0;
  }
  if (card.part === 'task') {
    return 2;
  }
  return card.part === 'tasks' ? 3 : 1;
}

// Rule TIMELINE-18
/** The work items whose group is collapsed after the user clicked the chevron of `id` */
export function toggleCollapsed(collapsed: readonly number[], id: number): number[] {
  return collapsed.includes(id) ? collapsed.filter((candidate) => candidate !== id) : [...collapsed, id];
}

/** The rows that are drawn: the children of a collapsed group are hidden */
export function visibleRows<T extends { groupId?: number; group?: unknown }>(
  rows: readonly T[],
  collapsed: readonly number[]
): T[] {
  return rows.filter((row) => row.group !== undefined || row.groupId === undefined || !collapsed.includes(row.groupId));
}
