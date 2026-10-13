/**
 * PRs the user has already reviewed (voted on), listed below the ones waiting for their review. Pure, so no
 * "vscode" import. They are informative only: they never count in the badge, the urgency, the Summary view,
 * the digest or the notifications, which use only the requests of reviewRequests.ts
 */
import { completedWindowMs, formatAge, voteKind } from './myPullRequests';
import type { VoteKind } from './myPullRequests';
import { ReviewCardInput, ReviewCardOptions, ReviewDetails, toReviewDetails } from './reviewCard';
import type { ReviewerPullRequest } from './reviewRequests';

/** How far back the reviewed PRs are listed (totalflowx.reviews.reviewedPeriod) */
export type ReviewedPeriod = 'active' | 'day' | 'hidden' | 'month' | 'week';

export const REVIEWED_PERIODS: ReviewedPeriod[] = ['hidden', 'active', 'day', 'week', 'month'];

/** The value of the setting, hidden when it is not a known period */
export function reviewedPeriodSetting(value: string): ReviewedPeriod {
  return REVIEWED_PERIODS.find((period) => period === value) ?? 'hidden';
}

/** Whether the PRs completed or abandoned in the past are listed, so they have to be fetched */
export function listsClosedReviews(period: ReviewedPeriod): boolean {
  return period === 'day' || period === 'week' || period === 'month';
}

/** The window of the closed PRs to list, in ms; 0 when only the active ones (or none) are listed */
function closedWindowMs(period: ReviewedPeriod): number {
  return listsClosedReviews(period) ? completedWindowMs(period as 'day' | 'month' | 'week') : 0;
}

/** The details of an unfolded reviewed PR: those of the cards waiting for review, without the waiting-time parts */
export type ReviewedDetails = Omit<ReviewDetails, 'timeline'>;

export interface ReviewedRequest {
  id: number;
  title: string;
  url: string;
  repository: string;
  author: string;
  /** The vote of the user, never 'none' or 'declined' */
  vote: VoteKind;
  status: 'abandoned' | 'active' | 'completed';
  /** When the PR was completed or abandoned, e.g. "2 d 3 h"; only for those */
  closedAgo?: string;
  isRequired: boolean;
  /** Only once fetched, for the PRs the user unfolded (see reviewedIdsToFetch) */
  details?: ReviewedDetails;
}

const VOTES_LISTED: VoteKind[] = ['approved', 'suggestions', 'waiting', 'rejected'];

/** The user's vote in the PR when it is one to list: someone else's PR, published, voted by the user (not declined) */
function myListedVote(pr: ReviewerPullRequest, myId: string): { vote: VoteKind; isRequired: boolean } | undefined {
  const me = pr.reviewers.find((reviewer) => reviewer.id === myId);
  if (!me || pr.isDraft || pr.createdBy.id === myId) {
    return undefined;
  }
  const vote = voteKind(me);
  return VOTES_LISTED.includes(vote) ? { vote, isRequired: !!me.isRequired } : undefined;
}

/** Whether the PR is in the period: the active ones always, the closed ones when closed within the window */
function inPeriod(pr: ReviewerPullRequest, now: Date, windowMs: number): boolean {
  if (pr.status === 'active') {
    return true;
  }
  const closedAt = Date.parse(pr.closedDate ?? '');
  return (
    (pr.status === 'completed' || pr.status === 'abandoned') && windowMs > 0 && now.getTime() - closedAt <= windowMs
  );
}

/** Active ones first (newest first), then the closed ones, the most recently closed first */
function byActiveThenDate(a: ReviewerPullRequest, b: ReviewerPullRequest): number {
  const aActive = a.status === 'active';
  if (aActive !== (b.status === 'active')) {
    return aActive ? -1 : 1;
  }
  return aActive
    ? b.creationDate.localeCompare(a.creationDate)
    : (b.closedDate ?? '').localeCompare(a.closedDate ?? '');
}

/**
 * The PRs of other people that the user has voted on (approved, approved with suggestions, waiting for the
 * author, rejected), for the period: the active ones, plus those completed or abandoned within the window when
 * the period has one. `pullRequests` may repeat a PR (the active ones come from two requests); declined PRs
 * and drafts are left out
 */
export function toReviewedRequests(
  pullRequests: ReviewerPullRequest[],
  myId: string,
  now: Date,
  period: ReviewedPeriod
): ReviewedRequest[] {
  if (period === 'hidden') {
    return [];
  }
  const windowMs = closedWindowMs(period);
  const unique = new Map(pullRequests.map((pr) => [pr.pullRequestId, pr]));
  return [...unique.values()]
    .filter((pr) => inPeriod(pr, now, windowMs))
    .sort(byActiveThenDate)
    .flatMap((pr): ReviewedRequest[] => {
      const mine = myListedVote(pr, myId);
      if (!mine) {
        return [];
      }
      const status = pr.status === 'completed' || pr.status === 'abandoned' ? pr.status : 'active';
      return [
        {
          id: pr.pullRequestId,
          title: pr.title,
          url: pr.webUrl,
          repository: pr.repository.name,
          author: pr.createdBy.displayName,
          vote: mine.vote,
          status,
          closedAgo: status === 'active' ? undefined : formatAge(now.getTime() - Date.parse(pr.closedDate ?? '')),
          isRequired: mine.isRequired,
        },
      ];
    });
}

/** The details of the card of a reviewed PR: the same as the ones waiting, but nothing about the waiting time */
export function toReviewedDetails(input: ReviewCardInput, options: ReviewCardOptions): ReviewedDetails {
  const { timeline, ...details } = toReviewDetails(input, options);
  void timeline;
  return details;
}

/** What the fetch policy needs to know of a reviewed PR */
export interface ReviewedRef {
  id: number;
  status: ReviewedRequest['status'];
}

/**
 * The reviewed PRs whose details have to be fetched now. Only unfolded PRs (and listed ones) are ever fetched:
 * - closed (completed / abandoned) PRs do not change: fetched once, then kept for the session;
 * - active PRs are fetched when unfolded without details, and again at every check (`refreshActive`) while they
 *   stay unfolded
 */
export function reviewedIdsToFetch(
  listed: ReviewedRef[],
  expanded: ReadonlySet<number>,
  hasDetails: (id: number) => boolean,
  refreshActive: boolean
): number[] {
  return listed
    .filter(({ id, status }) => {
      if (!expanded.has(id)) {
        return false;
      }
      return status === 'active' ? refreshActive || !hasDetails(id) : !hasDetails(id);
    })
    .map(({ id }) => id);
}

/**
 * The details to forget: those of active PRs that were folded (they would be stale when unfolded again) or are
 * no longer listed. The ones of closed PRs stay for the session
 */
export function reviewedIdsToDrop(
  known: ReviewedRef[],
  listed: ReviewedRef[],
  expanded: ReadonlySet<number>
): number[] {
  const activeListed = new Set(listed.filter(({ status }) => status === 'active').map(({ id }) => id));
  return known
    .filter(({ id, status }) => status === 'active' && (!expanded.has(id) || !activeListed.has(id)))
    .map(({ id }) => id);
}
