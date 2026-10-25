import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { setShowCompleted, settings, workingDaysSetting } from './config';
import { buildTeamBoard } from './teamBoardModel';
import { parsePeople } from './teamPeople';
import { groupByPerson, mergedPullRequests, shapeTeamItems, teamOfIteration, waitedOnBy } from './teamData';
import type { TeamWorkStore } from './teamWorkStore';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import { withFeature } from './requestContext';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { reviewSettings } from './reviewRequestsWatcher';
import { OPEN_SPRINT_TIMELINE_COMMAND } from './sprintTimelineModel';
import { isSharedMessage, runSharedMessage } from './sharedMessages';
import { sprintProgress } from './sprintCountdown';
import {
  ALL_KINDS,
  boardItems,
  buildBoard,
  mergedSince,
  type BoardKind,
  type BoardMessage,
  type BoardModel,
} from './trackBoardModel';
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

/** Without data yet the board is loading; a reload with data on screen is not shown (the lanes would jump) */
function teamStatus(status: TeamWorkStore['status'], hasData: boolean): TeamWorkStore['status'] {
  if (!hasData) {
    return status === 'error' ? 'error' : 'loading';
  }
  return status === 'loading' ? 'ready' : status;
}

/**
 * The board as the stores and watchers have it now: the Sprint timeline draws the same cards, so the two tabs never
 * disagree
 */
export function currentBoard(
  store: WorkItemsStore,
  reviews: ReviewRequestsWatcher,
  myPullRequests: MyPullRequestsWatcher,
  kinds: readonly BoardKind[] = ALL_KINDS,
  team?: TeamWorkStore
): BoardModel {
  const now = new Date();
  const base = store.toViewModel(NO_FILTER);
  const iterations = base.iterations.map((iteration) => ({
    name: iteration.name,
    startDate: iteration.startDate,
    finishDate: iteration.finishDate,
    progress: sprintProgress(iteration.startDate, iteration.finishDate, now, workingDaysSetting()),
  }));
  const scope = team?.scope ?? 'mine';
  const board = buildBoard({
    status: base.status,
    error: base.error,
    workItems: base.workItems,
    myPullRequests: myPullRequests.models().items,
    reviews: reviews.models(),
    reviewsStatus: reviews.status,
    reviewsError: reviews.error,
    maxWaitHours: reviewSettings().maxWaitHours,
    iterations,
    kinds: [...kinds],
    showCompleted: settings().showCompleted,
    completed: myPullRequests.completedPullRequests(),
    now,
    look: settings().look,
    popoverDelay: settings().popoverDelay,
    scope,
  });
  if (!team || scope !== 'team') {
    return board;
  }
  // Rules TEAM-1..8, BOARD-26..30
  const snapshot = team.snapshot;
  const items = snapshot
    ? shapeTeamItems(snapshot, {
        ownIds: new Set(store.workItems.map((entry) => entry.workItem.id)),
        baseBranch: settings().baseBranch,
        staleAfterWorkingDays: settings().alerts.staleAfterWorkingDays,
        workingDays: workingDaysSetting(),
        now,
      })
    : [];
  const own = boardItems(base.workItems, kinds);
  return {
    ...board,
    team: buildTeamBoard({
      // A reload with data on screen does not show "Loading…": the lanes would jump
      status: teamStatus(team.status, snapshot !== undefined),
      error: team.error,
      selected: team.selection,
      chosen: team.people,
      candidates: team.candidates,
      membersLoading: team.membersLoading,
      people: snapshot ? groupByPerson(items, snapshot) : [],
      own: {
        items: own,
        cards: board.work,
        collapsedIds: board.summary.ids,
        badges: new Map(snapshot ? own.map((item) => [item.id, teamOfIteration(item.iterationPath, snapshot)]) : []),
      },
      reviews: board.reviews,
      kinds: [...kinds],
      showCompleted: settings().showCompleted,
      completed: snapshot ? mergedPullRequests(snapshot) : [],
      since: mergedSince(iterations, now.getTime()),
      rules: { ...reviewSettings(), workingDays: workingDaysSetting() },
      waitedOn: waitedOnBy(
        store.workItems.map((entry) => ({
          id: entry.workItem.id,
          predecessorIds: entry.workItem.links.predecessorIds,
        }))
      ),
      now,
      youName: store.workItems.at(0)?.workItem.assignedTo?.replace(/\s+EXT$/i, ''),
    }),
  };
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
    private readonly myPullRequests: MyPullRequestsWatcher,
    private readonly team: TeamWorkStore
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
      panel.onDidChangeViewState(() => this.post());
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
      model: currentBoard(this.store, this.reviews, this.myPullRequests, this.kinds, this.team),
    };
    void this.panel.webview.postMessage(update);
    // Rule TEAM-8: the team data is only asked for by a visible tab in "Whole team"
    if (this.panel.visible && this.team.scope === 'team') {
      this.team.request();
    }
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
      if (message.type === 'setTeamScope') {
        await this.team.setScope(message.scope);
        return;
      }
      if (message.type === 'setTeamPeople') {
        // Rule TEAM-1: the webview posts the list it shows; what is not a person is dropped
        await this.team.setPeople(parsePeople(message.people));
        return;
      }
      if (message.type === 'openTeamPullRequest') {
        // Only the PR pages of the organization: the URL comes from a webview
        if (message.url.startsWith('https://dev.azure.com/')) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
        return;
      }
      if (message.type === 'refresh') {
        this.team.forceReload();
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
