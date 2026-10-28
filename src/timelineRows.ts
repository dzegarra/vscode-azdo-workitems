/**
 * The rows of the Sprint timeline (Rules TIMELINE-1, TIMELINE-16..20): one row per work item, drawn with the station it
 * is at day by day; expanded, the PRs of the work item with their own lifecycle and events, its tasks without a PR, or a
 * placeholder. The same builders draw the rows of the user and, read-only, those of the other people. Pure, so no
 * "vscode" import
 */
import { codingStartOf, needsFirstCommit, type CodingStartSource } from './codingStart';
import { mergedInRange, type CompletedPullRequestInfo } from './completedPullRequests';
import type { MyPullRequestModel, ReviewerModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import { stateSignature, type HistoryRef } from './prHistoryCache';
import {
  pullRequestEvents,
  pullRequestPhases,
  pullRequestStations,
  type CurrentStation,
  type LifecyclePhaseKind,
  type PrFacts,
  type StationSpan,
} from './prLifecycle';
import type { PullRequestStamps } from './pullRequestTimeline';
import { isFinishedState, stateCategory } from './states';
import type { TeamPullRequestInfo } from './teamData';
import { axisPosition, type TimelineDay } from './timelineAxis';
import { layoutMarkers, markerRows, mergeSegments, withAtRest } from './timelineLayout';
import {
  dateText,
  dayLabel,
  instant,
  needsYouSince,
  readySince,
  toSegment,
  withAsleep,
  type Span,
} from './timelineSpans';
import type {
  PullRequestChild,
  SegmentKind,
  RowLabel,
  TaskChild,
  TimelineChild,
  TimelineInput,
  TimelineMarker,
  TimelinePopover,
  TimelineRow,
  TimelineSegment,
} from './timelineTypes';
import { trackPullRequest } from './track';
import { pullRequestTitle, type BoardAction, type BoardWorkCard } from './trackBoardModel';
import type { WorkItemModel } from './viewModel';
import { workItemStations, type WorkItemStationSpan } from './workItemStations';
import { finishedAt as finishedStateAt, stateSpans, type StateKind } from './workItemStateHistory';

const MS_PER_HOUR = 3_600_000;

export interface RowContext {
  input: TimelineInput;
  /** Rule TIMELINE-23: the rows of another person: their PRs, as the whole-team data has them (no My Pull Requests) */
  team?: { pullRequests: ReadonlyMap<number, TeamPullRequestInfo> };
  days: TimelineDay[];
  axisStart: number;
  now: number;
  /** The PRs drawn whose first commit is not known yet (Rule TIMELINE-20) */
  firstCommitsWanted: Set<number>;
  /** Rule TIMELINE-35: the work items drawn and the key of their state history (`id:rev`) */
  statesWanted?: Map<number, string>;
  /** Rule TIMELINE-39: the PRs hovered and the key of their commits (a merged PR for good, an open one by its commit) */
  commitsWanted?: Map<number, { key: string; repositoryId?: string }>;
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

/** "✓ done We 21", or "✓ Ready to Test We 21" for a Bug (TRACK-7: developers finish a Bug at Ready to Test); no day: just the word */
const doneMark = (at: number | undefined, bug: boolean): string => {
  const word = bug ? 'Ready to Test' : 'done';
  return at === undefined ? `✓ ${word}` : `✓ ${word} ${dayLabel(at)}`;
};

const firstName = (name: string): string => name.split(' ').at(0) ?? name;

const workItemTag = (kind: BoardWorkCard['itemKind']): NonNullable<RowLabel['tag']> =>
  kind === 'bug' ? { text: 'BUG', tone: 'bug' } : { text: 'PBI', tone: 'pbi' };

const labelText = (label: RowLabel): string =>
  [label.tag?.text, label.id, label.pr?.text, label.state].filter(Boolean).join(' · ');

/* ---------- When the implementation starts (Rule TIMELINE-20) ---------- */

/** What the tooltip of the implementation says about its start */
function implementationDetail(source: CodingStartSource | undefined, at: number | undefined, taskId?: number): string {
  if (source === undefined || at === undefined) {
    return 'implementation';
  }
  switch (source) {
    case 'firstCommit':
      return `implementation since the first commit, ${dayLabel(at)}`;
    case 'task':
      return `implementation since task ${String(taskId ?? '')} was activated, ${dayLabel(at)}`;
    case 'workItem':
      return 'implementation since the work item was activated, approximate';
  }
}

interface TaskFacts {
  id: number;
  title: string;
  state: string;
  activated?: number;
  created?: number;
  /** When it last changed state (a task done: when it was done) */
  stateChanged?: number;
  /** Key of its state history (`id:rev`), read on the hover of its PR (Rule TIMELINE-39) */
  stateKey: string;
  prIds: number[];
  canCreatePullRequest: boolean;
}

// Rule TIMELINE-39
/** The creation and the first activation of a task from its state history, once read */
function taskMoments(id: number, input: TimelineInput): { created?: number; activated?: number } {
  const changes = input.stateHistory?.get(id);
  if (!changes?.length) {
    return {};
  }
  const sorted = [...changes].sort((a, b) => a.at - b.at);
  return {
    created: sorted[0].at,
    activated: sorted.find((change) => stateCategory(change.state) === 'in-progress')?.at,
  };
}

/** The tasks of a work item that are not removed: the Task children in the list and the ones outside it */
function tasksOfItem(item: WorkItemModel, input: TimelineInput): TaskFacts[] {
  const own = input.workItems
    .filter((candidate) => candidate.parentId === item.id && candidate.type === 'Task')
    .map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      activated: instant(task.dates?.activated),
      created: instant(task.dates?.created),
      stateChanged: instant(task.dates?.stateChanged),
      stateKey: `${String(task.id)}:${task.rev === undefined ? '?' : String(task.rev)}`,
      prIds: (task.taskPullRequests ?? []).map((pr) => pr.id),
      canCreatePullRequest: task.canCreatePullRequest === true,
    }));
  const others = (item.otherTasks ?? [])
    .filter((task) => task.type === 'Task')
    .map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      activated: instant(task.activated),
      created: instant(task.created),
      stateChanged: instant(task.stateChanged),
      stateKey: `${String(task.id)}:${task.rev === undefined ? '?' : String(task.rev)}`,
      prIds: task.taskPullRequests.map((pr) => pr.id),
      canCreatePullRequest: task.canCreatePullRequest === true,
    }));
  return [...own, ...others]
    .filter((task) => stateCategory(task.state) !== 'removed')
    .map((task) => {
      const read = taskMoments(task.id, input);
      return { ...task, created: read.created ?? task.created, activated: read.activated ?? task.activated };
    });
}

