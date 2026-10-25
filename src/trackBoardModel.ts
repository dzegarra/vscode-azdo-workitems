/**
 * The Track board (redesign): the user's Backlog Items and Bugs of the sprint as cards in six columns, one per
 * station of the track, plus the PRs they review. Everything comes from models the sidebar already has (work items,
 * My Pull Requests, review requests) and from the track (src/track.ts), so the board and the sidebar never
 * disagree. Pure, so no "vscode" import: the webview uses the types and the panel builds the model
 */
import { beforeCompletion, type CompletionCheck } from './beforeCompletion';
import { worstRunState } from './compactSignals';
import { nowQueue, type Verb } from './nowQueue';
import type { MyPullRequestModel, ReviewerModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import type { ReviewRequestModel } from './reviewRequests';
import type { SprintProgress } from './sprintCountdown';
import { isFinishedState, isNotStartedState, stateCategory } from './states';
import { branchLocationText, stationNotes } from './stationNotes';
import { taskProgress, taskProgressTooltip, type TaskSegmentCategory } from './taskProgress';
import { stationStateLabel } from './trackHtml';
import type { PullRequestTone } from './workItemLinks';
import {
  currentStation,
  openPullRequests,
  tasksOf,
  trackPullRequest,
  workItemTrack,
  type Station,
  type StationState,
} from './track';
import { branchActions, type PullRequestModel, type WebviewMessage, type WorkItemModel } from './viewModel';

export type BoardColumnId = 'branch' | 'ci' | 'done' | 'ready' | 'review' | 'toStart';

export const COLUMN_ORDER: readonly BoardColumnId[] = ['toStart', 'branch', 'ci', 'review', 'ready', 'done'];

/** The two type chips of the header */
export type BoardKind = 'backlog' | 'bug';

export const ALL_KINDS: readonly BoardKind[] = ['backlog', 'bug'];

/** Messages of the board: the buttons post the messages of the sidebar, so the same code runs them */
export type BoardMessage = WebviewMessage | { type: 'setBoardKinds'; kinds: BoardKind[] };

export type CardTone = 'active' | 'broken' | 'done' | 'needsYou' | 'neutral' | 'ship';

export interface BoardAction {
  label: string;
  /** What the button posts */
  message: WebviewMessage;
}

export interface BoardFact {
  label: string;
  value: string;
  tone?: 'broken' | 'needsYou' | 'passed';
}

export interface BoardStation {
  label: string;
  state: StationState;
  detail?: string;
  /** The station to look at */
  current: boolean;
}

/** A station of the drawer's list: its state in words and the note lines of the Work Item Details panel */
export interface BoardStationDetail extends BoardStation {
  /** "passed", "in progress", "needs you", "breaks a team rule", "not reached" */
  stateText: string;
  notes: string[];
}

/** A PR of the work item, in the drawer */
export interface BoardPullRequest {
  id: number;
  title: string;
  status: string;
  tone: PullRequestTone;
  /** The PR the track follows (TRACK-1) */
  followed: boolean;
  /** Only when it is in another repository */
  repository?: string;
  ci?: { text: string; tone?: BoardFact['tone'] };
  /** The user's own PR only: "Ana ✓, Jonas (waits for the author)" */
  reviewers?: string;
  /** The user's own PR only: the warnings of My Pull Requests */
  warnings: string[];
  /** "ready to merge", "auto-complete set", "conflicts" */
  flags: string[];
  open: BoardAction;
}

/** A task of the work item, in the drawer */
export interface BoardTask {
  id: number;
  title: string;
  state: string;
  category: TaskSegmentCategory;
  /** Only the tasks outside the list know who has them */
  assignee?: string;
  /** Not done: an open task sends a merged PR back to coding (TRACK-7) */
  open: boolean;
  /** Open, and the PR the track follows is merged: this is what keeps the work item out of Done */
  keepsOutOfDone: boolean;
  openDetails: BoardAction;
}

/** What the drawer shows to explain the column of a work item (BOARD-16) */
export interface BoardDetail {
  stations: BoardStationDetail[];
  pullRequests: BoardPullRequest[];
  /** A split work item (BOARD-20): "Pull requests · 5 open · 3 merged" */
  pullRequestsTitle?: string;
  /** A split work item: its merged and abandoned PRs, summarized (they have no card) */
  closedPullRequests?: { label: string; titles: string };
  tasks?: { summary: string; items: BoardTask[] };
  /** State, branches, not updated… */
  facts: BoardFact[];
  /** "Before completion", or "Broken rules" for a finished work item */
  checksTitle: string;
  checks: CompletionCheck[];
}

/** "Why CI" and the sentence behind it (BOARD-16) */
export interface BoardWhy {
  title: string;
  text: string;
}

/** The "NEEDS YOU" box of the drawer */
export interface BoardNeed {
  /** "CI FAILED", "WAITING FOR THE AUTHOR"… */
  title: string;
  text: string;
  /** Names of the failed tests, when the run model has them */
  tests: string[];
  actions: BoardAction[];
}

/** What a card of a split work item stands for (BOARD-20): one open PR, the tasks to do, or one task without a PR */
export type CardPart = 'pr' | 'task' | 'tasks';

export interface BoardWorkCard {
  kind: 'work';
  /** The work item */
  id: number;
  /** Unique and stable: "67145", "67145:pr:14021", "67145:tasks", "67145:task:70012" (BOARD-20) */
  key: string;
  /** Undefined: the one card of a work item with no more than one open PR */
  part?: CardPart;
  /** The PR of a PR card */
  prId?: number;
  /** The card of the work item itself: the only one, or the one of the PR the track follows (TRACK-1) */
  primary: boolean;
  /** Title of the work item (the title of a PR card is the PR's) */
  itemTitle: string;
  /** Short tag at the right of the header: "tasks", "no PR yet" */
  tag?: string;
  /** A line of small print under the status: the first tasks to do */
  note?: string;
  /** "Why on 6 cards" (BOARD-23); only the cards of a split work item */
  split?: BoardWhy;
  /** Keys of the other cards of the same work item (BOARD-14) */
  siblings: string[];
  column: BoardColumnId;
  itemKind: BoardKind;
  title: string;
  /** "#43751 · Bug · P1" */
  header: string;
  /** "Backlog Item · P2 · Committed" */
  subtitle: string;
  tone: CardTone;
  status?: { text: string; tone: 'broken' | 'needsYou' | 'normal' | 'passed' };
  /** Short "needs you" verb of the Now queue: "fix tests" */
  verb?: string;
  /** "zZ 3d" (REMIND-1) */
  asleep?: { days: number; text: string };
  /** The user is working on it */
  here?: boolean;
  /** The most urgent card: the first row of the Now queue (BOARD-10) */
  current?: boolean;
  action?: BoardAction;
  track: BoardStation[];
  need?: BoardNeed;
  why: BoardWhy;
  detail: BoardDetail;
  /** The rows of the hover summary */
  hover: BoardFact[];
  /** Work items on the board linked to this one: predecessors, successors, duplicates */
  related: number[];
  /** Buttons of the drawer footer */
  checkout?: BoardAction;
  openPullRequest?: BoardAction;
}

export interface BoardReviewCard {
  kind: 'review';
  /** The PR id */
  id: number;
  column: BoardColumnId;
  title: string;
  header: string;
  author: string;
  isRequired: boolean;
  /** "5 h left", "-3 h" */
  deadline: string;
  urgency: ReviewRequestModel['urgency'];
  /** Share of the maximum wait already used, 0 to 1 */
  elapsed: number;
  status?: { text: string; tone: 'passed' | 'normal' };
  /** The card of the most urgent row of the Now queue (BOARD-10) */
  current?: boolean;
  /** CI still running: the clock started, the review has not begun */
  ciRunning: boolean;
  why: BoardWhy;
  facts: BoardFact[];
  hover: BoardFact[];
  /** "19 h of 24 h · due Mon 10:00" */
  deadlineText: string;
  checkout?: BoardAction;
  openPullRequest: BoardAction;
}

export interface BoardSummaryCard {
  /** Finished work items without a broken rule, collapsed into one card */
  ids: number[];
}

export interface BoardColumn {
  id: BoardColumnId;
  title: string;
  hint: string;
  /** Work items in the column, the collapsed ones included */
  count: number;
  /** PRs to review in the column */
  reviewCount: number;
}

export interface BoardModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  /** Sprint name, "2 days left" and whether it is time to hurry */
  header: { sprint: string; left?: string; hurry: boolean; tooltip?: string };
  kinds: BoardKind[];
  columns: BoardColumn[];
  work: BoardWorkCard[];
  summary: BoardSummaryCard;
  reviews: BoardReviewCard[];
  /** Why the PRs to review are missing, when they could not be checked */
  notes: string[];
  /** Colours and fonts (Rule LOOK-1) */
  look: 'theme' | 'totalflow';
  popoverDelay: number;
}

