import { describe, expect, it } from 'vitest';
import { parsePriority, priorityFilterValue, severityLevel, severityName, sortWorkItems } from './priority';

describe('priority and severity', () => {
  it('parses the values of Azure DevOps', () => {
    expect(parsePriority(2)).toBe(2);
    expect(parsePriority(undefined)).toBeUndefined();
    expect(parsePriority(7)).toBeUndefined();
    expect(severityLevel('1 - Critical')).toBe(1);
    expect(severityLevel('3 - Medium')).toBe(3);
    expect(severityLevel(undefined)).toBeUndefined();
    expect(severityName('2 - High')).toBe('High');
    expect(severityName('Custom')).toBe('Custom');
  });

  it('gives the value of the filter chips', () => {
    expect(priorityFilterValue({ priority: 1 })).toBe('P1');
    expect(priorityFilterValue({})).toBe('No priority');
  });

  it('sorts by state, then priority, then severity', () => {
    const order = ['Done', 'Committed', 'New'];
    const items = [
      { id: 1, state: 'New', priority: 1 },
      { id: 2, state: 'Committed', priority: 3 },
      { id: 3, state: 'Committed' },
      { id: 4, state: 'Committed', priority: 2, severity: '3 - Medium' },
      { id: 5, state: 'Committed', priority: 2, severity: '1 - Critical' },
      { id: 6, state: 'Done', priority: 4 },
      { id: 7, state: 'Committed', priority: 2 },
    ];
    expect(sortWorkItems(items, order).map((item) => item.id)).toEqual([6, 5, 4, 7, 2, 3, 1]);
  });
});
