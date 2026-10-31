/**
 * The model of the Sprint timeline: what the panel posts to its webview. The rows are built by timelineRows.ts, the
 * rest by sprintTimelineModel.ts. Types only, so no "vscode" import
 */
import type { BaseMerge } from './baseBranchMerges';
import type { BaseBranchHealth, BaseBranchRun } from './baseBranchHealth';
import type { CodingStartSetting } from './codingStart';
import type { CompletedPullRequestInfo } from './completedPullRequests';
import type { TimelineDuplicate } from './duplicates';
import type { MyPullRequestModel } from './myPullRequests';
import type { HistoryRef, HistoryView } from './prHistoryCache';
import type { LifecycleEventKind } from './prLifecycle';
import type { ReviewRequestModel } from './reviewRequests';
import type { SprintTeams } from './sprintTitle';
import type { ZoomModifier } from './timelineZoom';
import type { SprintMembership } from './sprintMembership';
import type { TimelineViewOptions, TimelineViewSwitch } from './timelineView';
import type { TimelineDay } from './timelineAxis';
import type { TimelineDensity } from './timelineDensity';
import type { PeoplePicker } from './teamBoardModel';
import type { PickedPerson } from './teamPeople';
import type { TeamPullRequestInfo } from './teamData';
import type { TeamTimelineInput } from './teamTimelineModel';
import type { BoardAction, BoardModel } from './trackBoardModel';
import type { WebviewMessage, WorkItemModel } from './viewModel';
import type { StateChange } from './workItemStateHistory';
import type { ReviewedInput } from './reviewedTimeline';

/** Messages of the Sprint timeline: the buttons post the messages of the sidebar, so the same code runs them */
export type TimelineMessage =
  | WebviewMessage
  | { type: 'openBoard'; key?: string }
  | { type: 'setTimelineDensity'; density: TimelineDensity }
  /** Rule TIMELINE-48: the zoom chosen (percent of the width of a day), saved in the user setting */
  | { type: 'setTimelineZoom'; zoom: number }
  /** Rule TIMELINE-45: a switch of the view options */
  | { type: 'setTimelineViewOption'; option: TimelineViewSwitch; value: boolean }
  /** Rule TIMELINE-46: the link of the view options to the dimming setting */
  | { type: 'openDimSetting' }
  | { type: 'setTeamScope'; scope: 'mine' | 'team' }
  | { type: 'setTeamPeople'; people: PickedPerson[] }
  /** Rule TIMELINE-29: the work items whose rows are expanded (the panel reads the history of their PRs) */
  | { type: 'setExpanded'; ids: number[] }
  | { type: 'openTeamPullRequest'; url: string }
  /** Rule TIMELINE-39: the pointer is on the row of a PR for the first time: read its commits and its task's history */
  | { type: 'hoverPullRequest'; prId: number }
  /** Rule TIMELINE-40: the sprint shown, 0 the current one, 1 the one before… */
  | { type: 'setSprint'; offset: number }
  | { type: 'ready' };

/**
 * The colour of a bar: the stations of a work item row (branch, pullRequest, ci, review, ready, needsYou), the phases
 * of a PR row (implementation, draft, review, ready) and the reviews owed
 */
export type SegmentKind =
  | 'afterVote'
  | 'branch'
  | 'ci'
  | 'draft'
  | 'dueSoon'
  | 'implementation'
  | 'needsYou'
  | 'overdue'
  | 'pullRequest'
  | 'ready'
  | 'review'
  | 'stateApproved'
  | 'stateCommitted'
  | 'stateDone'
  | 'stateInReview'
  | 'stateNew'
  | 'stateReadyToTest'
  | 'stateRemoved'
  | 'stateReopened'
  | 'taskToDo'
  | 'wait';

export interface TimelineSegment {
  kind: SegmentKind;
  /** In days from the start of the axis */
  start: number;
  end: number;
  text?: string;
  /** Hover: the phase, its start and end */
  tip: string;
  approximate?: boolean;
  dashed?: boolean;
  /** Rule TIMELINE-8: no update in this part of the bar: its text ends with a bold orange "zZ", the colour is the state's */
  asleep?: boolean;
  /** Rule TIMELINE-31: the part of an open bar past the end of the sprint (faded, under the hatch of the margin) */
  after?: boolean;
}

