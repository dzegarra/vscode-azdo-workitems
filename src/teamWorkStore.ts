import * as vscode from 'vscode';
import type { PullRequestDetails, Team } from './azdoClient';
import { mapLimit, MAX_IN_FLIGHT } from './concurrency';
import { resolveContext, setTeamPeople, settings, workingDaysSetting } from './config';
import { mergeTeamIterations, type Iteration, type TeamIteration } from './iterations';
import { latestRuns, type RunModel } from './pipelines';
import { withFeature } from './requestContext';
import { lastPublishedFromDraft, timeLeftMs } from './reviewRequests';
import { reviewSettings } from './reviewRequestsWatcher';
import {
  attemptKey,
  completedLinked,
  earliestStart,
  pullRequestsToFetch,
  runsAreFinal,
  runsCacheKey,
  type TeamIterationInfo,
  type TeamSnapshot,
} from './teamData';
import { mergeCandidates, queryIdentity, type PickedPerson } from './teamPeople';
import { parseScope, shownTeams, TEAM_SCOPE_KEY, teamBadges, type TeamScope } from './teamView';
import type { WorkItemsStore } from './workItemsStore';

/** The teams, their members and the current iteration of a team change rarely: asked again after this long */
const TEAMS_TTL_MS = 60 * 60 * 1000;
/** PRs whose threads are read per refresh at most, to correct their publication date (Rule TEAM-6) */
const MAX_THREAD_CHECKS = 20;

/**
 * The work of the people chosen for the Track board (and, later, the Sprint timeline): their Backlog Items and Bugs of
 * the current sprints of the user's teams, their tasks, PRs and CI state. It fetches only when a view asks for it with
 * `request()` (a board tab that is open, visible and in "Whole team"), and only when something changed since the last
 * attempt (Rule TEAM-8): there is no timer. Everything it asks is attributed to the `teamView` feature
 */