export interface BoardInput {
  status: BoardModel['status'];
  error?: string;
  workItems: WorkItemModel[];
  myPullRequests: MyPullRequestModel[];
  reviews: ReviewRequestModel[];
  reviewsStatus: 'error' | 'loading' | 'ready';
  reviewsError?: string;
  maxWaitHours: number;
  iterations: { name: string; finishDate?: string; progress?: SprintProgress }[];
  kinds: BoardKind[];
  look: BoardModel['look'];
  popoverDelay: number;
}

const COLUMN_TITLES: Record<BoardColumnId, string> = {
  toStart: 'To start',
  branch: 'Branch · Draft',
  ci: 'CI',
  review: 'Review',
  ready: 'Ready to be merged',
  done: 'Done',
};

const isBug = (item: Pick<WorkItemModel, 'type'>): boolean => item.type === 'Bug';

const firstName = (name: string): string => name.split(' ').at(0) ?? name;

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

// Rule BOARD-1
/** The cards of the board: Backlog Items and Bugs (no tasks) in the types chosen, never the removed ones */
export function boardItems(workItems: WorkItemModel[], kinds: readonly BoardKind[]): WorkItemModel[] {
  return workItems.filter(
    (item) =>
      item.type !== 'Task' && stateCategory(item.state) !== 'removed' && kinds.includes(isBug(item) ? 'bug' : 'backlog')
  );
}

/** The first station after the pull request one that is not passed (a published PR that breaks a rule of its own) */
function firstOpenAfterPullRequest(track: Station[]): Station | undefined {
  const index = track.findIndex((station) => station.id === 'pullRequest');
  return track.slice(index + 1).find((station) => station.state !== 'done');
}

function columnOfStation(station: Station): BoardColumnId {
  switch (station.id) {
    case 'branch':
    case 'pullRequest':
      return 'branch';
    case 'ci':
      return 'ci';
    case 'review':
      return 'review';
    case 'ready':
      return 'ready';
    case 'done':
      return 'done';
  }
}

/** The column of a work item and the sentence that says why (BOARD-16): one function, so they never disagree */
export interface Placement {
  column: BoardColumnId;
  reason: string;
}

const stationReason = (station: Station): string =>
  `Current station: ${station.label}${station.detail ? ` — ${station.detail}` : ''}`;

/** The reason of a published PR that breaks a rule of its own (BOARD-4) */
function brokenPullRequestReason(pr: PullRequestModel, current: Station, next: Station | undefined): string {
  const own = `PR ${String(pr.id)} is published but ${current.detail ?? 'breaks a rule'}`;
  return next ? `${own} — the rest of its track is at ${next.label}` : own;
}

/** "PR 13912 merged · 1 task open: back to coding" (BOARD-3) */
function backToCodingReason(current: Station, pr: PullRequestModel | undefined, toStart: boolean): string {
  const detail = current.detail ?? 'PR merged';
  const text = pr ? detail.replace(/^PR merged/, `PR ${String(pr.id)} merged`) : detail;
  return `${text}: back to ${toStart ? 'the start' : 'coding'}`;
}

// Rules BOARD-2..5, BOARD-16
/**
 * The column of a work item, from its track so the board agrees with the sidebar, and why. Finished work items go to
 * Done; the current station (TRACK-9) says where an open one is
 */
