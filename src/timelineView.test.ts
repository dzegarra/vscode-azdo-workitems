import { describe, expect, it } from 'vitest';
import {
  arrangeRows,
  DEFAULT_VIEW_OPTIONS,
  inItemOrder,
  isTimelineViewSwitch,
  normalizeViewOptions,
} from './timelineView';

const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
const kind = { finished: (row: { id: number }) => row.id === 2, movedOut: (row: { id: number }) => row.id === 3 };

describe('arrangeRows (Rule TIMELINE-45)', () => {
  it('groups the finished and the moved-out work items at the end', () => {
    const arranged = arrangeRows(rows, kind, DEFAULT_VIEW_OPTIONS);
    expect(arranged.work.map((row) => row.id)).toEqual([1, 4]);
    expect(arranged.finished.map((row) => row.id)).toEqual([2]);
    expect(arranged.movedOut.map((row) => row.id)).toEqual([3]);
  });

  it('keeps each in its place among the others when its group is off', () => {
    expect(arrangeRows(rows, kind, { groupDone: false, groupMovedOut: true }).work.map((row) => row.id)).toEqual([
      1, 2, 4,
    ]);
    const neither = arrangeRows(rows, kind, { groupDone: false, groupMovedOut: false });
    expect(neither.work.map((row) => row.id)).toEqual([1, 2, 3, 4]);
    expect(neither.finished).toEqual([]);
    expect(neither.movedOut).toEqual([]);
  });

  it('never puts a moved-out work item in DONE THIS SPRINT', () => {
    const both = { finished: () => true, movedOut: (row: { id: number }) => row.id === 3 };
    const arranged = arrangeRows(rows, both, { groupDone: true, groupMovedOut: false });
    expect(arranged.finished.map((row) => row.id)).toEqual([1, 2, 4]);
    expect(arranged.work.map((row) => row.id)).toEqual([3]);
  });
});

describe('the view options (Rules TIMELINE-45, TIMELINE-46)', () => {
  it('default to everything shown, grouped and dimmed; only booleans are read', () => {
    expect(normalizeViewOptions({})).toEqual(DEFAULT_VIEW_OPTIONS);
    expect(normalizeViewOptions({ dimCompleted: false, showDevelop: 'no' })).toEqual({
      ...DEFAULT_VIEW_OPTIONS,
      dimCompleted: false,
    });
  });

  it('accepts only the switches of the panel from the webview', () => {
    expect(isTimelineViewSwitch('groupDone')).toBe(true);
    expect(isTimelineViewSwitch('dimCompleted')).toBe(false);
    expect(isTimelineViewSwitch(undefined)).toBe(false);
  });
});

describe('inItemOrder (Rule TIMELINE-45)', () => {
  it('orders the rows as the work items of the sprint, an unknown one last, the rest stable', () => {
    const board = [{ id: 2 }, { id: 9 }, { id: 3 }, { id: 1 }];
    expect(inItemOrder(board, [1, 2, 3]).map((row) => row.id)).toEqual([1, 2, 3, 9]);
  });
});
