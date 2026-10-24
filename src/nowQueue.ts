/**
 * The "Needs you" queue: everything waiting for the user, one row each, sorted by who waits on whom. Built only
 * from the existing rules (reviews, My Pull Requests attention, alerts, deletable branches, stale worktrees), so
 * it never disagrees with the status bar, the Summary view or the badge. Pure, so no "vscode" import
 */
import { attentionOf } from './myPullRequestsAttention';
import type { MyPullRequestModel } from './myPullRequests';
import type { ReviewRequestModel, ReviewUrgency } from './reviewRequests';
import type { WorkItemModel } from './viewModel';

/** In the order they are listed: someone waits on the user first, housekeeping last */
export type Verb = 'clean' | 'fix' | 'review' | 'ship' | 'unblock';

export const VERB_ORDER: readonly Verb[] = ['review', 'unblock', 'fix', 'ship', 'clean'];

export interface NowItem {
  verb: Verb;
  /** PR id (review, unblock, ship) or work item id (fix); 0 for the cleanup row */
  id: number;
  title: string;
  /** Why it is here, e.g. "overdue by 3 h", "Waiting for author (Jonas Berg)" */
  detail: string;
  /** Reviews only */
  urgency?: ReviewUrgency;
}

export interface NowInput {
  reviews: Pick<ReviewRequestModel, 'id' | 'isRequired' | 'timeLeft' | 'title' | 'urgency'>[];
  myPullRequests: MyPullRequestModel[];
  /** Work items of the list (tasks excluded) */
  workItems: Pick<WorkItemModel, 'alerts' | 'id' | 'title'>[];
  /** Branches whose PR was completed and that still exist (Rules DELETABLE-*) */
  deletableBranches: number;
  /** Worktrees that can be removed (Rules WORKTREE-STALE-*) */
  staleWorktrees: number;
  /** The base branch is broken (Rules BASE-CI-*): shown above the queue, it counts for everyone */
  baseBranchBroken?: boolean;
}

export interface NowQueue {
  items: NowItem[];
  /** What the "Now" tab counts: every row but the cleanup one, plus 1 while the base branch is broken (Rules NOW-6, NOW-7) */
  count: number;
}

// Rule NOW-1
/**
 * Reviews waiting for the user, in the order of the Reviews box (REVIEW-REQ-4: required first, then optional,
 * oldest first within each group, so the most urgent first)
 */
function reviewItems(reviews: NowInput['reviews']): NowItem[] {
  return reviews.map((review) => ({
    verb: 'review',
    id: review.id,
    title: review.title,
    detail: review.timeLeft,
    urgency: review.urgency,
  }));
}

// Rule NOW-2
/** The user's PRs that need them: the status bar reasons and the team-rule warnings (MYPR-PULSE) */
function unblockItems(pullRequests: MyPullRequestModel[]): NowItem[] {
  return pullRequests.flatMap((pr) => {
    if (pr.isCompleted || pr.isDraft) {
      return [];
    }
    const reasons = attentionOf(pr).reasons.map((reason) => reason.text);
    const details = [...reasons, ...pr.warnings.map((warning) => warning.text)];
    return details.length
      ? [{ verb: 'unblock' as const, id: pr.id, title: pr.title, detail: details.join(' · ') }]
      : [];
  });
}

// Rule NOW-3
/** Work items that break a team rule: the same set as the alerts banner and the badge */
function fixItems(workItems: NowInput['workItems']): NowItem[] {
  return workItems
    .filter((item) => item.alerts.length > 0)
    .map((item) => ({
      verb: 'fix',
      id: item.id,
      title: item.title,
      detail: item.alerts.map((alert) => alert.message).join(' · '),
    }));
}

// Rule NOW-4
/** PRs nothing stops from being merged and that the user completes (STATUSBAR-MYPR-3): auto-complete ones are not */
function shipItems(pullRequests: MyPullRequestModel[]): NowItem[] {
  return pullRequests
    .filter((pr) => attentionOf(pr).ready)
    .map((pr) => ({ verb: 'ship', id: pr.id, title: pr.title, detail: 'Ready to be merged' }));
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

// Rule NOW-5
/** One housekeeping row for the branches and worktrees that can go */
function cleanItems(input: NowInput): NowItem[] {
  const parts = [
    input.staleWorktrees && plural(input.staleWorktrees, 'worktree'),
    input.deletableBranches && plural(input.deletableBranches, 'branch'),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? [{ verb: 'clean', id: 0, title: `${parts.join(' and ')} can go`, detail: 'Clean up…' }] : [];
}

/** Everything waiting for the user, in VERB_ORDER */
export function nowQueue(input: NowInput): NowQueue {
  const items = [
    ...reviewItems(input.reviews),
    ...unblockItems(input.myPullRequests),
    ...fixItems(input.workItems),
    ...shipItems(input.myPullRequests),
    ...cleanItems(input),
  ];
  // Rules NOW-6, NOW-7: like the badge (SUMMARY-6), a broken base branch counts once
  const broken = input.baseBranchBroken ? 1 : 0;
  return { items, count: items.filter((item) => item.verb !== 'clean').length + broken };
}
