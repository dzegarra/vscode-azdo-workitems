import * as vscode from 'vscode';
import { SECTION } from './config';
import { describeReviews, ReviewUrgency } from './reviewRequests';
import { reviewSettings, ReviewRequestsWatcher } from './reviewRequestsWatcher';

const URGENCY_ICONS: Record<ReviewUrgency, string> = {
  overdue: '$(error)',
  dueSoon: '$(warning)',
  fresh: '$(git-pull-request)',
};

/**
 * PRs waiting for the user's review in the status bar, visible even when the sidebar is closed. It shows the
 * time left of the most urgent one and turns yellow when one is due soon, red when one is overdue
 */
export class ReviewStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('azdoWorkItems.reviews', vscode.StatusBarAlignment.Left);
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly watcher: ReviewRequestsWatcher) {
    this.item.name = 'Pull requests waiting for my review';
    this.item.command = 'azdoWorkItems.myItems.focus';
    this.subscriptions = [
      watcher.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.reviews`)) {
          this.update();
        }
      }),
    ];
  }

  dispose(): void {
    this.item.dispose();
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  private update(): void {
    const models = this.watcher.models();
    if (!reviewSettings().showInStatusBar || !models.length) {
      this.item.hide();
      return;
    }
    // Oldest first: the first one is the most urgent
    const [first] = models;
    this.item.text = `${URGENCY_ICONS[first.urgency]} ${models.length} to review · ${first.timeLeft}`;
    const background: Partial<Record<ReviewUrgency, string>> = {
      overdue: 'statusBarItem.errorBackground',
      dueSoon: 'statusBarItem.warningBackground',
    };
    const color = background[first.urgency];
    this.item.backgroundColor = color ? new vscode.ThemeColor(color) : undefined;

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`**`);
    tooltip.appendText(describeReviews(models));
    tooltip.appendMarkdown('**\n\n');
    for (const model of models) {
      tooltip.appendMarkdown(
        `${URGENCY_ICONS[model.urgency]} [PR ${model.id}](${model.url}) · **${model.timeLeft}** · `
      );
      tooltip.appendText(`${model.author}: ${model.title}`);
      tooltip.appendMarkdown('  \n');
    }
    tooltip.appendMarkdown('\n_Click to show the list_');
    this.item.tooltip = tooltip;
    this.item.show();
  }
}
