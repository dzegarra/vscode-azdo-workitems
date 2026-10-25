/**
 * The Sprint timeline (redesign): the work of the sprint on a working-days axis, one row per work item drawn with the
 * station it is at day by day (expanded: its PRs with their own lifecycle), the reviews the user owes with their
 * deadline and the history of the base branch. It only draws what the store, My Pull Requests, the review requests, the
 * base branch runs and the history of the expanded PRs already carry: no timestamp is invented, what is not known is
 * drawn approximate. Pure, so no "vscode" import
 */
import { brokenSince, type BaseBranchRun } from './baseBranchHealth';
import { formatAge } from './myPullRequests';
import type { HistoryRef } from './prHistoryCache';
import type { ReviewRequestModel } from './reviewRequests';
import { axisPosition, buildAxis, iterationDay, nextIteration, type TimelineDay } from './timelineAxis';
import { rowsOfCards, type RowContext } from './timelineRows';
import { dayText, toSegment } from './timelineSpans';
import type { SegmentKind, TimelineInput, TimelineModel, TimelineRow, TimelineSegment } from './timelineTypes';
import type { BoardModel } from './trackBoardModel';
import { addWorkingMs } from './workingTime';

export { axisPosition, buildAxis, nextIteration, type TimelineDay } from './timelineAxis';
export * from './timelineTypes';
export { withAsleep, needsYouSince, readySince, type Span } from './timelineSpans';
export { rowsOfCards, workItemRow, type RowContext } from './timelineRows';

export const OPEN_SPRINT_TIMELINE_COMMAND = 'totalflowx.openSprintTimeline';

const MS_PER_HOUR = 3_600_000;

const firstName = (name: string): string => name.split(' ').at(0) ?? name;

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
    label: {
      pr: { text: `PR ${String(review.id)}` },
      meta: `${firstName(review.author)}${review.isRequired ? ' · required' : ''}`,
    },
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
export function withSpill(
  row: TimelineRow,
  board: Pick<BoardModel, 'work'>,
  sprintEnd: number,
  total: number
): TimelineRow {
  const card = board.work.find((candidate) => candidate.key === row.key);
  if (!card || ['done', 'ready', 'toStart'].includes(card.column) || row.outline) {
    return row;
  }
  return {
    ...row,
    segments: [
      ...row.segments,
      {
        kind: 'branch',
        start: sprintEnd,
        end: Math.min(total, sprintEnd + 1.5),
        text: 'spills over',
        tip: 'Not done by the end of the sprint: what is left continues in the next one',
        dashed: true,
      },
    ],
  };
}

/** The working days of the axis, and the next sprint when the range asks for it (Rules TIMELINE-2, TIMELINE-10) */
export function axisOf(input: TimelineInput): { days: TimelineDay[]; next: ReturnType<typeof nextIteration> } {
  const next = input.sprint
    ? nextIteration({ name: input.sprint.name, finishDate: input.sprint.finishDate }, input.schedule)
    : undefined;
  const start = input.sprint?.startDate?.slice(0, 10);
  const finish = input.sprint?.finishDate?.slice(0, 10);
  const days =
    start && finish
      ? buildAxis(start, finish, input.workingDays, input.now, input.range === 'sprintAndNext' ? next : undefined)
      : [];
  return { days, next };
}

// Rules TIMELINE-1, TIMELINE-10, TIMELINE-13, TIMELINE-16, TIMELINE-19
export function buildSprintTimeline(input: TimelineInput): TimelineModel {
  const now = input.now.getTime();
  const { board } = input;
  const { days, next } = axisOf(input);
  const base = {
    status: board.status,
    error: board.error,
    range: input.range,
    header: headerOf(input, board),
    look: board.look,
    scope: input.scope ?? 'mine',
    reviewsTitle: `REVIEWS YOU OWE · ${String(input.maxWaitHours)} WORKING HOURS FROM PUBLISH`,
  };
  if (!days.length) {
    return {
      ...base,
      days: [],
      work: [],
      finished: [],
      showCompleted: board.showCompleted,
      planned: { rows: [] },
      reviews: [],
      firstCommitsWanted: [],
      develop: { branch: input.base.branch, spans: [] },
      notes: ['The dates of the sprint are not known, so there is no axis to draw'],
    };
  }
  const axisStart = days[0].startMs;
  const context: RowContext = { input, days, axisStart, now, firstCommitsWanted: new Set() };
  // The faded cards of the merged PRs are the board's: the timeline draws the merged PRs it has dates for (TIMELINE-17)
  const cards = board.work.filter((card) => card.merged === undefined);
  const { work, finished } = rowsOfCards(cards, context);
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
    finished,
    showCompleted: board.showCompleted,
    planned: plannedRows(input, days, next),
    reviews: input.reviews.map((review) => reviewRow(review, { input, days, now })),
    firstCommitsWanted: [...context.firstCommitsWanted],
    develop: developOf(input, days, now),
    notes: board.notes,
  };
}

// Rule TIMELINE-29
/**
 * The PRs whose history the panel reads: those under the expanded rows (the user's and the other people's), once each.
 * A collapsed row asks for nothing
 */
export function historyRefsOf(model: TimelineModel, expanded: ReadonlySet<number>): HistoryRef[] {
  const rows = [
    ...model.work,
    ...model.finished,
    ...(model.team?.sections.flatMap((section) => [...section.rows, ...section.finished]) ?? []),
  ];
  const refs = rows
    .filter((row) => expanded.has(row.id))
    .flatMap((row) => row.children ?? [])
    .flatMap((child) => (child.kind === 'pr' && child.historyRef ? [child.historyRef] : []));
  return [...new Map(refs.map((ref) => [ref.id, ref])).values()];
}
