import * as vscode from 'vscode';
import { coverageThresholds, recordsScope, SECTION } from './config';
import { coverageLevel } from './coverage';
import { CoverageResult, currentStreak, isNewBest } from './coverageRecords';
import { CoverageRecordsStore } from './coverageRecordsStore';
import { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import { RunModel } from './pipelines';
import { finishedRunMessage, finishedRunSubject, testsUrl } from './runDetails';
import { FinishedRun, RunsPoller } from './runsPolling';
import { WorkItemsStore } from './workItemsStore';

const MIN_INTERVAL_SECONDS = 5;
const MIN_IDLE_SECONDS = 30;

function pipelineSettings() {
  const config = vscode.workspace.getConfiguration(`${SECTION}.pipelines`);
  const idle = config.get<number>('idlePollIntervalSeconds', 60);
  return {
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, config.get<number>('pollIntervalSeconds', 15)),
    idleSeconds: idle > 0 ? Math.max(MIN_IDLE_SECONDS, idle) : 0,
    notifyOnFinish: config.get<boolean>('notifyOnFinish', true),
  };
}

/**
 * Keeps the CI runs of the PRs live: every few seconds while a run is queued or running and, when all are
 * finished, a slower check that discovers the runs queued later (re-runs, new pushes). It never stops.
 * Also keeps the personal coverage records of the user's own PRs
 */
export class PipelineWatcher implements vscode.Disposable {
  private readonly poller: RunsPoller;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly store: WorkItemsStore,
    private readonly myPullRequests: MyPullRequestsWatcher,
    private readonly records: CoverageRecordsStore
  ) {
    this.poller = new RunsPoller({
      settings: () => {
        const { intervalSeconds, idleSeconds } = pipelineSettings();
        return { fastSeconds: intervalSeconds, idleSeconds };
      },
      hasActive: () => store.hasActiveRuns,
      refresh: () => store.refreshRuns(),
      onFinished: (finished) => this.onFinished(finished),
    });
    this.subscriptions = [
      store.onDidLoad(() => this.poller.schedule()),
      // New PRs to follow: load their runs now instead of waiting for the next tick
      store.onDidChangeFollowed(() => void this.poller.tick()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.pipelines`)) {
          this.poller.schedule();
        }
      }),
      // Catches up with the runs that finished while the extension was not watching
      myPullRequests.onDidChange(() => void this.syncRecords(myPullRequests.ownRuns().flatMap(({ runs }) => runs))),
    ];
  }

  dispose(): void {
    this.poller.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private async onFinished(finished: FinishedRun[]): Promise<void> {
    const notify = pipelineSettings().notifyOnFinish;
    for (const entry of finished) {
      // Coverage records: only the runs validating the user's own PRs
      const own = entry.kind === 'pullRequest' && this.myPullRequests.isMine(entry.pullRequestId);
      const records = await this.syncRecords(own ? [entry.run] : []);
      if (notify) {
        void this.notify(entry, records);
      }
    }
  }

  /**
   * Records the coverage of the successful runs, oldest first. Only the user's own PRs count: the PRs of the
   * store also include the ones of other people linked to the work items of the user
   */
  private async syncRecords(runs: RunModel[]): Promise<{ newBest: boolean; streak: number } | undefined> {
    const scope = recordsScope(this.store.repository());
    const owners = new Map(
      this.myPullRequests.ownRuns().flatMap((pr) => pr.runs.map((run) => [run.id, pr.pullRequestId]))
    );
    const results = runs
      .filter((run) => run.state === 'succeeded' && run.coverage)
      .sort((a, b) => (a.finishTime ?? '').localeCompare(b.finishTime ?? ''))
      .flatMap((run) => {
        const pullRequestId = owners.get(run.id);
        return pullRequestId === undefined || !run.coverage
          ? []
          : [{ pullRequestId, runId: run.id, percent: run.coverage.percent }];
      });
    if (!scope || !results.length) {
      return undefined;
    }
    const { records, changed } = await this.records.observe(scope, results);
    if (changed) {
      this.store.notify();
    }
    const last = results[results.length - 1] as CoverageResult | undefined;
    return {
      newBest: !!last && isNewBest(records, last.runId),
      streak: currentStreak(records, coverageThresholds().target),
    };
  }

  /** The links of the PR as Azure DevOps lists them for the user's PRs, else the work items of the list */
  private workItemIdsOf(pullRequestId: number): number[] {
    const own = this.myPullRequests.workItemIdsOf(pullRequestId);
    return own?.length ? own : this.store.workItemIdsOfPullRequest(pullRequestId);
  }

  private async notify(
    finished: FinishedRun,
    records: { newBest: boolean; streak: number } | undefined
  ): Promise<void> {
    const { run } = finished;
    const thresholds = coverageThresholds();
    const pullRequestId = finished.kind === 'branch' ? undefined : finished.pullRequestId;
    const title =
      pullRequestId === undefined
        ? undefined
        : this.store.pullRequestTitle(pullRequestId) ?? this.myPullRequests.find(pullRequestId)?.title;
    const { text, warning, hasFailedTests } = finishedRunMessage(run, {
      subject: finishedRunSubject(finished, title),
      workItemIds: pullRequestId === undefined ? undefined : this.workItemIdsOf(pullRequestId),
      newBest: records?.newBest,
      streak: records?.streak,
      target: thresholds.target,
      excellent: !!run.coverage && coverageLevel(run.coverage.percent, thresholds) === 'excellent',
    });
    const show = warning ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const buttons = hasFailedTests ? ['Open Run', 'Show Tests'] : ['Open Run'];
    const picked = await show(text, ...buttons);
    if (picked) {
      await vscode.env.openExternal(vscode.Uri.parse(picked === 'Show Tests' ? testsUrl(run.url) : run.url));
    }
  }
}
