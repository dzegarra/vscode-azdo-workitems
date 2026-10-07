import { describe, expect, it } from 'vitest';
import {
  migratePredecessorStates,
  DEFAULT_COMPLETED_STATES,
  isCompletedState,
  isReadyToStart,
  NONE_OPEN,
  openPredecessors,
  OPEN_PREDECESSORS,
  predecessorFilterValue,
  startCheckMessage,
} from './predecessors';
import type { ScheduledIteration } from './schedule';

const schedule: ScheduledIteration[] = [
  { path: 'P\\Sprint 1', name: 'Sprint 1', start: '2026-01-01', finish: '2026-01-14' },
  { path: 'P\\Sprint 2', name: 'Sprint 2', start: '2026-01-15', finish: '2026-01-28' },
  { path: 'P\\Sprint 3', name: 'Sprint 3', start: '2026-01-29', finish: '2026-02-11' },
  { path: 'P', name: 'P' },
];

const predecessor = (id: number, state: string, iterationPath: string, assignedTo?: string) => ({
  id,
  title: `Item ${id}`,
  type: 'Bug',
  state,
  iterationPath,
  assignedTo,
});

describe('isCompletedState', () => {
  it('uses Done, Ready to Test, Closed and Removed by default', () => {
    expect(DEFAULT_COMPLETED_STATES.every((state) => isCompletedState(state))).toBe(true);
    expect(isCompletedState('In Progress')).toBe(false);
    expect(isCompletedState('New')).toBe(false);
  });

  it('ignores case, dashes and doubled letters', () => {
    expect(isCompletedState('Ready-to-Test')).toBe(true);
    expect(isCompletedState('done')).toBe(true);
  });

  it('follows a custom setting', () => {
    expect(isCompletedState('Resolved', ['Resolved'])).toBe(true);
    expect(isCompletedState('Done', ['Resolved'])).toBe(false);
    expect(isCompletedState('Done', [])).toBe(false);
  });
});

describe('openPredecessors', () => {
  const item = { iterationPath: 'P\\Sprint 2' };

  it('drops the completed predecessors', () => {
    const result = openPredecessors(
      item,
      [
        predecessor(1, 'Done', 'P\\Sprint 1'),
        predecessor(2, 'Ready-to-Test', 'P\\Sprint 1'),
        predecessor(3, 'New', 'P\\Sprint 1'),
      ],
      DEFAULT_COMPLETED_STATES,
      schedule
    );
    expect(result.map((p) => p.id)).toEqual([3]);
  });

  it('honours the completed states setting', () => {
    const predecessors = [predecessor(1, 'Done', 'P\\Sprint 1'), predecessor(2, 'Resolved', 'P\\Sprint 1')];
    expect(openPredecessors(item, predecessors, ['Resolved'], schedule).map((p) => p.id)).toEqual([1]);
  });

  it('sorts by risk: later iteration first, then not scheduled, same iteration, earlier', () => {
    const result = openPredecessors(
      item,
      [
        predecessor(1, 'New', 'P\\Sprint 1'),
        predecessor(2, 'New', 'P\\Sprint 2'),
        predecessor(3, 'New', 'P'),
        predecessor(4, 'New', 'P\\Sprint 3'),
      ],
      DEFAULT_COMPLETED_STATES,
      schedule
    );
    expect(result.map((p) => [p.id, p.risk])).toEqual([
      [4, 'late'],
      [3, 'unscheduled'],
      [2, 'tight'],
      [1, 'ok'],
    ]);
  });

  it('keeps the risk of an open predecessor even when its state looks done', () => {
    const [result] = openPredecessors(item, [predecessor(1, 'Resolved', 'P\\Sprint 3')], [], schedule);
    expect(result.risk).toBe('late');
  });

  it('gives the assignee and the iteration name', () => {
    const [result] = openPredecessors(item, [predecessor(1, 'In Progress', 'P\\Sprint 3', 'Ana')], [], schedule);
    expect(result).toMatchObject({ assignedTo: 'Ana', iterationName: 'Sprint 3', state: 'In Progress' });
  });

  it('has no risk without the schedule and then sorts by ID', () => {
    const result = openPredecessors(
      item,
      [predecessor(9, 'New', 'P\\Sprint 3'), predecessor(4, 'New', 'P\\Sprint 1')],
      DEFAULT_COMPLETED_STATES,
      undefined
    );
    expect(result.map((p) => [p.id, p.risk, p.iterationName])).toEqual([
      [4, undefined, 'Sprint 1'],
      [9, undefined, 'Sprint 3'],
    ]);
  });
});

describe('predecessorFilterValue', () => {
  it('tells open from none open, and unknown from both', () => {
    expect(predecessorFilterValue({ openPredecessors: [{}] })).toBe(OPEN_PREDECESSORS);
    expect(predecessorFilterValue({ openPredecessors: [] })).toBe(NONE_OPEN);
    expect(predecessorFilterValue({})).toBeUndefined();
  });
});

describe('isReadyToStart', () => {
  it('is for not started work items without open predecessors', () => {
    for (const state of ['New', 'Approved', 'To Do']) {
      expect(isReadyToStart({ state, openPredecessors: [] })).toBe(true);
    }
  });

  it('is not for work items with open predecessors', () => {
    expect(isReadyToStart({ state: 'New', openPredecessors: [{}] })).toBe(false);
  });

  it('is never for started or finished work items', () => {
    for (const state of ['Committed', 'In Progress', 'Done', 'Ready to Test']) {
      expect(isReadyToStart({ state, openPredecessors: [] })).toBe(false);
    }
  });

  it('gives no hint when the predecessors are unknown', () => {
    expect(isReadyToStart({ state: 'New' })).toBe(false);
  });
});

describe('startCheckMessage', () => {
  it('lists the predecessors with their state and owner', () => {
    expect(
      startCheckMessage({ id: 66280, type: 'Bug' }, [
        { id: 66101, state: 'In Progress', assignedTo: 'Ana Kowalska' },
        { id: 66120, state: 'New' },
      ])
    ).toBe(
      'Bug 66280 has 2 predecessors not completed: 66101 (In Progress, Ana Kowalska), 66120 (New, unassigned). Agree with their owners before starting.'
    );
  });

  it('uses the singular for one predecessor', () => {
    expect(startCheckMessage({ id: 1, type: 'Product Backlog Item' }, [{ id: 2, state: 'New' }])).toContain(
      'has 1 predecessor not completed: 2 (New, unassigned).'
    );
  });

  it('shortens long lists', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: i + 10, state: 'New' }));
    const message = startCheckMessage({ id: 1, type: 'Bug' }, many);
    expect(message).toContain('has 8 predecessors');
    expect(message).toContain('14 (New, unassigned) and 3 more.');
    expect(message).not.toContain('15 (');
  });
});

describe('migratePredecessorStates', () => {
  it('maps the old chip names to the new ones', () => {
    expect(migratePredecessorStates(['Open predecessors', 'None open'])).toEqual([
      'Incomplete predecessors',
      'Complete predecessors',
    ]);
    expect(migratePredecessorStates(['Open predecessors', 'Incomplete predecessors'])).toEqual([
      'Incomplete predecessors',
    ]);
    expect(migratePredecessorStates([])).toEqual([]);
  });
});
