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
import { iterationDates } from './sprintTitle';
import { AFTER_SPRINT_DAYS, axisPosition, buildAxis, type TimelineDay } from './timelineAxis';
import { reviewedRows, reviewedThreadsWanted } from './reviewedTimeline';
import { rowsOfCards, type RowContext } from './timelineRows';
import { dayText, toSegment } from './timelineSpans';
import type { SegmentKind, TimelineInput, TimelineModel, TimelineRow, TimelineSegment } from './timelineTypes';
import type { BoardModel } from './trackBoardModel';
import { addWorkingMs } from './workingTime';

export { AFTER_SPRINT_DAYS, axisPosition, buildAxis, type TimelineDay } from './timelineAxis';
export * from './timelineTypes';
export type { TimelineDensity } from './timelineDensity';
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

// Rule TIMELINE-38
/**
 * A tick per PR merged into the base branch (the merge message of the run it triggered: only merges that ran a
 * pipeline, within the latest runs read; several pipelines of one merge are one tick, at the first run to finish), and
 * above each red span the PR merged before it ("PR 13874 → red")
 */
export function developMerges(
  runs: readonly BaseBranchRun[],
  days: readonly TimelineDay[]
): { merges: TimelineModel['develop']['merges']; culprits: TimelineModel['develop']['culprits'] } {
  const first = new Map<number, number>();
  runs.forEach((run) => {
    const at = Date.parse(run.finishTime);
    if (run.pullRequestId !== undefined && !Number.isNaN(at)) {
      first.set(run.pullRequestId, Math.min(first.get(run.pullRequestId) ?? at, at));
    }
  });
  const inAxis = (ms: number): boolean => days.length > 0 && ms >= days[0].startMs && ms < days[days.length - 1].endMs;
  const merges = [...first]
    .filter(([, at]) => inAxis(at))
    .sort((a, b) => a[1] - b[1])
    .map(([pr, at]) => ({
      at: axisPosition(at, days),
      pr,
      tip: `PR ${String(pr)} merged · its run finished ${dayText(at)}`,
    }));
  const culprits = developSpans(runs, Number.POSITIVE_INFINITY)
    .filter((span) => span.red && inAxis(span.start))
    .flatMap((span) => {
      const before = [...first]
        .filter(([, at]) => at <= span.start)
        .sort((a, b) => b[1] - a[1])
        .at(0);
      return before ? [{ at: axisPosition(span.start, days), text: `PR ${String(before[0])} → red` }] : [];
    });
  return { merges, culprits };
}