export interface TimelinePopover {
  title: string;
  text: string;
  rule: string;
  actions: { label: string; message: TimelineMessage; primary?: boolean }[];
}

/** What the first line of a label says (Rule TIMELINE-15): whose title the second line is */
export interface RowLabel {
  /** PBI or BUG (the work item's title follows), Task (the task's title) */
  tag?: { text: string; tone: 'bug' | 'pbi' | 'task' };
  /** "#66280" */
  id?: string;
  /** The pill of a PR (the PR's title follows): "PR 13912", "draft PR 13966"; merged: the pill has a ✓ */
  pr?: { text: string; merged?: boolean };
  /** The state of a work item: "Committed · 6 PRs" */
  state?: string;
  /** A review row: "Marta · required" */
  meta?: string;
}

/** A mark on the bar of a PR (Rule TIMELINE-27): a push, a CI run, a vote, a comment… */
export interface TimelineMarker {
  kind: LifecycleEventKind;
  /** In days from the start of the axis */
  at: number;
  /** Initials, "+2", "3"; empty for a push */
  text: string;
  tone?: 'fail' | 'pass' | 'running';
  /** Marks of the same kind at the same moment are one, with their number */
  count?: number;
  /** The tooltip: who, when, what */
  tip: { title: string; lines: string[] };
  /** Rule TIMELINE-33: a problem (the latest CI run failed, conflicts now): shown at rest; the others on hover */
  atRest?: boolean;
}

/** How far the history of a PR is: nothing asked (collapsed row), being read, read, or it could not be read */
export type HistoryLoad = HistoryView['state'];

/** A PR under an expanded work item row (Rules TIMELINE-17, TIMELINE-27) */
export interface PullRequestChild {
  kind: 'pr';
  key: string;
  prId: number;
  /** "PR 14021", "draft PR 14021"; merged: with a ✓ */
  pill: { text: string; merged?: boolean };
  title: string;
  /** "Task 67163 · Measurement update · In Progress", "no linked task" */
  sub: string;
  /** Implementation, draft, review, ready to merge */
  segments: TimelineSegment[];
  markers: TimelineMarker[];
  /** "✓ merged Fr 16" */
  merged?: { at: number; text: string };
  action?: BoardAction & { primary: boolean };
  /** Rule TIMELINE-52: what stops an open PR in review from being merged, after its bar */
  blocker?: string;
  /** Its history: the row draws a skeleton while it is read (aria-busy) */
  history: HistoryLoad;
  /** Rule TIMELINE-39: its commits or the history of its task are being read (the row sweeps) */
  detailsLoading?: boolean;
  /** What the panel needs to read the history of the PR */
  historyRef?: HistoryRef;
  /** A click on the pill and the title */
  open: TimelineMessage;
  end: number;
  /** The dates of the PR are not known (another repository, an old one): no bar */
  undated?: boolean;
}

/** A task of the work item that has no PR, whatever its state (Rule TIMELINE-18) */
export interface TaskChild {
  kind: 'task';
  key: string;
  taskId: number;
  title: string;
  /** "In Progress since We 21 · no PR", "To Do · created We 14", "Done We 21 · no PR" */
  sub: string;
  /** Done: drawn faded */
  done?: boolean;
  segments: TimelineSegment[];
  action?: BoardAction & { primary: boolean };
  open: TimelineMessage;
  end: number;
}

/** The work item has no PR and no task yet */
export interface PlaceholderChild {
  kind: 'placeholder';
  key: string;
  text: string;
  hint: string;
}

export type TimelineChild = PlaceholderChild | PullRequestChild | TaskChild;

