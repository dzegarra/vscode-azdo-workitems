/**
 * What the card of a PR waiting for the user's review shows besides its urgency: the details a reviewer needs.
 * Reuses what "My Pull Requests" computes (status, reviewers, warnings, timeline). Pure, so no "vscode" import
 */
import {
  AuthoredPullRequest,
  autoCompleteWarnings,
  countApprovals,
  PolicyEvaluation,
  PullRequestExtras,
  PullRequestWarning,
  reviewerModels,
  ReviewerModel,
  ruleWarnings,
} from './myPullRequests';
import type { RunModel } from './pipelines';
import { buildTimeline, DateFormatter, Timeline } from './pullRequestTimeline';
import type { ReviewerPullRequest } from './reviewRequests';
import { myObservations, OpenObservations, summarizeOpenObservations } from './reviewThreads';
import { pullRequestStatus, PullRequestTone } from './workItemLinks';

/** Files changed are counted up to this number: more are shown as "100+" */
export const MAX_COUNTED_FILES = 100;

export interface FilesChanged {
  count: number;
  /** There are more files than the ones counted */
  capped: boolean;
}

// Rule REVIEW-CARD-4
/**
 * Files of a page of changes asked with `$top = limit + 1`: the API gives no total, only `nextSkip` when there
 * are more. The count never goes over the limit
 */
export function countChangedFiles(received: number, hasNextPage: boolean, limit = MAX_COUNTED_FILES): FilesChanged {
  return { count: Math.min(received, limit), capped: received > limit || hasNextPage };
}

export function describeFilesChanged({ count, capped }: FilesChanged): string {
  return `${count}${capped ? '+' : ''} file${count === 1 && !capped ? '' : 's'} changed`;
}

const VOTE_APPROVED_WITH_SUGGESTIONS = 5;
const SATISFIED_STATUSES = ['approved', 'notApplicable'];
const MIN_REVIEWERS_POLICY = 'Minimum number of reviewers';
const REQUIRED_REVIEWERS_POLICY = 'Required reviewers';
/** Rejected until the completion options are chosen: the one who completes the PR picks it, not a reviewer */
const MERGE_STRATEGY_POLICY = 'Require a merge strategy';

// Rules REVIEW-APPROVE-1..6
/**
 * The approval of the user is the last thing the PR needs. True when all of this holds:
 * - the PR is active, published and has no conflicts, and the policies are known;
 * - the user is a person (not a group) reviewing the PR who did not decline nor approve yet, so approving counts;
 * - something blocks the PR, and everything that blocks it is a reviewer policy: any other unsatisfied blocking
 *   policy (build, comments, work item linking…) makes it false, as does a policy that is "broken". "Require a
 *   merge strategy" is ignored: it is rejected on every PR until whoever completes it chooses one;
 * - every unsatisfied "Minimum number of reviewers" policy lacks exactly one approval (the author is not the user,
 *   so their vote does not matter: creatorVoteCounts is honoured when counting the approvals);
 * - every unsatisfied "Required reviewers" policy lacks only the user: the only people marked as required who
 *   have not approved yet (the author and those who declined do not count) is the user. A required group that
 *   has not voted makes it false, because who in the group will approve is unknown. The policy does not tell
 *   which reviewers it requires, so those marked as required in the PR are taken as them
 */
export function approvalCompletes(
  pr: AuthoredPullRequest,
  evaluations: PolicyEvaluation[] | undefined,
  myId: string
): boolean {
  if (!evaluations || pr.status !== 'active' || pr.isDraft || pr.mergeStatus === 'conflicts') {
    return false;
  }
  const me = pr.reviewers.find((reviewer) => reviewer.id === myId);
  if (!me || me.isContainer || me.hasDeclined || me.vote >= VOTE_APPROVED_WITH_SUGGESTIONS) {
    return false;
  }
  const unsatisfied = evaluations.filter(
    (evaluation) =>
      evaluation.isBlocking &&
      !SATISFIED_STATUSES.includes(evaluation.status) &&
      evaluation.type !== MERGE_STRATEGY_POLICY
  );
  if (!unsatisfied.length) {
    return false;
  }
  const pendingRequired = pr.reviewers.filter(
    (reviewer) =>
      reviewer.isRequired &&
      reviewer.id !== pr.createdBy.id &&
      !reviewer.hasDeclined &&
      reviewer.vote < VOTE_APPROVED_WITH_SUGGESTIONS
  );
  return unsatisfied.every((evaluation) => {
    if (evaluation.status === 'broken') {
      return false;
    }
    switch (evaluation.type) {
      case MIN_REVIEWERS_POLICY:
        return (evaluation.minimumApproverCount ?? 1) - countApprovals(pr, !!evaluation.creatorVoteCounts) === 1;
      case REQUIRED_REVIEWERS_POLICY:
        return pendingRequired.length === 1 && pendingRequired[0].id === myId;
      default:
        return false;
    }
  });
}

