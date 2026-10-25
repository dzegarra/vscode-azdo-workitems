/**
 * Spans in time and how they are put on the axis of the Sprint timeline: the helpers every row builder shares. Pure,
 * so no "vscode" import
 */
import type { PullRequestStamps } from './pullRequestTimeline';
import type { RunModel } from './pipelines';
import { axisPosition, type TimelineDay } from './timelineAxis';
import type { BoardColumnId } from './trackBoardModel';
import type { SegmentKind, TimelineSegment } from './timelineTypes';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

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
  /** Replaces the usual remark of an approximate start ("it begins with the sprint") */
  approximateNote?: string;
}

/** "We 14": the weekday and the day of the month, as the axis */
export const dayLabel = (ms: number): string => {
  const date = new Date(ms);
  return `${WEEKDAYS[date.getDay()]} ${String(date.getDate())}`;
};

export const instant = (value: string | undefined): number | undefined => {
  const ms = Date.parse(value ?? '');
  return Number.isNaN(ms) ? undefined : ms;
};

export const dayText = (ms: number): string =>
  new Date(ms).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

export const dateText = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

export function toSegment(span: Span, days: readonly TimelineDay[]): TimelineSegment | undefined {
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
    approximate ? span.approximateNote ?? 'The start is not known exactly' : '',
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

// Rule TIMELINE-16
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

// Rule TIMELINE-16
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
