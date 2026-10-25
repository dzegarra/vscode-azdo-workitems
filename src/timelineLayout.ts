/**
 * Layout of what is drawn on a lane of the Sprint timeline, in days of the axis (Rule TIMELINE-30): bars that are one
 * station are one bar, blips too short to see are absorbed by their neighbour, and marks never overlap. Pure, so no
 * "vscode" import
 */
import type { TimelineMarker, TimelineSegment } from './timelineTypes';

/** A bar narrower than this (days of the axis, about four hours) is a blip: it is absorbed by the previous one */
export const MIN_SEGMENT_DAYS = 0.15;
/** Two marks closer than this (days) would touch: the second goes to the next row of the strip */
export const MARK_GAP_DAYS = 0.17;
/** Marks of the same kind within this distance are one mark with a count */
export const MARK_MERGE_DAYS = 0.03;
/** Rows of the strip at most: a mark that finds no room goes on the last one */
export const MAX_MARK_ROWS = 3;

const sameBar = (a: TimelineSegment, b: TimelineSegment): boolean =>
  a.kind === b.kind && a.end >= b.start && a.dashed === b.dashed;

// Rule TIMELINE-30
/**
 * One bar per station: adjacent bars of the same kind join (the later text wins: it is the one of now); a bar narrower
 * than `minDays` joins the previous one, except the last (it is the station now) and the first when it has no previous.
 * The exact times of what was absorbed stay in the tooltip
 */
export function mergeSegments(segments: readonly TimelineSegment[], minDays = MIN_SEGMENT_DAYS): TimelineSegment[] {
  const out: TimelineSegment[] = [];
  const join = (into: TimelineSegment, next: TimelineSegment, note: boolean): void => {
    into.end = Math.max(into.end, next.end);
    into.text = next.text ?? into.text;
    into.approximate = into.approximate === true;
    into.tip = note ? `${into.tip}\n+ ${next.tip}` : into.tip;
  };
  segments.forEach((segment, index) => {
    const last = out.at(-1);
    const isLast = index === segments.length - 1;
    if (last && sameBar(last, segment)) {
      join(last, segment, false);
    } else if (last && !isLast && segment.end - segment.start < minDays && segment.kind !== 'asleep') {
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

// Rule TIMELINE-30
/**
 * Marks that never overlap: those of the same kind at the same moment are one ("2✓"); each mark goes to the first row of
 * the strip where the previous mark is far enough (`row` 0, 1, 2); on a full strip it stays on the last row
 */
export function layoutMarkers(markers: readonly TimelineMarker[]): TimelineMarker[] {
  const merged: TimelineMarker[] = [];
  for (const marker of [...markers].sort((a, b) => a.at - b.at)) {
    const same = merged.find(
      (candidate) =>
        candidate.kind === marker.kind &&
        candidate.tone === marker.tone &&
        marker.at - candidate.at <= MARK_MERGE_DAYS &&
        marker.kind !== 'push'
    );
    if (same) {
      const count = (same.count ?? 1) + 1;
      same.count = count;
      same.text = `${String(count)}${marker.text}`;
      same.tip = { title: same.tip.title, lines: [...same.tip.lines, ...marker.tip.lines] };
    } else {
      merged.push({ ...marker, count: undefined });
    }
  }
  const lastAt: number[] = [];
  return merged.map((marker) => {
    let row = lastAt.findIndex((at) => marker.at - at >= MARK_GAP_DAYS);
    if (row === -1) {
      row = Math.min(lastAt.length, MAX_MARK_ROWS - 1);
    }
    lastAt[row] = marker.at;
    return { ...marker, row };
  });
}

/** How many rows of marks a lane has: the row of the PR grows with them */
export const markerRows = (markers: readonly Pick<TimelineMarker, 'row'>[]): number =>
  Math.max(1, ...markers.map((marker) => (marker.row ?? 0) + 1));
