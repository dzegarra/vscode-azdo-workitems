import { describe, expect, it } from 'vitest';
import { isSidebarTab, tabCounts, tabForSummaryRow } from './sidebarTabs';

const input = { nowCount: 0, workItems: 0, reviews: 0, myPullRequests: [] };

describe('tabCounts', () => {
  it('counts what needs the user in Now, highlighted', () => {
    // Rule TABS-1
    expect(tabCounts({ ...input, nowCount: 4 }).now).toEqual({ text: '4', label: '4 things need you', urgent: true });
    expect(tabCounts(input).now).toEqual({ text: '', label: 'Nothing needs you', urgent: false });
  });

  it('counts the work items of the sprint in Work', () => {
    // Rule TABS-2
    expect(tabCounts({ ...input, workItems: 12 }).work).toEqual({ text: '12', label: '12 work items', urgent: false });
  });

  it('counts the PRs to review, then the active PRs of the user, in PRs', () => {
    // Rule TABS-3
    const myPullRequests = [{ isCompleted: false }, { isCompleted: true }, { isCompleted: false }];
    expect(tabCounts({ ...input, reviews: 2, myPullRequests }).prs).toEqual({
      text: '2 · 2',
      label: '2 pull requests to review · 2 pull requests of yours',
      urgent: true,
    });
    expect(tabCounts({ ...input, myPullRequests }).prs).toMatchObject({ text: '2', urgent: false });
    expect(tabCounts({ ...input, reviews: 1 }).prs).toMatchObject({ text: '1', urgent: true });
  });
});

describe('tabForSummaryRow', () => {
  it('opens the tab that lists what the row counts', () => {
    // Rule TABS-4
    expect(tabForSummaryRow('alerts')).toBe('work');
    expect(tabForSummaryRow('reviews')).toBe('prs');
    expect(tabForSummaryRow('pullRequestWarnings')).toBe('prs');
    expect(tabForSummaryRow('readyToMerge')).toBe('prs');
    expect(tabForSummaryRow('failedRuns')).toBe('prs');
    expect(tabForSummaryRow('baseBranch')).toBeUndefined();
    expect(tabForSummaryRow('staleWorktrees')).toBeUndefined();
  });
});

describe('isSidebarTab', () => {
  it('accepts only the known tabs', () => {
    expect(isSidebarTab('now')).toBe(true);
    expect(isSidebarTab('reviews')).toBe(false);
    expect(isSidebarTab(undefined)).toBe(false);
  });
});
