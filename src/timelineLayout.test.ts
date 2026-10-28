import { describe, expect, it } from 'vitest';
import { layoutMarkers, markerRows, mergeSegments, withAtRest } from './timelineLayout';
import type { TimelineMarker, TimelineSegment } from './timelineTypes';

const seg = (
  kind: TimelineSegment['kind'],
  start: number,
  end: number,
  extra: Partial<TimelineSegment> = {}
): TimelineSegment => ({
  kind,
  start,
  end,
  text: kind,
  tip: `${kind} ${String(start)}`,
  ...extra,
});

const mark = (kind: TimelineMarker['kind'], at: number, text = 'x', tone?: TimelineMarker['tone']): TimelineMarker => ({
  kind,
  at,
  text,
  tone,
  tip: { title: kind.toUpperCase(), lines: [`${kind} ${String(at)}`] },
});

describe('bars of a lane (TIMELINE-30)', () => {
  it('joins adjacent bars of the same station into one, the text of the later one', () => {
    const merged = mergeSegments([
      seg('needsYou', 1, 2, { text: 'needs you' }),
      seg('needsYou', 2, 4, { text: 'needs you · CI failed' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ start: 1, end: 4, text: 'needs you · CI failed' });
  });

  it('absorbs a blip into the previous bar and keeps its exact times in the tooltip', () => {
    const merged = mergeSegments([seg('review', 1, 3), seg('pullRequest', 3, 3.04), seg('review', 3.04, 5)]);
    expect(merged.map((bar) => [bar.kind, bar.start, bar.end])).toEqual([['review', 1, 5]]);
    expect(merged[0].tip).toContain('pullRequest 3');
  });

  it('never absorbs the last bar (the station now) nor the first one', () => {
    expect(mergeSegments([seg('review', 1, 3), seg('needsYou', 3, 3.02)]).map((bar) => bar.kind)).toEqual([
      'review',
      'needsYou',
    ]);
    expect(mergeSegments([seg('branch', 0, 0.02), seg('review', 0.02, 3)]).map((bar) => bar.kind)).toEqual([
      'branch',
      'review',
    ]);
  });

  it('keeps the zZ span and bars that are wide enough, and does not join a dashed bar to a solid one', () => {
    expect(
      mergeSegments([seg('review', 0, 2), seg('asleep', 2, 2.01), seg('asleep', 2.01, 4)]).map((bar) => bar.kind)
    ).toEqual(['review', 'asleep']);
    expect(mergeSegments([seg('branch', 0, 1), seg('branch', 1, 2, { dashed: true })])).toHaveLength(2);
  });
});

describe('marks of a lane (TIMELINE-30)', () => {
  it('puts marks that would touch on the next row, and the ones far apart on the first', () => {
    const laid = layoutMarkers([mark('approve', 2, 'AR'), mark('wait', 2.1, 'JB'), mark('push', 4)]);
    expect(laid.map((entry) => entry.row)).toEqual([0, 1, 0]);
    expect(markerRows(laid)).toBe(2);
  });

  it('never overlaps two marks of a row', () => {
    const laid = layoutMarkers(Array.from({ length: 3 }, (_, index) => mark('approve', 2 + index * 0.05, 'AR')));
    for (const row of [0, 1, 2]) {
      const at = laid.filter((entry) => entry.row === row).map((entry) => entry.at);
      at.slice(1).forEach((value, index) => expect(value - at[index]).toBeGreaterThanOrEqual(0.17 - 1e-9));
    }
  });

  it('merges marks of the same kind at the same moment into a count, with all their tooltips', () => {
    const [one] = layoutMarkers([mark('ci', 3, '✓', 'pass'), mark('ci', 3.01, '✓', 'pass')]);
    expect(one.text).toBe('2✓');
    expect(one.tip.lines).toHaveLength(2);
    expect(layoutMarkers([mark('ci', 3, '✓', 'pass'), mark('ci', 3.01, '✕', 'fail')])).toHaveLength(2);
    expect(layoutMarkers([mark('push', 3), mark('push', 3.01)])).toHaveLength(2);
  });

  it('has one row without marks', () => {
    expect(markerRows([])).toBe(1);
  });
});

describe('withAtRest (Rule TIMELINE-33)', () => {
  const event = (kind: TimelineMarker['kind'], at: number, tone?: TimelineMarker['tone']): TimelineMarker => ({
    kind,
    at,
    text: '',
    tone,
    tip: { title: kind, lines: [] },
  });

  it('keeps at rest only the failed latest CI run and the conflicts', () => {
    const marks = withAtRest([
      event('ci', 1, 'fail'),
      event('push', 2),
      event('ci', 3, 'fail'),
      event('approve', 4),
      event('conflicts', 5),
    ]);
    expect(marks.map((marker) => marker.atRest === true)).toEqual([false, false, true, false, true]);
  });

  it('shows no CI mark at rest when the latest run passed or is still running', () => {
    expect(withAtRest([event('ci', 1, 'fail'), event('ci', 2, 'pass')]).some((marker) => marker.atRest)).toBe(false);
    expect(withAtRest([event('ci', 1, 'fail'), event('ci', 2, 'running')]).some((marker) => marker.atRest)).toBe(false);
  });

  it('keeps the mark at rest when marks of the same moment are merged', () => {
    const [merged] = layoutMarkers([event('ci', 1, 'fail'), { ...event('ci', 1.01, 'fail'), atRest: true }]);
    expect(merged).toMatchObject({ count: 2, atRest: true });
  });
});