// Rule TIMELINE-20
/**
 * The start of the implementation of a PR drawn on a row: the first commit of the PR, the activation of the Task linked
 * to the PR, or the earlier of the two (the setting); never after the creation of the PR. The first commit of the PR
 * is asked when the setting needs it, except for the PRs of other people
 */
function implementationOf(
  prId: number,
  item: WorkItemModel,
  tasks: readonly TaskFacts[],
  created: number | undefined,
  context: RowContext
): { at: number; approximate: boolean; detail: string } | undefined {
  const { input } = context;
  const setting = input.codingStart ?? 'earliest';
  // Rule TIMELINE-24: the PRs of others are never asked for their commits (one request per PR for everybody)
  const readsCommits = needsFirstCommit(setting) && !context.team;
  const firstCommit = readsCommits ? input.firstCommits?.get(prId) : undefined;
  if (readsCommits && firstCommit === undefined) {
    context.firstCommitsWanted.add(prId);
  }
  const task = tasks
    .filter((candidate) => candidate.prIds.includes(prId) && candidate.activated !== undefined)
    .map((candidate) => ({ id: candidate.id, activated: candidate.activated ?? 0 }))
    .sort((a, b) => a.activated - b.activated)
    .at(0);
  const start = codingStartOf({
    setting,
    prCreated: created,
    firstCommit: instant(firstCommit),
    task,
    workItemActivated: instant(item.dates?.activated),
  });
  return start
    ? {
        at: start.at,
        approximate: start.approximate,
        detail: implementationDetail(start.source, start.at, start.taskId),
      }
    : undefined;
}

/* ---------- The PRs of a work item ---------- */

interface PrDraw {
  id: number;
  title: string;
  merged: boolean;
  draft: boolean;
  /** The row of the PR is not drawn (a merged PR outside of the axis) */
  hidden: boolean;
  /** Undefined: its dates are not known */
  facts?: PrFacts;
  stations: StationSpan[];
  card?: BoardWorkCard;
  mine?: MyPullRequestModel;
  reviewers: ReviewerModel[];
  runs: RunModel[];
  ref: HistoryRef;
  url?: string;
}

const stampsOfTeam = (pr: TeamPullRequestInfo): PullRequestStamps => ({
  createdAt: pr.createdAt,
  publishedAt: pr.publishedAt,
  closedAt: pr.closedAt,
});

const stampsOfCompleted = (pr: CompletedPullRequestInfo): PullRequestStamps => ({
  createdAt: pr.creationDate,
  publishedAt: pr.publishedAt,
  closedAt: pr.closedDate,
  lastVoteAt: pr.lastVoteAt,
});

