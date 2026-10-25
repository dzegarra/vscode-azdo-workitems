/**
 * The Sprint timeline (redesign): the work of the sprint on a working-days axis, one row per card of the Track board
 * (so the two tabs never disagree), the reviews the user owes with their deadline and the history of the base branch.
 * It only draws what the store, My Pull Requests, the review requests and the base branch runs already carry: no
 * timestamp is invented, a start that is not known begins at the first day of the sprint and is marked approximate.
 * Pure, so no "vscode" import: the webview uses the types and the panel builds the model
 */
import { brokenSince, type BaseBranchHealth, type BaseBranchRun } from './baseBranchHealth';
import { formatAge, type MyPullRequestModel } from './myPullRequests';
import type { PullRequestStamps } from './pullRequestTimeline';
import type { ReviewRequestModel } from './reviewRequests';
import { iterationKind, type ScheduledIteration } from './schedule';
import { trackPullRequest } from './track';
import type { BoardAction, BoardColumnId, BoardModel, BoardWorkCard } from './trackBoardModel';
import type { RunModel } from './pipelines';
import type { WebviewMessage, WorkItemModel } from './viewModel';
import { addWorkingMs } from './workingTime';

export const OPEN_SPRINT_TIMELINE_COMMAND = 'totalflowx.openSprintTimeline';

export type TimelineRange = 'sprint' | 'sprintAndNext';

/** Messages of the Sprint timeline: the buttons post the messages of the sidebar, so the same code runs them */
export type TimelineMessage =
  | WebviewMessage
  | { type: 'setTimelineRange'; range: TimelineRange }
  | { type: 'openBoard'; key?: string }
  | { type: 'ready' };

export type SegmentKind =
  | 'asleep'
  | 'coding'
  | 'draft'
  | 'dueSoon'
  | 'needsYou'
  | 'overdue'
  | 'planned'
  | 'ready'
  | 'review'
  | 'wait';

const MS_PER_HOUR = 3_600_000;
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/* ---------- The axis ---------- */

export interface TimelineDay {
  /** YYYY-MM-DD */
  date: string;
  /** "We 14" */
  label: string;
  /** First working day of a week: a separator before it */
  weekStart: boolean;
  today: boolean;
  /** A day of the next sprint ("This + next sprint") */
  next: boolean;
  /** The last day of the sprint */
  last: boolean;
  /** Local start and end of the day (ms) */
  startMs: number;
  endMs: number;
}

const iterationDay = (date: string): [number, number, number] | undefined => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return match ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])] : undefined;
};

// Rule TIMELINE-2
/**
 * The working days from `start` to `finish` (YYYY-MM-DD, both included); weekends and the days off are skipped. The
 * days of `nextFinish` after `finish` belong to the next sprint
 */
