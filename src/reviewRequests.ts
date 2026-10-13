/** Pull requests waiting for the user's review, and the notifications about them. Pure, so no "vscode" import */
import type { ReviewDetails } from './reviewCard';
import { describeBarCaption, describeBarValue, describeDue } from './reviewDue';
import { addWorkingMs, workingMsBetween } from './workingTime';

export interface ReviewerPullRequest {
  pullRequestId: number;
  title: string;
  status: 'abandoned' | 'active' | 'completed' | 'notSet';
  isDraft: boolean;
  creationDate: string;
  /** When the PR was completed or abandoned */
  closedDate?: string;
  createdBy: { id: string; displayName: string };
  targetRefName: string;
  sourceRefName: string;
  repository: { id: string; name: string; project: { id: string } };
  webUrl: string;
  /** Markdown; the list API may cut it */
  description?: string;
  mergeStatus?: string;
  /** Present while auto-complete is set */
  autoCompleteSetBy?: { id?: string };
  completionOptions?: { deleteSourceBranch?: boolean; transitionWorkItems?: boolean; mergeStrategy?: string };
  reviewers: {
    id?: string;
    displayName: string;
    vote: number;
    isRequired?: boolean;
    isContainer?: boolean;
    hasDeclined?: boolean;
  }[];
}

export interface ReviewRequest {
  id: number;
  title: string;
  url: string;
  repository: string;
  repositoryId: string;
  author: string;
  /** Branch the PR merges into, without "refs/heads/" */
  targetBranch: string;
  /** Branch of the PR, without "refs/heads/" */
  sourceBranch: string;
  /**
   * When the PR was published: its creation, or when it left draft. Reviewers are only asked to review
   * published PRs, so the waiting time starts here
   */
  publishedAt: string;
  isRequired: boolean;
}

/** Required reviews first, then optional ones; oldest first within each group, so the most urgent first */
function byRoleThenPublishedDate(a: ReviewRequest, b: ReviewRequest): number {
  return Number(b.isRequired) - Number(a.isRequired) || a.publishedAt.localeCompare(b.publishedAt);
}

/** Vote of a reviewer who has not reviewed yet */
const NO_VOTE = 0;

/**
 * Active, published PRs of other people where the user is a reviewer (required or optional) and has not voted
 * yet: the required ones first, oldest first within each group. Once the user votes (approve, wait for author,
 * reject…) or declines, the PR is no longer waiting for them. Whether the optional ones are shown is up to the
 * view (see splitOptional)
 */