/** The card of an open PR: its own card when the work item is split, else the one card of the work item */
function cardOfPullRequest(
  cards: readonly BoardWorkCard[],
  item: WorkItemModel,
  prId: number
): BoardWorkCard | undefined {
  const own = cards.find((card) => card.prId === prId);
  if (own) {
    return own;
  }
  const single = cards.find((card) => card.part === undefined);
  return single && trackPullRequest(item)?.id === prId ? single : undefined;
}

/** What the board says of an open PR now: its station, and since when when that is known */
function currentOf(
  card: BoardWorkCard | undefined,
  draft: boolean,
  runs: readonly RunModel[],
  stamps: PullRequestStamps | undefined
): CurrentStation | undefined {
  if (draft) {
    return { kind: 'pullRequest' };
  }
  if (!card) {
    return undefined;
  }
  const needs =
    card.status && (card.status.tone === 'broken' || card.status.tone === 'needsYou') ? card.status.text : undefined;
  if (needs && (card.column === 'ci' || card.column === 'review')) {
    const failed = runs.some((run) => run.state === 'failed' || run.state === 'partial');
    return {
      kind: 'needsYou',
      of: card.column,
      reason: card.column === 'ci' && failed && !needs.startsWith('CI') ? `CI: ${needs}` : needs,
      since: needsYouSince(card.column, runs, stamps),
    };
  }
  switch (card.column) {
    case 'ci':
      return { kind: 'ci' };
    case 'review':
      return { kind: 'review' };
    case 'ready':
      return { kind: 'ready', since: readySince(runs, stamps) };
    case 'branch':
      return { kind: 'pullRequest' };
    case 'done':
    case 'toStart':
      return undefined;
  }
}

// Rules TIMELINE-16, TIMELINE-17, TIMELINE-22
/** The PRs of a work item that are drawn: open ones and merged ones, with their stations, oldest creation first */
function pullRequestsOf(
  item: WorkItemModel,
  cards: readonly BoardWorkCard[],
  tasks: readonly TaskFacts[],
  context: RowContext
): PrDraw[] {
  const { input, days, axisStart } = context;
  const draws = item.pullRequests.flatMap((pr): PrDraw[] => {
    if (pr.tone === 'abandoned') {
      return [];
    }
    const merged = pr.tone === 'completed';
    const mine = input.myPullRequests.find((candidate) => candidate.id === pr.id);
    const theirs = context.team?.pullRequests.get(pr.id);
    const completed = input.completedPullRequests?.find((candidate) => candidate.id === pr.id);
    const stamps =
      (merged && completed ? stampsOfCompleted(completed) : undefined) ??
      mine?.stamps ??
      (theirs && stampsOfTeam(theirs)) ??
      (completed && stampsOfCompleted(completed));
    const draft = !merged && (mine?.isDraft ?? theirs?.isDraft ?? pr.tone === 'draft');
    const reviewers = mine?.reviewers ?? theirs?.reviewers ?? [];
    const runs = pr.runs.length ? pr.runs : mine?.runs ?? [];
    const history = input.history?.get(pr.id);
    const created = instant(stamps?.createdAt);
    const closed = merged ? instant(stamps?.closedAt) : undefined;
    const card = merged ? undefined : cardOfPullRequest(cards, item, pr.id);
    const dated = created !== undefined && (!merged || closed !== undefined);
    const ref: HistoryRef = {
      id: pr.id,
      repositoryId: mine?.repositoryId ?? theirs?.repositoryId ?? completed?.repositoryId,
      closed: merged,
      commit: mine?.commit ?? theirs?.commit,
      state: stateSignature(reviewers, draft),
    };
    // A merged PR has its row when it was merged within the axis (Rules TIMELINE-17, TIMELINE-19)
    const hidden =
      merged &&
      (closed === undefined ||
        !mergedInRange({ closedDate: new Date(closed).toISOString() }, axisStart, days[days.length - 1].endMs));
    let facts: PrFacts | undefined;
    let stations: StationSpan[] = [];
    if (dated) {
      const implementation = implementationOf(pr.id, item, tasks, created, context);
      facts = {
        id: pr.id,
        created,
        closed,
        isDraft: draft,
        published: instant(stamps?.publishedAt),
        author: theirs?.author,
        reviewers: reviewers.map((reviewer) => ({
          name: reviewer.name,
          isRequired: reviewer.isRequired,
          isContainer: reviewer.isContainer,
        })),
        conflicts: mine?.conflicts ?? theirs?.conflicts ?? false,
        threads: history?.threads,
        // Rule TIMELINE-39: read on the first hover of the row
        commits: input.commits?.get(pr.id),
        runs: history?.runs ?? runs,
        runsComplete: history?.runs !== undefined,
        implementation,
        current: merged ? undefined : currentOf(card, draft, runs, stamps),
        // Rule TIMELINE-16: a merged PR was ready from its last vote; without a vote event no green span is invented
        readySince: merged && stamps?.lastVoteAt !== undefined ? readySince(runs, stamps) : undefined,
        now: context.now,
      };
      stations = pullRequestStations(facts);
    }
    return [
      {
        id: pr.id,
        title: pullRequestTitle(pr.title),
        merged,
        draft,
        hidden,
        facts,
        stations,
        card,
        mine,
        reviewers,
        runs,
        ref,
        url: theirs?.url ?? mine?.url,
      },
    ];
  });
  const createdOf = (draw: PrDraw): number => draw.facts?.created ?? Number.MAX_SAFE_INTEGER;
  return draws.sort((a, b) => createdOf(a) - createdOf(b));
}

