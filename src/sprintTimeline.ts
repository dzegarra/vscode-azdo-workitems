import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { resolveContext, setTimelineDensity, settings, workingDaysSetting } from './config';
import { KeyedReads } from './keyedReads';
import { stateChanges, type StateChange } from './workItemStateHistory';
import { commitTimes } from './codingStart';
import { mapLimit, MAX_IN_FLIGHT } from './concurrency';
import {
  asOfMoment,
  axisIteration,
  endedText,
  PAST_SPRINTS,
  sprintChoices,
  type CurrentIteration,
  type SprintChoice,
} from './pastSprints';
import type { ScheduledIteration } from './schedule';
import type { WorkItemModel } from './viewModel';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import { PullRequestHistory } from './pullRequestHistory';
import { withFeature } from './requestContext';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { reviewSettings } from './reviewRequestsWatcher';
import { sprintProgress } from './sprintCountdown';
import {
  buildSprintTimeline,
  historyRefsOf,
  OPEN_SPRINT_TIMELINE_COMMAND,
  type TimelineMessage,
  type TimelineInput,
  type TimelineModel,
} from './sprintTimelineModel';
import type { ThreadResponse } from './reviewThreads';
import {
  groupByPerson,
  shapeTeamItems,
  teamCompletedPullRequests,
  teamOfIteration,
  waitedOnBy,
  type TeamSnapshot,
} from './teamData';
import { parsePeople } from './teamPeople';
import { buildWholeTeamTimeline, type TeamTimelineInput } from './teamTimelineModel';
import type { TeamWorkStore } from './teamWorkStore';
import { ALL_KINDS, boardItems, buildBoard } from './trackBoardModel';
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
 * PRs it draws when the setting needs it (Rule TIMELINE-14), the state history of the work items it draws (one request
 * per work item and revision, Rule TIMELINE-35), and the history of the PRs of the rows the user expanded: their threads (not asked for my own PRs, My Pull Requests has
 * them) and the whole history of their CI runs, only while the tab is visible (Rule TIMELINE-29)
 */