function developOf(input: TimelineInput, days: TimelineDay[], now: number): TimelineModel['develop'] {
  const { base } = input;
  if (!base.enabled) {
    return {
      branch: base.branch,
      spans: [],
      merges: [],
      culprits: [],
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
    return { branch: base.branch, spans, merges: [], culprits: [], note: 'No finished run of the base branch yet' };
  }
  const { merges, culprits } = developMerges(base.runs, days);
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
  return { branch: base.branch, spans, merges, culprits, label };
}

/* ---------- The whole timeline ---------- */

function headerOf(input: TimelineInput, board: BoardModel): TimelineModel['header'] {
  return {
    // Rule SPRINT-TITLE-1: the title and the chip of the board (the same sprint: the one that ends first)
    sprint: board.header.sprint,
    teams: board.header.teams,
    dates: input.sprint ? iterationDates(input.sprint) : undefined,
    left: board.header.left,
    hurry: board.header.hurry,
  };
}

/** The working days of the axis: the sprint, then the margin after it (Rules TIMELINE-2, TIMELINE-31) */
export function axisOf(input: TimelineInput): { days: TimelineDay[]; sprintEnd: number } {
  const start = input.sprint?.startDate?.slice(0, 10);
  const finish = input.sprint?.finishDate?.slice(0, 10);
  const days = start && finish ? buildAxis(start, finish, input.workingDays, input.now, AFTER_SPRINT_DAYS) : [];
  const last = days.findIndex((day) => day.after);
  return { days, sprintEnd: last < 0 ? days.length : last };
}

// Rule TIMELINE-31
/** Splits the bars at the end of the sprint: what is past it is the `after` part (faded, under the hatch) */
function splitAtEnd(segments: readonly TimelineSegment[], sprintEnd: number): TimelineSegment[] {
  return segments.flatMap((segment) => {
    if (segment.end <= sprintEnd) {
      return [segment];
    }
    if (segment.start >= sprintEnd) {
      return [{ ...segment, text: undefined, after: true }];
    }
    return [
      { ...segment, end: sprintEnd },
      { ...segment, start: sprintEnd, text: undefined, after: true },
    ];
  });
}

// Rule TIMELINE-31
/**
 * Once the sprint is over, what is still open keeps running up to NOW, but past the end of the sprint its bar is the
 * faded `after` part; the text and the buttons after a bar stay at the end of the sprint
 */
export function withAfterSprint(row: TimelineRow, sprintEnd: number): TimelineRow {
  const children = row.children?.map((child) => {
    switch (child.kind) {
      case 'pr':
      case 'task':
        return { ...child, segments: splitAtEnd(child.segments, sprintEnd), end: Math.min(child.end, sprintEnd) };
      case 'tasks':
      case 'placeholder':
        return child;
    }
  });
  return {
    ...row,
    segments: splitAtEnd(row.segments, sprintEnd),
    end: Math.min(row.end, sprintEnd),
    children,
  };
}

// Rules TIMELINE-1, TIMELINE-13, TIMELINE-16, TIMELINE-19, TIMELINE-31, TIMELINE-32
export function buildSprintTimeline(input: TimelineInput): TimelineModel {
  const now = input.now.getTime();
  const { board } = input;
  const { days, sprintEnd } = axisOf(input);
  const base = {
    status: board.status,
    error: board.error,
    density: input.density ?? 'normal',
    header: headerOf(input, board),
    look: board.look,
    scope: input.scope ?? 'mine',
    reviewsTitle: `REVIEWS YOU OWE · ${String(input.maxWaitHours)} WORKING HOURS FROM PUBLISH`,
  };
  if (!days.length) {
    return {
      ...base,
      days: [],
      sprintEnd: 0,
      over: false,
      work: [],
      finished: [],
      reviews: [],
      reviewed: [],
      reviewedWanted: [],
      firstCommitsWanted: [],
      statesWanted: [],
      commitsWanted: [],
      develop: { branch: input.base.branch, spans: [], merges: [], culprits: [] },
      notes: ['The dates of the sprint are not known, so there is no axis to draw'],
    };
  }
  const axisStart = days[0].startMs;
  const context: RowContext = {
    input,
    days,
    axisStart,
    now,
    firstCommitsWanted: new Set(),
    statesWanted: new Map(),
    commitsWanted: new Map(),
  };
  // The faded cards of the merged PRs are the board's: the timeline draws the merged PRs it has dates for (TIMELINE-17)
  const cards = board.work.filter((card) => card.merged === undefined);
  const { work, finished } = rowsOfCards(cards, context);
  const position = axisPosition(now, days);
  const shown = now >= axisStart && position < days.length ? position : undefined;
  const after = (row: TimelineRow): TimelineRow => withAfterSprint(row, sprintEnd);
  return {
    ...base,
    days: days.map(({ after: isAfter, date, label, last, today, weekStart }) => ({
      after: isAfter,
      date,
      label,
      last,
      today,
      weekStart,
    })),
    sprintEnd,
    now: shown,
    over: shown !== undefined && shown > sprintEnd,
    work: work.map(after),
    finished: finished.map(after),
    reviews: input.reviews.map((review) => after(reviewRow(review, { input, days, now }))),
    // Rule TIMELINE-37
    reviewed: input.reviewed ? reviewedRows({ ...input.reviewed, days, now }).map(after) : [],
    reviewedWanted: input.reviewed ? reviewedThreadsWanted(input.reviewed.pullRequests, axisStart) : [],
    firstCommitsWanted: [...context.firstCommitsWanted],
    statesWanted: [...(context.statesWanted ?? [])].map(([id, key]) => ({ id, key })),
    commitsWanted: [...(context.commitsWanted ?? [])].map(([id, wanted]) => ({ id, ...wanted })),
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
