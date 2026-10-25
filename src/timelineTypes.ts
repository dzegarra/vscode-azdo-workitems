/**
 * The model of the Sprint timeline: what the panel posts to its webview. The rows are built by timelineRows.ts, the
 * rest by sprintTimelineModel.ts. Types only, so no "vscode" import
 */
import type { BaseBranchHealth, BaseBranchRun } from './baseBranchHealth';
import type { CodingStartSetting } from './codingStart';
import type { CompletedPullRequestInfo } from './completedPullRequests';
import type { MyPullRequestModel } from './myPullRequests';
import type { HistoryRef, HistoryView } from './prHistoryCache';
import type { LifecycleEventKind } from './prLifecycle';
import type { ReviewRequestModel } from './reviewRequests';
import type { ScheduledIteration } from './schedule';
import type { TimelineDay } from './timelineAxis';
import type { PeoplePicker } from './teamBoardModel';
import type { PickedPerson } from './teamPeople';
import type { TeamTimelineInput } from './teamTimelineModel';
import type { BoardAction, BoardModel } from './trackBoardModel';
import type { WebviewMessage, WorkItemModel } from './viewModel';

export type TimelineRange = 'sprint' | 'sprintAndNext';

/** Messages of the Sprint timeline: the buttons post the messages of the sidebar, so the same code runs them */
export type TimelineMessage =
  | WebviewMessage
  | { type: 'setTimelineRange'; range: TimelineRange }
  | { type: 'openBoard'; key?: string }
  | { type: 'setShowCompleted'; show: boolean }
  | { type: 'setTeamScope'; scope: 'mine' | 'team' }
  | { type: 'setTeamPeople'; people: PickedPerson[] }
  /** Rule TIMELINE-29: the work items whose rows are expanded (the panel reads the history of their PRs) */
  | { type: 'setExpanded'; ids: number[] }
  | { type: 'openTeamPullRequest'; url: string }
  | { type: 'ready' };

/**
 * The colour of a bar: the stations of a work item row (branch, pullRequest, ci, review, ready, needsYou), the phases
 * of a PR row (implementation, draft, review, ready), the reviews owed and the planned work
 */
export type SegmentKind =
  | 'asleep'
  | 'branch'
  | 'ci'
  | 'draft'
  | 'dueSoon'
  | 'implementation'
  | 'needsYou'
  | 'overdue'
  | 'planned'
  | 'pullRequest'
  | 'ready'
  | 'review'
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
  /** Rule TIMELINE-30: the row of the strip it is on (marks that would touch go to the next row) */
  row?: number;
  /** Marks of the same kind at the same moment are one, with their number */
  count?: number;
  /** The tooltip: who, when, what */
  tip: { title: string; lines: string[] };
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
  /** Rows of the strip of marks (1 to 3): the row of the PR is taller with more */
  markerRows: number;
  /** "✓ merged Fr 16" */
  merged?: { at: number; text: string };
  action?: BoardAction & { primary: boolean };
  /** Its history: the row draws a skeleton while it is read (aria-busy) */
  history: HistoryLoad;
  /** What the panel needs to read the history of the PR */
  historyRef?: HistoryRef;
  /** A click on the pill and the title */
  open: TimelineMessage;
  end: number;
  /** The dates of the PR are not known (another repository, an old one): no bar */
  undated?: boolean;
}

/** A task of the work item that has no PR (Rule TIMELINE-18) */
export interface TaskChild {
  kind: 'task';
  key: string;
  taskId: number;
  title: string;
  /** "In Progress since We 21 · no PR" */
  sub: string;
  segments: TimelineSegment[];
  action?: BoardAction & { primary: boolean };
  open: TimelineMessage;
  end: number;
}

/** One compact row for the tasks that are still to do or already done, with no PR */
export interface TasksChild {
  kind: 'tasks';
  key: string;
  /** "5 tasks to do", "2 tasks done" */
  title: string;
  /** The titles, "Interfaces update · TFIO update · +3" */
  sub: string;
  open: TimelineMessage;
}

/** The work item has no PR and no task yet */
export interface PlaceholderChild {
  kind: 'placeholder';
  key: string;
  text: string;
  hint: string;
}

export type TimelineChild = PlaceholderChild | PullRequestChild | TasksChild | TaskChild;