export interface TimelineRow {
  key: string;
  section: 'review' | 'work';
  id: number;
  /** "PBI · #66280" (the label is drawn from `label`; this is its plain text) */
  header: string;
  title: string;
  label?: RowLabel;
  /** A finished work item: faded, with its mark (Rule TIMELINE-19) */
  faded?: boolean;
  /** "Done We 21" after the bar of a finished work item (Rule TIMELINE-19) */
  merged?: {
    at: number;
    text: string;
    /** Ready to Test: the pale green of "almost done" (TIMELINE-35) */ almostDone?: boolean;
  };
  /** Rule TIMELINE-35: the point badge of a work item in a final state (Done, Closed, Removed), at the moment it changed */
  finish?: { at: number; kind: 'done' | 'removed'; text: string; tip: string };
  here?: boolean;
  /** Rule TIMELINE-47: the work items linked to this one by the Duplicate link (hovering the row highlights theirs) */
  duplicates?: TimelineDuplicate[];
  /** Bug: the header is red */
  bug?: boolean;
  segments: TimelineSegment[];
  /** A work item not started: the dashed outline over the whole row */
  outline?: { text: string; broken: boolean };
  /** "waits on #66301" */
  chip?: string;
  /** The inline button after the last segment */
  action?: BoardAction & { primary: boolean };
  /**
   * The text after the bar of a review: "overdue 3 h". Rule TIMELINE-44, tone `moved`: where a work item of a past
   * sprint went ("→ Sprint 124"), drawn as a pill, and `detail` after it ("moved Th 22")
   */
  note?: { text: string; tone: 'dueSoon' | 'fresh' | 'moved' | 'needsYou' | 'overdue'; detail?: string };
  popover?: TimelinePopover;
  /** Rule TIMELINE-37: the user's vote on a PR they reviewed: its mark */
  vote?: { at: number; kind: 'approve' | 'reject' | 'wait'; text: string; tip: { title: string; lines: string[] } };
  /** Rule TIMELINE-44: it left the past sprint before it ended (faded whatever the dimming setting, TIMELINE-46) */
  movedOut?: boolean;
  /** Rule TIMELINE-37: what the row needs is being read (the threads of a reviewed PR) */
  loading?: boolean;
  /** A click on the label */
  open: TimelineMessage;
  /** The card of the Track board */
  boardKey?: string;
  /** Rule TIMELINE-23: a row of another person: no button, no popover */
  readOnly?: boolean;
  /** Where the bar ends, in days: the button and the note go after it */
  end: number;
  /** Rule TIMELINE-18: a work item row expands to its PRs and tasks */
  expandable?: boolean;
  /** It starts expanded: the user's own row whose station needs them */
  defaultExpanded?: boolean;
  /** What the row shows when expanded */
  children?: TimelineChild[];
}

export interface DevelopSpan {
  start: number;
  end: number;
  red: boolean;
  tip: string;
}

/** The person header and rows of a section of the Whole team timeline (Rules TIMELINE-21..25) */
export interface TimelineSection {
  key: string;
  /** "You", or the name of the person */
  name: string;
  initials: string;
  /** 0 to 5: the class of the avatar colour */
  colour: number;
  you: boolean;
  /** "5 open · PLT IA" */
  meta: string;
  /** "2 need you · 1 asleep", "waiting on reviewers" */
  summary: string;
  /** Rows of the person, read-only (the user's own rows are `work` and `finished` of the model) */
  rows: TimelineRow[];
  /** Rule TIMELINE-19, per person: the finished work items, after the open ones */
  finished: TimelineRow[];
  /** Rule TIMELINE-44, per person: in a past sprint, the work items that left it before it ended */
  movedOut: TimelineRow[];
}

/** The Whole team part of the timeline (Rule TIMELINE-21) */
export interface TimelineTeam {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  picker: PeoplePicker;
  /** Nobody is chosen: the section of the user and the hint */
  noPeople: boolean;
  /** Several teams are read */
  teamCount: number;
  /** Sections shown (the user's first) */
  sections: TimelineSection[];
  /** Open work items of every section */
  openItems: number;
  /** Rule TIMELINE-25: the asleep work items, with the owner: "you" or a first name */
  asleep: { id: number; owner: string }[];
  /** Rule TIMELINE-50: the people chosen whose work is not read yet (header and skeleton rows, "loading…") */
  pending: { key: string; name: string; initials: string; colour: number }[];
}