/* ---------- Work item row ---------- */

/** Where the work began: the first implementation of a PR, a task in progress without PR, or the work item itself */
function workStart(
  item: WorkItemModel,
  draws: readonly PrDraw[],
  tasks: readonly TaskFacts[]
): { at: number; approximate: boolean } | undefined {
  const candidates = [
    ...draws.flatMap((draw) =>
      draw.facts?.implementation
        ? [{ at: draw.facts.implementation.at, approximate: draw.facts.implementation.approximate }]
        : []
    ),
    ...tasks.flatMap((task) =>
      task.prIds.length === 0 && stateCategory(task.state) === 'in-progress' && task.activated !== undefined
        ? [{ at: task.activated, approximate: false }]
        : []
    ),
  ].sort((a, b) => a.at - b.at);
  const first = candidates.at(0);
  if (first) {
    return first;
  }
  const activated = instant(item.dates?.activated);
  return activated === undefined ? undefined : { at: activated, approximate: true };
}

// Rule TIMELINE-35
const STATE_SEGMENT: Record<StateKind, SegmentKind> = {
  new: 'stateNew',
  approved: 'stateApproved',
  committed: 'stateCommitted',
  inReview: 'stateInReview',
  done: 'stateDone',
  reopened: 'stateReopened',
};

const STATION_TEXT: Record<WorkItemStationSpan['kind'], string> = {
  branch: 'Branch',
  pullRequest: 'PR',
  ci: 'CI',
  review: 'Review',
  ready: 'ready to be merged',
  needsYou: 'needs you',
};

/** The text inside the bar of the station the work item is at now: what the board says of it */
function currentText(span: WorkItemStationSpan, draws: readonly PrDraw[], openCount: number): string {
  const draw = draws.find((candidate) => candidate.id === span.prId);
  if (span.kind === 'needsYou') {
    const where = openCount > 1 && span.prId !== undefined ? ` in PR ${String(span.prId)}` : '';
    return `needs you${span.reason ? ` · ${span.reason}` : ''}${where}`;
  }
  if (span.kind === 'review') {
    const waiting = draw?.reviewers.find(
      (reviewer) => reviewer.isRequired && !reviewer.isContainer && reviewer.vote === 'none'
    );
    const progress = draw?.card?.column === 'review' ? draw.card.status?.text : undefined;
    return ['Review', progress, waiting ? `waiting for ${firstName(waiting.name)}` : ''].filter(Boolean).join(' · ');
  }
  if (span.kind === 'branch' && draws.length === 0) {
    return 'Branch';
  }
  return STATION_TEXT[span.kind];
}

// Rule TIMELINE-9
/** The "Create PR" button of a task without PR: the one of the task row of the sidebar, under the same condition */
function createPullRequestAction(item: WorkItemModel, task: TaskFacts, context: RowContext): BoardAction | undefined {
  if (context.team || !task.canCreatePullRequest) {
    return undefined;
  }
  return { label: 'Create PR', message: { type: 'createPullRequest', id: item.id, taskId: task.id } };
}

/** The button of an open PR: the first of its NEEDS YOU box (Show tests…), else the one of its card */
function pullRequestAction(draw: PrDraw): (BoardAction & { primary: boolean }) | undefined {
  const card = draw.card;
  const needs = card?.need && card.status && ['broken', 'needsYou'].includes(card.status.tone);
  const action = needs ? card.need?.actions.at(0) : card?.action;
  return action && { ...action, primary: card?.tone === 'ship' };
}

const phaseText: Record<LifecyclePhaseKind, string> = {
  implementation: 'implementation',
  draft: 'draft',
  review: 'review',
  ready: 'ready to merge',
};