export function buildAxis(
  start: string,
  finish: string,
  workingDays: readonly number[],
  now: Date,
  next?: { start: string; finish: string }
): TimelineDay[] {
  const from = iterationDay(start);
  const to = iterationDay(next?.finish ?? finish);
  const thisLast = iterationDay(finish);
  if (!from || !to || !thisLast) {
    return [];
  }
  const working = workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6];
  const last = Date.UTC(...thisLast);
  const days: TimelineDay[] = [];
  let previousWeekday = -1;
  const today = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  for (let day = Date.UTC(...from); day <= Date.UTC(...to); day += 86_400_000) {
    const date = new Date(day);
    const weekday = date.getUTCDay();
    if (!working.includes(weekday)) {
      continue;
    }
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()];
    const iso = `${String(y)}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({
      date: iso,
      label: `${WEEKDAYS[weekday]} ${String(d)}`,
      weekStart: days.length > 0 && weekday <= previousWeekday,
      today: iso === today,
      next: day > last,
      last: day === last,
      startMs: new Date(y, m, d).getTime(),
      endMs: new Date(y, m, d + 1).getTime(),
    });
    previousWeekday = weekday;
  }
  return days;
}

/**
 * Where a moment falls on the axis, in days from its start (1.5: the middle of the second day). A moment on a day off
 * is the start of the next working day; before the first day 0, after the last one the number of days
 */
export function axisPosition(ms: number, days: readonly TimelineDay[]): number {
  for (const [index, day] of days.entries()) {
    if (ms < day.startMs) {
      return index;
    }
    if (ms < day.endMs) {
      return index + (ms - day.startMs) / (day.endMs - day.startMs);
    }
  }
  return days.length;
}

/** The sprint after the given one: same team (same name without its number), starting later; the earliest */
export function nextIteration(
  current: { name: string; finishDate?: string },
  schedule: readonly ScheduledIteration[] | undefined
): { name: string; start: string; finish: string; path: string } | undefined {
  const prefix = current.name.replace(/\s*\d+$/, '');
  const finish = current.finishDate?.slice(0, 10);
  if (!schedule || !finish) {
    return undefined;
  }
  return schedule
    .flatMap((iteration) =>
      iterationKind(iteration.path) === 'sprint' &&
      iteration.start &&
      iteration.finish &&
      iteration.name.replace(/\s*\d+$/, '') === prefix &&
      iteration.start.slice(0, 10) > finish
        ? [
            {
              name: iteration.name,
              start: iteration.start.slice(0, 10),
              finish: iteration.finish.slice(0, 10),
              path: iteration.path,
            },
          ]
        : []
    )
    .sort((a, b) => a.start.localeCompare(b.start))
    .at(0);
}

/* ---------- The segments of a work item ---------- */

/** A span in time, before it is put on the axis */
export interface Span {
  kind: SegmentKind;
  start: number;
  end: number;
  text?: string;
  /** What it stands for, for the tooltip */
  detail?: string;
  /** The start is not known: it begins at the first day of the sprint */
  approximate?: boolean;
  /** The span began before the sprint */
  fromBefore?: boolean;
}

export interface PhaseInput {
  now: number;
  /** Start of the first day of the axis */
  axisStart: number;
  column: BoardColumnId;
  /** The work item left its first state (ActivatedDate) */
  started?: number;
  /** The work item reached Done (its last state change): what ends the bars of a finished work item */
  finished?: number;
  /** The user's PR, when there is one */
  pullRequest?: { created?: number; published?: number; closed?: number; isDraft: boolean };
  /** The text of the CI · review span */
  reviewText: string;
  /** The current station needs the user: since when (undefined: not known) and what to say */
  needsYou?: { text: string; since?: number };
  /** Since when nothing stops the merge (undefined: not known) */
  readySince?: number;
}

const instant = (value: string | undefined): number | undefined => {
  const ms = Date.parse(value ?? '');
  return Number.isNaN(ms) ? undefined : ms;
};

// Rule TIMELINE-3..7
/**
 * The spans of a work item, in order: coding, draft · self-review, CI · review and then needs you or ready to be
 * merged. A start that is not known begins at the first day of the sprint (approximate)
 */
export function workSpans(input: PhaseInput): Span[] {
  const { now, axisStart, pullRequest: pr } = input;
  const spans: Span[] = [];
  // Rule TIMELINE-3: coding runs from the activation of the work item to the PR (or to now without one)
  const codingEnd = pr?.created ?? input.finished ?? now;
  const known = input.started !== undefined && input.started <= codingEnd ? input.started : undefined;
  const codingStart = known === undefined ? axisStart : Math.max(known, axisStart);
  if (input.column !== 'toStart' && codingEnd > codingStart) {
    spans.push({
      kind: 'coding',
      start: codingStart,
      end: codingEnd,
      detail: 'coding',
      approximate: known === undefined,
      fromBefore: known !== undefined && known < axisStart,
    });
  }
  if (!pr?.created) {
    return spans;
  }
  // Rule TIMELINE-4: a draft until it is published; a PR created published has no draft span
  const published = pr.isDraft ? undefined : pr.published ?? pr.created;
  const draftEnd = pr.isDraft ? pr.closed ?? input.finished ?? now : pr.published;
  if (draftEnd !== undefined && draftEnd > pr.created) {
    spans.push({ kind: 'draft', start: pr.created, end: draftEnd, text: 'draft', detail: 'draft · self-review' });
  }
  if (published === undefined) {
    return spans;
  }
  const end = pr.closed ?? input.finished ?? now;
  // Rule TIMELINE-7: ready to be merged from the moment nothing stopped it
  if (input.column === 'ready') {
    const since = Math.min(Math.max(input.readySince ?? published, published), end);
    return [
      ...spans,
      { kind: 'review', start: published, end: since, text: input.reviewText, detail: 'CI · review' },
      {
        kind: 'ready',
        start: since,
        end,
        text: 'ready to be merged',
        detail: 'ready to be merged',
        approximate: input.readySince === undefined,
      },
    ];
  }
  // Rule TIMELINE-6: needs you from the moment the station did
  if (input.needsYou) {
    const since = Math.min(Math.max(input.needsYou.since ?? published, published), end);
    return [
      ...spans,
      { kind: 'review', start: published, end: since, text: input.reviewText, detail: 'CI · review' },
      {
        kind: 'needsYou',
        start: since,
        end,
        text: input.needsYou.text,
        detail: 'needs you',
        approximate: input.needsYou.since === undefined,
      },
    ];
  }
  // Rule TIMELINE-5
  return [...spans, { kind: 'review', start: published, end, text: input.reviewText, detail: 'CI · review' }];
}

// Rule TIMELINE-8
/** The period without update replaces what it covers with the hatched zZ span */
export function withAsleep(spans: Span[], from: number, to: number, text: string): Span[] {
  if (to <= from) {
    return spans;
  }
  const kept = spans.flatMap((span): Span[] => {
    if (span.end <= from) {
      return [span];
    }
    return span.start < from ? [{ ...span, end: from }] : [];
  });
  return [...kept, { kind: 'asleep', start: from, end: to, text, detail: 'no update' }];
}

// Rule TIMELINE-6
/** The moment the CI or the review started to wait for the user, from the PR's dates and runs */
export function needsYouSince(
  column: BoardColumnId,
  runs: readonly Pick<RunModel, 'finishTime' | 'state'>[],
  stamps: PullRequestStamps | undefined
): number | undefined {
  if (column === 'ci') {
    return runs
      .filter((run) => run.state === 'failed' || run.state === 'partial')
      .map((run) => instant(run.finishTime))
      .filter((at): at is number => at !== undefined)
      .sort((a, b) => a - b)
      .at(-1);
  }
  return instant(stamps?.sentBackAt) ?? instant(stamps?.lastPushAt);
}

// Rule TIMELINE-7
/** The last thing that had to happen before the merge: the latest vote, a green run, the publication */
export function readySince(
  runs: readonly Pick<RunModel, 'finishTime' | 'state'>[],
  stamps: PullRequestStamps | undefined
): number | undefined {
  const moments = [
    instant(stamps?.lastVoteAt),
    ...runs.filter((run) => run.state === 'succeeded').map((run) => instant(run.finishTime)),
  ].filter((at): at is number => at !== undefined);
  return moments.length ? Math.max(...moments) : undefined;
}

/* ---------- The model ---------- */

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

export interface TimelineRow {
  key: string;
  section: 'planned' | 'review' | 'work';
  id: number;
  /** "#66280 · PR 13912" */
  header: string;
  title: string;
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
  /** Where the bar ends, in days: the button and the note go after it */
  end: number;
}

export interface DevelopSpan {
  start: number;
  end: number;
  red: boolean;
  tip: string;
}

export interface TimelineModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  range: TimelineRange;
  header: { sprint: string; dates?: string; left?: string; hurry: boolean };
  days: Pick<TimelineDay, 'date' | 'label' | 'last' | 'next' | 'today' | 'weekStart'>[];
  /** Where NOW is on the axis; undefined outside of it */
  now?: number;
  work: TimelineRow[];
  /** The work items planned in the next sprint ("This + next sprint") */
  planned: { rows: TimelineRow[]; note?: string };
  reviews: TimelineRow[];
  reviewsTitle: string;
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
  base: { branch: string; enabled: boolean; runs: readonly BaseBranchRun[]; health?: BaseBranchHealth };
}

const dayText = (ms: number): string =>
  new Date(ms).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

const dateText = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

function toSegment(span: Span, days: readonly TimelineDay[]): TimelineSegment | undefined {
  const start = axisPosition(span.start, days);
  const end = axisPosition(span.end, days);
  if (end <= start) {
    return undefined;
  }
  const approximate = span.approximate ?? false;
  const tip = [
    span.detail ?? span.kind,
    `${
      span.fromBefore ? 'since before the sprint' : `${approximate ? 'about ' : ''}${dayText(span.start)}`
    } – ${dayText(span.end)}`,
    span.text && span.text !== span.detail ? span.text : '',
    approximate ? 'The start is not known: it begins with the sprint' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    kind: span.kind,
    start,
    end,
    text: span.text,
    tip,
    approximate: approximate || span.fromBefore === true,
  };
}

const firstName = (name: string): string => name.split(' ').at(0) ?? name;

/** "CI ✓ · review · 1 of 2 approvals · waiting for Ana" */
function reviewTextOf(card: BoardWorkCard, mine: MyPullRequestModel | undefined): string {
  const ci = card.hover.find((fact) => fact.label === 'CI')?.value ?? '';
  let ciText = 'CI';
  if (ci.includes('passed')) {
    ciText = 'CI ✓';
  } else if (ci.includes('running')) {
    ciText = 'CI running';
  } else if (ci.includes('queued')) {
    ciText = 'CI queued';
  }
  if (card.column === 'ci') {
    return ciText;
  }
  const waiting = mine?.reviewers.find(
    (reviewer) => reviewer.isRequired && !reviewer.isContainer && reviewer.vote === 'none'
  );
  return [ciText, 'review', card.status?.text, waiting ? `waiting for ${firstName(waiting.name)}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** The PR a card stands for: the one of its PR card, or the one the track follows */
