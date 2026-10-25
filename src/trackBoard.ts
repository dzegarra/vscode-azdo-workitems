import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { setShowCompleted, settings, workingDaysSetting } from './config';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import { withFeature } from './requestContext';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { reviewSettings } from './reviewRequestsWatcher';
import { OPEN_SPRINT_TIMELINE_COMMAND } from './sprintTimelineModel';
import { isSharedMessage, runSharedMessage } from './sharedMessages';
import { sprintProgress } from './sprintCountdown';
import { ALL_KINDS, buildBoard, type BoardKind, type BoardMessage, type BoardModel } from './trackBoardModel';
import type { WorkItemsStore } from './workItemsStore';

export const OPEN_TRACK_BOARD_COMMAND = 'totalflowx.openTrackBoard';

/** What the panel posts to its webview */
export type BoardUpdate = { type: 'board'; model: BoardModel } | { type: 'select'; key: string };

const NO_FILTER = {
  types: [],
  hiddenStates: [],
  hiddenPullRequestStates: [],
  hiddenPriorities: [],
  hiddenPredecessorStates: [],
  hiddenDuplicates: [],
};

/**
 * The board as the stores and watchers have it now: the Sprint timeline draws the same cards, so the two tabs never
 * disagree
 */
export function currentBoard(
  store: WorkItemsStore,
  reviews: ReviewRequestsWatcher,
  myPullRequests: MyPullRequestsWatcher,
  kinds: readonly BoardKind[] = ALL_KINDS
): BoardModel {
  const now = new Date();
  const base = store.toViewModel(NO_FILTER);
  return buildBoard({
    status: base.status,
    error: base.error,
    workItems: base.workItems,
    myPullRequests: myPullRequests.models().items,
    reviews: reviews.models(),
    reviewsStatus: reviews.status,
    reviewsError: reviews.error,
    maxWaitHours: reviewSettings().maxWaitHours,
    iterations: base.iterations.map((iteration) => ({
      name: iteration.name,
      startDate: iteration.startDate,
      finishDate: iteration.finishDate,
      progress: sprintProgress(iteration.startDate, iteration.finishDate, now, workingDaysSetting()),
    })),
    kinds: [...kinds],
    showCompleted: settings().showCompleted,
    completed: myPullRequests.completedPullRequests(),
    now,
    look: settings().look,
    popoverDelay: settings().popoverDelay,
  });
}

/**
 * The Track board: an editor tab with the work of the sprint by station of the track. It only draws what the store,
 * My Pull Requests and the review requests already have (no request of its own, no polling): it redraws when they
 * change. The model is built by trackBoardModel.ts; the buttons run the sidebar's code (sharedMessages.ts)
 */
export class TrackBoardPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  /** The webview has loaded its script and asked for the state */
  private ready = false;
  private kinds: BoardKind[] = [...ALL_KINDS];
  /** The card to select once the board is drawn ("Open on board" of the Sprint timeline) */
  private select?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: WorkItemsStore,
    private readonly reviews: ReviewRequestsWatcher,
    private readonly myPullRequests: MyPullRequestsWatcher
  ) {}

  dispose(): void {
    this.panel?.dispose();
  }

  /** Opens the board, or shows it when it is already open */
  open(key?: string): void {
    withFeature('trackBoard', () => {
      this.select = key;
      if (this.panel) {
        this.panel.reveal();
        this.postSelect();
        return;
      }
      const panel = vscode.window.createWebviewPanel('totalflowx.trackBoard', 'Track board', vscode.ViewColumn.Active, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, 'dist'),
          vscode.Uri.joinPath(this.extensionUri, 'media'),
        ],
      });
      this.panel = panel;
      this.ready = false;
      panel.webview.html = this.html(panel.webview);
      panel.webview.onDidReceiveMessage(
        (message: BoardMessage) => void withFeature('trackBoard', () => this.onMessage(message))
      );
      panel.onDidDispose(() => {
        this.panel = undefined;
        this.ready = false;
      });
    });
  }

  /** Draws the board again from what the store and the watchers have now */
  post(): void {
    if (!this.panel || !this.ready) {
      return;
    }
    const update: BoardUpdate = {
      type: 'board',
      model: currentBoard(this.store, this.reviews, this.myPullRequests, this.kinds),
    };
    void this.panel.webview.postMessage(update);
  }

  private postSelect(): void {
    if (this.panel && this.ready && this.select) {
      const update: BoardUpdate = { type: 'select', key: this.select };
      void this.panel.webview.postMessage(update);
      this.select = undefined;
    }
  }

  private async onMessage(message: BoardMessage): Promise<void> {
    try {
      if (message.type === 'openTimeline') {
        await vscode.commands.executeCommand(OPEN_SPRINT_TIMELINE_COMMAND);
        return;
      }
      if (message.type === 'ready') {
        this.ready = true;
        this.post();
        this.postSelect();
        await this.store.ensureLoaded();
        return;
      }
      if (message.type === 'setShowCompleted') {
        // Rule BOARD-25: the change of the setting redraws both tabs (extension.ts)
        await setShowCompleted(message.show);
        return;
      }
      if (message.type === 'setBoardKinds') {
        this.kinds = ALL_KINDS.filter((kind) => message.kinds.includes(kind));
        this.post();
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
  <title>Track board</title>
</head>
<body class="board-page">
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset('dist', 'board.js')}"></script>
</body>
</html>`;
  }
}
