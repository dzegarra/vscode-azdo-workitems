import { describe, expect, it } from 'vitest';
import { canHaveTasks, sanitizeHtml, stateButton } from './html';
import {
  DEFAULT_STATE_ORDER,
  normalizeState,
  sortByState,
  stateAfterBranchCreated,
  stateCategory,
  stateRank,
} from './states';

describe('states', () => {
  it('matches state names ignoring case, separators and typos with doubled letters', () => {
    expect(normalizeState('Ready-to-Test')).toBe(normalizeState('Ready to Test'));
    expect(normalizeState('Commited')).toBe(normalizeState('Committed'));
    expect(normalizeState('To Do')).not.toBe(normalizeState('Done'));
  });

  it('sorts by the configured order, keeping the order within the same state', () => {
    const items = [
      { id: 1, state: 'New' },
      { id: 2, state: 'Done' },
      { id: 3, state: 'Unknown' },
      { id: 4, state: 'In Progress' },
      { id: 5, state: 'Ready to Test' },
      { id: 6, state: 'Committed' },
      { id: 7, state: 'New' },
      { id: 8, state: 'To Do' },
      { id: 9, state: 'Approved' },
    ];
    expect(sortByState(items, DEFAULT_STATE_ORDER).map((item) => item.id)).toEqual([2, 5, 6, 4, 9, 1, 7, 8, 3]);
    expect(stateRank('Unknown', DEFAULT_STATE_ORDER)).toBe(DEFAULT_STATE_ORDER.length);
  });

  it.each([
    ['Done', 'done'],
    ['Ready to Test', 'done'],
    ['Committed', 'in-progress'],
    ['In Progress', 'in-progress'],
    ['New', 'proposed'],
    ['Removed', 'removed'],
  ])('%s is %s', (state, category) => {
    expect(stateCategory(state)).toBe(category);
  });

  it('moves to Committed only the items not started yet', () => {
    const mapping = { 'Product Backlog Item': 'Committed', Bug: 'Committed' };
    expect(stateAfterBranchCreated('Product Backlog Item', 'New', mapping)).toBe('Committed');
    expect(stateAfterBranchCreated('Bug', 'Approved', mapping)).toBe('Committed');
    expect(stateAfterBranchCreated('Bug', 'Committed', mapping)).toBeUndefined();
    expect(stateAfterBranchCreated('Bug', 'In Progress', mapping)).toBeUndefined();
    expect(stateAfterBranchCreated('Bug', 'Done', mapping)).toBeUndefined();
    expect(stateAfterBranchCreated('Task', 'To Do', mapping)).toBeUndefined();
  });
});

describe('sanitizeHtml', () => {
  it('keeps formatting and removes active content', () => {
    const html =
      '<div onclick="steal()"><b>Steps</b><script>alert(1)</script><img src="x.png" onerror=alert(1)>' +
      '<a href="javascript:alert(1)">x</a><iframe src="https://evil"></iframe></div>';
    expect(sanitizeHtml(html)).toBe('<div><b>Steps</b><img src="x.png"><a href="#">x</a></div>');
  });
});

describe('state button', () => {
  it('opens the state picker of the work item', () => {
    const html = stateButton(66280, 'Ready to Test');
    expect(html).toContain('data-action="changeState"');
    expect(html).toContain('data-id="66280"');
    expect(html).toContain('state-done');
  });

  it('allows tasks under Backlog Items and Bugs only', () => {
    expect(canHaveTasks('Product Backlog Item')).toBe(true);
    expect(canHaveTasks('Bug')).toBe(true);
    expect(canHaveTasks('Task')).toBe(false);
  });
});