const SEGMENT_OF_PHASE: Record<LifecyclePhaseKind, TimelineSegment['kind']> = {
  implementation: 'implementation',
  draft: 'draft',
  review: 'review',
  ready: 'ready',
};

/** "Task 67163 · Measurement update · In Progress", or "no linked task" */
function linkedTasksText(prId: number, tasks: readonly TaskFacts[]): string {
  const linked = tasks.filter((task) => task.prIds.includes(prId));
  const first = linked.at(0);
  if (!first) {
    return 'no linked task';
  }
  const more = linked.length > 1 ? ` · +${String(linked.length - 1)} more` : '';
  return `Task ${String(first.id)} · ${first.title} · ${first.state}${more}`;
}

// Rules TIMELINE-17, TIMELINE-27
/** The row of a PR under its work item: its phases, the events along them and, when merged, its mark */
function pullRequestChild(
  item: WorkItemModel,
  draw: PrDraw,
  tasks: readonly TaskFacts[],
  openCount: number,
  context: RowContext,
  knownStart?: number
): PullRequestChild {
  const { days, axisStart } = context;
  const history = context.input.history?.get(draw.id);
  const base: PullRequestChild = {
    kind: 'pr',
    key: `pr:${String(item.id)}:${String(draw.id)}`,
    prId: draw.id,
    pill: { text: `${draw.draft ? 'draft ' : ''}PR ${String(draw.id)}`, ...(draw.merged ? { merged: true } : {}) },
    title: draw.title,
    sub: linkedTasksText(draw.id, tasks),
    segments: [],
    markers: [],
    markerRows: 1,
    history: history?.state ?? 'idle',
    historyRef: draw.ref,
    open: context.team
      ? { type: 'openTeamPullRequest', url: draw.url ?? '' }
      : { type: 'openPullRequest', id: item.id, pullRequestId: draw.id },
    end: 0,
  };
  const { facts } = draw;
  if (!facts) {
    // Its dates are not known: what is known is drawn, approximate (a bar from the start of the work to now)
    const start = knownStart ?? axisStart;
    const guess = toSegment(
      {
        kind: draw.draft ? 'draft' : 'review',
        start: Math.max(start, axisStart),
        end: context.now,
        text: draw.draft ? 'draft' : 'review',
        detail: draw.draft ? 'draft · self-review' : 'review',
        approximate: true,
        approximateNote: 'The dates of this PR are not known',
      },
      days
    );
    return { ...base, segments: guess ? [guess] : [], end: guess?.end ?? 0, undated: true };
  }
  const phases = pullRequestPhases(facts, draw.stations);
  const segments = phases.flatMap((phase) => {
    const segment = toSegment(
      {
        kind: SEGMENT_OF_PHASE[phase.kind],
        start: phase.start,
        end: phase.end,
        text: phaseText[phase.kind],
        detail: phase.detail,
        approximate: phase.approximate,
        fromBefore: phase.start < axisStart,
        approximateNote: 'Not exact: the history of the PR is not read yet or the start is a guess',
      },
      days
    );
    return segment ? [segment] : [];
  });
  const marks = pullRequestEvents(facts).flatMap((event): TimelineMarker[] => {
    const at = axisPosition(event.at, days);
    return event.at < axisStart || at >= days.length
      ? []
      : [{ kind: event.kind, at, text: event.text, tone: event.tone, tip: { title: event.title, lines: event.lines } }];
  });
  const markers = layoutMarkers(withAtRest(marks));
  // Rule TIMELINE-39: before the implementation, the linked task while it was to do; read on the first hover
  const linked = tasks.filter((task) => task.prIds.includes(draw.id));
  const { input } = context;
  if (input.hovered?.has(draw.id)) {
    context.commitsWanted?.set(draw.id, {
      key: draw.merged ? 'closed' : draw.ref.commit ?? 'open',
      repositoryId: draw.ref.repositoryId,
    });
    linked.forEach((task) => context.statesWanted?.set(task.id, task.stateKey));
  }
  const detailsLoading =
    input.detailsLoading?.has(draw.id) === true || linked.some((task) => input.statesLoading?.has(task.id) === true);
  const implementationStart = segments.at(0)?.start;
  const task = linked
    .filter((candidate) => candidate.created !== undefined)
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
    .at(0);
  const toDo =
    task?.created !== undefined && implementationStart !== undefined
      ? toSegment(
          {
            kind: 'taskToDo',
            start: Math.max(task.created, axisStart),
            end: Math.min(facts.implementation?.at ?? facts.created, facts.created),
            text: 'task to do',
            detail: `Task ${String(task.id)} to do, before its work started`,
            fromBefore: task.created < axisStart,
          },
          days
        )
      : undefined;
  // The implementation that starts at the activation of the task is the task in progress
  const startedByTask = task?.activated !== undefined && facts.implementation?.at === task.activated;
  const drawn = [
    ...(toDo && toDo.end <= (implementationStart ?? 0) + 0.001 ? [toDo] : []),
    ...segments.map((segment) =>
      startedByTask && segment.kind === 'implementation' ? { ...segment, text: 'task in progress' } : segment
    ),
  ];
  const closedAt = facts.closed;
  const merged =
    draw.merged && closedAt !== undefined
      ? { at: axisPosition(closedAt, days), text: `✓ merged ${dayLabel(closedAt)}` }
      : undefined;
  const end = merged?.at ?? segments.at(-1)?.end ?? 0;
  // The buttons of the PRs are on their own row only when there are several (a single PR has them on the work item row)
  const action = !draw.merged && openCount > 1 && !context.team ? pullRequestAction(draw) : undefined;
  return {
    ...base,
    segments: mergeSegments(drawn),
    markers,
    markerRows: markerRows(markers),
    ...(detailsLoading ? { detailsLoading } : {}),
    ...(merged ? { merged } : {}),
    ...(action ? { action } : {}),
    end,
  };
}

