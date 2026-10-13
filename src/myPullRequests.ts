/**
 * The pull requests created by the user, shaped for the "My Pull Requests" box of the sidebar: what is still
 * missing before each one can be merged. Pure, so no "vscode" import
 */
import {
  BuildNotesOptions,
  BuildNotesStatus,
  buildNotesWarningText,
  needsBuildNotesWarning,
  PullRequestLabel,
} from './buildNotes';
import { isValidPullRequestTitle } from './naming';
import type { RunModel } from './pipelines';
import {
  PHASE_LABELS,
  PhaseEventKind,
  PhaseKind,
  PullRequestPhases,
  pullRequestPhases,
  summarizeCompleted,
} from './pullRequestPhases';
import { buildTimeline, formatTimelineDate, publishedAt, Timeline } from './pullRequestTimeline';
import type { ThreadResponse } from './reviewThreads';
import { PullRequestReviewer, pullRequestStatus, PullRequestTone } from './workItemLinks';
import { DEFAULT_WORKING_DAYS, workingMsBetween } from './workingTime';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const HOURS_PER_DAY = 24;
/** PRs completed less than this ago are counted as hidden when the completed PRs are not listed */
export const COMPLETED_WINDOW_MS = HOURS_PER_DAY * MS_PER_HOUR;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;

/** How far back the completed PRs are listed (totalflowx.myPullRequests.completedPeriod) */
export type CompletedPeriod = 'hidden' | 'day' | 'week' | 'month';

/** The window of the completed PRs to list, in ms; 0 when they are not listed */
export function completedWindowMs(period: CompletedPeriod): number {
  switch (period) {
    case 'hidden':
      return 0;
    case 'day':
      return COMPLETED_WINDOW_MS;
    case 'week':
      return DAYS_PER_WEEK * COMPLETED_WINDOW_MS;
    case 'month':
      return DAYS_PER_MONTH * COMPLETED_WINDOW_MS;
  }
}

const VOTE_APPROVED = 10;
const VOTE_APPROVED_WITH_SUGGESTIONS = 5;
const VOTE_WAITING_FOR_AUTHOR = -5;
const VOTE_REJECTED = -10;

export interface AuthoredReviewer extends PullRequestReviewer {
  hasDeclined?: boolean;
}

/** PR created by the user, as returned by the pull requests API */
export interface AuthoredPullRequest {
  pullRequestId: number;
  title: string;
  /** Markdown. Undefined when the API does not return it */
  description?: string;
  status: 'abandoned' | 'active' | 'completed' | 'notSet';
  isDraft: boolean;
  mergeStatus?: string;
  creationDate: string;
  closedDate?: string;
  createdBy: { id: string; displayName?: string };
  /** E.g. "refs/heads/develop" */
  targetRefName: string;
  sourceRefName: string;
  repository: { id: string; name: string; project: { id: string } };
  webUrl: string;
  reviewers: AuthoredReviewer[];
  /** Present while auto-complete is set */
  autoCompleteSetBy?: { id?: string };
  completionOptions?: { deleteSourceBranch?: boolean; transitionWorkItems?: boolean; mergeStrategy?: string };
  /** Tags of the PR. The API leaves the key out when there are none */
  labels?: PullRequestLabel[];
  lastMergeSourceCommit?: { commitId: string };
  lastMergeTargetCommit?: { commitId: string };
}

/** Evaluation of a branch policy on a PR, flattened from the policy evaluations API */
export interface PolicyEvaluation {
  /** queued, running, approved, rejected, notApplicable or broken */
  status: string;
  isBlocking: boolean;
  /** E.g. "Minimum number of reviewers", "Build" */
  type: string;
  minimumApproverCount?: number;
  creatorVoteCounts?: boolean;
  /** Name of the policy, set by the build policies */
  displayName?: string;
}

