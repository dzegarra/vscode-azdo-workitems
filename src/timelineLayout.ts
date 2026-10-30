/**
 * Layout of what is drawn on a lane of the Sprint timeline, in days of the axis (Rule TIMELINE-30): bars that are one
 * station are one bar, blips too short to see are absorbed by their neighbour, and marks never overlap (one line). Pure, so no
 * "vscode" import
 */
import type { TimelineMarker, TimelineSegment } from './timelineTypes';

/** A bar narrower than this (days of the axis, about four hours) is a blip: it is absorbed by the previous one */
export const MIN_SEGMENT_DAYS = 0.15;
/** Marks of the same kind within this distance are one mark with a count */
export const MARK_MERGE_DAYS = 0.03;
/**
 * Rule TIMELINE-42: commits, pushes and comments within this distance (days of the axis: ten minutes) are one bigger
 * mark: a rebase followed by a forced push makes many commits and pushes at the same moment
 */
export const BURST_DAYS = 10 / (24 * 60);

const sameBar = (a: TimelineSegment, b: TimelineSegment): boolean =>
  a.kind === b.kind && a.end >= b.start && a.dashed === b.dashed && a.asleep === b.asleep;

// Rule TIMELINE-30
/**
 * One bar per station: adjacent bars of the same kind join (the later text wins: it is the one of now); a bar narrower
 * than `minDays` joins the previous one (which keeps its text), except the last (it is the station now) and the first when it has no previous.
 * The exact times of what was absorbed stay in the tooltip
 */
export function mergeSegments(segments: readonly TimelineSegment[], minDays = MIN_SEGMENT_DAYS): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  const join = (into: TimelineSegment, next: TimelineSegment, note: boolean): void => {
    into.end = Math.max(into.end, next.end);
    // A blip absorbed keeps the text of the bar that absorbs it (it is too short to name the bar)
    into.text = note ? into.text ?? next.text : next.text ?? into.text;
    into.approximate = into.approximate === true;
    into.tip = note ? `${into.tip}\n+ ${next.tip}` : into.tip;
  };
  segments.forEach((segment, index) => {
    const last = out.at(-1);
    const isLast = index === segments.length - 1;
    if (last && sameBar(last, segment)) {
      join(last, segment, false);
    } else if (last && !isLast && segment.end - segment.start < minDays && !segment.asleep) {
      join(last, segment, true);
    } else {
      out.push({ ...segment });
    }
  });
  // A blip absorbed between two bars of the same kind makes them neighbours again
  return out.reduce<TimelineSegment[]>((all, segment) => {
    const last = all.at(-1);
    if (last && sameBar(last, segment)) {
      join(last, segment, false);
    } else {
      all.push(segment);
    }
    return all;
  }, []);
}

// Rule TIMELINE-33
/**
 * The marks shown at rest are the problems only: the ✕ of the latest CI run when it failed (a run still going is the
 * latest: then nothing), and ⚠ conflicts now. Every other mark waits for the hover of the row
 */
export function withAtRest(markers: readonly TimelineMarker[]): TimelineMarker[] {
  const latestCi = [...markers]
    .filter((marker) => marker.kind === 'ci')
    .sort((a, b) => a.at - b.at)
    .at(-1);
  return markers.map((marker) =>
    marker.kind === 'conflicts' || (marker === latestCi && marker.tone === 'fail')
      ? { ...marker, atRest: true }
      : marker
  );
}

/** Each reviewer added is its own mark (Rule TIMELINE-39) */
const NEVER_MERGED = new Set<TimelineMarker['kind']>(['reviewers']);
/** Rule TIMELINE-42: marks drawn as a line or a dot, grouped only within a burst; the group is drawn bigger, no text */
const BURSTS = new Set<TimelineMarker['kind']>(['comments', 'commit', 'push']);

// Rule TIMELINE-30
/**
 * Marks of the same kind at the same moment are one ("2✓"), except the ones that are each their own mark. They all sit
 * on one line above the bar: the webview spreads the ones that would touch sideways (`packMarks`), never on new rows
 */
export function layoutMarkers(markers: readonly TimelineMarker[]): TimelineMarker[] {
  const merged: TimelineMarker[] = [];
  for (const marker of [...markers].sort((a, b) => a.at - b.at)) {
    const same = merged.find(
      (candidate) =>
        candidate.kind === marker.kind &&
        candidate.tone === marker.tone &&
        marker.at - candidate.at <= (BURSTS.has(marker.kind) ? BURST_DAYS : MARK_MERGE_DAYS) &&
        !NEVER_MERGED.has(marker.kind)
    );
    if (same) {
      const count = (same.count ?? 1) + 1;
      same.count = count;
      same.text = BURSTS.has(marker.kind) ? same.text : `${String(count)}${marker.text}`;
      same.tip = { title: same.tip.title, lines: [...same.tip.lines, ...marker.tip.lines] };
      if (marker.atRest) {
        same.atRest = true;
      }
    } else {
      merged.push({ ...marker, count: undefined });
    }
  }
  return merged;
}

// Rule TIMELINE-30
/**
 * Where the marks of a line go (pixels): each at its moment unless it would touch the previous one, then just after it
 * (`gap` apart); a line that would run past `width` is packed back from the right edge. Marks sorted by moment
 */
export function packMarks(marks: readonly { left: number; width: number }[], gap: number, width: number): number[] {
  const lefts: number[] = [];
  marks.forEach((mark, index) => {
    const previous = index > 0 ? lefts[index - 1] + marks[index - 1].width + gap : Number.NEGATIVE_INFINITY;
    lefts.push(Math.max(mark.left, previous));
  });
  for (let index = marks.length - 1; index >= 0; index -= 1) {
    const limit = index === marks.length - 1 ? width : lefts[index + 1] - gap;
    lefts[index] = Math.min(lefts[index], limit - marks[index].width);
  }
  return lefts;
}
