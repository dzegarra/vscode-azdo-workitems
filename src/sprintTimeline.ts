import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { resolveContext, settings, workingDaysSetting } from './config';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import { withFeature } from './requestContext';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { reviewSettings } from './reviewRequestsWatcher';
import { sprintProgress } from './sprintCountdown';
import {
  buildSprintTimeline,
  nextIteration,
  OPEN_SPRINT_TIMELINE_COMMAND,
  type PlannedItem,
  type TimelineMessage,
  type TimelineModel,
  type TimelineRange,
} from './sprintTimelineModel';
import { stateCategory } from './states';
import { isSharedMessage, runSharedMessage } from './sharedMessages';
import { currentBoard, OPEN_TRACK_BOARD_COMMAND } from './trackBoard';
import type { WorkItemsStore } from './workItemsStore';

export { OPEN_SPRINT_TIMELINE_COMMAND };

/** What the panel posts to its webview */
export type TimelineUpdate = { type: 'timeline'; model: TimelineModel };

interface PlannedState {
  status: 'error' | 'loading' | 'off' | 'ready';
  items: PlannedItem[];
}

/**
 * The Sprint timeline: an editor tab with the work of the sprint on a working-days axis. It draws what the store, My
 * Pull Requests, the review requests and the base branch runs already have. The only request of its own is the list of
 * what the user has planned in the next sprint: one query per load of the work items, only while the tab is visible
 * and shows "This + next sprint" (Rule TIMELINE-14)
 */
export class SprintTimelinePanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  private range: TimelineRange = 'sprint';
  private planned: PlannedState = { status: 'off', items: [] };
  /** "<load>:<path>" of the last query, so a load of the work items asks once */
  private plannedKey?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: WorkItemsStore,
    private readonly reviews: ReviewRequestsWatcher,
    private readonly myPullRequests: MyPullRequestsWatcher
  ) {}

  dispose(): void {
    this.panel?.dispose();
  }

  /** Opens the timeline, or shows it when it is already open */
  open(): void {
    withFeature('sprintTimeline', () => {
      if (this.panel) {
        this.panel.reveal();
        return;
      }
      const panel = vscode.window.createWebviewPanel(
        'totalflowx.sprintTimeline',
        'Sprint timeline',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.extensionUri, 'dist'),
            vscode.Uri.joinPath(this.extensionUri, 'media'),
          ],
        }
      );
      this.panel = panel;
      this.ready = false;
      panel.webview.html = this.html(panel.webview);
      panel.webview.onDidReceiveMessage(
        (message: TimelineMessage) => void withFeature('sprintTimeline', () => this.onMessage(message))
      );
      panel.onDidChangeViewState(() => {
        if (panel.visible) {
          this.post();
        }
      });
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.ready = false;
      });
    });
  }

  /** The sprint the board and the sidebar strip show: the one that ends first */
  private sprint(): { name: string; startDate?: string; finishDate?: string; path: string } | undefined {
    const now = new Date();
    const iterations = this.store.toViewModel({
      types: [],
      hiddenStates: [],
      hiddenPullRequestStates: [],
      hiddenPriorities: [],
      hiddenPredecessorStates: [],
      hiddenDuplicates: [],
    }).iterations;
    return (
      [...iterations]
        .filter((iteration) => sprintProgress(iteration.startDate, iteration.finishDate, now, workingDaysSetting()))
        .sort((a, b) => (a.finishDate ?? '').localeCompare(b.finishDate ?? ''))
        .at(0) ?? iterations.at(0)
    );
  }

  /** Draws the timeline again from what the store and the watchers have now */
  post(): void {
    if (!this.panel || !this.ready || !this.panel.visible) {
      return;
    }
    const sprint = this.sprint();
    const next = sprint && nextIteration(sprint, this.store.iterationSchedule);
    if (this.range === 'sprintAndNext' && next) {
      void this.loadPlanned(next.path);
    }
    const base = this.store.baseBranch;
    const model = buildSprintTimeline({
      now: new Date(),
      workingDays: workingDaysSetting(),
      maxWaitHours: reviewSettings().maxWaitHours,
      board: currentBoard(this.store, this.reviews, this.myPullRequests),
      workItems: this.store.toViewModel({
        types: [],
        hiddenStates: [],
        hiddenPullRequestStates: [],
        hiddenPriorities: [],
        hiddenPredecessorStates: [],
        hiddenDuplicates: [],
      }).workItems,
      myPullRequests: this.myPullRequests.models().items,
      reviews: this.reviews.models(),
      sprint,
      schedule: this.store.iterationSchedule,
      range: this.range,
      planned: this.range === 'sprintAndNext' ? this.planned : { status: 'off', items: [] },
      base: {
        branch: settings().baseBranch,
        enabled: settings().baseBranchAlert.enabled,
        runs: this.store.baseBranchHistory,
        health: base,
      },
    });
    const update: TimelineUpdate = { type: 'timeline', model };
    void this.panel.webview.postMessage(update);
  }

  /** What the user has planned in the next sprint: one query per load of the work items (cached by that load) */
  private async loadPlanned(path: string): Promise<void> {
    const key = `${String(this.store.loadCount)}:${path}`;
    if (this.plannedKey === key) {
      return;
    }
    this.plannedKey = key;
    this.planned = { status: 'loading', items: [] };
    try {
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      const items = await client.getMyWorkItems([path]);
      this.planned = {
        status: 'ready',
        items: items
          .filter((item) => item.type !== 'Task' && stateCategory(item.state) !== 'removed')
          .map((item) => ({ id: item.id, title: item.title, type: item.type, state: item.state })),
      };
    } catch {
      this.planned = { status: 'error', items: [] };
    }
    this.post();
  }

  private async onMessage(message: TimelineMessage): Promise<void> {
    try {
      if (message.type === 'ready') {
        this.ready = true;
        this.post();
        await this.store.ensureLoaded();
        return;
      }
      if (message.type === 'setTimelineRange') {
        this.range = message.range;
        this.post();
        return;
      }
      if (message.type === 'openBoard') {
        await vscode.commands.executeCommand(OPEN_TRACK_BOARD_COMMAND, message.key);
        return;
      }
      if (isSharedMessage(message)) {
        await runSharedMessage(
          { store: this.store, reviews: this.reviews, myPullRequests: this.myPullRequests },
          message
        );
      }
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const asset = (...path: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...path)).toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${
      webview.cspSource
    }; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset('media', 'fonts.css')}">
  <link rel="stylesheet" href="${asset('media', 'webview.css')}">
  <link rel="stylesheet" href="${asset('media', 'board.css')}">
  <link rel="stylesheet" href="${asset('media', 'timeline.css')}">
  <title>Sprint timeline</title>
</head>
<body class="board-page timeline-page">
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset('dist', 'timeline.js')}"></script>
</body>
</html>`;
  }
}