export function placementOf(item: WorkItemModel, track: Station[], pr: PullRequestModel | undefined): Placement {
  // Rule BOARD-5
  if (isFinishedState(item.state)) {
    const broken = item.alerts.length ? ` · ${plural(item.alerts.length, 'rule')} broken` : '';
    return { column: 'done', reason: `Finished (${item.state})${broken}` };
  }
  const current = currentStation(track);
  // Rule BOARD-5: every station passed
  if (!current) {
    return { column: 'done', reason: 'Every station passed' };
  }
  // Rule BOARD-3 / BOARD-5: a merged PR with work left (Done station pending) goes back to coding
  if (current.id === 'done' && current.state === 'pending') {
    const toStart = isNotStartedState(item.state);
    return { column: toStart ? 'toStart' : 'branch', reason: backToCodingReason(current, pr, toStart) };
  }
  switch (current.id) {
    case 'branch':
      // Rule BOARD-3: nothing yet. Not started: To start; started without a branch (created elsewhere): coding
      return isNotStartedState(item.state)
        ? { column: 'toStart', reason: `Not started (${item.state}), no branch` }
        : { column: 'branch', reason: `Started (${item.state}), no branch yet` };
    case 'pullRequest': {
      // Rule BOARD-4: a draft or no PR yet is coding; a published PR that breaks a rule of its own stays where the
      // rest of its track is
      if (pr && pr.tone !== 'draft' && pr.tone !== 'abandoned') {
        const next = firstOpenAfterPullRequest(track);
        return {
          column: next ? columnOfStation(next) : 'done',
          reason: brokenPullRequestReason(pr, current, next),
        };
      }
      if (pr) {
        return {
          column: 'branch',
          reason:
            pr.tone === 'draft'
              ? `Draft PR ${String(pr.id)}: self-review, then publish`
              : `PR ${String(pr.id)} is ${pr.status}: no PR to follow`,
        };
      }
      return { column: 'branch', reason: 'Branch ready, no PR yet' };
    }
    case 'ci':
    case 'review':
    case 'ready':
    case 'done':
      return { column: columnOfStation(current), reason: stationReason(current) };
  }
}

// Rules BOARD-2..5
/** The column of a work item (see placementOf) */
export function columnOf(item: WorkItemModel, track: Station[], pr: PullRequestModel | undefined): BoardColumnId {
  return placementOf(item, track, pr).column;
}

// Rule BOARD-9
/** "fix tests", "answer Jonas", "complete it": the short form of why a work item is in the Now queue */
export function needsYouVerb(
  verb: Verb,
  current: Station | undefined,
  mine: Pick<MyPullRequestModel, 'conflicts' | 'reviewers'> | undefined,
  runs: RunModel[]
): string {
  switch (verb) {
    case 'ship':
      return 'complete it';
    case 'fix':
      return 'fix rules';
    case 'review':
    case 'clean':
      return '';
    case 'unblock': {
      if (current?.id === 'ci') {
        return runs.some((run) => (run.tests?.failed ?? 0) > 0) ? 'fix tests' : 'fix CI';
      }
      const sentBack = mine?.reviewers.find((reviewer) => reviewer.vote === 'waiting' || reviewer.vote === 'rejected');
      if (sentBack) {
        return `answer ${firstName(sentBack.name)}`;
      }
      if (mine?.conflicts) {
        return 'resolve conflicts';
      }
      return current?.id === 'ready' ? 'fix auto-complete' : 'unblock PR';
    }
  }
}

const VOTE_MARKS: Record<ReviewerModel['vote'], string> = {
  approved: ' ✓',
  declined: ' (declined)',
  none: '',
  rejected: ' (rejected)',
  suggestions: ' (suggestions)',
  waiting: ' (waits for the author)',
};

function reviewersText(reviewers: ReviewerModel[]): string {
  return reviewers
    .filter((reviewer) => !reviewer.isContainer)
    .map((reviewer) => `${reviewer.isMe ? 'You' : reviewer.name}${VOTE_MARKS[reviewer.vote]}`)
    .join(', ');
}

/** The run that matters most, its text and the failed tests it names */
function ciSummary(runs: RunModel[]): { text: string; tone?: BoardFact['tone']; failedTests: string[] } | undefined {
  const state = worstRunState(runs);
  const run = runs.find((candidate) => candidate.state === state);
  if (!state || !run) {
    return undefined;
  }
  const failed = run.tests?.failed ?? 0;
  const total = run.tests?.total;
  switch (state) {
    case 'failed':
    case 'partial': {
      const fallback = state === 'failed' ? 'failed' : 'partially succeeded';
      const what = failed
        ? `${String(failed)} of ${String(total ?? '?')} tests failed`
        : (run.failedStep && `failed at ${run.failedStep}`) || fallback;
      return {
        text: `${run.pipeline} · ${what}`,
        tone: 'needsYou',
        failedTests: run.tests?.failedTests.map((test) => test.title) ?? [],
      };
    }
    case 'running':
      return { text: `${run.pipeline} · running`, failedTests: [] };
    case 'queued':
      return { text: `${run.pipeline} · queued`, failedTests: [] };
    case 'succeeded':
    case 'canceled': {
      const parts = ['passed'];
      if (total !== undefined) {
        parts.push(plural(total, 'test'));
      }
      if (run.coverage) {
        const delta = run.coverage.delta;
        const arrow =
          delta === undefined || delta === 0 ? '' : ` ${delta > 0 ? '▲' : '▼'}${Math.abs(delta).toFixed(1)}`;
        parts.push(`${String(Math.round(run.coverage.percent))}%${arrow}`);
      }
      return { text: parts.join(' · '), tone: 'passed', failedTests: [] };
    }
  }
}

/** "2 tests failed" for the status line of a card in CI */
function failedTestsText(runs: RunModel[]): string | undefined {
  const state = worstRunState(runs);
  const run = runs.find((candidate) => candidate.state === state);
  if (!run || (state !== 'failed' && state !== 'partial')) {
    return undefined;
  }
  if (run.tests?.failed) {
    return `${plural(run.tests.failed, 'test')} failed`;
  }
  return run.failedStep ? `${run.failedStep} failed` : 'CI failed';
}

/**
 * The runs of the PR the track follows: the store's own (the track reads them, and the buttons open them by id),
 * else My Pull Requests' fetch
 */
function runsOf(pr: PullRequestModel | undefined, mine: MyPullRequestModel | undefined): RunModel[] {
  return pr?.runs.length ? pr.runs : mine?.runs ?? [];
}

type StatusLine = NonNullable<BoardWorkCard['status']>;

/** Approvals of the required reviewers: "1 of 2 approvals" */
function approvalsText(mine: MyPullRequestModel): string | undefined {
  const required = mine.reviewers.filter((reviewer) => reviewer.isRequired && !reviewer.isContainer);
  if (!required.length) {
    return undefined;
  }
  const approved = required.filter((reviewer) => reviewer.vote === 'approved').length;
  return `${String(approved)} of ${String(required.length)} approval${required.length === 1 ? '' : 's'}`;
}

