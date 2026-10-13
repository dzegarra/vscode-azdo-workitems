import * as vscode from 'vscode';
import { SECTION } from './config';
import { ciHasFailures, ciStatusText, ciTooltipTitle, countRunStates, STATE_ICONS } from './pipelines';
import { runExtraLines, runLabel, testsUrl } from './runDetails';
import { WorkItemsStore } from './workItemsStore';

export const SHOW_RUNS_COMMAND = 'totalflowx.showPipelineRuns';

/**
 * CI runs of the user's pull requests in the status bar, visible even when the sidebar is closed.
 * Updated with the store: every few seconds while a run is queued or running
 */
export class PipelineStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('totalflowx.pipelines', vscode.StatusBarAlignment.Left);
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly store: WorkItemsStore) {
    this.item.name = 'CI runs of my pull requests';
    this.item.command = SHOW_RUNS_COMMAND;
    this.subscriptions = [
      store.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.pipelines.showInStatusBar`)) {
          this.update();
        }
      }),
      vscode.commands.registerCommand(SHOW_RUNS_COMMAND, () => this.pick()),
    ];
  }

  dispose(): void {
    this.item.dispose();
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }

  private update(): void {
    const enabled = vscode.workspace.getConfiguration(SECTION).get<boolean>('pipelines.showInStatusBar', true);
    const runs = this.store.pullRequestRuns;
    if (!enabled || !runs.length) {
      this.item.hide();
      return;
    }
    const counts = countRunStates(runs.map(({ run }) => run.state));
    this.item.text = ciStatusText(counts);
    this.item.backgroundColor = ciHasFailures(counts)
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : undefined;

    const now = new Date();
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown('**');
    tooltip.appendText(ciTooltipTitle(counts));
    tooltip.appendMarkdown('**\n\n');
    for (const { pullRequestId, title, run } of runs) {
      const label = runLabel(run, now);
      tooltip.appendMarkdown(
        `${STATE_ICONS[run.state]} [PR ${pullRequestId}](${label.opensTests ? testsUrl(run.url) : run.url}) · ${
          run.pipeline
        } · **${label.text}**  \n`
      );
      // Failed tests, coverage…
      runExtraLines(run).forEach((line) => {
        tooltip.appendText(line.trimEnd());
        tooltip.appendMarkdown('  \n');
      });
      if (title) {
        tooltip.appendText(title);
        tooltip.appendMarkdown('\n\n');
      }
    }
    tooltip.appendMarkdown('\n_Click to open a run_');
    this.item.tooltip = tooltip;
    this.item.show();
  }

  /** Lists the runs; the selected one opens in Azure DevOps */
  private async pick(): Promise<void> {
    const now = new Date();
    const picked = await vscode.window.showQuickPick(
      this.store.pullRequestRuns.map(({ pullRequestId, title, run }) => ({
        label: `${STATE_ICONS[run.state]} PR ${pullRequestId} · ${runLabel(run, now).text}`,
        description: run.pipeline,
        detail: title,
        url: runLabel(run, now).opensTests ? testsUrl(run.url) : run.url,
      })),
      { title: 'CI runs of my pull requests', placeHolder: 'Select a run to open it in Azure DevOps' }
    );
    if (picked) {
      await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    }
  }
}