export class TeamWorkStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  /** Fired when the scope, the selection or the data changed */
  readonly onDidChange = this.emitter.event;

  status: 'error' | 'loading' | 'ready' = 'ready';
  error?: string;
  snapshot?: TeamSnapshot;
  /** Every team of the user, with its badge; known after the first load */
  teams: { name: string; badge: string }[] = [];
  /** The members of the user's teams, without repeats: the candidates of the People picker (Rule TEAM-1) */
  members: PickedPerson[] = [];

  private loading?: Promise<void>;
  private lastAttempt?: string;
  private forced = 0;
  /** Never changes: asked once per session */
  private myId?: string;
  private teamsAt = 0;
  private membersAt = 0;
  private userTeams: Team[] = [];
  private readonly iterationCache = new Map<string, { at: number; iteration: Iteration | undefined }>();
  /** Completed and abandoned PRs never change: kept for the session */
  private readonly closedPullRequests = new Map<number, PullRequestDetails>();
  /** Linked PRs that could not be read: not asked again in this session */
  private readonly unreachable = new Set<number>();
  private readonly runsCache = new Map<string, RunModel[]>();
  /** PR id -> when it left draft ('' when it never was one) */
  private readonly publishedCache = new Map<number, string>();

  constructor(private readonly state: vscode.Memento, private readonly store: WorkItemsStore) {}

  dispose(): void {
    this.emitter.dispose();
  }

  get scope(): TeamScope {
    return parseScope(this.state.get(TEAM_SCOPE_KEY));
  }

  async setScope(scope: TeamScope): Promise<void> {
    await this.state.update(TEAM_SCOPE_KEY, scope);
    this.emitter.fire();
  }

  /** The teams whose sprints are read: the sidebar's teams, else all of the user's (Rule TEAM-1) */
  get selection(): string[] {
    const available = this.teams.length ? this.teams.map((team) => team.name) : this.userTeams.map((team) => team.name);
    return available.length ? shownTeams(available, settings().teams) : [...settings().teams];
  }

  /** The people chosen, from the settings; the user is always in the view and never listed */
  get people(): PickedPerson[] {
    return settings().teamPeople.filter((person) => person.id !== this.myId);
  }

  /** What the picker offers: the members of the teams and the people already chosen */
  get candidates(): PickedPerson[] {
    return mergeCandidates([this.people, this.members], this.myId);
  }

  /** The members have not been read yet */
  get membersLoading(): boolean {
    return this.status === 'loading' && this.membersAt === 0;
  }

  /** Saves the people in the user's settings; the change of the settings redraws the board (extension.ts) */
  async setPeople(people: PickedPerson[]): Promise<void> {
    await setTeamPeople(people);
    this.emitter.fire();
  }

  /** Asks to load the data if something changed since the last attempt. Cheap and safe to call on every redraw */
  request(): void {
    if (this.loading || this.store.status !== 'ready') {
      return;
    }
    const key = attemptKey(
      this.store.loadCount,
      this.people.map((person) => person.id),
      this.forced
    );
    if (key === this.lastAttempt) {
      return;
    }
    this.lastAttempt = key;
    this.loading = withFeature('teamView', () => this.load()).finally(() => {
      this.loading = undefined;
    });
  }

  /** The user pressed Refresh: the next request loads again even if the store did not */
  forceReload(): void {
    this.forced += 1;
    this.teamsAt = 0;
    this.iterationCache.clear();
  }

  private async load(): Promise<void> {
    const loads = this.store.loadCount;
    this.status = 'loading';
    this.error = undefined;
    this.emitter.fire();
    try {
      this.snapshot = await this.fetch();
      this.status = 'ready';
    } catch (error) {
      this.status = 'error';
      this.error = (error as Error).message;
    }
    // The user is known now (and so the people to show). Not a new attempt
    this.lastAttempt = attemptKey(
      loads,
      this.people.map((person) => person.id),
      this.forced
    );
    this.emitter.fire();
  }

  private async iterations(
    client: ReturnType<typeof resolveContext>['client'],
    names: string[]
  ): Promise<TeamIteration[]> {
    const now = Date.now();
    const known = new Map(
      this.store.iterations.flatMap(({ iteration, teams }) => teams.map((team) => [team, iteration]))
    );
    await Promise.all(
      names.map(async (team) => {
        const cached = this.iterationCache.get(team);
        if (known.has(team) || (cached && now - cached.at < TEAMS_TTL_MS)) {
          return;
        }
        this.iterationCache.set(team, { at: now, iteration: await client.getCurrentIteration(team) });
      })
    );
    return mergeTeamIterations(
      names.map((team) => ({ team, iteration: known.get(team) ?? this.iterationCache.get(team)?.iteration }))
    );
  }

  /** The members of every team of the user, once an hour: 1 request per team, at most 6 at once (Rule TEAM-1) */
  private async readMembers(client: ReturnType<typeof resolveContext>['client']): Promise<void> {
    if (this.members.length && Date.now() - this.membersAt < TEAMS_TTL_MS) {
      return;
    }
    const lists = await mapLimit(this.userTeams, MAX_IN_FLIGHT, (team) => client.getTeamMembers(team.id));
    const found = lists.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    // A team whose members cannot be read just offers fewer people
    this.members = mergeCandidates([found], undefined);
    this.membersAt = Date.now();
  }

  // Rules TEAM-2..7
  private async fetch(): Promise<TeamSnapshot> {
    await this.store.whenRepositoryReady();
    const { client } = resolveContext(this.store.repository());
    if (!this.userTeams.length || Date.now() - this.teamsAt > TEAMS_TTL_MS) {
      this.userTeams = await client.getTeams();
      this.teamsAt = Date.now();
    }
    const badges = teamBadges(this.userTeams.map((team) => team.name));
    this.teams = this.userTeams.map((team) => ({ name: team.name, badge: badges.get(team.name) ?? '' }));
    this.myId ??= await client.getMyId();
    const { myId } = this;
    await this.readMembers(client);
    const selected = this.selection;
    const people = this.people;
    const empty = (): TeamSnapshot => ({
      teams: this.teams.filter((team) => selected.includes(team.name)),
      iterations: [],
      items: [],
      children: [],
      pullRequests: [],
      runs: new Map(),
      publishedAt: new Map(),
      myId,
      fetchedAt: Date.now(),
    });
    // Rule TEAM-2: nobody chosen, nothing to ask
    if (!people.length) {
      return empty();
    }
    const iterations = await this.iterations(client, selected);
    const ownIds = new Set(this.store.workItems.map((entry) => entry.workItem.id));
    const all = await client.getTeamWorkItems(
      iterations.map(({ iteration }) => iteration.path),
      people.map(queryIdentity)
    );
    // Rule TEAM-4: the user's own work items come from the store, with no request of this view
    const items = all.filter((item) => !ownIds.has(item.id));
    const children = await client.getWorkItems([...new Set(items.flatMap((item) => item.links.childIds))]);
    const links = [...items, ...children].flatMap((item) => item.links.pullRequests);
    const active = new Map((await client.getActivePullRequests()).map((pr) => [pr.pullRequestId, pr]));
    await this.closedPullRequestsOf(
      client,
      links,
      active,
      earliestStart(iterations.map(({ iteration }) => ({ startDate: iteration.attributes?.startDate })))
    );
    const linked = new Set(links.map((link) => link.id));
    const pullRequests = [...linked].flatMap((id) => {
      const pr = active.get(id) ?? this.closedPullRequests.get(id);
      return pr ? [pr] : [];
    });
    const runs = await this.runs(client, pullRequests);
    const published = await this.published(client, pullRequests);
    const teams = this.teams.filter((team) => selected.includes(team.name));
    return {
      teams: teams.map((team) => ({
        ...team,
        iterationPath: iterations.find((iteration) => iteration.teams.includes(team.name))?.iteration.path,
      })),
      iterations: iterations.map(
        ({ iteration, teams: names }): TeamIterationInfo => ({
          name: iteration.name,
          path: iteration.path,
          startDate: iteration.attributes?.startDate,
          finishDate: iteration.attributes?.finishDate,
          teams: names,
        })
      ),
      items: all,
      children,
      pullRequests,
      runs,
      publishedAt: published,
      myId,
      fetchedAt: Date.now(),
    };
  }

  // Rules TEAM-3, TEAM-7
  /**
   * Remembers the closed PRs linked to the work items. The PRs not known yet come from one listing of the project's
   * PRs completed since the start of the sprint; only the ones that listing does not bring (abandoned, older, of
   * another project) are read one by one, 6 at a time, once (a failed read is not repeated in this session)
   */
  private async closedPullRequestsOf(
    client: ReturnType<typeof resolveContext>['client'],
    links: { id: number; projectId?: string }[],
    active: ReadonlyMap<number, PullRequestDetails>,
    since: string | undefined
  ): Promise<void> {
    let missing = pullRequestsToFetch(
      links.map((link) => link.id),
      active,
      this.closedPullRequests
    ).filter((id) => !this.unreachable.has(id));
    if (!missing.length) {
      return;
    }
    if (since) {
      const wanted = new Set(missing);
      for (const pr of completedLinked(await client.getCompletedPullRequests(since), wanted, since)) {
        this.closedPullRequests.set(pr.pullRequestId, pr);
      }
      missing = missing.filter((id) => !this.closedPullRequests.has(id));
    }
    const projectOf = new Map(links.map((link) => [link.id, link.projectId]));
    const fetched = await mapLimit(missing, MAX_IN_FLIGHT, (id) => client.getPullRequest(id, projectOf.get(id)));
    fetched.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.unreachable.add(missing[index]);
      } else if (result.value.status !== 'active') {
        this.closedPullRequests.set(result.value.pullRequestId, result.value);
      }
    });
  }

  // Rule TEAM-7
  /** The last run of each pipeline of the active published PRs: asked again only when the commit changed or a run is not over */
  private async runs(
    client: ReturnType<typeof resolveContext>['client'],
    pullRequests: PullRequestDetails[]
  ): Promise<Map<number, RunModel[]>> {
    const result = new Map<number, RunModel[]>();
    const own = new Set(this.store.workItems.flatMap((entry) => entry.pullRequests.map((pr) => pr.pullRequestId)));
    // Rule TEAM-7: at most 6 requests in flight; without its runs a card just has no CI marker
    await mapLimit(
      pullRequests.filter((pr) => pr.status === 'active' && !pr.isDraft && !own.has(pr.pullRequestId)),
      MAX_IN_FLIGHT,
      async (pr) => {
        const key = runsCacheKey(pr);
        const cached = this.runsCache.get(key);
        if (cached) {
          result.set(pr.pullRequestId, cached);
          return;
        }
        const runs = latestRuns(await client.getPullRequestBuilds(pr.pullRequestId));
        if (runsAreFinal(runs)) {
          this.runsCache.set(key, runs);
        }
        result.set(pr.pullRequestId, runs);
      }
    );
    return result;
  }

  // Rule TEAM-6
  /**
   * When a PR left draft, for the ones that look overdue by their creation date only: a draft published late would
   * show a false delay. Read once per PR (its threads) and kept; a few per refresh at most
   */
  private async published(
    client: ReturnType<typeof resolveContext>['client'],
    pullRequests: PullRequestDetails[]
  ): Promise<Map<number, string>> {
    const rules = { ...reviewSettings(), workingDays: workingDaysSetting() };
    const now = new Date();
    const suspicious = pullRequests
      .filter(
        (pr) =>
          pr.status === 'active' &&
          !pr.isDraft &&
          !this.publishedCache.has(pr.pullRequestId) &&
          pr.creationDate !== undefined &&
          timeLeftMs({ publishedAt: pr.creationDate }, now, rules) <= 0
      )
      .slice(0, MAX_THREAD_CHECKS);
    // At most 6 requests in flight; a PR whose threads cannot be read keeps its creation date
    await mapLimit(suspicious, MAX_IN_FLIGHT, async (pr) => {
      const threads = await client.getPullRequestThreads(pr.repository.id, pr.pullRequestId);
      this.publishedCache.set(pr.pullRequestId, lastPublishedFromDraft(threads) ?? '');
    });
    return new Map(
      [...this.publishedCache].filter(([, date]) => date !== '').map(([id, date]): [number, string] => [id, date])
    );
  }
}