// Rule BOARD-8
/** The one line under the title: the station detail that matters, from the data the models already carry */
function statusLine(
  item: WorkItemModel,
  column: BoardColumnId,
  current: Station | undefined,
  pr: PullRequestModel | undefined,
  mine: MyPullRequestModel | undefined
): StatusLine | undefined {
  const runs = runsOf(pr, mine);
  if (isFinishedState(item.state)) {
    if (item.alerts.length) {
      return { text: `${plural(item.alerts.length, 'rule')} broken`, tone: 'broken' };
    }
    return isBug(item) ? { text: 'Ready to Test · testers next', tone: 'passed' } : undefined;
  }
  if (current?.state === 'broken' && current.detail) {
    return { text: current.detail, tone: 'broken' };
  }
  if (current?.id === 'done' && current.state === 'pending' && current.detail) {
    return { text: current.detail, tone: 'needsYou' };
  }
  const blocked = item.blockingTags?.at(0);
  const waitsOn = item.openPredecessors?.at(0);
  switch (column) {
    case 'toStart':
      if (item.alerts.length) {
        return { text: `${plural(item.alerts.length, 'rule')} broken`, tone: 'broken' };
      }
      break;
    case 'branch':
      if (mine?.isDraft || pr?.tone === 'draft') {
        return { text: `Draft PR ${String(pr?.id ?? mine?.id)}`, tone: 'normal' };
      }
      if (item.branches.length) {
        return { text: `${item.branchLocation === 'remote' ? 'remote' : 'local'} branch · no PR`, tone: 'normal' };
      }
      return { text: 'no branch yet', tone: 'normal' };
    case 'ci': {
      const failed = failedTestsText(runs);
      if (failed) {
        return { text: failed, tone: 'broken' };
      }
      return { text: current?.detail ? `CI ${current.detail}` : 'CI not started', tone: 'normal' };
    }
    case 'review': {
      const sentBack = mine?.reviewers.find((r) => r.vote === 'waiting' || r.vote === 'rejected');
      if (sentBack && mine) {
        const text = `${firstName(sentBack.name)} ${sentBack.vote === 'waiting' ? 'waits' : 'rejected'}${
          mine.conflicts ? ' · conflicts' : ''
        }`;
        return { text, tone: 'needsYou' };
      }
      if (mine?.conflicts) {
        return { text: 'conflicts', tone: 'needsYou' };
      }
      return { text: (mine && approvalsText(mine)) ?? pr?.status ?? 'In review', tone: 'normal' };
    }
    case 'ready':
      return mine?.autoComplete
        ? { text: 'will complete automatically', tone: 'passed' }
        : { text: 'nothing in the way', tone: 'passed' };
    case 'done':
      break;
  }
  if (item.alerts.length) {
    return { text: `${plural(item.alerts.length, 'rule')} broken`, tone: 'broken' };
  }
  if (waitsOn) {
    return { text: `Waits on #${String(waitsOn.id)}`, tone: 'needsYou' };
  }
  if (blocked) {
    return { text: 'Blocked', tone: 'needsYou' };
  }
  return current?.state === 'needsYou' && current.detail ? { text: current.detail, tone: 'needsYou' } : undefined;
}

// Rule BOARD-7
function toneOf(
  item: WorkItemModel,
  column: BoardColumnId,
  current: Station | undefined,
  verb: Verb | undefined
): CardTone {
  if (isFinishedState(item.state)) {
    return item.alerts.length ? 'broken' : 'done';
  }
  if (verb === 'ship' || (column === 'ready' && current?.state === 'needsYou')) {
    return 'ship';
  }
  if (item.alerts.length || current?.state === 'broken' || item.blockingTags?.length) {
    return 'broken';
  }
  if (current?.state === 'needsYou' || verb) {
    return 'needsYou';
  }
  if (item.workingOn || current?.state === 'active') {
    return 'active';
  }
  return current?.state === 'done' ? 'done' : 'neutral';
}

function actionOf(
  item: WorkItemModel,
  column: BoardColumnId,
  mine: MyPullRequestModel | undefined
): BoardAction | undefined {
  // Rule BOARD-11: only buttons that exist elsewhere, offered under the same conditions
  if (column === 'toStart' && branchActions(item).includes('createBranch')) {
    return { label: 'Create branch', message: { type: 'createBranch', id: item.id } };
  }
  if (column === 'branch' && mine?.isDraft && !mine.isCompleted) {
    return { label: 'Publish', message: { type: 'publishMyPullRequest', pullRequestId: mine.id } };
  }
  if (column === 'ready' && mine?.canComplete) {
    return { label: 'Complete…', message: { type: 'completeMyPullRequest', pullRequestId: mine.id } };
  }
  return undefined;
}

// Rule BOARD-15
function needOf(
  item: WorkItemModel,
  current: Station | undefined,
  pr: PullRequestModel | undefined,
  mine: MyPullRequestModel | undefined
): BoardNeed | undefined {
  if (current?.state !== 'needsYou' || !pr) {
    return undefined;
  }
  const runs = runsOf(pr, mine);
  const open: BoardAction = {
    label: 'Open PR',
    message: { type: 'openPullRequest', id: item.id, pullRequestId: pr.id },
  };
  if (current.id === 'ci') {
    const ci = ciSummary(runs);
    const run = runs.find((candidate) => candidate.state === worstRunState(runs));
    return {
      title: 'CI FAILED',
      text: `PR ${String(pr.id)} · ${ci?.text ?? 'failed'}`,
      tests: ci?.failedTests ?? [],
      actions: run
        ? [
            { label: 'Show tests', message: { type: 'openRun', id: item.id, runId: run.id, view: 'tests' } },
            { label: 'Open run', message: { type: 'openRun', id: item.id, runId: run.id } },
          ]
        : [open],
    };
  }
  return {
    title: current.id === 'ready' ? 'READY TO COMPLETE' : `${current.label.toUpperCase()}: YOUR MOVE`,
    text: `PR ${String(pr.id)} · ${current.detail ?? 'needs you'}`,
    tests: [],
    actions: [open],
  };
}

