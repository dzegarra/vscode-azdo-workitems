import { describe, expect, it } from 'vitest';
import { STATUS_BAR_PRIORITY, toFixText, toFixTooltipLines } from './statusBarOrder';

describe('status bar order', () => {
  it('goes alarm, place, work item, CI, reviews, my PRs, to fix', () => {
    const order = Object.entries(STATUS_BAR_PRIORITY)
      .sort(([, a], [, b]) => b - a)
      .map(([name]) => name);
    expect(order).toEqual(['baseBranch', 'place', 'workItem', 'ci', 'reviews', 'myPullRequests', 'toFix']);
  });

  it('shows "N to fix" only above 0', () => {
    expect(toFixText(0)).toBeUndefined();
    expect(toFixText(2)).toBe('$(warning) 2 to fix');
  });

  it('lists the work items and what is wrong', () => {
    expect(
      toFixTooltipLines([{ workItem: { id: 7, title: 'A' }, alerts: [{ message: 'no PR' }, { message: 'no branch' }] }])
    ).toEqual(['1 work item to fix', '7 A: no PR; no branch']);
  });
});