/** Rule TIMELINE-40: a sprint of the menu on the title: "Sprint 121", its dates "30 Sep – 13 Oct" */
export interface SprintSwitchEntry {
  offset: number;
  title: string;
  dates?: string;
}

export interface TimelineModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  /** Rule TIMELINE-32: the row style of the view shown */
  density: TimelineDensity;
  /** Rule TIMELINE-40: the sprints the switch offers (the current one first) and the one shown */
  sprints: SprintSwitchEntry[];
  sprintOffset: number;
  /** The scope chip: the user's work (default) or the whole team (the rows of the others are in `team`) */
  scope: 'mine' | 'team';
  team?: TimelineTeam;
  /** Rule SPRINT-TITLE-1: the title the teams share, the "N teams" chip */
  header: { sprint: string; teams?: SprintTeams; dates?: string; left?: string; hurry: boolean };
  days: Pick<TimelineDay, 'after' | 'before' | 'date' | 'label' | 'last' | 'today' | 'weekStart'>[];
  /** Rule TIMELINE-31: where the sprint ends on the axis (the days after it are the margin) */
  sprintEnd: number;
  /** Rule TIMELINE-2: the index of the first day of the sprint; the days before it are the margin before the sprint */
  sprintStart: number;
  /** Where NOW is on the axis; undefined outside of it */
  now?: number;
  /** Rule TIMELINE-31: NOW is past the end of the sprint (in the margin): drawn faded, behind the text */
  over: boolean;
  work: TimelineRow[];
  /** Rule TIMELINE-19: the finished work items, after the open ones, in "DONE THIS SPRINT" */
  finished: TimelineRow[];
  /** Rule TIMELINE-44: in a past sprint, the work items that left it before it ended, in "MOVED OUT DURING THE SPRINT" */
  movedOut: TimelineRow[];
  /** Rules TIMELINE-45, TIMELINE-46: the view options (the switches of the header, the dimming setting) */
  options: TimelineViewOptions;
  reviews: TimelineRow[];
  reviewsTitle: string;
  /** Rule TIMELINE-37: the PRs the user reviewed within the axis, faded, under the reviews owed */
  reviewed: TimelineRow[];
  /** Rule TIMELINE-37: the threads the reviewed rows need (the panel reads what it lacks) */
  reviewedWanted: { id: number; key: string }[];
  /** Rule TIMELINE-20: the PRs drawn whose first commit is not known yet (empty when the setting does not read commits) */
  firstCommitsWanted: number[];
  /** Rule TIMELINE-35: the work items drawn and the key of their state history (the panel reads what it lacks) */
  statesWanted: { id: number; key: string }[];
  /** Rule TIMELINE-39: the commits of the PRs hovered (the panel reads what it lacks) */
  commitsWanted: { id: number; key: string; repositoryId?: string }[];
  /** Rule TIMELINE-38: the commits of the base branch the develop strip needs (the panel reads them once per key) */
  mergesWanted?: { key: string; from: string; to: string };
  develop: {
    branch: string;
    spans: DevelopSpan[];
    /** Rule TIMELINE-38: a tick per merged PR (from the commits of the branch, else the merge messages of the runs) and the PR(s) before each red span */
    merges: { at: number; pr: number; tip: string }[];
    culprits: { at: number; text: string }[];
    label?: { text: string; at: number };
    note?: string;
  };
  notes: string[];
  look: BoardModel['look'];
  /** Rule TIMELINE-48: the zoom (percent of the width of a day, `appearance.timelineZoom`) */
  zoom: number;
  /** Rule TIMELINE-49: the key that zooms with the wheel (`appearance.timelineZoomModifier`) */
  zoomModifier: ZoomModifier;
  /** Rule TIMELINE-25: the asleep work items of the user (Mine and Whole team) */
  asleep: number[];
  /** Rule TIMELINE-50: how many of the work items drawn have their state history being read */
  statesLoading: number;
}