function tasksText(item: WorkItemModel, workItems: WorkItemModel[]): string | undefined {
  const tasks = workItems.filter((child) => child.parentId === item.id && child.type === 'Task');
  if (!tasks.length) {
    return undefined;
  }
  const progress = taskProgress(tasks);
  return [
    progress.toDo ? `${String(progress.toDo)} to do` : '',
    progress.inProgress ? `${String(progress.inProgress)} in progress` : '',
    progress.done ? `${String(progress.done)} done` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function stationsOf(track: Station[], current: Station | undefined): BoardStation[] {
  return track.map((station) => ({
    label: station.label,
    state: station.state,
    detail: station.detail,
    current: station === current,
  }));
}

// Rule BOARD-17
/** The drawer's rows for the PRs of the work item: all of them, the followed one marked (BOARD-17) */
function pullRequestsDetail(
  item: WorkItemModel,
  followed: PullRequestModel | undefined,
  myPullRequests: MyPullRequestModel[]
): BoardPullRequest[] {
  return item.pullRequests.map((pr) => {
    const own = myPullRequests.find((candidate) => candidate.id === pr.id);
    const ci = ciSummary(runsOf(pr, own));
    const flags = [
      own?.readyToMerge ? 'ready to merge' : '',
      own?.autoComplete ? 'auto-complete set' : '',
      own?.conflicts ? 'conflicts' : '',
    ].filter(Boolean);
    return {
      id: pr.id,
      title: pr.title,
      status: pr.status,
      tone: pr.tone,
      followed: pr.id === followed?.id,
      repository: pr.otherRepository ? pr.repository : undefined,
      ci: ci ? { text: ci.text, tone: ci.tone } : undefined,
      reviewers: own?.reviewers.length ? reviewersText(own.reviewers) : undefined,
      warnings: own?.warnings.map((warning) => warning.text) ?? [],
      flags,
      open: { label: 'Open PR', message: { type: 'openPullRequest', id: item.id, pullRequestId: pr.id } },
    };
  });
}

// Rule BOARD-18
/** All the tasks (own list + other developers'), without the removed ones; open ones marked (BOARD-18) */
function tasksDetail(
  item: WorkItemModel,
  workItems: WorkItemModel[],
  followed: PullRequestModel | undefined
): BoardDetail['tasks'] {
  const own = workItems.filter((child) => child.parentId === item.id && child.type === 'Task');
  const rows = [
    ...own.map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      assignee: undefined as string | undefined,
    })),
    ...(item.otherTasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      assignee: task.assignedTo,
    })),
  ].filter((task) => stateCategory(task.state) !== 'removed');
  if (!rows.length) {
    return undefined;
  }
  const merged = followed?.tone === 'completed';
  return {
    summary: taskProgressTooltip(taskProgress(rows)),
    items: rows.map((task) => {
      const category = stateCategory(task.state);
      const open = category !== 'done';
      return {
        ...task,
        category: category === 'in-progress' || category === 'done' ? category : 'proposed',
        open,
        keepsOutOfDone: open && merged,
        openDetails: { label: 'Details', message: { type: 'openDetails', id: task.id } },
      };
    }),
  };
}

/** The checks of the work item; a finished one lists the rules it breaks (BOARD-19) */
function checksOf(item: WorkItemModel): Pick<BoardDetail, 'checks' | 'checksTitle'> {
  const checks = beforeCompletion(item);
  if (checks.length || !item.alerts.length) {
    return { checksTitle: 'Before completion', checks };
  }
  return {
    checksTitle: 'Broken rules',
    checks: item.alerts.map((alert): CompletionCheck => ({ severity: 'broken', text: alert.message })),
  };
}

/** State, branches and the forgotten badge: the facts of the rules that are not a list (BOARD-19) */
function factsOf(item: WorkItemModel): BoardFact[] {
  const state = item.displayState === item.state ? item.state : `${item.displayState} (${item.state})`;
  return [
    { label: 'State', value: state },
    ...item.branches.map((branch) => ({
      label: 'Branch',
      value: `${branch.name} · ${branchLocationText(branch)}${branch.repository ? ` · ${branch.repository}` : ''}`,
    })),
    ...(item.notUpdated ? [{ label: 'Not updated', value: item.notUpdated.text, tone: 'needsYou' as const }] : []),
  ];
}

// Rule BOARD-19
/** What the drawer lists to explain the column (BOARD-16..19) */
function detailOf(
  item: WorkItemModel,
  workItems: WorkItemModel[],
  track: Station[],
  current: Station | undefined,
  followed: PullRequestModel | undefined,
  mine: MyPullRequestModel | undefined,
  myPullRequests: MyPullRequestModel[],
  /** The work item as the card sees it (the PR of a split card): the station notes read it */
  view: WorkItemModel = item
): BoardDetail {
  const notes = stationNotes({ card: view, mine });
  return {
    stations: track.map((station) => ({
      label: station.label,
      state: station.state,
      detail: station.detail,
      current: station === current,
      stateText: stationStateLabel(station.state),
      notes: notes[station.id],
    })),
    pullRequests: pullRequestsDetail(item, followed, myPullRequests),
    tasks: tasksDetail(item, workItems, followed),
    facts: factsOf(item),
    ...checksOf(item),
  };
}

function relatedIds(item: WorkItemModel): number[] {
  return [
    ...(item.openPredecessors ?? []).map((link) => link.id),
    ...(item.fixesBugs ?? []).map((link) => link.id),
    ...(item.fixedBy ?? []).map((link) => link.id),
    ...(item.duplicateOf ?? []).map((link) => link.id),
    ...(item.duplicates ?? []).map((link) => link.id),
  ];
}

/** The queue row that makes a work item urgent: its alerts (by id) or its PR (by PR id) */
function queueVerbOf(item: WorkItemModel, queue: ReturnType<typeof nowQueue>['items']): Verb | undefined {
  const prIds = new Set(item.pullRequests.map((pr) => pr.id));
  return queue.find((row) => (row.verb === 'fix' ? row.id === item.id : row.verb !== 'review' && prIds.has(row.id)))
    ?.verb;
}

interface CardContext {
  workItems: WorkItemModel[];
  myPullRequests: MyPullRequestModel[];
  queue: ReturnType<typeof nowQueue>['items'];
}

interface CardPlan {
  key: string;
  part?: CardPart;
  primary: boolean;
  /** The Now queue verb of the card */
  verb: Verb | undefined;
  /** The one split card for a PR, or the whole work item's PRs */
  followed: PullRequestModel | undefined;
  /** The work item as the card sees it: the PRs of the card, the item-level things only on the primary card */
  view: WorkItemModel;
}