export interface TimelineRow {
  key: string;
  section: 'planned' | 'review' | 'work';
  id: number;
  /** "PBI · #66280" (the label is drawn from `label`; this is its plain text) */
  header: string;
  title: string;
  label?: RowLabel;
  /** A finished work item: faded, with its mark (Rule TIMELINE-19) */
  faded?: boolean;
  /** "✓ done We 21" of a finished work item */
  merged?: { at: number; text: string };
  here?: boolean;
  /** Bug: the header is red */
  bug?: boolean;
  segments: TimelineSegment[];
  /** A work item not started: the dashed outline over the whole row */
  outline?: { text: string; broken: boolean };
  /** "waits on #66301" */
  chip?: string;
  /** The inline button after the last segment */
  action?: BoardAction & { primary: boolean };
  /** The text after the bar of a review: "overdue 3 h" */
  note?: { text: string; tone: 'dueSoon' | 'fresh' | 'overdue' };
  popover?: TimelinePopover;
  /** A click on the label */
  open: TimelineMessage;
  /** The card of the Track board */
  boardKey?: string;
  /** Rule TIMELINE-23: a row of another person: compact label, no button, no popover */
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
  /** Rows of the person: compact and read-only (the user's own rows are `work`, `finished` and `planned` of the model) */
  rows: TimelineRow[];
  /** Rule TIMELINE-19, per person: the finished work items, after the open ones */
  finished: TimelineRow[];
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
}

export interface TimelineModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  range: TimelineRange;
  /** The scope chip: the user's work (default) or the whole team (the rows of the others are in `team`) */
  scope: 'mine' | 'team';
  team?: TimelineTeam;
  header: { sprint: string; dates?: string; left?: string; hurry: boolean };
  days: Pick<TimelineDay, 'date' | 'label' | 'last' | 'next' | 'today' | 'weekStart'>[];
  /** Where NOW is on the axis; undefined outside of it */
  now?: number;
  work: TimelineRow[];
  /** Rule TIMELINE-19: the finished work items, after the open ones, in "DONE THIS SPRINT" */
  finished: TimelineRow[];
  /** The finished work items and the merged PRs are shown (the setting shared with the Track board) */
  showCompleted: boolean;
  /** The work items planned in the next sprint ("This + next sprint") */
  planned: { rows: TimelineRow[]; note?: string };
  reviews: TimelineRow[];
  reviewsTitle: string;
  /** Rule TIMELINE-20: the PRs drawn whose first commit is not known yet (empty when the setting does not read commits) */
  firstCommitsWanted: number[];
  develop: { branch: string; spans: DevelopSpan[]; label?: { text: string; at: number }; note?: string };
  notes: string[];
  look: BoardModel['look'];
}

export interface PlannedItem {
  id: number;
  title: string;
  type: string;
  state: string;
}

export interface TimelineInput {
  now: Date;
  workingDays: readonly number[];
  maxWaitHours: number;
  board: BoardModel;
  workItems: WorkItemModel[];
  myPullRequests: MyPullRequestModel[];
  reviews: ReviewRequestModel[];
  sprint?: { name: string; startDate?: string; finishDate?: string };
  schedule?: readonly ScheduledIteration[];
  range: TimelineRange;
  planned: { status: 'error' | 'loading' | 'off' | 'ready'; items: PlannedItem[] };
  /** The PRs of the user that were merged (My Pull Requests already has them): drawn when merged within the axis */
  completedPullRequests?: readonly CompletedPullRequestInfo[];
  base: { branch: string; enabled: boolean; runs: readonly BaseBranchRun[]; health?: BaseBranchHealth };
  /** Rule TIMELINE-20: where the implementation starts (`totalflowx.appearance.timelineCodingStart`); default: the earliest of both */
  codingStart?: CodingStartSetting;
  /** Rule TIMELINE-20: author date (ISO) of the oldest commit of each PR, by PR id, of those already read */
  firstCommits?: ReadonlyMap<number, string>;
  /** Rule TIMELINE-29: the history read so far of the PRs (threads and CI runs), by PR id */
  history?: ReadonlyMap<number, HistoryView>;
  /** Rule TIMELINE-21: the scope of the tab; "team" adds the sections of the people chosen (src/teamTimelineModel.ts) */
  scope?: 'mine' | 'team';
  team?: TeamTimelineInput;
}
