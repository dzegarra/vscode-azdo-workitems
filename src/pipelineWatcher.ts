import * as vscode from 'vscode';
import { SECTION } from './config';
import { describeRun, RunModel } from './pipelines';
import { WorkItemsStore } from './workItemsStore';

const MS_PER_SECOND = 1000;
const MIN_INTERVAL_SECONDS = 5;

function pipelineSettings() {
  const config = vscode.workspace.getConfiguration(`${SECTION}.pipelines`);
  return {
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, config.get<number>('pollIntervalSeconds', 15)),
    notifyOnFinish: config.get<boolean>('notifyOnFinish', true),
  };
}

/**
 * Keeps the CI runs of the PRs live: while a run is queued or running, only the runs are reloaded
 * every few seconds. Stops by itself once every run is finished
 */
export class PipelineWatcher implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly store: WorkItemsStore) {
    this.subscription = store.onDidLoad(() => this.schedule());
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.subscription.dispose();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (!this.store.hasActiveRuns) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), pipelineSettings().intervalSeconds * MS_PER_SECOND);
  }

  private async tick(): Promise<void> {
    try {
      const finished = await this.store.refreshRuns();
      if (pipelineSettings().notifyOnFinish) {
        finished.forEach(({ pullRequestId, run }) => void this.notify(pullRequestId, run));
      }
    } catch {
      // Network hiccups: try again on the next tick
    }
    this.schedule();
  }

  private async notify(pullRequestId: number, run: RunModel): Promise<void> {
    const message = `PR ${pullRequestId}: ${run.pipeline} — ${describeRun(run, new Date())}`;
    const show =
      run.state === 'failed' || run.state === 'partial'
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;
    const open = await show(message, 'Open Run');
    if (open) {
      await vscode.env.openExternal(vscode.Uri.parse(run.url));
    }
  }
}