/** "[67145] Measurement update" -> "Measurement update" */
export function pullRequestTitle(title: string): string {
  return title.replace(/^\[\d+(?:,\s*\d+)*\]\s*/, '');
}

function buildCard(full: WorkItemModel, plan: CardPlan, ctx: CardContext): BoardWorkCard {
  const { view, followed, verb } = plan;
  const mine = followed ? ctx.myPullRequests.find((candidate) => candidate.id === followed.id) : undefined;
  const track = workItemTrack(view, mine, tasksOf(view, ctx.workItems));
  const current = isFinishedState(view.state) ? undefined : currentStation(track);
  const { column, reason } = placementOf(view, track, followed);
  const runs = runsOf(followed, mine);
  const priority = view.priority ? ` · P${String(view.priority)}` : '';
  const header = `#${String(view.id)}${isBug(view) ? ' · Bug' : ''}${priority}`;
  const tasks = tasksText(view, ctx.workItems);
  const ci = ciSummary(runs);
  const waitsOn = view.openPredecessors?.at(0);
  const hover: BoardFact[] = [
    ...(mine?.next || current?.detail ? [{ label: 'Next', value: mine?.next ?? current?.detail ?? '' }] : []),
    ...(followed
      ? [
          {
            label: 'PR',
            value: `${String(followed.id)}${
              mine && !mine.isDraft ? ` · published ${mine.time}` : ` · ${followed.status}`
            }`,
          },
        ]
      : []),
    ...(ci ? [{ label: 'CI', value: ci.text, tone: ci.tone }] : []),
    ...(tasks ? [{ label: 'Tasks', value: tasks }] : []),
    ...(waitsOn
      ? [
          {
            label: 'Waits on',
            value: `#${String(waitsOn.id)} (${[waitsOn.assignedTo ? firstName(waitsOn.assignedTo) : '', waitsOn.state]
              .filter(Boolean)
              .join(', ')})`,
            tone: 'needsYou' as const,
          },
        ]
      : []),
  ];
  // The checkout button is the work item's (its branch), so only its own card has it
  const checkout: BoardAction | undefined =
    plan.primary && branchActions(full).includes('checkout')
      ? { label: 'Checkout', message: { type: 'checkout', id: full.id } }
      : undefined;
  const split = plan.part === 'pr';
  return {
    kind: 'work',
    id: full.id,
    key: plan.key,
    part: plan.part,
    prId: split ? followed?.id : undefined,
    primary: plan.primary,
    itemTitle: full.title,
    siblings: [],
    column,
    itemKind: isBug(full) ? 'bug' : 'backlog',
    // Rule BOARD-21: the title of a PR card is the PR's, without the "[67145] " prefix of the naming convention
    title: split && followed ? pullRequestTitle(followed.title) : full.title,
    header: split && followed ? `${header} · PR ${String(followed.id)}` : header,
    subtitle: `${isBug(full) ? 'Bug' : 'Backlog Item'}${priority} · ${full.displayState}`,
    tone: toneOf(view, column, current, verb),
    status: statusLine(view, column, current, followed, mine),
    verb: verb && verb !== 'clean' ? needsYouVerb(verb, current, mine, runs) : undefined,
    asleep: view.notUpdated,
    here: view.workingOn !== undefined,
    action: actionOf(view, column, mine),
    track: stationsOf(track, current),
    need: needOf(view, current, followed, mine),
    why: { title: `Why ${COLUMN_TITLES[column]}`, text: reason },
    detail: detailOf(full, ctx.workItems, track, current, followed, mine, ctx.myPullRequests, view),
    hover,
    related: [],
    checkout,
    openPullRequest: followed
      ? { label: 'Open PR', message: { type: 'openPullRequest', id: full.id, pullRequestId: followed.id } }
      : undefined,
  };
}

interface TaskRow {
  id: number;
  title: string;
  state: string;
  /** PRs linked to the task */
  pullRequests: number;
  branch?: string;
}

/** All the tasks of a work item (own list + other developers'), not the removed ones */
function taskRows(item: WorkItemModel, workItems: WorkItemModel[]): TaskRow[] {
  return [
    ...workItems
      .filter((child) => child.parentId === item.id && child.type === 'Task')
      .map((task) => ({
        id: task.id,
        title: task.title,
        state: task.state,
        pullRequests: task.taskPullRequests?.length ?? 0,
        branch: task.taskBranches?.at(0)?.name,
      })),
    ...(item.otherTasks ?? []).map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      pullRequests: task.taskPullRequests.length,
      branch: task.taskBranches?.at(0)?.name,
    })),
  ].filter((task) => stateCategory(task.state) !== 'removed');
}

// Rule BOARD-23
/** "5 PRs open, 1 task in progress without a PR, 5 tasks to do. Done when all 15 tasks are." */
function splitWhy(cards: number, prs: number, noPr: number, toDo: number, total: number): BoardWhy {
  const parts = [
    prs ? `${plural(prs, 'PR')} open` : '',
    noPr ? `${plural(noPr, 'task')} in progress without a PR` : '',
    toDo ? `${plural(toDo, 'task')} to do` : '',
  ].filter(Boolean);
  const done = total === 1 ? 'Done when its task is.' : `Done when all ${String(total)} tasks are.`;
  return {
    title: `Why on ${String(cards)} cards`,
    text: `${parts.join(', ')}.${total ? ` ${done}` : ''}`,
  };
}

/** The drawer's PR section of a split work item: the open PRs, then the closed ones in one line (BOARD-17) */
function splitPullRequestsDetail(
  full: WorkItemModel,
  detail: BoardDetail,
  followed: PullRequestModel | undefined,
  myPullRequests: MyPullRequestModel[]
): BoardDetail {
  const open = new Set(openPullRequests(full).map((pr) => pr.id));
  const closed = full.pullRequests.filter((pr) => !open.has(pr.id));
  const merged = closed.filter((pr) => pr.tone === 'completed').length;
  const abandoned = closed.length - merged;
  const label = [merged ? `${String(merged)} merged` : '', abandoned ? `${String(abandoned)} abandoned` : '']
    .filter(Boolean)
    .join(' · ');
  return {
    ...detail,
    pullRequests: pullRequestsDetail(
      { ...full, pullRequests: full.pullRequests.filter((pr) => open.has(pr.id)) },
      followed,
      myPullRequests
    ).map((row) => ({ ...row, title: pullRequestTitle(row.title) })),
    pullRequestsTitle: `Pull requests · ${String(open.size)} open${label ? ` · ${label}` : ''}`,
    closedPullRequests: closed.length
      ? { label, titles: closed.map((pr) => pullRequestTitle(pr.title)).join(' · ') }
      : undefined,
  };
}

