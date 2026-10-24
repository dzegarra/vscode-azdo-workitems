/**
 * The tabs of the sidebar (redesign): Now (what needs the user), Work (the work items of the sprint) and PRs (the
 * PRs to review and the user's own). Which tab shows what, what each counts, and which tab a link from elsewhere
 * (Summary row, status bar) opens. Pure, so no "vscode" import: the webview uses it too
 */
import type { SummaryRowId } from './summaryRows';

export type SidebarTab = 'now' | 'prs' | 'work';

export const SIDEBAR_TABS: readonly SidebarTab[] = ['now', 'work', 'prs'];

export const TAB_LABELS: Record<SidebarTab, string> = { now: 'Now', work: 'Work', prs: 'PRs' };

export interface TabCountsInput {
  /** Count of the "Needs you" queue (Rules NOW-6, NOW-7) */
  nowCount: number;
  /** Work items listed as cards (Backlog Items, Bugs…; tasks are inside their card) */
  workItems: number;
  /** PRs waiting for the user's review, as the Reviews box lists them */
  reviews: number;
  /** The user's PRs listed in My Pull Requests */
  myPullRequests: { isCompleted: boolean }[];
}

export interface TabCount {
  /** Next to the tab name; empty: nothing */
  text: string;
  /** For screen readers and the tooltip */
  label: string;
  /** Something waits for the user: the count is highlighted */
  urgent: boolean;
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

// Rules TABS-1..3
/** What each tab shows next to its name */
export function tabCounts(input: TabCountsInput): Record<SidebarTab, TabCount> {
  const mine = input.myPullRequests.filter((pr) => !pr.isCompleted).length;
  const prParts = [input.reviews ? String(input.reviews) : '', mine ? String(mine) : ''];
  return {
    // Rule TABS-1
    now: {
      text: input.nowCount ? String(input.nowCount) : '',
      label: input.nowCount
        ? `${plural(input.nowCount, 'thing')} need${input.nowCount === 1 ? 's' : ''} you`
        : 'Nothing needs you',
      urgent: input.nowCount > 0,
    },
    // Rule TABS-2
    work: {
      text: input.workItems ? String(input.workItems) : '',
      label: plural(input.workItems, 'work item'),
      urgent: false,
    },
    // Rule TABS-3: the reviews first (someone waits on the user), then the user's own active PRs
    prs: {
      text: input.reviews && mine ? prParts.join(' · ') : prParts.join(''),
      label: `${plural(input.reviews, 'pull request')} to review · ${plural(mine, 'pull request')} of yours`,
      urgent: input.reviews > 0,
    },
  };
}

// Rule TABS-4
/** The tab a click on a row of the Summary view opens; undefined: the row has its own command or none */
export function tabForSummaryRow(id: SummaryRowId): SidebarTab | undefined {
  switch (id) {
    case 'alerts':
      return 'work';
    case 'reviews':
    case 'pullRequestWarnings':
    case 'readyToMerge':
    case 'failedRuns':
      return 'prs';
    case 'baseBranch':
    case 'cleanBoard':
    case 'nothing':
    case 'staleWorktrees':
      return undefined;
  }
}

/** Whether a stored value is a tab (the webview state may come from an older version) */
export function isSidebarTab(value: unknown): value is SidebarTab {
  return typeof value === 'string' && (SIDEBAR_TABS as readonly string[]).includes(value);
}
