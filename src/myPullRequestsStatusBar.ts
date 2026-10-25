import * as vscode from 'vscode';
import { STATUS_BAR_PRIORITY } from './statusBarOrder';
import { SECTION } from './config';
import { attentionIcon, attentionLine, myPullRequestsItem } from './myPullRequestsAttention';
import { MyPullRequestsWatcher, myPullRequestSettings } from './myPullRequestsWatcher';
import { WorkItemsStore } from './workItemsStore';

const BACKGROUNDS = { error: 'statusBarItem.errorBackground', warning: 'statusBarItem.warningBackground' };

/**
 * The user's own PRs that need them (rejected, waiting for the author, conflicts, failed CI, unresolved comments)
 * or are ready to merge, in the status bar. Nothing is requested: it reads what the sidebar shows
 */
export class MyPullRequestsStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'totalflowx.myPullRequests',
    vscode.StatusBarAlignment.Left,
    STATUS_BAR_PRIORITY.myPullRequests
  );
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly watcher: MyPullRequestsWatcher, store: WorkItemsStore) {
    this.item.name = 'My pull requests that need me';
    // Rule STATUSBAR-MYPR-8
    this.item.command = 'totalflowx.myItems.focus';
    this.subscriptions = [
      watcher.onDidChange(() => this.update()),
      // The CI runs of the store change without the watcher polling
      store.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.myPullRequests`)) {
          this.update();
        }
      }),
    ];
  }

  dispose(): void {
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private update(): void {
    // Rule STATUSBAR-MYPR-6
    const item = myPullRequestSettings().showInStatusBar ? myPullRequestsItem(this.watcher.models().items) : undefined;
    if (!item) {
      this.item.hide();
      return;
    }
    this.item.text = item.text;
    this.item.backgroundColor = item.background ? new vscode.ThemeColor(BACKGROUNDS[item.background]) : undefined;

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown('**');
    tooltip.appendText(item.title);
    tooltip.appendMarkdown('**\n\n');
    for (const pr of item.pullRequests) {
      tooltip.appendMarkdown(`${attentionIcon(pr)} [PR ${pr.id}](${pr.url}) · `);
      tooltip.appendText(`${attentionLine(pr)} · ${pr.title}`);
      tooltip.appendMarkdown('  \n');
    }
    tooltip.appendMarkdown('\n_Click to show the list_');
    this.item.tooltip = tooltip;
    this.item.show();
  }
}