// Rule BOARD-20
/**
 * A work item with 2+ open PRs is split: one card per open PR (BOARD-21), one card for the tasks not started and one
 * for each task in progress without a PR (BOARD-22). Undefined: the work item keeps its one card
 */
function splitCards(full: WorkItemModel, ctx: CardContext): BoardWorkCard[] | undefined {
  const open = openPullRequests(full);
  if (isFinishedState(full.state) || open.length < 2) {
    return undefined;
  }
  const followed = trackPullRequest(full);
  const primaryId = followed && open.some((pr) => pr.id === followed.id) ? followed.id : open[0].id;
  const rows = taskRows(full, ctx.workItems);
  const toDo = rows.filter((task) => stateCategory(task.state) === 'proposed');
  const noPr = rows.filter((task) => stateCategory(task.state) === 'in-progress' && task.pullRequests === 0);
  const base = (primary: boolean): WorkItemModel =>
    primary
      ? full
      : {
          ...full,
          alerts: [],
          blockingTags: [],
          openPredecessors: [],
          workingOn: undefined,
          notUpdated: undefined,
        };
  const prCards = open.map((pr): BoardWorkCard => {
    const primary = pr.id === primaryId;
    // Rule BOARD-21
    const view: WorkItemModel = { ...base(primary), pullRequests: [pr] };
    const verb = ctx.queue.find((row) =>
      row.verb === 'fix' ? primary && row.id === full.id : row.verb !== 'review' && row.id === pr.id
    )?.verb;
    const card = buildCard(
      full,
      { key: `${String(full.id)}:pr:${String(pr.id)}`, part: 'pr', primary, verb, followed: pr, view },
      ctx
    );
    return { ...card, detail: splitPullRequestsDetail(full, card.detail, pr, ctx.myPullRequests) };
  });
  // Rule BOARD-22: the cards of the tasks have no PR: the track of the work item without PRs
  const noPrView: WorkItemModel = { ...base(false), pullRequests: [] };
  const partCard = (key: string, part: CardPart): BoardWorkCard => {
    const card = buildCard(
      full,
      { key, part, primary: false, verb: undefined, followed: undefined, view: noPrView },
      ctx
    );
    return {
      ...card,
      detail: splitPullRequestsDetail(full, card.detail, undefined, ctx.myPullRequests),
      action: undefined,
      checkout: undefined,
      openPullRequest: undefined,
      need: undefined,
      verb: undefined,
      here: false,
      asleep: undefined,
      tone: 'neutral',
    };
  };
  const taskCards = noPr.map((task): BoardWorkCard => {
    const card = partCard(`${String(full.id)}:task:${String(task.id)}`, 'task');
    return {
      ...card,
      column: 'branch',
      title: task.title,
      tag: 'no PR yet',
      status: { text: `task ${task.state} · ${task.branch ? `branch ${task.branch}` : 'no branch'}`, tone: 'normal' },
      why: { title: `Why ${COLUMN_TITLES.branch}`, text: `Task ${String(task.id)} is ${task.state} and has no PR yet` },
      hover: [{ label: 'Task', value: `#${String(task.id)} · ${task.state}` }],
    };
  });
  const toDoCards = toDo.length
    ? [
        (() => {
          const card = partCard(`${String(full.id)}:tasks`, 'tasks');
          const titles = toDo.slice(0, 3).map((task) => task.title);
          return {
            ...card,
            column: 'toStart' as const,
            tag: 'tasks',
            status: { text: `${plural(toDo.length, 'task')} to do`, tone: 'normal' as const },
            note: [...titles, ...(toDo.length > 3 ? [`+${String(toDo.length - 3)}`] : [])].join(' · '),
            why: {
              title: `Why ${COLUMN_TITLES.toStart}`,
              text: `${plural(toDo.length, 'task')} not started: ${toDo.map((task) => task.title).join(' · ')}`,
            },
            hover: [{ label: 'Tasks to do', value: toDo.map((task) => task.title).join(' · ') }],
          };
        })(),
      ]
    : [];
  const cards = [...prCards, ...taskCards, ...toDoCards];
  const why = splitWhy(cards.length, open.length, noPr.length, toDo.length, rows.length);
  return cards.map((card) => ({ ...card, split: why }));
}

/** The cards of a work item: one, or one per open PR when several are open at once (BOARD-20) */
function workCards(item: WorkItemModel, ctx: CardContext): BoardWorkCard[] {
  const split = splitCards(item, ctx);
  if (split) {
    return split;
  }
  const verb = queueVerbOf(item, ctx.queue);
  return [
    buildCard(item, { key: String(item.id), primary: true, verb, followed: trackPullRequest(item), view: item }, ctx),
  ];
}

// Rule BOARD-13
/** "5 h left" stays; "overdue by 3 h" becomes "-3 h" */
export function shortDeadline(timeLeft: string): string {
  const overdue = /^overdue by (.+)$/.exec(timeLeft);
  return overdue ? `-${overdue[1]}` : timeLeft;
}

// Rule BOARD-12
function reviewCard(review: ReviewRequestModel): BoardReviewCard {
  const details = review.details;
  const state = worstRunState(details?.runs ?? []);
  const ciRunning = state === 'running' || state === 'queued';
  const ci = ciSummary(details?.runs ?? []);
  const facts: BoardFact[] = [
    { label: 'Author', value: review.author },
    ...(details?.reviewers.length ? [{ label: 'Reviewers', value: reviewersText(details.reviewers) }] : []),
    ...(ci ? [{ label: 'CI', value: ci.text, tone: ci.tone }] : []),
    ...(details?.filesChangedText
      ? [{ label: 'Size', value: `${details.filesChangedText} · into ${review.targetBranch}` }]
      : []),
    ...(details?.autoComplete ? [{ label: 'Merge', value: 'auto-complete set' }] : []),
    ...(details?.toVerify.length
      ? [
          {
            label: 'Verify',
            value: `Acceptance criteria of ${details.toVerify.map((id) => `#${String(id)}`).join(', ')}`,
          },
        ]
      : []),
  ];
  const approval = details?.approvalCompletes;
  return {
    kind: 'review',
    id: review.id,
    column: ciRunning ? 'ci' : 'review',
    title: review.title,
    header: `PR ${String(review.id)} · ${firstName(review.author)}`,
    author: review.author,
    isRequired: review.isRequired,
    deadline: shortDeadline(review.timeLeft),
    urgency: review.urgency,
    elapsed: review.elapsed,
    status: approval ? { text: 'Your approval completes it', tone: 'passed' } : undefined,
    ciRunning,
    // Rule BOARD-16
    why: {
      title: `Why ${ciRunning ? COLUMN_TITLES.ci : COLUMN_TITLES.review}`,
      text: ciRunning ? 'CI running: the review clock has started' : `In review, ${shortDeadline(review.timeLeft)}`,
    },
    facts,
    hover: facts,
    deadlineText: `${review.barCaption} · ${review.dueText}`,
    checkout: review.canCheckout
      ? { label: 'Checkout', message: { type: 'checkoutReviewRequest', pullRequestId: review.id } }
      : undefined,
    openPullRequest: { label: 'Open PR', message: { type: 'openReviewRequest', url: review.url } },
  };
}