export interface RawPolicyEvaluation {
  status: string;
  configuration: {
    isBlocking?: boolean;
    isEnabled?: boolean;
    isDeleted?: boolean;
    type: { displayName: string };
    settings?: { minimumApproverCount?: number; creatorVoteCounts?: boolean; displayName?: string };
  };
}

/** Undefined for the policies that are disabled or deleted: they do not apply to the PR */
export function toPolicyEvaluation(raw: RawPolicyEvaluation): PolicyEvaluation | undefined {
  const { configuration } = raw;
  if (configuration.isEnabled === false || configuration.isDeleted) {
    return undefined;
  }
  const settings = configuration.settings ?? {};
  return {
    status: raw.status,
    isBlocking: !!configuration.isBlocking,
    type: configuration.type.displayName,
    minimumApproverCount: settings.minimumApproverCount,
    creatorVoteCounts: settings.creatorVoteCounts,
    displayName: settings.displayName,
  };
}

/** What is fetched besides the PR. Each part is undefined when it could not be fetched: the card degrades */
export interface PullRequestExtras {
  evaluations?: PolicyEvaluation[];
  /** Text comment threads still active or pending */
  unresolvedThreads?: number;
  workItems?: { id: number; type: string }[];
  /** All the threads of the PR: they tell when it was published and what happened to it */
  threads?: ThreadResponse[];
  runs: RunModel[];
  /** The build notes rule; undefined while it is not known */
  buildNotes?: BuildNotesStatus;
}

export interface AuthoredPullRequestData {
  pr: AuthoredPullRequest;
  extras: PullRequestExtras;
}

const OPEN_THREAD_STATUSES = ['active', 'pending'];