// Rule TIMELINE-18
/** The tasks of the work item that have no PR: the ones in progress with a bar, the others in one compact row */
function taskChildren(item: WorkItemModel, tasks: readonly TaskFacts[], context: RowContext): TimelineChild[] {
  const { days, axisStart, now } = context;
  const without = tasks.filter((task) => task.prIds.length === 0);
  const order = { 'in-progress': 0, proposed: 1, done: 2, removed: 3 } as const;
  return [...without]
    .sort((a, b) => order[stateCategory(a.state)] - order[stateCategory(b.state)])
    .map((task): TaskChild => {
      const category = stateCategory(task.state);
      let span: Span;
      let sub: string;
      if (category === 'done') {
        // Rule TIMELINE-18: a task done without a PR, from its activation to when it was done
        const end = Math.min(task.stateChanged ?? now, now);
        const start = task.activated !== undefined && task.activated < end ? task.activated : undefined;
        span = {
          kind: 'implementation',
          start: start ?? Math.min(end, axisStart),
          end,
          text: 'done',
          detail: 'Task done, without a PR',
          approximate: start === undefined,
          fromBefore: start !== undefined && start < axisStart,
          approximateNote: 'The task has no activation date',
        };
        sub = `${task.state}${task.stateChanged === undefined ? '' : ` ${dayLabel(task.stateChanged)}`} · no PR`;
      } else if (category === 'in-progress') {
        const start = task.activated;
        const guess = start === undefined || start > now;
        span = {
          kind: 'branch',
          start: guess ? axisStart : Math.max(start, axisStart),
          end: now,
          text: 'in progress',
          detail: 'Task in progress, no PR yet',
          approximate: guess,
          fromBefore: !guess && start < axisStart,
          approximateNote: 'The task has no activation date',
        };
        sub = `${task.state}${guess ? '' : ` since ${dayLabel(start)}`} · no PR`;
      } else {
        // Rule TIMELINE-18: a task still to do, hatched from its creation
        const created = task.created;
        const guess = created === undefined || created > now;
        span = {
          kind: 'taskToDo',
          start: guess ? axisStart : Math.max(created, axisStart),
          end: now,
          text: 'to do',
          detail: 'Task to do',
          approximate: guess,
          fromBefore: !guess && created < axisStart,
          approximateNote: 'The task has no creation date',
        };
        sub = `${task.state}${guess ? '' : ` · created ${dayLabel(created)}`}`;
      }
      const segment = toSegment(span, days);
      const action = category === 'in-progress' ? createPullRequestAction(item, task, context) : undefined;
      return {
        kind: 'task',
        key: `task:${String(item.id)}:${String(task.id)}`,
        taskId: task.id,
        title: task.title,
        sub,
        segments: segment ? [segment] : [],
        ...(action ? { action: { ...action, primary: false } } : {}),
        ...(category === 'done' ? { done: true } : {}),
        open: { type: 'openDetails', id: task.id },
        end: segment?.end ?? 0,
      };
    });
}

