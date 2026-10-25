/**
 * The Track board (redesign): the user's Backlog Items and Bugs of the sprint as cards in six columns, one per
 * station of the track, plus the PRs they review. Everything comes from models the sidebar already has (work items,
 * My Pull Requests, review requests) and from the track (src/track.ts), so the board and the sidebar never
 * disagree. Pure, so no "vscode" import: the webview uses the types and the panel builds the model
 */
import { beforeCompletion } from './beforeCompletion';
import { worstRunState } from './compactSignals';
import { nowQueue, type Verb } from './nowQueue';
import type { MyPullRequestModel, ReviewerModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import type { ReviewRequestModel } from './reviewRequests';
import type { SprintProgress } from './sprintCountdown';
import { isFinishedState, isNotStartedState, stateCategory } from './states';
import { taskProgress } from './taskProgress';
import { currentStation, tasksOf, trackPullRequest, workItemTrack, type Station, type StationState } from './track';
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

/** The "NEEDS YOU" box of the drawer */
export interface BoardNeed {
  /** "CI FAILED", "WAITING FOR THE AUTHOR"… */
  title: string;
  text: string;
  /** Names of the failed tests, when the run model has them */
  tests: string[];
  actions: BoardAction[];
}

export interface BoardWorkCard {
  kind: 'work';
  id: number;
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
  facts: BoardFact[];
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

// Rules BOARD-2..5
/**
 * The column of a work item, from its track so the board agrees with the sidebar. Finished work items go to Done;
 * the current station (TRACK-9) says where an open one is
 */
export function columnOf(item: WorkItemModel, track: Station[], pr: PullRequestModel | undefined): BoardColumnId {
  // Rule BOARD-5
  if (isFinishedState(item.state)) {
    return 'done';
  }
  const current = currentStation(track);
  // Rule BOARD-5: every station passed
  if (!current) {
    return 'done';
  }
  // Rule BOARD-3 / BOARD-5: a merged PR with work left (Done station pending) goes back to coding
  if (current.id === 'done' && current.state === 'pending') {
    return isNotStartedState(item.state) ? 'toStart' : 'branch';
  }
  switch (current.id) {
    case 'branch':
      // Rule BOARD-3: nothing yet. Not started: To start; started without a branch (created elsewhere): coding
      return isNotStartedState(item.state) ? 'toStart' : 'branch';
    case 'pullRequest':
      // Rule BOARD-4: a draft or no PR yet is coding; a published PR that breaks a rule of its own stays where the
      // rest of its track is
      if (pr && pr.tone !== 'draft' && pr.tone !== 'abandoned') {
        const next = firstOpenAfterPullRequest(track);
        return next ? columnOfStation(next) : 'done';
      }
      return 'branch';
    case 'ci':
    case 'review':
    case 'ready':
    case 'done':
      return columnOfStation(current);
  }
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

function workCard(
  item: WorkItemModel,
  workItems: WorkItemModel[],
  myPullRequests: MyPullRequestModel[],
  queue: ReturnType<typeof nowQueue>['items']
): BoardWorkCard {
  const followed = trackPullRequest(item);
  const mine = followed ? myPullRequests.find((candidate) => candidate.id === followed.id) : undefined;
  const track = workItemTrack(item, mine, tasksOf(item, workItems));
  const current = isFinishedState(item.state) ? undefined : currentStation(track);
  const column = columnOf(item, track, followed);
  const verb = queueVerbOf(item, queue);
  const runs = runsOf(followed, mine);
  const priority = item.priority ? ` · P${String(item.priority)}` : '';
  const header = `#${String(item.id)}${isBug(item) ? ' · Bug' : ''}${priority}`;
  const tasks = tasksText(item, workItems);
  const checks = beforeCompletion(item);
  const ci = ciSummary(runs);
  const facts: BoardFact[] = [
    ...(item.branch ? [{ label: 'Branch', value: item.branch }] : []),
    ...(mine && mine.reviewers.length ? [{ label: 'Reviewers', value: reviewersText(mine.reviewers) }] : []),
    ...(mine && !mine.isDraft ? [{ label: 'Published', value: `${mine.time} ago` }] : []),
    ...(tasks ? [{ label: 'Tasks', value: tasks }] : []),
    ...(isFinishedState(item.state)
      ? []
      : [
          checks.length
            ? { label: 'Completion', value: checks.map((check) => check.text).join(' · '), tone: 'needsYou' as const }
            : { label: 'Completion', value: 'nothing in the way', tone: 'passed' as const },
        ]),
  ];
  const waitsOn = item.openPredecessors?.at(0);
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
  const checkout: BoardAction | undefined = branchActions(item).includes('checkout')
    ? { label: 'Checkout', message: { type: 'checkout', id: item.id } }
    : undefined;
  return {
    kind: 'work',
    id: item.id,
    column,
    itemKind: isBug(item) ? 'bug' : 'backlog',
    title: item.title,
    header,
    subtitle: `${isBug(item) ? 'Bug' : 'Backlog Item'}${priority} · ${item.displayState}`,
    tone: toneOf(item, column, current, verb),
    status: statusLine(item, column, current, followed, mine),
    verb: verb && verb !== 'clean' ? needsYouVerb(verb, current, mine, runs) : undefined,
    asleep: item.notUpdated,
    here: item.workingOn !== undefined,
    action: actionOf(item, column, mine),
    track: stationsOf(track, current),
    need: needOf(item, current, followed, mine),
    facts,
    hover,
    related: [],
    checkout,
    openPullRequest: followed
      ? { label: 'Open PR', message: { type: 'openPullRequest', id: item.id, pullRequestId: followed.id } }
      : undefined,
  };
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
/** The card of the most urgent row of the Now queue (BOARD-9 maps the rows): a work item or a review */
function currentCard(
  queue: ReturnType<typeof nowQueue>['items'],
  work: BoardWorkCard[],
  reviews: BoardReviewCard[],
  items: WorkItemModel[]
): { kind: 'review' | 'work'; id: number } | undefined {
  for (const row of queue) {
    if (row.verb === 'clean') {
      continue;
    }
    if (row.verb === 'review') {
      // A PR whose CI still runs is not yours to review yet: it is never the most urgent card
      if (reviews.some((review) => review.id === row.id && !review.ciRunning)) {
        return { kind: 'review', id: row.id };
      }
      continue;
    }
    const item =
      row.verb === 'fix'
        ? items.find((candidate) => candidate.id === row.id)
        : items.find((candidate) => candidate.pullRequests.some((pr) => pr.id === row.id));
    if (item && work.some((card) => card.id === item.id)) {
      return { kind: 'work', id: item.id };
    }
  }
  return undefined;
}

// Rule BOARD-14
/** Work items linked to one another, both ways, among the ones on the board */
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
  return cards.map((card) => ({ ...card, related: [...(links.get(card.id) ?? [])].sort((a, b) => a - b) }));
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

// Rules BOARD-6, BOARD-12
export function buildBoard(input: BoardInput): BoardModel {
  const items = boardItems(input.workItems, input.kinds);
  const queue = nowQueue({
    reviews: input.reviews,
    myPullRequests: input.myPullRequests,
    workItems: items,
    deletableBranches: 0,
    staleWorktrees: 0,
  }).items;
  const cards = items.map((item) => workCard(item, input.workItems, input.myPullRequests, queue));
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
    current?.kind === 'work' && current.id === card.id ? { ...card, current: true } : card
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
      current?.kind === 'review' && current.id === review.id ? { ...review, current: true } : review
    ),
    notes,
    look: input.look,
    popoverDelay: input.popoverDelay,
  };
}
