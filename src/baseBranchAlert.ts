import * as vscode from 'vscode';
import {
  baseBranchModal,
  baseBranchStatusText,
  BrokenPipeline,
  breakingBuildText,
  brokenPipelineText,
  newIncidents,
  rememberIncidents,
} from './baseBranchHealth';
import { recordsScope, resolveContext, SECTION } from './config';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import { hasFailedTests, testsUrl } from './runDetails';
import type { WorkItemsStore } from './workItemsStore';

export const SHOW_BASE_BRANCH_COMMAND = 'totalflowx.showBaseBranchAlert';
/** Incidents already shown in the modal, per organization / project: shared by the windows, kept across reloads */
const NOTIFIED_KEY = 'totalflowx.baseBranchAlert.notified';
const MS_PER_MINUTE = 60 * 1000;

interface UrlPick extends vscode.QuickPickItem {
  url?: string;
}

/**
 * The alarm of a broken base branch (Rules BASE-CI-5..7, 9): a red status bar item that stays until the branch is
 * green, a modal once per incident and the alarm sound in the sidebar. The Summary row and the banner of the
 * sidebar read the same state of the store
 */
export class BaseBranchAlert implements vscode.Disposable {
  // Priority: the leftmost of the extension's items
  private readonly item = vscode.window.createStatusBarItem(
    'totalflowx.baseBranch',
    vscode.StatusBarAlignment.Left,
    1000
  );
  private readonly subscriptions: vscode.Disposable[];
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly globalState: vscode.Memento,
    private readonly store: WorkItemsStore,
    private readonly myPullRequests: Pick<MyPullRequestsWatcher, 'isMine'>,
    /** Plays the alarm in the sidebar when totalflowx.pipelines.baseBranchAlarmSound allows it */
    private readonly playAlarm: () => void
  ) {
    this.item.name = 'Base branch broken';
    this.item.command = SHOW_BASE_BRANCH_COMMAND;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.subscriptions = [
      store.onDidChange(() => this.update()),
      vscode.commands.registerCommand(SHOW_BASE_BRANCH_COMMAND, () => this.pick()),
    ];
    // The elapsed time of the text
    this.timer = setInterval(() => this.updateItem(), MS_PER_MINUTE);
    this.update();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private update(): void {
    this.updateItem();
    this.announce();
  }

  // Rule BASE-CI-5
  private updateItem(): void {
    const health = this.store.baseBranch;
    if (!health?.broken.length) {
      this.item.hide();
      return;
    }
    const now = new Date();
    this.item.text = baseBranchStatusText(health, now);
    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(`$(flame) **${health.branch} is broken**: fix it as soon as possible\n\n`);
    for (const pipeline of health.broken) {
      tooltip.appendMarkdown(`[$(error)](${pipeline.run.url}) `);
      tooltip.appendText(brokenPipelineText(pipeline, now));
      tooltip.appendMarkdown('  \n&nbsp;&nbsp;&nbsp;&nbsp;');
      tooltip.appendText(`Broken by ${breakingBuildText(pipeline.brokenBy)}`);
      tooltip.appendMarkdown('\n\n');
    }
    tooltip.appendText('Click for the runs and the pull request.');
    this.item.tooltip = tooltip;
    this.item.show();
  }

  // Rules BASE-CI-6, BASE-CI-9
  /** A new incident: the modal (never awaited: the polling goes on) and the alarm sound */
  private announce(): void {
    const health = this.store.baseBranch;
    const scope = recordsScope(this.store.repository());
    if (!health?.broken.length || !scope) {
      return;
    }
    const all = this.globalState.get<Record<string, string[] | undefined>>(NOTIFIED_KEY, {});
    const notified = all[scope] ?? [];
    const incidents = newIncidents(health, notified);
    if (!incidents.length) {
      return;
    }
    // Remembered before the modal shows, so another update (or window) does not show it twice
    void this.globalState.update(NOTIFIED_KEY, { ...all, [scope]: rememberIncidents(notified, incidents) });
    this.playAlarm();
    void this.showModal(health.branch, incidents);
  }

  /** URL of a PR of the repository; undefined when the repository cannot be told */
  private pullRequestUrl(pullRequestId: number): string | undefined {
    try {
      const { client, repositoryName } = resolveContext(this.store.repository());
      return client.pullRequestWebUrlByName(repositoryName, pullRequestId);
    } catch {
      return undefined;
    }
  }

  // Rule BASE-CI-7
  private async showModal(branch: string, incidents: BrokenPipeline[]): Promise<void> {
    const { message, detail, pullRequestId } = baseBranchModal(
      branch,
      incidents,
      (id) => this.myPullRequests.isMine(id),
      new Date()
    );
    const first = incidents[0];
    const prUrl = pullRequestId === undefined ? undefined : this.pullRequestUrl(pullRequestId);
    const actions: (vscode.MessageItem & { url?: string })[] = [
      { title: 'Open Run', url: first.run.url },
      ...(hasFailedTests(first.run) ? [{ title: 'Show Tests', url: testsUrl(first.run.url) }] : []),
      ...(prUrl && pullRequestId !== undefined ? [{ title: `Open PR ${pullRequestId}`, url: prUrl }] : []),
      { title: "I'm on it", isCloseAffordance: true },
    ];
    const picked = await vscode.window.showErrorMessage(message, { modal: true, detail }, ...actions);
    if (picked?.url) {
      await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    }
  }

  /** The broken pipelines, their failing run and what broke them; the chosen one opens in Azure DevOps */
  private async pick(): Promise<void> {
    const health = this.store.baseBranch;
    if (!health?.broken.length) {
      void vscode.window.showInformationMessage(
        `The CI of ${health?.branch ?? 'the base branch'} is green.${
          vscode.workspace.getConfiguration(SECTION).get<boolean>('pipelines.baseBranchAlert', true)
            ? ''
            : ' (totalflowx.pipelines.baseBranchAlert is off.)'
        }`
      );
      return;
    }
    const now = new Date();
    const items = health.broken.flatMap((pipeline): UrlPick[] => {
      const { run, brokenBy } = pipeline;
      const prUrl = brokenBy.pullRequestId === undefined ? undefined : this.pullRequestUrl(brokenBy.pullRequestId);
      return [
        { label: pipeline.pipeline, kind: vscode.QuickPickItemKind.Separator },
        {
          label: `$(error) ${brokenPipelineText(pipeline, now)}`,
          description: hasFailedTests(run) ? 'Show the failed tests' : 'Open the run',
          url: hasFailedTests(run) ? testsUrl(run.url) : run.url,
        },
        ...(prUrl
          ? [
              {
                label: `$(git-pull-request) ${breakingBuildText(brokenBy)}`,
                description: 'Open the PR that broke it',
                url: prUrl,
              },
            ]
          : []),
        ...(brokenBy.buildId === run.id
          ? []
          : [
              {
                label: `$(history) Run ${brokenBy.buildId}`,
                description: 'The first run that failed',
                url: brokenBy.url,
              },
            ]),
      ];
    });
    const picked = await vscode.window.showQuickPick(items, {
      title: `${health.branch} is broken`,
      placeHolder: 'Select a run or the pull request to open it in Azure DevOps',
    });
    if (picked?.url) {
      await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    }
  }
}
