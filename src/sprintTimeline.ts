import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { setTimelineDensity, settings, workingDaysSetting } from './config';
import type { WorkItemModel } from './viewModel';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import { PullRequestHistory } from './pullRequestHistory';
import { withFeature } from './requestContext';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { reviewSettings } from './reviewRequestsWatcher';
import { sprintProgress } from './sprintCountdown';
import {
  historyRefsOf,
  OPEN_SPRINT_TIMELINE_COMMAND,
  type TimelineMessage,
  type TimelineModel,
} from './sprintTimelineModel';
import { groupByPerson, shapeTeamItems, teamCompletedPullRequests, teamOfIteration, waitedOnBy } from './teamData';
import { parsePeople } from './teamPeople';
import { buildWholeTeamTimeline, type TeamTimelineInput } from './teamTimelineModel';
import type { TeamWorkStore } from './teamWorkStore';
import { ALL_KINDS, boardItems } from './trackBoardModel';
import { isSharedMessage, runSharedMessage } from './sharedMessages';
import { densityOf, normalizeTimelineDensity } from './timelineDensity';
import { currentBoard, OPEN_TRACK_BOARD_COMMAND, teamStatus } from './trackBoard';
import type { WorkItemsStore } from './workItemsStore';

export { OPEN_SPRINT_TIMELINE_COMMAND };

/** What the panel posts to its webview */
export type TimelineUpdate = { type: 'timeline'; model: TimelineModel };

/**
 * The Sprint timeline: an editor tab with the work of the sprint on a working-days axis. It draws what the store, My
 * Pull Requests, the review requests and the base branch runs already have. Its own requests are the first commit of the
 * PRs it draws when the setting needs it (Rule TIMELINE-14), and the history of the PRs of the rows the user expanded: their threads (not asked for my own PRs, My Pull Requests has
 * them) and the whole history of their CI runs, only while the tab is visible (Rule TIMELINE-29)
 */