function cardPullRequest(card: BoardWorkCard, item: WorkItemModel): WorkItemModel['pullRequests'][number] | undefined {
  if (card.part === 'task' || card.part === 'tasks') {
    return undefined;
  }
  return card.prId === undefined ? trackPullRequest(item) : item.pullRequests.find((pr) => pr.id === card.prId);
}

// Rule TIMELINE-1
function workRow(
  card: BoardWorkCard,
  context: { input: TimelineInput; days: TimelineDay[]; axisStart: number; now: number }
): TimelineRow {
  const { input, days, axisStart, now } = context;
  const item = input.workItems.find((candidate) => candidate.id === card.id);
  const pr = item && cardPullRequest(card, item);
  const mine = pr && input.myPullRequests.find((candidate) => candidate.id === pr.id);
  const stamps = mine?.stamps;
  const runs = pr?.runs.length ? pr.runs : mine?.runs ?? [];
  const row: TimelineRow = {
    key: card.key,
    section: 'work',
    id: card.id,
    header: card.header,
    title: card.title,
    here: card.here,
    bug: card.itemKind === 'bug',
    segments: [],
    open: { type: 'openDetails', id: card.id },
    boardKey: card.key,
    end: 0,
  };
  // Rule TIMELINE-9: not started, or a task of a split work item without a PR: a dashed outline with the reasons
  if (card.column === 'toStart' || (!pr && card.column !== 'branch' && card.column !== 'done')) {
    const blocked = item?.blockingTags?.length ? `tag ${item.blockingTags.join(', ')}` : '';
    const waits = item?.openPredecessors?.at(0);
    const text = [
      card.tag === 'tasks' ? card.status?.text ?? 'tasks to do' : 'not started',
      card.tag === 'no PR yet' ? card.status?.text ?? '' : '',
      blocked,
      waits ? `⛓ waits on #${String(waits.id)}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    return {
      ...row,
      outline: { text, broken: !!blocked || card.tone === 'broken' },
      action: card.action && { ...card.action, primary: false },
      end: days.length,
    };
  }
  const waitsOn = item?.openPredecessors?.at(0);
  const needsText =
    card.status &&
    (card.status.tone === 'broken' || card.status.tone === 'needsYou') &&
    ['ci', 'review'].includes(card.column)
      ? card.status.text
      : undefined;
  let spans = workSpans({
    now,
    axisStart,
    column: card.column,
    started: instant(item?.dates?.activated),
    finished: card.column === 'done' ? instant(item?.dates?.stateChanged) : undefined,
    pullRequest: stamps
      ? {
          created: instant(stamps.createdAt),
          published: instant(stamps.publishedAt),
          closed: instant(stamps.closedAt),
          isDraft: mine.isDraft,
        }
      : undefined,
    reviewText: reviewTextOf(card, mine),
    needsYou: needsText
      ? {
          text:
            card.column === 'ci' && runs.some((run) => run.state === 'failed' || run.state === 'partial')
              ? `CI: ${needsText}`
              : needsText,
          since: needsYouSince(card.column, runs, stamps),
        }
      : undefined,
    readySince: readySince(runs, stamps),
  });
  // Rule TIMELINE-8
  let popover: TimelinePopover | undefined;
  if (card.asleep && item) {
    const changed = instant(item.dates?.changed);
    const from = changed ?? now - card.asleep.days * 24 * MS_PER_HOUR;
    spans = withAsleep(
      spans,
      Math.max(from, axisStart),
      now,
      `zZ no update for ${String(card.asleep.days)} working day${card.asleep.days === 1 ? '' : 's'}`
    );
    const draft = mine?.isDraft ? mine : undefined;
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
  // A PR whose dates are not known (another repository, an old one): its work is drawn, but not as a guess of phases
  const undated = pr && !stamps ? spans.map((span) => ({ ...span, approximate: true })) : spans;
  const segments = undated.flatMap((span) => {
    const segment = toSegment(span, days);
    return segment ? [segment] : [];
  });
  const action = needsText && card.need ? card.need.actions.at(0) : card.action;
  return {
    ...row,
    segments,
    chip: waitsOn ? `⛓ waits on #${String(waitsOn.id)}` : undefined,
    action: action && { ...action, primary: card.tone === 'ship' },
    popover,
    end: segments.at(-1)?.end ?? 0,
  };
}

/* ---------- Reviews ---------- */

/** "overdue 3 h", "due Mon 10:00 · 5 h left", or the time left of a review that is not urgent */
function reviewNote(review: ReviewRequestModel, overdue: boolean): NonNullable<TimelineRow['note']> {
  if (overdue) {
    return { text: review.timeLeft.replace('overdue by', 'overdue'), tone: 'overdue' };
  }
  if (review.urgency === 'dueSoon') {
    return { text: `${review.dueText} · ${review.timeLeft}`, tone: 'dueSoon' };
  }
  return { text: review.timeLeft, tone: 'fresh' };
}

// Rule TIMELINE-11
function reviewRow(
  review: ReviewRequestModel,
  context: { input: TimelineInput; days: TimelineDay[]; now: number }
): TimelineRow {
  const { input, days, now } = context;
  const published = Date.parse(review.publishedAt);
  const due = addWorkingMs(new Date(published), input.maxWaitHours * MS_PER_HOUR, input.workingDays).getTime();
  const overdue = now > due;
  const late = review.urgency === 'dueSoon' || review.urgency === 'overdue';
  const waitEnd = Math.min(now, due);
  const mk = (kind: SegmentKind, start: number, end: number, tip: string, dashed = false): TimelineSegment[] => {
    const segment = toSegment({ kind, start, end, detail: tip }, days);
    return segment ? [{ ...segment, dashed }] : [];
  };
  const segments = [
    ...mk(late && !overdue ? 'dueSoon' : 'wait', published, waitEnd, 'waiting for your review'),
    ...(overdue ? mk('overdue', due, now, 'overdue') : mk('wait', now, due, `due ${dayText(due)}`, true)),
  ];
  const end = segments.at(-1)?.end ?? 0;
  const note = reviewNote(review, overdue);
  const card = input.board.reviews.find((candidate) => candidate.id === review.id);
  return {
    key: `review:${String(review.id)}`,
    section: 'review',
    id: review.id,
    header: `PR ${String(review.id)} · ${firstName(review.author)}${review.isRequired ? ' · required' : ''}`,
    title: review.title,
    segments,
    note,
    action: card?.checkout && { ...card.checkout, primary: false },
    open: { type: 'openReviewRequest', url: review.url },
    end,
  };
}

/* ---------- The base branch ---------- */

// Rule TIMELINE-12
/**
 * Green and red spans of the base branch from its runs: red while the latest finished run of any pipeline is red.
 * The strip starts at the first run known (the list holds the latest runs only)
 */
export function developSpans(
  runs: readonly BaseBranchRun[],
  now: number
): { start: number; end: number; red: boolean; firstRun: number }[] {
  const latest = new Map<number, boolean>();
  const spans: { start: number; end: number; red: boolean; firstRun: number }[] = [];
  const first = runs.at(0);
  if (!first) {
    return spans;
  }
  let cursor = Date.parse(first.finishTime);
  let red = false;
  for (const run of runs) {
    const at = Date.parse(run.finishTime);
    latest.set(run.definitionId, run.red);
    const next = [...latest.values()].some(Boolean);
    if (next !== red) {
      if (at > cursor) {
        spans.push({ start: cursor, end: at, red, firstRun: Date.parse(first.finishTime) });
      }
      cursor = at;
      red = next;
    }
  }
  if (now > cursor) {
    spans.push({ start: cursor, end: now, red, firstRun: Date.parse(first.finishTime) });
  }
  return spans;
}

function developOf(input: TimelineInput, days: TimelineDay[], now: number): TimelineModel['develop'] {
  const { base } = input;
  if (!base.enabled) {
    return {
      branch: base.branch,
      spans: [],
      note: 'The alarm of the base branch is off (pipelines.baseBranchAlert): its runs are not read',
    };
  }
  const spans = developSpans(base.runs, now).flatMap((span) => {
    const start = axisPosition(span.start, days);
    const end = axisPosition(span.end, days);
    return end > start
      ? [
          {
            start,
            end,
            red: span.red,
            tip: `${span.red ? 'red' : 'green'} · ${dayText(span.start)} – ${dayText(span.end)}`,
          },
        ]
      : [];
  });
  if (!spans.length) {
    return { branch: base.branch, spans, note: 'No finished run of the base branch yet' };
  }
  const since = base.health && brokenSince(base.health);
  const culprit = base.health?.broken.at(0)?.brokenBy.pullRequestId;
  const label =
    since && base.health?.broken.length
      ? {
          text: `broken ${formatAge(now - Date.parse(since))}${
            culprit === undefined ? '' : ` · after PR ${String(culprit)}`
          }`,
          at: spans.at(-1)?.end ?? 0,
        }
      : undefined;
  return { branch: base.branch, spans, label };
}

/* ---------- The whole timeline ---------- */

function plannedRows(
  input: TimelineInput,
  days: TimelineDay[],
  next: { name: string } | undefined
): TimelineModel['planned'] {
  if (input.range !== 'sprintAndNext') {
    return { rows: [] };
  }
  if (!next) {
    return { rows: [], note: 'The next sprint of this team is not in the iteration schedule' };
  }
  if (input.planned.status === 'error') {
    return { rows: [], note: `What is planned in ${next.name} could not be read` };
  }
  if (input.planned.status !== 'ready') {
    return { rows: [], note: `Reading what is planned in ${next.name}…` };
  }
  const first = days.findIndex((day) => day.next);
  return {
    rows: input.planned.items.map((item) => ({
      key: `planned:${String(item.id)}`,
      section: 'planned' as const,
      id: item.id,
      header: `#${String(item.id)}${item.type === 'Bug' ? ' · Bug' : ''}`,
      title: item.title,
      bug: item.type === 'Bug',
      segments: [
        {
          kind: 'planned' as const,
          start: Math.max(first, 0),
          end: days.length,
          text: `planned in ${next.name} · ${item.state}`,
          tip: `Planned in ${next.name} (${item.state})`,
          dashed: true,
        },
      ],
      open: { type: 'openDetails' as const, id: item.id },
      end: days.length,
    })),
    note: input.planned.items.length ? undefined : `Nothing of yours is planned in ${next.name} yet`,
  };
}

function headerOf(input: TimelineInput, board: BoardModel): TimelineModel['header'] {
  const start = input.sprint?.startDate && iterationDay(input.sprint.startDate);
  const finish = input.sprint?.finishDate && iterationDay(input.sprint.finishDate);
  const format = (date: [number, number, number]) =>
    new Date(Date.UTC(...date)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return {
    sprint: input.sprint?.name ?? board.header.sprint,
    dates: start && finish ? `${format(start)} – ${format(finish)} · working days only` : undefined,
    left: board.header.left,
    hurry: board.header.hurry,
  };
}

// Rule TIMELINE-10
/** An open work item gets a dashed "spills over" extension past the end of the sprint (a projection, not a date) */
function withSpill(row: TimelineRow, board: BoardModel, sprintEnd: number, total: number): TimelineRow {
  const card = board.work.find((candidate) => candidate.key === row.key);
  if (!card || ['done', 'ready', 'toStart'].includes(card.column) || row.outline) {
    return row;
  }
  return {
    ...row,
    segments: [
      ...row.segments,
      {
        kind: 'coding',
        start: sprintEnd,
        end: Math.min(total, sprintEnd + 1.5),
        text: 'spills over',
        tip: 'Not done by the end of the sprint: what is left continues in the next one',
        dashed: true,
      },
    ],
  };
}

// Rules TIMELINE-1, TIMELINE-10, TIMELINE-13
export function buildSprintTimeline(input: TimelineInput): TimelineModel {
  const now = input.now.getTime();
  const { board } = input;
  const next = input.sprint
    ? nextIteration({ name: input.sprint.name, finishDate: input.sprint.finishDate }, input.schedule)
    : undefined;
  const start = input.sprint?.startDate?.slice(0, 10);
  const finish = input.sprint?.finishDate?.slice(0, 10);
  const days =
    start && finish
      ? buildAxis(start, finish, input.workingDays, input.now, input.range === 'sprintAndNext' ? next : undefined)
      : [];
  const base = {
    status: board.status,
    error: board.error,
    range: input.range,
    header: headerOf(input, board),
    look: board.look,
    reviewsTitle: `REVIEWS YOU OWE · ${String(input.maxWaitHours)} WORKING HOURS FROM PUBLISH`,
  };
  if (!days.length) {
    return {
      ...base,
      days: [],
      work: [],
      planned: { rows: [] },
      reviews: [],
      develop: { branch: input.base.branch, spans: [] },
      notes: ['The dates of the sprint are not known, so there is no axis to draw'],
    };
  }
  const axisStart = days[0].startMs;
  const context = { input, days, axisStart, now };
  const work = board.work.map((card) => workRow(card, context));
  const spillFrom = days.findIndex((day) => day.next);
  const rows =
    input.range === 'sprintAndNext' && spillFrom > 0
      ? work.map((row) => withSpill(row, board, spillFrom, days.length))
      : work;
  const position = axisPosition(now, days);
  return {
    ...base,
    days: days.map(({ date, label, last, next: isNext, today, weekStart }) => ({
      date,
      label,
      last,
      next: isNext,
      today,
      weekStart,
    })),
    now: now >= axisStart && position < days.length ? position : undefined,
    work: rows,
    planned: plannedRows(input, days, next),
    reviews: input.reviews.map((review) => reviewRow(review, { input, days, now })),
    develop: developOf(input, days, now),
    notes: board.notes,
  };
}
