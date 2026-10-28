import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { resolveContext, setTimelineDensity, settings, workingDaysSetting } from './config';
import { KeyedReads } from './keyedReads';
import { stateChanges, type StateChange, type WorkItemUpdate } from './workItemStateHistory';
import { sprintMembership, type SprintMembership } from './sprintMembership';
import { commitTimes } from './codingStart';
import { iterationDates } from './sprintTitle';
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
import type { WorkItem } from './azdoClient';
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
  type SprintSwitchEntry,
  type TimelineInput,
  type TimelineModel,
} from './sprintTimelineModel';
import type { ThreadResponse } from './reviewThreads';
import {
  groupByPerson,
  pullRequestInfo,
  shapeTeamItems,
  teamCompletedPullRequests,
  teamOfIteration,
  waitedOnBy,
  type TeamSnapshot,
} from './teamData';
import { parsePeople, queryIdentity } from './teamPeople';
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
/** Rules TIMELINE-41, TIMELINE-43: the work of a past sprint, what each work item's history says, its changes of state */
interface PastRead {
  snapshot: TeamSnapshot;
  membership: Map<number, SprintMembership>;
  changes: Map<number, StateChange[]>;
}

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
  private readonly past: KeyedReads<PastRead>;
  private readonly pastTeam: KeyedReads<PastRead>;
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
    this.pastTeam = new KeyedReads(
      (offset) => this.readPastTeam(offset),
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

  // Rules TIMELINE-41, TIMELINE-43
  /** The user's work of a past sprint: every work item that was in it (see `readPast`). Read once per sprint */
  private readPastSprint(offset: number): Promise<PastRead> {
    return withFeature('sprintTimeline', async () => {
      const { choice, asOf } = this.pastChoice(offset);
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      const paths = choice.iterations.map((iteration) => iteration.path);
      return this.readPast(client, choice, asOf, {
        assignees: '@Me',
        ids: new Set([await client.getMyId()]),
        atTheEnd: () => client.getMyWorkItems(paths, asOf),
      });
    });
  }

  // Rules TIMELINE-41, TIMELINE-43, TEAM-2
  /** The work of the people chosen in a past sprint (the same reads as the user's own) */
  private readPastTeam(offset: number): Promise<PastRead> {
    return withFeature('teamView', async () => {
      const { choice, asOf } = this.pastChoice(offset);
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      const people = this.team.people.map(queryIdentity);
      const paths = choice.iterations.map((iteration) => iteration.path);
      if (!people.length) {
        return {
          snapshot: await this.pastSnapshot(client, [], asOf, choice),
          membership: new Map(),
          changes: new Map(),
        };
      }
      return this.readPast(client, choice, asOf, {
        assignees: people,
        ids: new Set(this.team.people.map((person) => person.id)),
        atTheEnd: () => client.getTeamWorkItems(paths, people, asOf),
      });
    });
  }

  // Rules TIMELINE-43, TIMELINE-44
  /**
   * Every work item that was in a past sprint: the WIQL `EVER` gives the candidates, the history of each (one request
   * per work item, 6 at a time) keeps those that were in one of its iterations, assigned to one of the people, at some
   * moment between its start and its end. They are read as they were at the end, or, those that left before, just
   * before they left. If WIQL refuses `EVER`, the work items as of the end only (Rule TIMELINE-41)
   */
  private async readPast(
    client: ReturnType<typeof resolveContext>['client'],
    choice: SprintChoice,
    asOf: string,
    who: { assignees: readonly string[] | '@Me'; ids: ReadonlySet<string>; atTheEnd: () => Promise<WorkItem[]> }
  ): Promise<PastRead> {
    const paths = choice.iterations.map((iteration) => iteration.path);
    let candidates: number[];
    try {
      candidates = await client.getEverWorkItemIds(paths, who.assignees);
    } catch {
      return {
        snapshot: await this.pastSnapshot(client, await who.atTheEnd(), asOf, choice),
        membership: new Map(),
        changes: new Map(),
      };
    }
    const starts = choice.iterations.flatMap((iteration) => iteration.startDate ?? []).sort();
    const sprint = {
      paths: new Set(paths),
      people: who.ids,
      start: Date.parse(starts.at(0) ?? asOf),
      end: Date.parse(asOf),
    };
    const histories = await mapLimit(candidates, MAX_IN_FLIGHT, (id) => client.getWorkItemUpdates(id));
    const membership = new Map<number, SprintMembership>();
    const changes = new Map<number, StateChange[]>();
    histories.forEach((result, index) => {
      if (result.status === 'rejected') {
        // A history not read: the sprint is read again later (or on Refresh), rather than drawn without it
        throw new Error('The history of a work item could not be read');
      }
      const updates: WorkItemUpdate[] = result.value;
      const found = sprintMembership(updates, sprint);
      if (found) {
        membership.set(candidates[index], found);
        changes.set(candidates[index], stateChanges(updates));
      }
    });
    const stayed = [...membership].filter(([, found]) => !found.left).map(([id]) => id);
    const left = [...membership].flatMap(([id, found]) => (found.left ? [{ id, at: found.left.at }] : []));
    const before = await mapLimit(left, MAX_IN_FLIGHT, ({ id, at }) =>
      client.getWorkItems([id], new Date(at - 1).toISOString())
    );
    const all = [
      ...(await client.getWorkItems(stayed, asOf)),
      ...before.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    ];
    return { snapshot: await this.pastSnapshot(client, all, asOf, choice), membership, changes };
  }

  /** The changes of state read with the histories of a past sprint (the user's and the people's) */
  private pastChanges(offset: number): Map<number, StateChange[]> {
    return new Map([...(this.pastTeam.get(offset)?.changes ?? []), ...(this.past.get(offset)?.changes ?? [])]);
  }

  private pastChoice(offset: number): { choice: SprintChoice; asOf: string } {
    const choice = this.pastChoicesAsked.get(offset);
    const asOf = choice && asOfMoment(choice.iterations);
    if (!choice || !asOf) {
      throw new Error('The dates of this sprint are not known');
    }
    return { choice, asOf };
  }

  /** The Backlog Items and Bugs read, their tasks asOf the same moment and the PRs linked to them (6 at a time) */
  private async pastSnapshot(
    client: ReturnType<typeof resolveContext>['client'],
    all: WorkItem[],
    asOf: string,
    choice: SprintChoice
  ): Promise<TeamSnapshot> {
    const items = all.filter((item) => ['Product Backlog Item', 'Bug'].includes(item.type) && item.state !== 'Removed');
    const children = await client.getWorkItems([...new Set(items.flatMap((item) => item.links.childIds))], asOf);
    const links = [
      ...new Map(
        [...items, ...children].flatMap((item) => item.links.pullRequests).map((link) => [link.id, link])
      ).values(),
    ];
    const read = await mapLimit(links, MAX_IN_FLIGHT, (link) => client.getPullRequest(link.id, link.projectId));
    // The teams of the current Whole team data, each in its iteration of that sprint (their badges)
    const teams = (this.team.snapshot?.teams ?? []).map((team) => ({
      ...team,
      iterationPath: choice.iterations.find((iteration) => iteration.teams?.includes(team.name))?.path,
    }));
    return {
      teams,
      iterations: choice.iterations.map((iteration) => ({
        name: iteration.name,
        path: iteration.path,
        startDate: iteration.startDate,
        finishDate: iteration.finishDate,
        teams: [...(iteration.teams ?? [])],
      })),
      items,
      children,
      pullRequests: read.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
      runs: new Map(),
      publishedAt: new Map(),
      myId: await client.getMyId(),
      fetchedAt: Date.now(),
    };
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
  private teamInput(
    workItems: WorkItemModel[],
    source: {
      snapshot: TeamSnapshot | undefined;
      status: TeamTimelineInput['status'];
      ownIds: ReadonlySet<number>;
      now: Date;
    } = {
      snapshot: this.team.snapshot,
      status: teamStatus(this.team.status, this.team.snapshot !== undefined),
      ownIds: new Set(this.store.workItems.map((entry) => entry.workItem.id)),
      now: new Date(),
    }
  ): TeamTimelineInput | undefined {
    if (this.team.scope !== 'team') {
      return undefined;
    }
    const { snapshot, now } = source;
    const items = snapshot
      ? shapeTeamItems(snapshot, {
          ownIds: source.ownIds,
          baseBranch: settings().baseBranch,
          staleAfterWorkingDays: settings().alerts.staleAfterWorkingDays,
          workingDays: workingDaysSetting(),
          now,
        })
      : [];
    return {
      status: source.status,
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
    const sprints = choices.map(({ offset, title, iterations }) => {
      const axis = axisIteration(iterations);
      return { offset, title, dates: axis && iterationDates(axis) };
    });
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
      // Rule TIMELINE-17: the dates of the PRs linked to the work items that My Pull Requests does not list
      pullRequestInfo: new Map(
        this.store.workItems
          .flatMap((entry) => [...entry.pullRequests, ...entry.otherTasks.flatMap((task) => task.pullRequests)])
          .map((pr) => [pr.pullRequestId, pullRequestInfo(pr, { publishedAt: new Map() })])
      ),
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
   * A past sprint: the user's work, and in Whole team the work of the people chosen, as it was when it ended, drawn as
   * history (no NOW, no buttons, no reviews owed)
   */
  private buildPastModel(choice: SprintChoice, sprints: SprintSwitchEntry[]): TimelineModel {
    const asOf = asOfMoment(choice.iterations);
    const end = new Date(Math.min(Date.now(), asOf ? Date.parse(asOf) : Date.now()));
    const read = this.past.get(choice.offset);
    const data = read?.snapshot;
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
    // Rule TIMELINE-41: in Whole team, the people chosen as their work was when the sprint ended
    const teamRead = this.pastTeam.get(choice.offset);
    const teamData = teamRead?.snapshot;
    let teamState: TeamTimelineInput['status'] = teamData ? 'ready' : 'loading';
    if (!teamData && this.pastTeam.failed(choice.offset)) {
      teamState = 'error';
    }
    const teamInput = this.teamInput(workItems, {
      snapshot: teamData,
      status: teamState,
      ownIds: new Set(workItems.map((item) => item.id)),
      now: end,
    });
    const model = buildWholeTeamTimeline({
      team: teamInput && { ...teamInput, membership: teamRead?.membership },
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
      past: { ended: endedText(axis?.finishDate), membership: read?.membership },
      scope: this.team.scope,
      completedPullRequests: data ? teamCompletedPullRequests(data) : [],
      // Rule TIMELINE-17: the open (or abandoned) PRs of a past sprint have their dates too
      pullRequestInfo: new Map(
        (data?.pullRequests ?? []).map((pr) => [pr.pullRequestId, pullRequestInfo(pr, { publishedAt: new Map() })])
      ),
      codingStart: 'taskActivated',
      history: this.history.snapshot(),
      // Rule TIMELINE-43: the histories read to know which work items were in the sprint give their states too
      stateHistory: new Map([...this.states.snapshot(), ...this.pastChanges(choice.offset)]),
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
    return model;
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
      const key = `${choice.iterations.map((iteration) => iteration.path).join('|')}@${
        asOfMoment(choice.iterations) ?? ''
      }`;
      this.past.request([{ id: choice.offset, key }]);
      // Rule TIMELINE-41: in Whole team, the people chosen too (read again when the people change)
      if (this.team.scope === 'team') {
        this.pastTeam.request([
          { id: choice.offset, key: `${key}#${this.team.people.map((person) => person.id).join(',')}` },
        ]);
      }
    }
    let model = this.buildModel(sprint);
    // Only while the tab is visible, each once per immutable key; the rows say they are loading in this very draw:
    // Rule TIMELINE-29, the history of the PRs of the expanded rows; Rule TIMELINE-35, the state history of the work
    // items drawn; Rule TIMELINE-37, the threads of the reviewed PRs the review poll did not read (the closed ones)
    const known = this.reviews.timelineReviewed().knownThreads;
    const started = [
      this.history.request(historyRefsOf(model, this.expanded)),
      this.states.request(
        model.statesWanted.filter((wanted) => this.offset === 0 || !this.pastChanges(this.offset).has(wanted.id))
      ),
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
          this.pastTeam.forget(this.offset);
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