export class SprintTimelinePanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  /** Rule TIMELINE-18: the work items whose rows are expanded in the webview (it tells us when they change) */
  private expanded = new Set<number>();
  /** Rule TIMELINE-29: the history of the PRs of the expanded rows */
  private readonly history: PullRequestHistory;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: WorkItemsStore,
    private readonly reviews: ReviewRequestsWatcher,
    private readonly myPullRequests: MyPullRequestsWatcher,
    private readonly team: TeamWorkStore
  ) {
    this.history = new PullRequestHistory(
      store,
      () => myPullRequests.knownThreads(),
      () => this.post()
    );
  }

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
        // A new tab starts with its own rows collapsed or expanded: it tells which
        this.expanded = new Set();
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

  // Rules TIMELINE-21..24
  /** What the Whole team timeline needs, from the data the store of the team already has (no request here) */
  private teamInput(workItems: WorkItemModel[]): TeamTimelineInput | undefined {
    if (this.team.scope !== 'team') {
      return undefined;
    }
    const now = new Date();
    const snapshot = this.team.snapshot;
    const items = snapshot
      ? shapeTeamItems(snapshot, {
          ownIds: new Set(this.store.workItems.map((entry) => entry.workItem.id)),
          baseBranch: settings().baseBranch,
          staleAfterWorkingDays: settings().alerts.staleAfterWorkingDays,
          workingDays: workingDaysSetting(),
          now,
        })
      : [];
    return {
      status: teamStatus(this.team.status, snapshot !== undefined),
      error: this.team.error,
      teamCount: this.team.selection.length,
      chosen: this.team.people,
      candidates: this.team.candidates,
      membersLoading: this.team.membersLoading,
      people: snapshot ? groupByPerson(items, snapshot) : [],
      completed: snapshot ? teamCompletedPullRequests(snapshot) : [],
      kinds: [...ALL_KINDS],
      rules: { ...reviewSettings(), workingDays: workingDaysSetting() },
      waitedOn: waitedOnBy(
        this.store.workItems.map((entry) => ({
          id: entry.workItem.id,
          predecessorIds: entry.workItem.links.predecessorIds,
        }))
      ),
      ownBadges: new Map(
        snapshot
          ? boardItems(workItems, ALL_KINDS).map((item) => [item.id, teamOfIteration(item.iterationPath, snapshot)])
          : []
      ),
      youName: this.store.workItems.at(0)?.workItem.assignedTo?.replace(/\s+EXT$/i, ''),
    };
  }

  /** The model from what the store and the watchers have now, with the history read so far */
  private buildModel(sprint: ReturnType<SprintTimelinePanel['sprint']>): TimelineModel {
    const base = this.store.baseBranch;
    const workItems = this.store.toViewModel({
      types: [],
      hiddenStates: [],
      hiddenPullRequestStates: [],
      hiddenPriorities: [],
      hiddenPredecessorStates: [],
      hiddenDuplicates: [],
    }).workItems;
    return buildWholeTeamTimeline({
      now: new Date(),
      workingDays: workingDaysSetting(),
      maxWaitHours: reviewSettings().maxWaitHours,
      // Rule TIMELINE-19: the timeline always draws the finished work items and the merged PRs (no Completed chip)
      board: currentBoard(this.store, this.reviews, this.myPullRequests, undefined, undefined, true),
      workItems,
      scope: this.team.scope,
      team: this.teamInput(workItems),
      myPullRequests: this.myPullRequests.models().items,
      reviews: this.reviews.models(),
      sprint,
      density: densityOf(this.team.scope, settings().timelineDensity),
      completedPullRequests: this.myPullRequests.completedPullRequests(),
      codingStart: settings().timelineCodingStart,
      firstCommits: this.myPullRequests.firstCommitDates(),
      history: this.history.snapshot(),
      base: {
        branch: settings().baseBranch,
        enabled: settings().baseBranchAlert.enabled,
        runs: this.store.baseBranchHistory,
        health: base,
      },
    });
  }

  /** Draws the timeline again from what the store and the watchers have now */
  post(): void {
    if (!this.panel || !this.ready || !this.panel.visible) {
      return;
    }
    const sprint = this.sprint();
    let model = this.buildModel(sprint);
    // Rule TIMELINE-29: the history of the PRs of the expanded rows, only while the tab is visible; the rows say they
    // are loading in this very draw
    if (this.history.request(historyRefsOf(model, this.expanded))) {
      model = this.buildModel(sprint);
    }
    const update: TimelineUpdate = { type: 'timeline', model };
    void this.panel.webview.postMessage(update);
    // Rule TIMELINE-26: the team data is only asked for by a visible tab in "Whole team"
    if (this.team.scope === 'team') {
      this.team.request();
    }
    if (model.firstCommitsWanted.length) {
      // Rule TIMELINE-20: the first commit of the PRs drawn, only while the tab is visible and the setting reads commits
      void this.myPullRequests.loadFirstCommits(model.firstCommitsWanted).then((read) => {
        if (read) {
          this.post();
        }
      });
    }
  }

  private async onMessage(message: TimelineMessage): Promise<void> {
    try {
      if (message.type === 'ready') {
        this.ready = true;
        this.post();
        await this.store.ensureLoaded();
        return;
      }
      if (message.type === 'setTimelineDensity') {
        // Rule TIMELINE-32: the style of the view shown; the change of the setting redraws the tab (extension.ts)
        await setTimelineDensity(this.team.scope, normalizeTimelineDensity(message.density, 'normal'));
        return;
      }
      if (message.type === 'setExpanded') {
        // Rule TIMELINE-18: the webview posts the expanded work items when they change; their PRs' history is read now
        this.expanded = new Set(message.ids.filter((id) => Number.isInteger(id)));
        this.post();
        return;
      }
      if (message.type === 'openTeamPullRequest') {
        // Only the PR pages of the organization: the URL comes from a webview
        if (message.url.startsWith('https://dev.azure.com/')) {
          await vscode.env.openExternal(vscode.Uri.parse(message.url));
        }
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
      if (message.type === 'refresh') {
        this.team.forceReload();
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
