import * as vscode from 'vscode';
import type { PullRequestDetails, Team } from './azdoClient';
import { resolveContext, settings, workingDaysSetting } from './config';
import { mergeTeamIterations, type Iteration, type TeamIteration } from './iterations';
import { latestRuns, type RunModel } from './pipelines';
import { withFeature } from './requestContext';
import { lastPublishedFromDraft, timeLeftMs } from './reviewRequests';
import { reviewSettings } from './reviewRequestsWatcher';
import {
  attemptKey,
  pullRequestsToFetch,
  runsAreFinal,
  runsCacheKey,
  type TeamIterationInfo,
  type TeamSnapshot,
} from './teamData';
import {
  parseScope,
  resolveSelection,
  TEAM_SCOPE_KEY,
  TEAM_SELECTION_KEY,
  teamBadges,
  type TeamScope,
} from './teamView';
import type { WorkItemsStore } from './workItemsStore';

/** The teams and the current iteration of a team change rarely: asked again after this long */
const TEAMS_TTL_MS = 60 * 60 * 1000;
/** PRs whose threads are read per refresh at most, to correct their publication date (Rule TEAM-6) */
const MAX_THREAD_CHECKS = 20;

/**
 * The work of the whole team for the Track board (and, later, the Sprint timeline): Backlog Items and Bugs of the
 * current sprints of the teams chosen, their tasks, PRs and CI state. It fetches only when a view asks for it with
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

  private loading?: Promise<void>;
  private lastAttempt?: string;
  private forced = 0;
  /** Never changes: asked once per session */
  private myId?: string;
  private teamsAt = 0;
  private userTeams: Team[] = [];
  private readonly iterationCache = new Map<string, { at: number; iteration: Iteration | undefined }>();
  /** Completed and abandoned PRs never change: kept for the session */
  private readonly closedPullRequests = new Map<number, PullRequestDetails>();
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

  /** The teams shown: the remembered choice, else the teams of the sidebar (Rule TEAM-1) */
  get selection(): string[] {
    const available = this.teams.length ? this.teams.map((team) => team.name) : this.userTeams.map((team) => team.name);
    const stored = this.state.get<string[]>(TEAM_SELECTION_KEY);
    return available.length ? resolveSelection(stored, available, settings().teams) : [...(stored ?? settings().teams)];
  }

  async setSelection(teams: string[]): Promise<void> {
    await this.state.update(TEAM_SELECTION_KEY, teams);
    this.emitter.fire();
  }

  /** Asks to load the data if something changed since the last attempt. Cheap and safe to call on every redraw */
  request(): void {
    if (this.loading || this.store.status !== 'ready') {
      return;
    }
    const key = attemptKey(this.store.loadCount, this.selection, this.forced);
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
    // The teams are known now: the selection may resolve differently than before the first load. Not a new attempt
    this.lastAttempt = attemptKey(loads, this.selection, this.forced);
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
    const selected = this.selection;
    this.myId ??= await client.getMyId();
    const { myId } = this;
    const iterations = await this.iterations(client, selected);
    const ownIds = new Set(this.store.workItems.map((entry) => entry.workItem.id));
    const all = await client.getTeamWorkItems(iterations.map(({ iteration }) => iteration.path));
    // Rule TEAM-4: the user's own work items come from the store, with no request of this view
    const items = all.filter((item) => !ownIds.has(item.id));
    const children = await client.getWorkItems([...new Set(items.flatMap((item) => item.links.childIds))]);
    const links = [...items, ...children].flatMap((item) => item.links.pullRequests);
    const active = new Map((await client.getActivePullRequests()).map((pr) => [pr.pullRequestId, pr]));
    const missing = pullRequestsToFetch(
      links.map((link) => link.id),
      active,
      this.closedPullRequests
    );
    const projectOf = new Map(links.map((link) => [link.id, link.projectId]));
    const fetched = await Promise.allSettled(missing.map((id) => client.getPullRequest(id, projectOf.get(id))));
    for (const result of fetched) {
      if (result.status === 'fulfilled' && result.value.status !== 'active') {
        this.closedPullRequests.set(result.value.pullRequestId, result.value);
      }
    }
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

  // Rule TEAM-7
  /** The last run of each pipeline of the active published PRs: asked again only when the commit changed or a run is not over */
  private async runs(
    client: ReturnType<typeof resolveContext>['client'],
    pullRequests: PullRequestDetails[]
  ): Promise<Map<number, RunModel[]>> {
    const result = new Map<number, RunModel[]>();
    const own = new Set(this.store.workItems.flatMap((entry) => entry.pullRequests.map((pr) => pr.pullRequestId)));
    await Promise.all(
      pullRequests
        .filter((pr) => pr.status === 'active' && !pr.isDraft && !own.has(pr.pullRequestId))
        .map(async (pr) => {
          const key = runsCacheKey(pr);
          const cached = this.runsCache.get(key);
          if (cached) {
            result.set(pr.pullRequestId, cached);
            return;
          }
          try {
            const runs = latestRuns(await client.getPullRequestBuilds(pr.pullRequestId));
            if (runsAreFinal(runs)) {
              this.runsCache.set(key, runs);
            }
            result.set(pr.pullRequestId, runs);
          } catch {
            // Without its runs the card just has no CI marker
          }
        })
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
    await Promise.all(
      suspicious.map(async (pr) => {
        try {
          const threads = await client.getPullRequestThreads(pr.repository.id, pr.pullRequestId);
          this.publishedCache.set(pr.pullRequestId, lastPublishedFromDraft(threads) ?? '');
        } catch {
          // Kept as created
        }
      })
    );
    return new Map(
      [...this.publishedCache].filter(([, date]) => date !== '').map(([id, date]): [number, string] => [id, date])
    );
  }
}