// Rule BOARD-10
/**
 * The card of the most urgent row of the Now queue (BOARD-9 maps the rows): a work item or a review. A PR row finds
 * the card of that PR first (BOARD-20), else the card of the work item that has it
 */
function currentCard(
  queue: ReturnType<typeof nowQueue>['items'],
  work: BoardWorkCard[],
  reviews: BoardReviewCard[],
  items: WorkItemModel[]
): { kind: 'review' | 'work'; key: string } | undefined {
  for (const row of queue) {
    if (row.verb === 'clean') {
      continue;
    }
    if (row.verb === 'review') {
      // A PR whose CI still runs is not yours to review yet: it is never the most urgent card
      if (reviews.some((review) => review.id === row.id && !review.ciRunning)) {
        return { kind: 'review', key: String(row.id) };
      }
      continue;
    }
    const byPullRequest = row.verb === 'fix' ? undefined : work.find((card) => card.prId === row.id);
    if (byPullRequest) {
      return { kind: 'work', key: byPullRequest.key };
    }
    const item =
      row.verb === 'fix'
        ? items.find((candidate) => candidate.id === row.id)
        : items.find((candidate) => candidate.pullRequests.some((pr) => pr.id === row.id));
    const card = item && work.find((candidate) => candidate.id === item.id && candidate.primary);
    if (card) {
      return { kind: 'work', key: card.key };
    }
  }
  return undefined;
}

// Rule BOARD-14
/**
 * Work items linked to one another, both ways, among the ones on the board; and the other cards of the same work item
 * (a split work item, BOARD-20)
 */
function withRelated(cards: BoardWorkCard[], items: WorkItemModel[]): BoardWorkCard[] {
  const onBoard = new Set(cards.map((card) => card.id));
  const links = new Map<number, Set<number>>();
  const link = (from: number, to: number): void => {
    if (from !== to && onBoard.has(from) && onBoard.has(to)) {
      links.set(from, (links.get(from) ?? new Set()).add(to));
      links.set(to, (links.get(to) ?? new Set()).add(from));
    }
  };
  for (const item of items) {
    relatedIds(item).forEach((id) => link(item.id, id));
  }
  return cards.map((card) => ({
    ...card,
    related: [...(links.get(card.id) ?? [])].sort((a, b) => a - b),
    siblings: cards.filter((other) => other.id === card.id && other.key !== card.key).map((other) => other.key),
  }));
}

function headerOf(iterations: BoardInput['iterations']): BoardModel['header'] {
  // Like the sprint strip of the sidebar: the sprint that ends first
  const iteration = [...iterations]
    .filter((candidate) => candidate.progress)
    .sort((a, b) => (a.finishDate ?? '').localeCompare(b.finishDate ?? ''))
    .at(0);
  if (!iteration?.progress) {
    return { sprint: iterations.at(0)?.name ?? 'Sprint', hurry: false };
  }
  return {
    sprint: iteration.name,
    left: iteration.progress.text,
    hurry: iteration.progress.hurry,
    tooltip: iteration.progress.tooltip,
  };
}

function columnHint(id: BoardColumnId, maxWaitHours: number): string {
  switch (id) {
    case 'toStart':
      return 'New · Approved · ReOpened';
    case 'branch':
      return 'coding, self-review';
    case 'ci':
      return 'starts on publish';
    case 'review':
      return `${String(maxWaitHours)} working hours`;
    case 'ready':
      return 'Complete… or auto-complete';
    case 'done':
      return 'Bugs: Ready to Test';
  }
}

// Rules BOARD-6, BOARD-12, BOARD-20
export function buildBoard(input: BoardInput): BoardModel {
  const items = boardItems(input.workItems, input.kinds);
  const queue = nowQueue({
    reviews: input.reviews,
    myPullRequests: input.myPullRequests,
    workItems: items,
    deletableBranches: 0,
    staleWorktrees: 0,
  }).items;
  const context: CardContext = { workItems: input.workItems, myPullRequests: input.myPullRequests, queue };
  const cards = items.flatMap((item) => workCards(item, context));
  // Rule BOARD-5: finished work items without a broken rule are one dashed card
  const collapsedIds = new Set(
    items.filter((item) => isFinishedState(item.state) && item.alerts.length === 0).map((item) => item.id)
  );
  const shown = withRelated(
    cards.filter((card) => !collapsedIds.has(card.id)),
    items
  );
  const reviews = input.reviews.map(reviewCard);
  const current = currentCard(queue, shown, reviews, items);
  const work = shown.map((card) =>
    current?.kind === 'work' && current.key === card.key ? { ...card, current: true } : card
  );
  const notes =
    input.reviewsStatus === 'error' ? [`The PRs to review could not be checked: ${input.reviewsError ?? 'error'}`] : [];
  return {
    status: input.status,
    error: input.error,
    header: headerOf(input.iterations),
    kinds: input.kinds,
    columns: COLUMN_ORDER.map((id) => ({
      id,
      title: COLUMN_TITLES[id],
      hint: columnHint(id, input.maxWaitHours),
      count: cards.filter((card) => card.column === id).length,
      reviewCount: reviews.filter((review) => review.column === id).length,
    })),
    work,
    summary: { ids: [...collapsedIds] },
    reviews: reviews.map((review) =>
      current?.kind === 'review' && current.key === String(review.id) ? { ...review, current: true } : review
    ),
    notes,
    look: input.look,
    popoverDelay: input.popoverDelay,
  };
}
