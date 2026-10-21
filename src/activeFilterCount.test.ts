import { describe, expect, it } from 'vitest';
import { NO_PRIORITY } from './priority';
import { activeFilterCount, FilterModel, NO_PULL_REQUEST } from './viewModel';

const NONE: FilterModel = {
  types: [],
  hiddenStates: [],
  hiddenPullRequestStates: [],
  hiddenPriorities: [],
  hiddenPredecessorStates: [],
  hiddenDuplicates: [],
};

const items = [
  { type: 'Bug', state: 'New', pullRequests: [], priority: 1, openPredecessors: [] },
  { type: 'User Story', state: 'Done', pullRequests: [], priority: 2, openPredecessors: [{}] },
  { type: 'User Story', state: 'Active', pullRequests: [], openPredecessors: undefined },
];

describe('activeFilterCount', () => {
  it('is 0 without filters', () => {
    expect(activeFilterCount(NONE, items)).toBe(0);
  });

  it('counts the types left out', () => {
    expect(activeFilterCount({ ...NONE, types: ['Bug'] }, items)).toBe(1);
    expect(activeFilterCount({ ...NONE, types: ['Bug', 'User Story'] }, items)).toBe(0);
  });

  it('counts each kind of hidden value', () => {
    expect(activeFilterCount({ ...NONE, hiddenStates: ['Done', 'New'] }, items)).toBe(2);
    expect(activeFilterCount({ ...NONE, hiddenPullRequestStates: [NO_PULL_REQUEST] }, items)).toBe(1);
    expect(activeFilterCount({ ...NONE, hiddenPriorities: ['P1', NO_PRIORITY] }, items)).toBe(2);
    expect(activeFilterCount({ ...NONE, hiddenPredecessorStates: ['Incomplete predecessors'] }, items)).toBe(1);
  });

  it('counts the hidden duplicates only when some work item is a duplicate', () => {
    const hidden = { ...NONE, hiddenDuplicates: ['Duplicates'] };
    expect(activeFilterCount(hidden, items)).toBe(0);
    expect(activeFilterCount(hidden, [...items, { ...items[0], duplicateOf: [{}] }])).toBe(1);
  });

  it('adds up all the kinds', () => {
    const filter = { ...NONE, types: ['Bug'], hiddenStates: ['Done'], hiddenPriorities: ['P2'] };
    expect(activeFilterCount(filter, items)).toBe(3);
  });

  it('ignores the values no work item has', () => {
    expect(activeFilterCount({ ...NONE, hiddenStates: ['Removed'], hiddenPriorities: ['P4'] }, items)).toBe(0);
  });
});
