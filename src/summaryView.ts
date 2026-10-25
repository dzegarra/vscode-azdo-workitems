import * as vscode from 'vscode';
import { needsYou } from './nowQueue';
import { tabForSummaryRow } from './sidebarTabs';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { summaryBadge, SummaryInput, SummaryRow, summaryRows } from './summaryRows';
import type { WorkItemsStore } from './workItemsStore';
import { hygieneReasonsText } from './worktreeHygiene';
import { worktreeLabel } from './worktrees';
import { CLEAN_UP_WORKTREES_COMMAND, type WorktreeTracker } from './worktreeTracker';

export const SUMMARY_VIEW_ID = 'totalflowx.summary';
/** Shows the sidebar on a tab (SHOW_SIDEBAR_TAB_COMMAND of workItemsView.ts, not imported: it imports vscode views) */
const SHOW_TAB_COMMAND = 'totalflowx.showSidebarTab';
/** Declared here (src/baseBranchAlert.ts registers it): the Summary is built before the alert */
const BASE_BRANCH_COMMAND = 'totalflowx.showBaseBranchAlert';

/** The parts of the extension the Summary reads. Structural, so a test can pass fakes */
export interface SummarySources {
  store: Pick<WorkItemsStore, 'baseBranch' | 'entries' | 'onDidChange' | 'pullRequestRuns' | 'withAlerts'>;
  reviews: Pick<ReviewRequestsWatcher, 'models' | 'onDidChange'>;
  myPullRequests: Pick<MyPullRequestsWatcher, 'models' | 'onDidChange'>;
  /** totalflowx.fun.enabled with the alerts on (a clean board means nothing without them); off when missing */
  celebrateCleanBoard?: () => boolean;
  /** The worktrees to clean up; no row when missing or when totalflowx.worktrees.showInSummary is off */
  worktrees?: Pick<WorktreeTracker, 'onDidChange' | 'stale'>;
  showStaleWorktrees?: () => boolean;
}

export function summaryInput({
  store,
  reviews,
  myPullRequests,
  celebrateCleanBoard,
  worktrees,
  showStaleWorktrees,
}: SummarySources): SummaryInput {
  const baseBranch = store.baseBranch;
  return {
    baseBranch: baseBranch && {
      branch: baseBranch.branch,
      brokenPipelines: baseBranch.broken.map(({ pipeline }) => pipeline),
    },
    celebrateCleanBoard: !!celebrateCleanBoard?.() && store.entries.length > 0,
    workItemsWithAlerts: store.withAlerts.length,
    reviews: reviews.models(),
    myPullRequests: myPullRequests.models().items.map((pr) => ({
      isCompleted: pr.isCompleted,
      readyToMerge: pr.readyToMerge,
      warnings: pr.warnings,
      ...needsYou(pr),
    })),
    failedRuns: store.pullRequestRuns.filter(({ run }) => run.state === 'failed').length,
    staleWorktrees:
      worktrees && showStaleWorktrees?.()
        ? worktrees.stale().map((item) => ({
            branch: worktreeLabel(item.worktree),
            reasons: hygieneReasonsText(item.reasons),
          }))
        : undefined,
  };
}

function toItem(row: SummaryRow): vscode.TreeItem {
  const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
  item.id = row.id;
  item.description = row.description;
  item.tooltip = row.tooltip;
  item.iconPath = new vscode.ThemeIcon(row.icon, row.color ? new vscode.ThemeColor(row.color) : undefined);
  if (row.id === 'baseBranch') {
    item.command = { command: BASE_BRANCH_COMMAND, title: 'Show what broke it' };
  } else if (row.id === 'staleWorktrees') {
    item.command = { command: CLEAN_UP_WORKTREES_COMMAND, title: 'Clean up worktrees' };
  } else {
    // Rule TABS-4: the tab that lists what the row counts
    const tab = tabForSummaryRow(row.id);
    if (tab) {
      item.command = { command: SHOW_TAB_COMMAND, title: 'Show the list', arguments: [tab] };
    }
  }
  return item;
}

/**
 * "Summary" tree view: what needs the user's attention. It is a native tree view, created at activation, because
 * a webview view only exists once it is shown and the activity bar badge must show from a cold start
 */
export class SummaryView implements vscode.TreeDataProvider<SummaryRow>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: vscode.TreeView<SummaryRow>;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly sources: SummarySources) {
    this.treeView = vscode.window.createTreeView(SUMMARY_VIEW_ID, { treeDataProvider: this });
    this.subscriptions = [
      this.treeView,
      this.changed,
      sources.store.onDidChange(() => this.update()),
      sources.reviews.onDidChange(() => this.update()),
      sources.myPullRequests.onDidChange(() => this.update()),
      ...(sources.worktrees ? [sources.worktrees.onDidChange(() => this.update())] : []),
    ];
    this.update();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Re-reads the sources: the rows and the badge */
  update(): void {
    this.treeView.badge = summaryBadge(summaryInput(this.sources));
    this.changed.fire();
  }

  getTreeItem(row: SummaryRow): vscode.TreeItem {
    return toItem(row);
  }

  getChildren(element?: SummaryRow): SummaryRow[] {
    return element ? [] : summaryRows(summaryInput(this.sources));
  }
}