export interface TimelineInput {
  now: Date;
  workingDays: readonly number[];
  maxWaitHours: number;
  board: BoardModel;
  workItems: WorkItemModel[];
  myPullRequests: MyPullRequestModel[];
  reviews: ReviewRequestModel[];
  /** The sprint drawn: the current iteration that ends first (as the board header) */
  sprint?: { name: string; startDate?: string; finishDate?: string };
  /** Rule TIMELINE-32: the row style of the view shown; default Normal */
  density?: TimelineDensity;
  /** Rule TIMELINE-40: the sprints of the switch and the one shown */
  sprints?: SprintSwitchEntry[];
  sprintOffset?: number;
  /**
   * Rule TIMELINE-41: a past sprint, drawn as history ("ended Mon 26 Oct" instead of the days left). Rules TIMELINE-43,
   * TIMELINE-44: what the history of each work item says of its time in the sprint (by id)
   */
  past?: {
    ended?: string;
    membership?: ReadonlyMap<number, SprintMembership>;
    /** Rule TIMELINE-41: the real current moment (ms): the PRs still open run into the margin up to it (or the axis end) */
    today?: number;
  };
  /** The PRs of the user that were merged (My Pull Requests already has them): drawn when merged within the axis */
  completedPullRequests?: readonly CompletedPullRequestInfo[];
  base: {
    branch: string;
    enabled: boolean;
    runs: readonly BaseBranchRun[];
    health?: BaseBranchHealth;
    /** Rule TIMELINE-38: the PRs merged within the axis, newest first (undefined: not read yet, or the read failed) */
    merges?: readonly BaseMerge[];
  };
  /** Rule TIMELINE-20: where the implementation starts (`totalflowx.appearance.timelineCodingStart`); default: the earliest of both */
  codingStart?: CodingStartSetting;
  /**
   * Rule TIMELINE-2: at most this many working days before the sprint are added to the axis, as needed by the PRs that
   * start before it (`totalflowx.appearance.timelineDaysBeforeSprint`); default 0
   */
  daysBeforeSprint?: number;
  /** Rule TIMELINE-2: the earliest start of a drawn PR (set by the builders; the axis takes what it needs from it) */
  earliestStart?: number;
  /** Rule TIMELINE-20: author date (ISO) of the oldest commit of each PR, by PR id, of those already read */
  firstCommits?: ReadonlyMap<number, string>;
  /** Rule TIMELINE-37: the PRs of others the user voted on, and their threads read so far */
  reviewed?: Omit<ReviewedInput, 'days' | 'now'>;
  /**
   * Rule TIMELINE-17: what is known of the PRs linked to the work items from their own details (the store's, or a past
   * sprint's): the dates of a PR that is not in My Pull Requests (another author, an older one, an open PR of a past
   * sprint) come from here
   */
  pullRequestInfo?: ReadonlyMap<number, TeamPullRequestInfo>;
  /** Rule TIMELINE-39: the PRs whose row was hovered, the times of their commits read so far, and those being read */
  hovered?: ReadonlySet<number>;
  commits?: ReadonlyMap<number, readonly number[]>;
  detailsLoading?: ReadonlySet<number>;
  /** The work items (and tasks) whose state history is being read */
  statesLoading?: ReadonlySet<number>;
  /** Rule TIMELINE-35: the changes of state read so far, by work item id (until then the states are guessed) */
  stateHistory?: ReadonlyMap<number, readonly StateChange[]>;
  /** Rule TIMELINE-29: the history read so far of the PRs (threads and CI runs), by PR id */
  history?: ReadonlyMap<number, HistoryView>;
  /** Rule TIMELINE-21: the scope of the tab; "team" adds the sections of the people chosen (src/teamTimelineModel.ts) */
  scope?: 'mine' | 'team';
  team?: TeamTimelineInput;
  /** Rules TIMELINE-45, TIMELINE-46: the view options; default: everything shown, grouped and dimmed */
  view?: TimelineViewOptions;
  /** Rule TIMELINE-48: the zoom setting, percent; default 100 */
  zoom?: number;
  /** Rule TIMELINE-49: the key of the wheel zoom setting; default ctrl */
  zoomModifier?: ZoomModifier;
}