/** Text threads (not the system ones) whose status is active or pending */
export function countUnresolvedThreads(threads: ThreadResponse[]): number {
  return threads.filter((thread) => {
    const [first] = thread.comments ?? [];
    return first?.commentType === 'text' && !first.isDeleted && OPEN_THREAD_STATUSES.includes(thread.status ?? '');
  }).length;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Approvals (approved, or approved with suggestions) of people: groups vote through their members */
export function countApprovals(pr: AuthoredPullRequest, creatorVoteCounts: boolean): number {
  return pr.reviewers.filter(
    (reviewer) =>
      !reviewer.isContainer &&
      !reviewer.hasDeclined &&
      reviewer.vote >= VOTE_APPROVED_WITH_SUGGESTIONS &&
      (creatorVoteCounts || reviewer.id !== pr.createdBy.id)
  ).length;
}

export const READY_TO_MERGE = 'Ready to merge';
export const COMPLETES_BY_ITSELF = 'Will complete automatically';

const SATISFIED_STATUSES = ['approved', 'notApplicable'];

function policyStep(evaluation: PolicyEvaluation, pr: AuthoredPullRequest, extras: PullRequestExtras): string {
  switch (evaluation.type) {
    case 'Minimum number of reviewers': {
      const missing = (evaluation.minimumApproverCount ?? 1) - countApprovals(pr, !!evaluation.creatorVoteCounts);
      return `${plural(Math.max(1, missing), 'more approval')} needed`;
    }
    case 'Comment requirements':
      return extras.unresolvedThreads
        ? `Resolve ${plural(extras.unresolvedThreads, 'comment')}`
        : 'Resolve the comments';
    case 'Build': {
      let state = 'failed';
      if (evaluation.status === 'running' || evaluation.status === 'queued') {
        state = evaluation.status;
      }
      // The name of the build policy already says it is a build, e.g. "Pull Request Build failed"
      return `${evaluation.displayName ?? 'Build'} ${state}`;
    }
    case 'Work item linking':
      return 'Link a work item';
    case 'Require a merge strategy':
      if (evaluation.status === 'rejected') {
        return 'Choose an allowed merge strategy';
      }
      break;
    case 'Required reviewers':
      return 'Approval of a required reviewer missing';
  }
  return `${evaluation.type}: ${evaluation.status}`;
}

/**
 * Reviewers who sent the PR back to its author: "Waiting for author" or "Rejected". Branch policies do not count
 * these votes, so without this the PR could look ready to merge. People are named; a group (e.g. a team) only when
 * no member of it is listed with the same vote, since a group votes through its members
 */
export function feedbackReviewers(pr: Pick<AuthoredPullRequest, 'reviewers' | 'createdBy'>): {
  waiting: string[];
  rejected: string[];
} {
  const names = (vote: (value: number) => boolean) => {
    const voters = pr.reviewers.filter((reviewer) => reviewer.id !== pr.createdBy.id && vote(reviewer.vote));
    const people = voters.filter((reviewer) => !reviewer.isContainer);
    return (people.length ? people : voters).map((reviewer) => reviewer.displayName);
  };
  return {
    rejected: names((vote) => vote <= VOTE_REJECTED),
    waiting: names((vote) => vote > VOTE_REJECTED && vote <= VOTE_WAITING_FOR_AUTHOR),
  };
}

/** The feedback steps of the "Next" line: what the author has to do about the reviewers who sent the PR back */
function feedbackSteps(pr: AuthoredPullRequest): string[] {
  const { waiting, rejected } = feedbackReviewers(pr);
  return [
    ...(rejected.length ? [`Rejected by ${rejected.join(', ')}`] : []),
    ...(waiting.length ? [`Address the feedback of ${waiting.join(', ')}`] : []),
  ];
}

/**
 * What is missing before the PR can be merged, in one line: the draft state, the conflicts and the blocking
 * policies that are not satisfied. Undefined when nothing is known to be missing and the policies are unknown
 */
export function nextStep(pr: AuthoredPullRequest, extras: PullRequestExtras): string | undefined {
  const steps: string[] = [];
  if (pr.isDraft) {
    steps.push('Publish the draft');
  }
  if (pr.mergeStatus === 'conflicts') {
    steps.push('Resolve the conflicts');
  }
  steps.push(...feedbackSteps(pr));
  for (const evaluation of extras.evaluations ?? []) {
    if (evaluation.isBlocking && !SATISFIED_STATUSES.includes(evaluation.status)) {
      steps.push(policyStep(evaluation, pr, extras));
    }
  }
  if (steps.length) {
    return [...new Set(steps)].join(' · ');
  }
  if (!extras.evaluations) {
    return undefined;
  }
  return pr.autoCompleteSetBy ? COMPLETES_BY_ITSELF : READY_TO_MERGE;
}

/**
 * A mistake of the auto-complete settings. "error": it breaks a rule that only someone else may act on
 * (completing a Bug is up to the testers); "warning": a team convention
 */
export interface PullRequestWarning {
  text: string;
  severity: 'error' | 'warning';
  /** A fix the card offers as a button */
  action?: 'addSkipTag' | 'retarget';
  actionLabel?: string;
}

/** Reviewers that must approve: people marked as required, not the author nor those who declined */
function countRequiredReviewers(pr: AuthoredPullRequest): number {
  return pr.reviewers.filter(
    (reviewer) =>
      reviewer.isRequired && !reviewer.isContainer && !reviewer.hasDeclined && reviewer.id !== pr.createdBy.id
  ).length;
}

const MIN_DESCRIPTION_LENGTH = 10;

/** Text of a markdown description without its syntax (link targets, markers) nor whitespace */
export function plainDescription(markdown: string | undefined): string {
  return (markdown ?? '')
    .replace(/\]\([^)]*\)/g, '')
    .replace(/[#*_`>\-[\]()!~|]/g, '')
    .replace(/\s+/g, '');
}

const stripHeads = (ref: string) => ref.replace(/^refs\/heads\//, '');

/** What the retarget check knows of the branches: the user's PRs, and the remote branches when known */
export interface RetargetContext {
  /** Team default base, e.g. "develop" */
  baseBranch: string;
  /** The user's PRs (active and completed): a completed one whose source is the target is a merged base */
  pullRequests: Pick<
    AuthoredPullRequest,
    'pullRequestId' | 'status' | 'sourceRefName' | 'targetRefName' | 'repository'
  >[];
  /** Remote branches of the PR's repository, when already known (nothing is requested for it) */
  remoteBranches?: ReadonlySet<string>;
}

/**
 * An active PR that targets a branch other than the base, whose own base is gone: its PR was completed (the changes
 * were squash-merged into the base) or the branch no longer exists. Offers to retarget it to the base branch
 */
export function retargetWarnings(pr: AuthoredPullRequest, context: RetargetContext): PullRequestWarning[] {
  const target = stripHeads(pr.targetRefName);
  if (pr.status !== 'active' || target === context.baseBranch) {
    return [];
  }
  const merged = context.pullRequests.find(
    (other) =>
      other.status === 'completed' &&
      other.sourceRefName === pr.targetRefName &&
      other.repository.id === pr.repository.id
  );
  let reason: string | undefined;
  if (merged) {
    reason = `Its base PR ${merged.pullRequestId} was completed`;
  } else if (context.remoteBranches && !context.remoteBranches.has(target)) {
    reason = `Its base branch ${target} no longer exists`;
  }
  if (!reason) {
    return [];
  }
  return [
    {
      text: `${reason}: retarget to ${context.baseBranch}`,
      severity: 'warning',
      action: 'retarget',
      actionLabel: `Retarget to ${context.baseBranch}`,
    },
  ];
}

const BACKLOG_TYPES = ['Product Backlog Item', 'User Story', 'Bug'];

export interface WarningOptions {
  /** 0 disables the check of the required reviewers */
  minimumRequiredReviewers: number;
  /** The build notes rule; unchecked when undefined */
  buildNotes?: BuildNotesOptions;
}

export const DEFAULT_WARNING_OPTIONS: WarningOptions = { minimumRequiredReviewers: 2 };

/** The team rules a published PR breaks. Never for drafts nor for PRs that are not active */
export function ruleWarnings(
  pr: AuthoredPullRequest,
  extras: Pick<PullRequestExtras, 'buildNotes' | 'workItems'>,
  options: WarningOptions
): PullRequestWarning[] {
  if (pr.isDraft || pr.status !== 'active') {
    return [];
  }
  const warnings: string[] = [];
  if (!isValidPullRequestTitle(pr.title)) {
    warnings.push('The title does not follow "[<IDs>] <Feature Name>: <description>"');
  }
  if (plainDescription(pr.description).length < MIN_DESCRIPTION_LENGTH) {
    warnings.push('Add a short description of the changes');
  }
  const missing = options.minimumRequiredReviewers - countRequiredReviewers(pr);
  if (options.minimumRequiredReviewers > 0 && missing > 0) {
    warnings.push(
      `Add ${missing} more required reviewer${missing === 1 ? '' : 's'} (team rule: at least ${
        options.minimumRequiredReviewers
      })`
    );
  }
  // Only when the linked work items are known
  if (extras.workItems && !extras.workItems.some((item) => BACKLOG_TYPES.includes(item.type))) {
    warnings.push('Link the Backlog Item or Bug of this PR');
  }
  const found = warnings.map((text): PullRequestWarning => ({ text, severity: 'warning' }));
  if (options.buildNotes && needsBuildNotesWarning(pr, extras.buildNotes, options.buildNotes)) {
    found.push({
      text: buildNotesWarningText(options.buildNotes),
      severity: 'warning',
      action: 'addSkipTag',
      actionLabel: `Add tag ${options.buildNotes.skipTag}`,
    });
  }
  return found;
}

export const BUG_AUTOCOMPLETE_WARNING =
  "Auto-complete shouldn't complete the linked Bug: Only testers have that prerogative.";

/** Mistakes of the auto-complete settings: only while auto-complete is set */
export function autoCompleteWarnings(
  pr: AuthoredPullRequest,
  extras: Pick<PullRequestExtras, 'workItems'>
): PullRequestWarning[] {
  const warnings: PullRequestWarning[] = [];
  if (pr.autoCompleteSetBy) {
    if (pr.completionOptions?.transitionWorkItems === true && extras.workItems?.some((item) => item.type === 'Bug')) {
      warnings.push({ text: BUG_AUTOCOMPLETE_WARNING, severity: 'error' });
    }
    if (pr.completionOptions?.deleteSourceBranch !== true) {
      warnings.push({
        text: 'Auto-complete will not delete the branch (team rule: delete branches after merging)',
        severity: 'warning',
      });
    }
  }
  return warnings;
}

/**
 * A reviewer sent the PR back: the author has to act. "Rejected" is an error, "Waiting for author" a warning. Both
 * keep the PR from being "Ready to merge" and make it count in the Summary's PRs with warnings
 */
export function feedbackWarnings(pr: AuthoredPullRequest): PullRequestWarning[] {
  if (pr.status !== 'active') {
    return [];
  }
  const { waiting, rejected } = feedbackReviewers(pr);
  const who = (names: string[]) => names.join(', ');
  return [
    ...(rejected.length
      ? [{ text: `Rejected by ${who(rejected)}: talk to them before going on`, severity: 'error' as const }]
      : []),
    ...(waiting.length
      ? [
          {
            text: `${who(waiting)} ${
              waiting.length === 1 ? 'is' : 'are'
            } waiting for you: address their comments, then ask for a new review`,
            severity: 'warning' as const,
          },
        ]
      : []),
  ];
}

/** Mistakes of the auto-complete settings and rules of the team the PR breaks, the most serious first */
export function pullRequestWarnings(
  pr: AuthoredPullRequest,
  extras: Pick<PullRequestExtras, 'buildNotes' | 'workItems'>,
  options: WarningOptions = DEFAULT_WARNING_OPTIONS
): PullRequestWarning[] {
  return [...feedbackWarnings(pr), ...autoCompleteWarnings(pr, extras), ...ruleWarnings(pr, extras, options)];
}

/**
 * Nothing stops the PR from being merged: active, published, no conflicts, no warnings, the policies are
 * known and every blocking one is satisfied (the approvals included)
 */
export function isReadyToMerge(
  pr: AuthoredPullRequest,
  extras: Pick<PullRequestExtras, 'evaluations'>,
  warnings: PullRequestWarning[]
): boolean {
  if (
    pr.status !== 'active' ||
    pr.isDraft ||
    pr.mergeStatus === 'conflicts' ||
    warnings.length ||
    !extras.evaluations
  ) {
    return false;
  }
  return extras.evaluations.every(
    (evaluation) => !evaluation.isBlocking || SATISFIED_STATUSES.includes(evaluation.status)
  );
}

/**
 * Tone of the "Next" line: "danger" when a warning is an error (the text may sound like good news),
 * "ready" for the states without blockers, "pending" otherwise
 */
export type NextTone = 'ready' | 'danger' | 'pending';

export function nextTone(next: string | undefined, warnings: PullRequestWarning[]): NextTone {
  if (warnings.some((warning) => warning.severity === 'error')) {
    return 'danger';
  }
  return next === READY_TO_MERGE || next === COMPLETES_BY_ITSELF ? 'ready' : 'pending';
}

export type VoteKind = 'approved' | 'declined' | 'none' | 'rejected' | 'suggestions' | 'waiting';

export function voteKind(reviewer: Pick<AuthoredReviewer, 'hasDeclined' | 'vote'>): VoteKind {
  if (reviewer.hasDeclined) {
    return 'declined';
  }
  if (reviewer.vote >= VOTE_APPROVED) {
    return 'approved';
  }
  if (reviewer.vote >= VOTE_APPROVED_WITH_SUGGESTIONS) {
    return 'suggestions';
  }
  if (reviewer.vote <= VOTE_REJECTED) {
    return 'rejected';
  }
  return reviewer.vote <= VOTE_WAITING_FOR_AUTHOR ? 'waiting' : 'none';
}

export interface ReviewerModel {
  name: string;
  /** The user of the extension (only set in the cards of the PRs to review) */
  isMe?: boolean;
  vote: VoteKind;
  isRequired: boolean;
  /** A group (e.g. a team): it votes through its members */
  isContainer: boolean;
}

/** The author is left out: they appear in the reviewers when they added themselves. Required ones first */
export function reviewerModels(
  pr: Pick<AuthoredPullRequest, 'reviewers'> & { createdBy: { id?: string } },
  myId?: string
): ReviewerModel[] {
  return pr.reviewers
    .filter((reviewer) => reviewer.id !== pr.createdBy.id)
    .map((reviewer) => ({
      name: reviewer.displayName,
      vote: voteKind(reviewer),
      isRequired: !!reviewer.isRequired,
      isContainer: !!reviewer.isContainer,
      ...(myId && reviewer.id === myId ? { isMe: true } : {}),
    }))
    .sort(
      (a, b) =>
        Number(!!b.isMe) - Number(!!a.isMe) ||
        Number(b.isRequired) - Number(a.isRequired) ||
        Number(a.isContainer) - Number(b.isContainer)
    );
}

export interface PhaseModel {
  kind: PhaseKind;
  label: string;
  /** Working time, e.g. "9 h" */
  duration: string;
  startText: string;
  endText: string;
  /** Of the total working time (0 to 1) */
  share: number;
}

export interface PhaseEventModel {
  kind: PhaseEventKind;
  /** Where it falls along the working time of the PR (0 to 1) */
  share: number;
  text: string;
  when: string;
}

export interface MyPullRequestModel {
  id: number;
  title: string;
  repository: string;
  repositoryId: string;
  url: string;
  /** Without "refs/heads/" */
  sourceBranch: string;
  /** Only when the PR does not merge into the base branch, e.g. "release/x" */
  target?: string;
  /** "1 d 2 h" since the PR was published (created, for the drafts); "completed 3 h ago" for the completed ones */
  time: string;
  /** What happened to the PR, oldest first */
  timeline: Timeline;
  /** Linked work items; the type is known for the ones that could be fetched */
  workItems: { id: number; type?: string }[];
  status: string;
  tone: PullRequestTone;
  isDraft: boolean;
  /** Completed in the last 24 hours: shown faded, without details */
  isCompleted: boolean;
  /** Completed PRs: working time from creation to completion, e.g. "1 d 6 h" */
  took?: string;
  /** Completed PRs: the phases in order; the shares add up to 1 */
  phases?: PhaseModel[];
  /** Completed PRs: the events to mark along the phases */
  phaseEvents?: PhaseEventModel[];
  /** Completed PRs: total time per phase, in order of first appearance (a phase can happen several times) */
  phaseTotals?: { kind: PhaseModel['kind']; label: string; duration: string }[];
  reviewers: ReviewerModel[];
  /** Undefined when the comments could not be fetched */
  unresolved?: number;
  conflicts: boolean;
  runs: RunModel[];
  autoComplete: boolean;
  warnings: PullRequestWarning[];
  /** Nothing stops the PR from being merged (approvals included) */
  readyToMerge: boolean;
  next?: string;
  nextTone: NextTone;
  /** The PR belongs to the repository open in VS Code: its branch can be checked out */
  canCheckout?: boolean;
  /** Its branch is the one checked out */
  isCurrentBranch?: boolean;
  /** Another worktree has its branch checked out: its folder */
  worktree?: string;
}

/** "25 min", "5 h", "1 d 2 h" */
export function formatAge(milliseconds: number): string {
  const ms = Math.max(0, milliseconds);
  if (ms < MS_PER_HOUR) {
    return `${Math.floor(ms / MS_PER_MINUTE)} min`;
  }
  const hours = Math.floor(ms / MS_PER_HOUR);
  return hours < HOURS_PER_DAY ? `${hours} h` : `${Math.floor(hours / HOURS_PER_DAY)} d ${hours % HOURS_PER_DAY} h`;
}

export interface ListOptions {
  now: Date;
  /** Formats the dates of the timeline; the local time by default */
  formatDate?: (isoDate: string) => string;
  baseBranch: string;
  showDrafts: boolean;
  /** How far back the completed PRs are listed (default: the last 24 hours) */
  completedPeriod?: CompletedPeriod;
  minimumRequiredReviewers: number;
  buildNotes?: BuildNotesOptions;
  /** Weekdays that count as waiting time of the published PRs (0 is Sunday); Monday to Friday by default */
  workingDays?: readonly number[];
  /** Remote branches of each repository (by lowercase name), when already known: a PR whose target is gone is flagged */
  remoteBranches?: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Completed no longer than windowMs ago (a window of 0 matches nothing) */
export function isCompletedWithin(pr: AuthoredPullRequest, now: Date, windowMs: number): boolean {
  return (
    windowMs > 0 &&
    pr.status === 'completed' &&
    !!pr.closedDate &&
    now.getTime() - Date.parse(pr.closedDate) <= windowMs
  );
}

/** When the PR started to wait for reviewers: its publication (the creation for the drafts) */
function waitingSince({ pr, extras }: AuthoredPullRequestData): string {
  return pr.isDraft ? pr.creationDate : publishedAt(pr, extras.threads);
}

/** How long the PR has been waiting: working time once published (as the reviewers see it), calendar time for a draft */
function waitingTime(data: AuthoredPullRequestData, now: Date, workingDays: readonly number[]): string {
  const since = new Date(waitingSince(data));
  return formatAge(data.pr.isDraft ? now.getTime() - since.getTime() : workingMsBetween(since, now, workingDays));
}

/** Working time per phase kind, summed over its segments, in order of first appearance */
export function phaseTotals(
  segments: PullRequestPhases['segments']
): { kind: PullRequestPhases['segments'][number]['kind']; label: string; duration: string }[] {
  const totals = new Map<PullRequestPhases['segments'][number]['kind'], number>();
  segments.forEach((segment) => totals.set(segment.kind, (totals.get(segment.kind) ?? 0) + segment.ms));
  return [...totals].map(([kind, ms]) => ({ kind, label: PHASE_LABELS[kind], duration: formatAge(ms) }));
}

/** Completed PRs: how long they took and the time spent in each phase */
function phaseFields(
  phases: PullRequestPhases | undefined,
  format: (isoDate: string) => string
): Pick<MyPullRequestModel, 'took' | 'phases' | 'phaseEvents' | 'phaseTotals'> {
  if (!phases) {
    return {};
  }
  return {
    took: formatAge(phases.totalMs),
    phases: phases.segments.map((segment) => ({
      kind: segment.kind,
      label: PHASE_LABELS[segment.kind],
      duration: formatAge(segment.ms),
      startText: format(segment.start),
      endText: format(segment.end),
      share: segment.share,
    })),
    phaseTotals: phaseTotals(phases.segments),
    phaseEvents: phases.events.map((event) => ({
      kind: event.kind,
      share: event.share,
      text: event.text,
      when: format(event.at),
    })),
  };
}

function toModel(
  { pr, extras }: AuthoredPullRequestData,
  options: ListOptions,
  all: AuthoredPullRequestData[]
): MyPullRequestModel {
  const {
    now,
    baseBranch,
    minimumRequiredReviewers,
    buildNotes,
    formatDate,
    workingDays = DEFAULT_WORKING_DAYS,
  } = options;
  const { label, tone } = pullRequestStatus(pr);
  const isCompleted = pr.status === 'completed';
  const target = stripHeads(pr.targetRefName);
  const base = {
    id: pr.pullRequestId,
    title: pr.title,
    repository: pr.repository.name,
    repositoryId: pr.repository.id,
    url: pr.webUrl,
    sourceBranch: stripHeads(pr.sourceRefName),
    target: target === baseBranch ? undefined : target,
    workItems: extras.workItems ?? [],
    timeline: buildTimeline(pr, extras.threads, formatDate),
    status: label,
    tone,
    isDraft: pr.isDraft,
    isCompleted,
  };
  if (isCompleted) {
    const ago = formatAge(now.getTime() - Date.parse(pr.closedDate ?? ''));
    const fields = phaseFields(pullRequestPhases(pr, extras.threads, workingDays), formatDate ?? formatTimelineDate);
    return {
      ...base,
      ...fields,
      time: `completed ${ago} ago${fields.took ? ` · took ${fields.took}` : ''}`,
      reviewers: [],
      conflicts: false,
      runs: [],
      autoComplete: false,
      warnings: [],
      readyToMerge: false,
      nextTone: 'pending',
    };
  }
  const warnings = [
    ...pullRequestWarnings(pr, extras, { minimumRequiredReviewers, buildNotes }),
    ...retargetWarnings(pr, {
      baseBranch,
      pullRequests: all.map((entry) => entry.pr),
      remoteBranches: options.remoteBranches?.get(pr.repository.name.toLowerCase()),
    }),
  ];
  const next = nextStep(pr, extras);
  return {
    ...base,
    time: waitingTime({ pr, extras }, now, workingDays),
    reviewers: reviewerModels(pr),
    unresolved: extras.unresolvedThreads,
    conflicts: pr.mergeStatus === 'conflicts',
    runs: extras.runs,
    autoComplete: !!pr.autoCompleteSetBy,
    warnings,
    readyToMerge: isReadyToMerge(pr, extras, warnings),
    next,
    nextTone: nextTone(next, warnings),
  };
}

/** Active non-draft PRs (oldest publication first), then the drafts, then the recently completed (latest first) */
function compare(a: AuthoredPullRequestData, b: AuthoredPullRequestData): number {
  const rank = ({ pr }: AuthoredPullRequestData) => {
    if (pr.status === 'completed') {
      return 2;
    }
    return pr.isDraft ? 1 : 0;
  };
  if (rank(a) !== rank(b)) {
    return rank(a) - rank(b);
  }
  if (a.pr.status === 'completed') {
    return (b.pr.closedDate ?? '').localeCompare(a.pr.closedDate ?? '');
  }
  return waitingSince(a).localeCompare(waitingSince(b));
}

export interface MyPullRequestList {
  items: MyPullRequestModel[];
  hiddenDrafts: number;
  hiddenCompleted: number;
  /** E.g. "Completed PRs: median 1 d 2 h, mostly waiting for review"; undefined with fewer than 2 completed PRs */
  completedSummary?: string;
}

/**
 * The PRs to list: the active ones and those completed within the period. Abandoned PRs are never listed.
 * Drafts can be hidden, and so can the completed PRs (period "hidden"): they are counted (the completed ones
 * of the last 24 hours), so the box can say so
 */
export function toMyPullRequestModels(data: AuthoredPullRequestData[], options: ListOptions): MyPullRequestList {
  const period = options.completedPeriod ?? 'day';
  const windowMs = completedWindowMs(period);
  const listed = data.filter(({ pr }) => pr.status === 'active' || isCompletedWithin(pr, options.now, windowMs));
  const hiddenDrafts = options.showDrafts ? 0 : listed.filter(({ pr }) => pr.isDraft).length;
  const hiddenCompleted =
    period === 'hidden' ? data.filter(({ pr }) => isCompletedWithin(pr, options.now, COMPLETED_WINDOW_MS)).length : 0;
  const shown = listed.filter(({ pr }) => options.showDrafts || !pr.isDraft).sort(compare);
  const completedSummary = summarizeCompleted(
    shown
      .filter(({ pr }) => pr.status === 'completed')
      .map(({ pr, extras }) => pullRequestPhases(pr, extras.threads, options.workingDays)),
    formatAge
  );
  return {
    items: shown.map((entry) => toModel(entry, options, data)),
    hiddenDrafts,
    hiddenCompleted,
    completedSummary,
  };
}