// Rule TIMELINE-18
/** What an expanded work item row shows: its PRs (oldest first), its tasks without a PR, or a placeholder */
function childrenOf(
  item: WorkItemModel,
  draws: readonly PrDraw[],
  tasks: readonly TaskFacts[],
  openCount: number,
  context: RowContext
): TimelineChild[] {
  const prRows = draws
    .filter((draw) => !draw.hidden)
    .map((draw) => pullRequestChild(item, draw, tasks, openCount, context, workStart(item, draws, tasks)?.at));
  const taskRows = taskChildren(item, tasks, context);
  if (!prRows.length && !taskRows.length) {
    return [
      {
        kind: 'placeholder',
        key: `empty:${String(item.id)}`,
        text: 'No PRs or tasks yet',
        hint: 'Add a task or create a PR: they will show here',
      },
    ];
  }
  return [...prRows, ...taskRows];
}

/** The work item needs the user: one of its PRs is theirs to move, or it is theirs to complete (Rule TIMELINE-18) */
const needsTheUser = (cards: readonly BoardWorkCard[]): boolean =>
  cards.some(
    (card) => card.tone === 'needsYou' || card.tone === 'broken' || card.tone === 'ship' || card.verb !== undefined
  );

// Rule TIMELINE-1
/** The row of a work item: its stations over time, and what it shows when expanded */
export function workItemRow(cards: readonly BoardWorkCard[], context: RowContext): TimelineRow {
  const { input, days, axisStart, now } = context;
  const card = cards.find((candidate) => candidate.primary) ?? cards[0];
  const item = input.workItems.find((candidate) => candidate.id === card.id);
  const readOnly = context.team !== undefined;
  const label: RowLabel = {
    tag: workItemTag(card.itemKind),
    id: `#${String(card.id)}`,
    state: item?.displayState,
  };
  const row: TimelineRow = {
    key: card.key,
    section: 'work',
    id: card.id,
    header: labelText(label),
    title: card.itemTitle,
    label,
    here: cards.some((candidate) => candidate.here),
    bug: card.itemKind === 'bug',
    segments: [],
    open: { type: 'openDetails', id: card.id },
    boardKey: card.key,
    end: 0,
    expandable: true,
  };
  if (!item) {
    return row;
  }
  context.statesWanted?.set(item.id, `${String(item.id)}:${item.rev === undefined ? '?' : String(item.rev)}`);
  const tasks = tasksOfItem(item, input);
  const draws = pullRequestsOf(item, cards, tasks, context);
  const openDraws = draws.filter((draw) => !draw.merged);
  const openCount = openDraws.length;
  const children = childrenOf(item, draws, tasks, openCount, context);
  const prCount = draws.length;
  label.state = [item.displayState, prCount > 1 ? plural(prCount, 'PR') : ''].filter(Boolean).join(' · ');
  const base: TimelineRow = {
    ...row,
    title: item.title,
    header: labelText(label),
    children,
    defaultExpanded:
      !readOnly &&
      !isFinishedState(item.state) &&
      needsTheUser(cards) &&
      children.some((child) => child.kind !== 'placeholder'),
  };
  // Rule TIMELINE-9: not started, or only work still to do: a dashed outline with the reasons
  const single = cards.length === 1 && card.part === undefined;
  if (single && (card.column === 'toStart' || (!draws.length && card.column !== 'branch' && card.column !== 'done'))) {
    const blocked = item.blockingTags?.length ? `tag ${item.blockingTags.join(', ')}` : '';
    const waits = item.openPredecessors?.at(0);
    const text = [
      'not started',
      tasks.length || draws.length ? '' : 'no PRs or tasks in progress',
      blocked,
      waits ? `⛓ waits on #${String(waits.id)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      ...base,
      outline: { text, broken: !!blocked || card.tone === 'broken' },
      action: card.action && { ...card.action, primary: false },
      end: days.length,
    };
  }
  const finished = isFinishedState(item.state);
  const lastClosed = Math.max(
    0,
    ...draws.flatMap((draw) => (draw.facts?.closed === undefined ? [] : [draw.facts.closed]))
  );
  // Rule TIMELINE-35: the states of the work item, from its history once read
  // The changes after now are not drawn (a past sprint is drawn as of its end, Rule TIMELINE-41)
  const changes = input.stateHistory?.get(item.id)?.filter((change) => change.at <= now);
  const finishedAt = finished
    ? finishedStateAt({ changes, state: item.state, dates: item.dates }) ?? (lastClosed || now)
    : undefined;
  const started =
    workStart(item, draws, tasks) ?? (card.column === 'toStart' ? undefined : { at: axisStart, approximate: true });
  const stations = workItemStations({
    now,
    started,
    finished: finishedAt,
    prs: draws.flatMap((draw) =>
      draw.facts
        ? [{ id: draw.id, created: draw.facts.created, closed: draw.facts.closed, stations: draw.stations }]
        : []
    ),
    tasksOpen: tasks.some((task) => stateCategory(task.state) !== 'done'),
  });
  // What the work item needs now is said after the bar (the stations stay on the PR rows, the board and the sidebar)
  const current = stations.at(-1);
  const needsNow =
    !finished && current?.kind === 'needsYou' && current.end >= now
      ? currentText(current, draws, openCount)
      : undefined;
  // Rule TIMELINE-36: In review, in the past, from the publication of the first PR while Committed
  const published = draws.flatMap((draw) => {
    const facts = draw.facts;
    if (!facts) {
      return [];
    }
    const when = facts.published ?? (facts.isDraft ? undefined : facts.created);
    return when === undefined ? [] : [when];
  });
  let spans: Span[] = stateSpans({
    changes,
    state: item.state,
    dates: item.dates,
    firstPublished: published.length ? Math.min(...published) : undefined,
    now,
  }).map((span) => ({
    kind: STATE_SEGMENT[span.kind],
    start: span.start,
    end: span.end,
    text: span.text,
    detail: span.derived
      ? 'In review · not a state of Azure DevOps: from the publication of the first PR'
      : `State ${span.text}`,
    approximate: span.approximate,
    fromBefore: span.start < axisStart,
    dashed: span.derived,
    approximateNote: 'Not exact: the history of its states is not read yet',
  }));
  // Rule TIMELINE-8
  let popover: TimelinePopover | undefined;
  if (card.asleep) {
    const changed = instant(item.dates?.changed);
    const from = changed ?? now - card.asleep.days * 24 * MS_PER_HOUR;
    spans = withAsleep(
      spans,
      Math.max(from, axisStart),
      now,
      `zZ no update for ${String(card.asleep.days)} working day${card.asleep.days === 1 ? '' : 's'}`
    );
    const draft = openDraws.find((draw) => draw.draft && draw.mine)?.mine;
    popover = {
      title: `ASLEEP · #${String(card.id)}`,
      text: `Neither the item nor its tasks changed since ${dateText(from)}.${
        draft ? ` Its draft PR ${String(draft.id)} waits for your self-review.` : ''
      }`,
      rule: 'Team rule: update status, tasks and effort daily.',
      actions: [
        ...(draft
          ? [
              {
                label: 'Publish draft',
                message: { type: 'publishMyPullRequest' as const, pullRequestId: draft.id },
                primary: true,
              },
            ]
          : []),
        { label: 'Update tasks', message: { type: 'openDetails' as const, id: card.id } },
        { label: 'Open on board', message: { type: 'openBoard' as const, key: card.key } },
      ],
    };
  }
  const segments = mergeSegments(
    spans.flatMap((span) => {
      const segment = toSegment(span, days);
      return segment ? [segment] : [];
    })
  );
  // The button after the bar: with one open PR (or none), the one of its card; with several they are on their rows
  const needsText = card.status && (card.status.tone === 'broken' || card.status.tone === 'needsYou');
  let action: (BoardAction & { primary: boolean }) | undefined;
  if (openCount <= 1 && !readOnly) {
    const found = needsText && card.need ? card.need.actions.at(0) : card.action;
    action = found && { ...found, primary: card.tone === 'ship' };
  }
  const waitsOn = item.openPredecessors?.at(0);
  const end = segments.at(-1)?.end ?? 0;
  // Rule TIMELINE-19: a finished work item is faded, with its mark at the day it finished
  const done = finished
    ? {
        at: finishedAt === undefined ? end : Math.max(axisPosition(finishedAt, days), end),
        text: doneMark(instant(item.dates?.stateChanged), item.type === 'Bug'),
      }
    : undefined;
  return {
    ...base,
    segments,
    chip: waitsOn ? `⛓ waits on #${String(waitsOn.id)}` : undefined,
    ...(needsNow ? { note: { text: needsNow, tone: 'needsYou' as const } } : {}),
    action,
    popover,
    ...(done ? { faded: true, merged: done } : {}),
    end: done ? done.at : end,
  };
}

// Rules TIMELINE-1, TIMELINE-19
/** The rows of a list of cards, one per work item; the finished work items go apart, after the open ones */
export function rowsOfCards(
  cards: readonly BoardWorkCard[],
  context: RowContext
): { work: TimelineRow[]; finished: TimelineRow[] } {
  const work: TimelineRow[] = [];
  const finished: TimelineRow[] = [];
  const ids = [...new Set(cards.map((card) => card.id))];
  for (const id of ids) {
    const item = context.input.workItems.find((candidate) => candidate.id === id);
    const row = workItemRow(
      cards.filter((card) => card.id === id),
      context
    );
    // Rule TIMELINE-19: the finished work items come after the open ones
    (item && isFinishedState(item.state) ? finished : work).push(row);
  }
  return { work, finished };
}
