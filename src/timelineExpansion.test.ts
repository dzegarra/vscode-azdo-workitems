import { describe, expect, it } from 'vitest';
import { collapseAll, expandedIds, isExpanded, parseChoices, sameIds, toggleRow } from './timelineExpansion';

const rows = [
  { id: 1, expandable: true, defaultExpanded: true },
  { id: 2, expandable: true },
  { id: 3, expandable: true, defaultExpanded: true },
  { id: 4, expandable: false },
];

describe('expansion of the rows (TIMELINE-18)', () => {
  it('starts expanded the rows the model says need the user, and the others collapsed', () => {
    expect(expandedIds(rows, {})).toEqual([1, 3]);
  });

  it('lets the choice of the user win over the default, both ways', () => {
    const choices = { 1: false, 2: true };
    expect(isExpanded(rows[0], choices)).toBe(false);
    expect(isExpanded(rows[1], choices)).toBe(true);
    expect(expandedIds(rows, choices)).toEqual([2, 3]);
  });

  it('toggles from what is shown, not from what was chosen', () => {
    expect(toggleRow(rows[0], {})).toEqual({ 1: false });
    expect(toggleRow(rows[1], {})).toEqual({ 2: true });
    expect(toggleRow(rows[1], { 2: true })).toEqual({ 2: false });
  });

  it('collapses all the rows that can be expanded, whatever their default', () => {
    expect(collapseAll(rows, { 2: true })).toEqual({ 1: false, 2: false, 3: false });
    expect(expandedIds(rows, collapseAll(rows, {}))).toEqual([]);
  });

  it('never expands a row that cannot be (the placeholder is the row of a work item with nothing)', () => {
    expect(isExpanded(rows[3], { 4: true })).toBe(false);
  });

  it('keeps only booleans of numeric ids from the saved state', () => {
    expect(parseChoices({ '12': true, '13': false, x: true, '14': 'yes' })).toEqual({ 12: true, 13: false });
    expect(parseChoices(undefined)).toEqual({});
    expect(parseChoices([true, false])).toEqual({});
  });

  it('compares id lists, so the webview posts the expanded set only when it changed', () => {
    expect(sameIds([1, 3], [1, 3])).toBe(true);
    expect(sameIds([1, 3], [1])).toBe(false);
    expect(sameIds([1, 3], [3, 1])).toBe(false);
  });
});