export class SprintTimelinePanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  /** Rule TIMELINE-18: the work items whose rows are expanded in the webview (it tells us when they change) */
  private expanded = new Set<number>();
  /** Rule TIMELINE-29: the history of the PRs of the expanded rows */
  private readonly history: PullRequestHistory;
  /** Rule TIMELINE-35: the changes of state of the work items drawn, kept by revision */
  private readonly states: KeyedReads<StateChange[]>;
  /** Rule TIMELINE-37: the threads of the reviewed PRs the review poll does not have (the closed ones) */
  private readonly reviewedThreads: KeyedReads<ThreadResponse[]>;
  private readonly reviewedRepositories = new Map<number, string>();
  /** Rule TIMELINE-39: the PRs whose row the pointer reached, and the times of their commits (read on that hover) */
  private hovered = new Set<number>();
  private readonly commits: KeyedReads<number[]>;
  private readonly commitRepositories = new Map<number, string>();
  /** Rule TIMELINE-40: the sprint shown (0: the current one), the schedule the past ones come from, and their work */
  private offset = 0;
  private schedule?: ScheduledIteration[];
  private scheduleAsked = false;
  private readonly past: KeyedReads<TeamSnapshot>;
  private readonly pastChoicesAsked = new Map<number, SprintChoice>();

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
    this.states = new KeyedReads(
      (id) =>
        withFeature('sprintTimeline', async () => {
          await this.store.whenRepositoryReady();
          const { client } = resolveContext(this.store.repository());
          return stateChanges(await client.getWorkItemUpdates(id));
        }),
      () => this.post()
    );
    this.commits = new KeyedReads(
      (id) => this.readCommits(id),
      () => this.post()
    );
    this.past = new KeyedReads(
      (offset) => this.readPastSprint(offset),
      () => this.post()
    );
    this.reviewedThreads = new KeyedReads(
      (id) =>
        withFeature('sprintTimeline', async () => {
          await this.store.whenRepositoryReady();
          const { client } = resolveContext(this.store.repository());
          return client.getPullRequestThreads(this.reviewedRepositories.get(id) ?? '', id);
        }),
      () => this.post()
    );
  }

  /** The current iterations of the user's teams */
  private currentIterations(): CurrentIteration[] {
    return this.store
      .toViewModel({
        types: [],
        hiddenStates: [],
        hiddenPullRequestStates: [],
        hiddenPriorities: [],
        hiddenPredecessorStates: [],
        hiddenDuplicates: [],
      })
      .iterations.map((iteration) => ({
        name: iteration.name,
        path: iteration.path,
        teams: iteration.teams,
        startDate: iteration.startDate,
        finishDate: iteration.finishDate,
      }));
  }

  // Rule TIMELINE-40
  /** The current sprint and the ones before it (the schedule is read once when a past sprint is first wanted) */
  private choices(): SprintChoice[] {
    return sprintChoices(this.currentIterations(), this.schedule ?? this.store.iterationSchedule);
  }

  private loadSchedule(): void {
    if (this.scheduleAsked || this.store.iterationSchedule) {
      return;
    }
    this.scheduleAsked = true;
    void withFeature('sprintTimeline', async () => {
      try {
        await this.store.whenRepositoryReady();
        const { client } = resolveContext(this.store.repository());
        this.schedule = await client.getIterationSchedule();
        this.post();
      } catch {
        // Without the schedule the switch only has the current sprint; Refresh asks again
        this.scheduleAsked = false;
      }
    });
  }

  // Rule TIMELINE-41
  /**
   * The user's work of a past sprint as it was when it ended: the WIQL of the sidebar ASOF the end of its last day, the
   * work items and their tasks asOf that moment, and the PRs linked to them (6 at a time). Read once per sprint
   */
  private readPastSprint(offset: number): Promise<TeamSnapshot> {
    return withFeature('sprintTimeline', async () => {
      const choice = this.pastChoicesAsked.get(offset);
      const asOf = choice && asOfMoment(choice.iterations);
      if (!choice || !asOf) {
        throw new Error('The dates of this sprint are not known');
      }
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      const all = await client.getMyWorkItems(
        choice.iterations.map((iteration) => iteration.path),
        asOf
      );
      const items = all.filter(
        (item) => ['Product Backlog Item', 'Bug'].includes(item.type) && item.state !== 'Removed'
      );
      const children = await client.getWorkItems([...new Set(items.flatMap((item) => item.links.childIds))], asOf);
      const links = [
        ...new Map(
          [...items, ...children].flatMap((item) => item.links.pullRequests).map((link) => [link.id, link])
        ).values(),
      ];
      const read = await mapLimit(links, MAX_IN_FLIGHT, (link) => client.getPullRequest(link.id, link.projectId));
      return {
        teams: [],
        iterations: [],
        items,
        children,
        pullRequests: read.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
        runs: new Map(),
        publishedAt: new Map(),
        myId: await client.getMyId(),
        fetchedAt: Date.now(),
      };
    });
  }

  // Rule TIMELINE-39
  private readCommits(id: number): Promise<number[]> {
    return withFeature('sprintTimeline', async () => {
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      return commitTimes(await client.getPullRequestCommits(this.commitRepositories.get(id) ?? '', id));
    });
  }

  // Rule TIMELINE-37
  /** The PRs the user reviewed, with the threads known (the poll's) and read (the others') */
  private reviewedInput(): TimelineInput['reviewed'] {
    const reviewed = this.reviews.timelineReviewed();
    if (!reviewed.myId) {
      return undefined;
    }
    reviewed.pullRequests.forEach((pr) => this.reviewedRepositories.set(pr.id, pr.repositoryId));
    const threads = new Map([...this.reviewedThreads.snapshot(), ...reviewed.knownThreads]);
    return {
      pullRequests: reviewed.pullRequests,
      threads,
      loading: new Set(reviewed.pullRequests.map((pr) => pr.id).filter((id) => this.reviewedThreads.loading(id))),
      myId: reviewed.myId,
      myName: reviewed.myName ?? 'You',
    };
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
        this.hovered = new Set();
        this.offset = 0;
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
    const choices = this.choices();
    const sprints = choices.map(({ offset, title }) => ({ offset, title }));
    const pastChoice = choices.find((choice) => choice.offset === this.offset && choice.offset > 0);
    if (pastChoice) {
      return this.buildPastModel(pastChoice, sprints);
    }
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
      sprints,
      sprintOffset: 0,
      completedPullRequests: this.myPullRequests.completedPullRequests(),
      codingStart: settings().timelineCodingStart,
      firstCommits: this.myPullRequests.firstCommitDates(),
      history: this.history.snapshot(),
      stateHistory: this.states.snapshot(),
      hovered: this.hovered,
      commits: this.commits.snapshot(),
      detailsLoading: new Set([...this.hovered].filter((id) => this.commits.loading(id))),
      statesLoading: this.states.loadingIds(),
      reviewed: this.reviewedInput(),
      base: {
        branch: settings().baseBranch,
        enabled: settings().baseBranchAlert.enabled,
        runs: this.store.baseBranchHistory,
        health: base,
      },
    });
  }

  // Rules TIMELINE-40, TIMELINE-41
  /**
   * A past sprint: the user's work as it was when it ended, drawn as history (no NOW, no buttons, no reviews owed).
   * Whole team shows the current sprint only for now: a past sprint shows the user's own work with a note
   */
  private buildPastModel(choice: SprintChoice, sprints: { offset: number; title: string }[]): TimelineModel {
    const asOf = asOfMoment(choice.iterations);
    const end = new Date(Math.min(Date.now(), asOf ? Date.parse(asOf) : Date.now()));
    const data = this.past.get(choice.offset);
    const workItems = data
      ? shapeTeamItems(data, {
          ownIds: new Set(),
          baseBranch: settings().baseBranch,
          staleAfterWorkingDays: settings().alerts.staleAfterWorkingDays,
          workingDays: workingDaysSetting(),
          now: end,
        }).map((item) => item.model)
      : [];
    let status: TimelineModel['status'] = data ? 'ready' : 'loading';
    if (!data && this.past.failed(choice.offset)) {
      status = 'error';
    }
    const board = buildBoard({
      status,
      error: status === 'error' ? `The work items of ${choice.title} could not be read` : undefined,
      workItems,
      myPullRequests: [],
      reviews: [],
      reviewsStatus: 'ready',
      maxWaitHours: reviewSettings().maxWaitHours,
      iterations: choice.iterations.map((iteration) => ({ ...iteration, teams: [...(iteration.teams ?? [])] })),
      kinds: [...ALL_KINDS],
      showCompleted: true,
      completed: [],
      now: end,
      look: settings().look,
      popoverDelay: settings().popoverDelay,
      scope: 'mine',
    });
    const axis = axisIteration(choice.iterations);
    const model = buildSprintTimeline({
      now: end,
      workingDays: workingDaysSetting(),
      maxWaitHours: reviewSettings().maxWaitHours,
      board,
      workItems,
      myPullRequests: [],
      reviews: [],
      sprint: axis,
      density: densityOf(this.team.scope, settings().timelineDensity),
      sprints,
      sprintOffset: choice.offset,
      past: { ended: endedText(axis?.finishDate) },
      scope: this.team.scope,
      completedPullRequests: data ? teamCompletedPullRequests(data) : [],
      codingStart: 'taskActivated',
      history: this.history.snapshot(),
      stateHistory: this.states.snapshot(),
      hovered: this.hovered,
      commits: this.commits.snapshot(),
      detailsLoading: new Set([...this.hovered].filter((id) => this.commits.loading(id))),
      statesLoading: this.states.loadingIds(),
      reviewed: this.reviewedInput(),
      base: {
        branch: settings().baseBranch,
        enabled: settings().baseBranchAlert.enabled,
        runs: this.store.baseBranchHistory,
        health: undefined,
      },
    });
    const notes = [
      ...model.notes,
      ...(this.team.scope === 'team' ? ['Whole team shows the current sprint only: this is your own work'] : []),
    ];
    return { ...model, notes };
  }

  /** Draws the timeline again from what the store and the watchers have now */
  post(): void {
    if (!this.panel || !this.ready || !this.panel.visible) {
      return;
    }
    const sprint = this.sprint();
    // Rule TIMELINE-40: the schedule gives the past sprints; a past sprint shown is read once
    this.loadSchedule();
    const choice = this.offset > 0 ? this.choices().find((candidate) => candidate.offset === this.offset) : undefined;
    if (choice) {
      this.pastChoicesAsked.set(choice.offset, choice);
      this.past.request([
        {
          id: choice.offset,
          key: `${choice.iterations.map((iteration) => iteration.path).join('|')}@${
            asOfMoment(choice.iterations) ?? ''
          }`,
        },
      ]);
    }
    let model = this.buildModel(sprint);
    // Only while the tab is visible, each once per immutable key; the rows say they are loading in this very draw:
    // Rule TIMELINE-29, the history of the PRs of the expanded rows; Rule TIMELINE-35, the state history of the work
    // items drawn; Rule TIMELINE-37, the threads of the reviewed PRs the review poll did not read (the closed ones)
    const known = this.reviews.timelineReviewed().knownThreads;
    const started = [
      this.history.request(historyRefsOf(model, this.expanded)),
      this.states.request(model.statesWanted),
      this.reviewedThreads.request(model.reviewedWanted.filter((wanted) => !known.has(wanted.id))),
      // Rule TIMELINE-39: the commits of the PRs hovered (their tasks' histories are among the states above)
      this.commits.request(
        model.commitsWanted.flatMap((wanted) => {
          if (wanted.repositoryId === undefined) {
            return [];
          }
          this.commitRepositories.set(wanted.id, wanted.repositoryId);
          return [{ id: wanted.id, key: wanted.key }];
        })
      ),
    ];
    if (started.some(Boolean)) {
      model = this.buildModel(sprint);
    }
    // Rule TIMELINE-37: the closed reviewed PRs, one listing at most every 10 minutes
    void this.reviews.loadReviewedForTimeline().then((changed) => {
      if (changed) {
        this.post();
      }
    });
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
      if (message.type === 'setSprint') {
        // Rule TIMELINE-40: the current sprint or one of the 4 before it
        if (Number.isInteger(message.offset) && message.offset >= 0 && message.offset <= PAST_SPRINTS) {
          this.offset = message.offset;
          this.post();
        }
        return;
      }
      if (message.type === 'hoverPullRequest') {
        // Rule TIMELINE-39: the first hover of a PR row reads its commits and its task's history (once per key)
        if (Number.isInteger(message.prId) && !this.hovered.has(message.prId)) {
          this.hovered = new Set([...this.hovered, message.prId]);
          this.post();
        }
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
        // Rule TIMELINE-41: Refresh reads the past sprint shown again
        if (this.offset > 0) {
          this.past.forget(this.offset);
          this.post();
        }
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
