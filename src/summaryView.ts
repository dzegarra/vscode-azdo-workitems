import * as vscode from 'vscode';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { summaryBadge, SummaryInput, SummaryRow, summaryRows } from './summaryRows';
import type { WorkItemsStore } from './workItemsStore';

export const SUMMARY_VIEW_ID = 'totalflowx.summary';
const FOCUS_COMMAND = 'totalflowx.myItems.focus';

/** The parts of the extension the Summary reads. Structural, so a test can pass fakes */
export interface SummarySources {
  store: Pick<WorkItemsStore, 'onDidChange' | 'pullRequestRuns' | 'withAlerts'>;
  reviews: Pick<ReviewRequestsWatcher, 'models' | 'onDidChange'>;
  myPullRequests: Pick<MyPullRequestsWatcher, 'models' | 'onDidChange'>;
}

export function summaryInput({ store, reviews, myPullRequests }: SummarySources): SummaryInput {
  return {
    workItemsWithAlerts: store.withAlerts.length,
    reviews: reviews.models(),
    myPullRequests: myPullRequests.models().items,
    failedRuns: store.pullRequestRuns.filter(({ run }) => run.state === 'failed').length,
  };
}

function toItem(row: SummaryRow): vscode.TreeItem {
  const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
  item.id = row.id;
  item.description = row.description;
  item.tooltip = row.tooltip;
  item.iconPath = new vscode.ThemeIcon(row.icon, row.color ? new vscode.ThemeColor(row.color) : undefined);
  if (row.id !== 'nothing') {
    item.command = { command: FOCUS_COMMAND, title: 'Show the list' };
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