export function toReviewRequests(pullRequests: ReviewerPullRequest[], myId: string): ReviewRequest[] {
  return pullRequests
    .flatMap((pr) => {
      const me = pr.reviewers.find((reviewer) => reviewer.id === myId);
      const waiting =
        pr.status === 'active' &&
        !pr.isDraft &&
        pr.createdBy.id !== myId &&
        me &&
        me.vote === NO_VOTE &&
        !me.hasDeclined;
      if (!waiting) {
        return [];
      }
      return [
        {
          id: pr.pullRequestId,
          title: pr.title,
          url: pr.webUrl,
          repository: pr.repository.name,
          repositoryId: pr.repository.id,
          author: pr.createdBy.displayName,
          targetBranch: pr.targetRefName.replace(/^refs\/heads\//, ''),
          sourceBranch: pr.sourceRefName.replace(/^refs\/heads\//, ''),
          // Until the threads tell when it left draft (withPublishedDates)
          publishedAt: pr.creationDate,
          isRequired: !!me.isRequired,
        },
      ];
    })
    .sort(byRoleThenPublishedDate);
}

/**
 * The requests to show: all of them, or only the required ones. The optional ones left out are counted, so the
 * box can offer to show them
 */
export function splitOptional<T extends Pick<ReviewRequest, 'isRequired'>>(
  requests: T[],
  includeOptional: boolean
): { shown: T[]; hiddenOptional: number } {
  if (includeOptional) {
    return { shown: requests, hiddenOptional: 0 };
  }
  const shown = requests.filter((request) => request.isRequired);
  return { shown, hiddenOptional: requests.length - shown.length };
}

/** Thread of a PR, as returned by the threads API */
export interface PullRequestThread {
  publishedDate: string;
  properties?: Partial<Record<string, { $value?: unknown }>>;
}

/**
 * When the PR was last published from draft; undefined when it was never a draft. Azure DevOps records it as a
 * system thread "<name> published the pull request." of type IsDraftUpdate, with CodeReviewIsDraftNowSet "0"
 * ("1" when it goes back to draft)
 */
export function lastPublishedFromDraft(threads: PullRequestThread[]): string | undefined {
  return threads
    .filter(
      ({ properties }) =>
        properties?.CodeReviewThreadType?.$value === 'IsDraftUpdate' &&
        String(properties.CodeReviewIsDraftNowSet?.$value) === '0'
    )
    .map((thread) => thread.publishedDate)
    .sort()
    .at(-1);
}

/** Uses the date each PR left draft, when it was a draft, and sorts the requests again */
export function withPublishedDates(
  requests: ReviewRequest[],
  publishedDates: ReadonlyMap<number, string | undefined>
): ReviewRequest[] {
  return requests
    .map((request) => ({ ...request, publishedAt: publishedDates.get(request.id) ?? request.publishedAt }))
    .sort(byRoleThenPublishedDate);
}

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const HOURS_PER_DAY = 24;

/** Team rule on how long PRs may wait for reviewers, and when to remind the user */
export interface ReviewRules {
  /** Hours of working time a PR may wait (see workingDays) */
  maxWaitHours: number;
  /** Weekdays whose time counts as waiting time (0 is Sunday… 6 is Saturday); all 24 hours of such a day count */
  workingDays: number[];
  /** Hours before the maximum wait when a PR is due soon */
  dueSoonHours: number;
  /** While a PR is overdue, how often it is notified again; 0: only once */
  remindOverdueEveryHours: number;
}

/** "fresh": time left; "dueSoon": close to the maximum wait; "overdue": over it */
export type ReviewUrgency = 'dueSoon' | 'fresh' | 'overdue';

/** Working time since the PR was published: the weekend does not count (by default) */
export function waitingMs(
  request: Pick<ReviewRequest, 'publishedAt'>,
  now: Date,
  workingDays: readonly number[]
): number {
  return workingMsBetween(new Date(request.publishedAt), now, workingDays);
}

/** Negative when the PR is overdue */
export function timeLeftMs(
  request: Pick<ReviewRequest, 'publishedAt'>,
  now: Date,
  rules: Pick<ReviewRules, 'maxWaitHours' | 'workingDays'>
): number {
  return rules.maxWaitHours * MS_PER_HOUR - waitingMs(request, now, rules.workingDays);
}

export function reviewUrgency(
  request: Pick<ReviewRequest, 'publishedAt'>,
  now: Date,
  rules: Pick<ReviewRules, 'dueSoonHours' | 'maxWaitHours' | 'workingDays'>
): ReviewUrgency {
  const left = timeLeftMs(request, now, rules);
  if (left <= 0) {
    return 'overdue';
  }
  return left <= rules.dueSoonHours * MS_PER_HOUR ? 'dueSoon' : 'fresh';
}

/** "12 min", "5 h", "2 d 3 h" */
export function formatWait(ms: number): string {
  const hours = Math.floor(ms / MS_PER_HOUR);
  if (hours < 1) {
    return `${Math.floor(ms / MS_PER_MINUTE)} min`;
  }
  if (hours < HOURS_PER_DAY) {
    return `${hours} h`;
  }
  const days = Math.floor(hours / HOURS_PER_DAY);
  const rest = hours % HOURS_PER_DAY;
  return rest ? `${days} d ${rest} h` : `${days} d`;
}

/** "5 h left" or "overdue by 3 h" */
export function describeTimeLeft(
  request: Pick<ReviewRequest, 'publishedAt'>,
  now: Date,
  rules: Pick<ReviewRules, 'maxWaitHours' | 'workingDays'>
): string {
  const left = timeLeftMs(request, now, rules);
  return left > 0 ? `${formatWait(left)} left` : `overdue by ${formatWait(-left)}`;
}

/** A review request as shown in the views */
export interface ReviewRequestModel extends ReviewRequest {
  /** What a reviewer needs to know about the PR. Undefined until the PR is checked in depth */
  details?: ReviewDetails;
  urgency: ReviewUrgency;
  /** "5 h left", "overdue by 3 h" */
  timeLeft: string;
  /** "19 h" */
  waited: string;
  /** Share of the maximum wait already used, from 0 to 1 */
  elapsed: number;
  /** "due today 14:30", "was due today 10:30" */
  dueText: string;
  /** Under the bar: "19 h of 24 h", "overdue by 3 h" */
  barCaption: string;
  /** For screen readers: "Waited 19 hours of 24; due today at 14:30", "Overdue by 3 hours" */
  barValueText: string;
  /** Hours waited, up to the maximum wait */
  waitedHours: number;
  /** The PR belongs to the repository open in VS Code: its branch can be checked out */
  canCheckout?: boolean;
  /** Its branch is the one checked out */
  isCurrentBranch?: boolean;
  /** Another worktree has its branch checked out: its folder */
  worktree?: string;
}

/** The time zone only matters for tests: it is the local one otherwise */
export function toReviewModels(
  requests: ReviewRequest[],
  now: Date,
  rules: ReviewRules,
  timeZone?: string
): ReviewRequestModel[] {
  return requests.map((request) => {
    const waited = waitingMs(request, now, rules.workingDays);
    const left = timeLeftMs(request, now, rules);
    const timeLeft = describeTimeLeft(request, now, rules);
    const due = addWorkingMs(new Date(request.publishedAt), rules.maxWaitHours * MS_PER_HOUR, rules.workingDays);
    const dueText = describeDue(due, now, timeZone);
    return {
      ...request,
      urgency: reviewUrgency(request, now, rules),
      timeLeft,
      waited: formatWait(waited),
      elapsed: Math.min(1, waited / (rules.maxWaitHours * MS_PER_HOUR)),
      dueText,
      barCaption: describeBarCaption(waited, rules.maxWaitHours),
      barValueText: describeBarValue(waited, rules.maxWaitHours, left > 0 ? undefined : -left, dueText),
      waitedHours: Math.min(rules.maxWaitHours, Math.floor(waited / MS_PER_HOUR)),
    };
  });
}

/**
 * Overdue and due soon requests among the required ones: the team rule about the maximum wait is about required
 * reviewers, so the optional ones do not count as late
 */
export function countLate(requests: Pick<ReviewRequestModel, 'isRequired' | 'urgency'>[]): {
  overdue: number;
  dueSoon: number;
} {
  const count = (urgency: ReviewUrgency) =>
    requests.filter((request) => request.isRequired && request.urgency === urgency).length;
  return { overdue: count('overdue'), dueSoon: count('dueSoon') };
}

/** "3 pull requests are waiting for your review: 1 overdue, 1 due soon" */
export function describeReviews(requests: Pick<ReviewRequestModel, 'urgency'>[]): string {
  const count = (urgency: ReviewUrgency) => requests.filter((request) => request.urgency === urgency).length;
  const details = [
    count('overdue') && `${count('overdue')} overdue`,
    count('dueSoon') && `${count('dueSoon')} due soon`,
  ].filter(Boolean);
  const waiting = requests.length === 1 ? '1 pull request is waiting' : `${requests.length} pull requests are waiting`;
  return `${waiting} for your review${details.length ? `: ${details.join(', ')}` : ''}`;
}

/** What is remembered between checks, so each notification is shown once */
export interface StoredReviewRequests {
  known: number[];
  dueSoonNotified: number[];
  /** Last time each overdue PR was notified (ISO date) */
  overdueNotified: Partial<Record<number, string>>;
  /** Day of the last digest, in local time: "2026-10-6" */
  digestDay?: string;
}

export type ReviewEvent = { kind: 'dueSoon' | 'overdue' | 'requested'; request: ReviewRequest };

function localDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

/**
 * Notifications since the last check: new review requests, PRs getting close to the maximum wait, and overdue
 * PRs (again every few hours while they stay overdue). "digest" is true on the first check of the day: one
 * summary of all the PRs replaces the other notifications. The first check ever only establishes a baseline
 * (and the digest). PRs that are no longer waiting are forgotten
 */
export function detectReviewEvents(
  previous: StoredReviewRequests | undefined,
  current: ReviewRequest[],
  now: Date,
  rules: ReviewRules
): { events: ReviewEvent[]; digest: boolean; stored: StoredReviewRequests } {
  const events: ReviewEvent[] = [];
  const stored: StoredReviewRequests = {
    known: current.map((request) => request.id),
    dueSoonNotified: [],
    overdueNotified: {},
    digestDay: localDay(now),
  };
  for (const request of current) {
    const urgency = reviewUrgency(request, now, rules);
    const isNew = !!previous && !previous.known.includes(request.id);
    const lastOverdue = previous?.overdueNotified[request.id];
    if (isNew) {
      // Already overdue or due soon when added (e.g. a reviewer added late): only notified as new
      events.push({ kind: 'requested', request });
    } else if (previous && urgency === 'overdue') {
      // Working time too: no reminders pile up over the weekend
      const remindAfter = rules.remindOverdueEveryHours * MS_PER_HOUR;
      const sinceLast = lastOverdue ? workingMsBetween(new Date(lastOverdue), now, rules.workingDays) : 0;
      const remind = !!lastOverdue && remindAfter > 0 && sinceLast >= remindAfter;
      if (!lastOverdue || remind) {
        events.push({ kind: 'overdue', request });
      }
    } else if (previous && urgency === 'dueSoon' && !previous.dueSoonNotified.includes(request.id)) {
      events.push({ kind: 'dueSoon', request });
    }
    const notifiedNow = !previous || events.some((event) => event.request.id === request.id);
    if (urgency === 'overdue') {
      stored.overdueNotified[request.id] = notifiedNow ? now.toISOString() : lastOverdue;
    }
    if (urgency !== 'fresh') {
      stored.dueSoonNotified.push(request.id);
    }
  }
  const digest = previous?.digestDay !== stored.digestDay && current.length > 0;
  return { events, digest, stored };
}

export function describeReviewEvent(
  event: ReviewEvent,
  now: Date,
  rules: Pick<ReviewRules, 'maxWaitHours' | 'workingDays'>
): string {
  const { request } = event;
  const pr = `PR ${request.id} by ${request.author}`;
  switch (event.kind) {
    case 'requested': {
      // Reviewers may be added by the author, someone else or a branch policy: only the role is told
      const role = request.isRequired ? 'a required reviewer' : 'an optional reviewer';
      return `You are ${role} of ${pr}: ${request.title}`;
    }
    case 'dueSoon':
      return `${describeTimeLeft(request, now, rules)} to review ${pr}: ${request.title}`;
    case 'overdue':
      return `${pr} is ${describeTimeLeft(request, now, rules)} (waiting for your review for ${formatWait(
        waitingMs(request, now, rules.workingDays)
      )}): ${request.title}`;
  }
}