/** What the user's own comments of the PR are doing */
export function myCommentsLine({ open, answered }: OpenObservations): string | undefined {
  if (!open) {
    return undefined;
  }
  const count = open === 1 ? '1 of your comments is' : `${open} of your comments are`;
  return `${count} still open${answered ? ' · replies since your last comment' : ''}`;
}

export interface ReviewDetails {
  /** "In review", "Conflicts"… */
  status: string;
  tone: PullRequestTone;
  /** Only when the PR does not merge into the base branch */
  target?: string;
  timeline: Timeline;
  /** Linked work items; the type is known for the ones that could be fetched */
  workItems: { id: number; type?: string }[];
  /** The user's chip first, marked */
  reviewers: ReviewerModel[];
  /** Undefined when the comments could not be fetched */
  unresolved?: number;
  conflicts: boolean;
  runs: RunModel[];
  autoComplete: boolean;
  /** Your approval is the last thing missing */
  approvalCompletes: boolean;
  /** Auto-complete is set: the approval of the user may merge the PR; an error when it would complete a Bug */
  autoCompleteNote?: PullRequestWarning;
  /** Observations of the user still open; undefined when none or when the threads could not be read */
  myComments?: string;
  filesChanged?: FilesChanged;
  filesChangedText?: string;
  /** Team rules the PR breaks (the author should fix them) */
  teamRules: string[];
}

export const AUTO_COMPLETE_REVIEWER_NOTE = 'Auto-complete is set: your approval may merge it right away';

export interface ReviewCardOptions {
  baseBranch: string;
  minimumRequiredReviewers: number;
  formatDate?: DateFormatter;
}

export interface ReviewCardInput {
  pr: ReviewerPullRequest;
  myId: string;
  extras: PullRequestExtras;
  filesChanged?: FilesChanged;
}

const stripHeads = (ref: string) => ref.replace(/^refs\/heads\//, '');

/** The details of the card of a PR waiting for the user's review. Whatever is unknown is left out */
export function toReviewDetails(
  { pr, myId, extras, filesChanged }: ReviewCardInput,
  { baseBranch, minimumRequiredReviewers, formatDate }: ReviewCardOptions
): ReviewDetails {
  const { label, tone } = pullRequestStatus(pr);
  const target = stripHeads(pr.targetRefName);
  const [autoCompleteError] = autoCompleteWarnings(pr, extras).filter(({ severity }) => severity === 'error');
  const open = summarizeOpenObservations(myObservations(extras.threads ?? [], myId), myId);
  let autoCompleteNote: PullRequestWarning | undefined;
  if (pr.autoCompleteSetBy) {
    // Rule REVIEW-CARD-1
    autoCompleteNote = autoCompleteError ?? { text: AUTO_COMPLETE_REVIEWER_NOTE, severity: 'warning' };
  }
  return {
    status: label,
    tone,
    target: target === baseBranch ? undefined : target,
    timeline: buildTimeline(pr, extras.threads, formatDate),
    workItems: extras.workItems ?? [],
    reviewers: reviewerModels(pr, myId),
    unresolved: extras.unresolvedThreads,
    conflicts: pr.mergeStatus === 'conflicts',
    runs: extras.runs,
    autoComplete: !!pr.autoCompleteSetBy,
    approvalCompletes: approvalCompletes(pr, extras.evaluations, myId),
    autoCompleteNote,
    // Rule REVIEW-CARD-3
    myComments: extras.threads ? myCommentsLine(open) : undefined,
    filesChanged,
    filesChangedText: filesChanged && describeFilesChanged(filesChanged),
    // Rule REVIEW-CARD-2
    teamRules: ruleWarnings(pr, extras, { minimumRequiredReviewers }).map(({ text }) => text),
  };
}

/** "2 team rules not met — remind the author" */
export function describeTeamRules(rules: string[]): string | undefined {
  if (!rules.length) {
    return undefined;
  }
  return `${rules.length} team rule${rules.length === 1 ? '' : 's'} not met — remind the author`;
}
