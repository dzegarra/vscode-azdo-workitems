import { describe, expect, it } from 'vitest';
import { layoutMarkers, mergeSegments, packMarks, withAtRest } from './timelineLayout';
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
  it('spreads marks that would touch sideways on one line, never on new rows', () => {
    expect(
      packMarks(
        [
          { left: 10, width: 16 },
          { left: 14, width: 16 },
          { left: 100, width: 2 },
        ],
        2,
        500
      )
    ).toEqual([10, 28, 100]);
  });

  it('packs a crowded line back from the right edge', () => {
    expect(
      packMarks(
        [
          { left: 80, width: 16 },
          { left: 90, width: 16 },
        ],
        2,
        110
      )
    ).toEqual([76, 94]);
  });

  it('merges marks of the same kind at the same moment into a count, with all their tooltips', () => {
    const [one] = layoutMarkers([mark('ci', 3, '✓', 'pass'), mark('ci', 3.01, '✓', 'pass')]);
    expect(one.text).toBe('2✓');
    expect(one.tip.lines).toHaveLength(2);
    expect(layoutMarkers([mark('ci', 3, '✓', 'pass'), mark('ci', 3.01, '✕', 'fail')])).toHaveLength(2);
    expect(layoutMarkers([mark('push', 3), mark('push', 3.5)])).toHaveLength(2);
  });

  it('groups commits, pushes and comments of a burst into one bigger mark, without text (TIMELINE-42)', () => {
    const minutes = (n: number) => 3 + n / (24 * 60);
    const laid = layoutMarkers([
      mark('commit', minutes(0), ''),
      mark('commit', minutes(4), ''),
      mark('commit', minutes(9), ''),
      mark('commit', minutes(30), ''),
      mark('comments', minutes(1), ''),
      mark('comments', minutes(2), ''),
    ]);
    expect(laid.map((entry) => [entry.kind, entry.count, entry.text])).toEqual([
      ['commit', 3, ''],
      ['comments', 2, ''],
      ['commit', undefined, ''],
    ]);
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
