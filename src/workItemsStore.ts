import { withFeature } from './requestContext';
import * as vscode from 'vscode';
import { AzdoClient, PullRequestDetails, WorkItem } from './azdoClient';
import { resolveContext, settings, DEFAULT_PULL_REQUEST_TASK_PATTERN } from './config';
import { RepositoryGate } from './repositoryGate';
import { GitAPI, pickRepository, Ref, REF_TYPE_HEAD, Repository } from './git';
import { TeamIteration } from './iterations';
import { branchBelongsToWorkItem } from './naming';
import { collectBranches, EntryBranch, toBranchModels, unknownRepositoryIds } from './workItemBranches';
import { isFinishedState, stateCategory } from './states';
import { fixLinks } from './fixLinks';
import { openPredecessors } from './predecessors';
import { ScheduledIteration } from './schedule';
import { sortTaskPullRequests, TaskPullRequestModel, toTaskPullRequestModel } from './taskPullRequests';
import { FilterModel, ViewModel, WorkItemModel } from './viewModel';
import { runDetailsLoader } from './runDetailsLoader';
import { isActive, latestRuns, RunModel } from './pipelines';
import { followedPullRequestIds, RunsTracker } from './runsPolling';
import { toPullRequestModel } from './pullRequestModel';
import { listWorktrees } from './worktreeGit';
import { findWorktree, otherWorktreeBranches, Worktree } from './worktrees';
import { WorkingOnLevel, workingOnLevels } from './workingOn';
import { realpathSync } from 'node:fs';
import { canCreateBranchForTask, canCreatePullRequestForTask } from './pullRequestTasks';
import { parsePriority, PRIORITY_FIELD, SEVERITY_FIELD } from './priority';
import { AlertRules, findAlerts, parseTags, resolveFieldName, resolveRequiredFields, WorkItemAlert } from './alerts';

export interface WorkItemEntry {
  workItem: WorkItem;
  parent?: { id: number; title: string; type: string };
  alerts: WorkItemAlert[];
  branch?: string;
  branchLocation?: 'local' | 'remote';
  /** Every branch of the work item (the main one included), in this repository and in others */
  branches: EntryBranch[];
  /** Branch of a finished work item that still exists (it should have been deleted after its PR was merged) */
  leftoverBranch?: LeftoverBranch;
  pullRequests: PullRequestDetails[];
  /** Tasks under the work item that are not in the list (assigned to other people or in other iterations) */
  otherTasks: OtherTaskEntry[];
  /** Work items that must be done before this one; undefined when they could not be loaded */
  predecessors?: WorkItem[];
  /** Work items that depend on this one; undefined when they could not be loaded */
  successors?: WorkItem[];
}

export interface OtherTaskEntry {
  workItem: WorkItem;
  pullRequests: PullRequestDetails[];
}

export interface LeftoverBranch {
  name: string;
  /** The local branch exists */
  local: boolean;
  /** Commit of the branch in Azure DevOps; undefined when it does not exist there */
  remoteObjectId?: string;
}

interface BranchCandidates {
  local: string[];
  remote: string[];
}

const REMOTE_REF_TYPE = 1;

async function listBranches(repository: Repository | undefined, remoteName: string): Promise<BranchCandidates> {
  if (!repository) {
    return { local: [], remote: [] };
  }
  const names = (refs: Ref[]) => refs.map((ref) => ref.name).filter((name): name is string => !!name);
  const [local, remote] = await Promise.all([
    repository.getBranches({ remote: false }),
    repository.getBranches({ remote: true }),
  ]);
  return {
    local: names(local.filter((ref) => ref.type === REF_TYPE_HEAD)),
    remote: names(remote.filter((ref) => ref.type === REMOTE_REF_TYPE && ref.remote === remoteName)).map((name) =>
      name.slice(remoteName.length + 1)
    ),
  };
}

/** Local branch of the work item, or a remote one (by name or linked to the work item) */
function findBranch(
  workItem: WorkItem,
  branches: BranchCandidates,
  repositoryId: string
): Pick<WorkItemEntry, 'branch' | 'branchLocation'> {
  const local = branches.local.find((name) => branchBelongsToWorkItem(name, workItem.id));
  if (local) {
    return { branch: local, branchLocation: 'local' };
  }
  const remote =
    branches.remote.find((name) => branchBelongsToWorkItem(name, workItem.id)) ??
    workItem.links.branches.find((link) => link.repositoryId === repositoryId)?.name;
  return remote ? { branch: remote, branchLocation: 'remote' } : {};
}

/**
 * Branch of a finished work item that still exists, locally or in Azure DevOps. The remote one is checked in
 * Azure DevOps: the links of the work item and the local "origin/…" refs remain after the branch is deleted
 */
async function findLeftoverBranch(
  client: AzdoClient,
  repositoryId: string,
  { workItem, branch }: Pick<WorkItemEntry, 'branch' | 'workItem'>,
  branches: BranchCandidates
): Promise<LeftoverBranch | undefined> {
  if (!branch || !isFinishedState(workItem.state)) {
    return undefined;
  }
  const local = branches.local.includes(branch);
  let remoteObjectId: string | undefined;
  try {
    remoteObjectId = await client.getBranchObjectId(repositoryId, branch);
  } catch {
    // Unknown: only the local branch is offered for deletion
  }
  return local || remoteObjectId ? { name: branch, local, remoteObjectId } : undefined;
}

interface PullRequestLink {
  id: number;
  projectId: string;
}

/**
 * PRs of the given links, fetched once even when linked to several work items, one request per PR in parallel.
 * The ones in another project are fetched through that project; the ones that fail are left out
 */
async function fetchPullRequests(
  client: AzdoClient,
  links: PullRequestLink[],
  projectId: string
): Promise<Map<number, PullRequestDetails>> {
  const byId = new Map(links.map((link) => [link.id, link]));
  const results = await Promise.allSettled(
    [...byId.values()].map((link) =>
      client.getPullRequest(
        link.id,
        link.projectId.toLowerCase() === projectId.toLowerCase() ? undefined : link.projectId
      )
    )
  );
  const pullRequests = new Map<number, PullRequestDetails>();
  for (const result of results) {
    // PRs of deleted repositories or inaccessible projects are ignored
    if (result.status === 'fulfilled') {
      pullRequests.set(result.value.pullRequestId, result.value);
    }
  }
  return pullRequests;
}

/** Child tasks of the work item that are not in the list, e.g. the ones assigned to other developers */
function otherTasksOf(workItem: WorkItem, related: Map<number, WorkItem>, listed: Set<number>): WorkItem[] {
  return workItem.links.childIds
    .filter((id) => !listed.has(id))
    .map((id) => related.get(id))
    .filter((child): child is WorkItem => child?.type === 'Task' && stateCategory(child.state) !== 'removed');
}

/**
 * Parents and child tasks of the work items, including the ones not in the list
 * (Features, tasks assigned to other people…), fetched at once
 */
async function fetchRelated(client: AzdoClient, workItems: WorkItem[]): Promise<Map<number, WorkItem>> {
  const byId = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const relatedIds = workItems.flatMap((workItem) => [
    ...(workItem.links.parentId === undefined ? [] : [workItem.links.parentId]),
    ...workItem.links.childIds,
  ]);
  // Without them, the cards only lose the parent names and some alerts: do not fail the whole list
  const fetched = await client.getWorkItems([...new Set(relatedIds)].filter((id) => !byId.has(id))).catch(() => []);
  fetched.forEach((workItem) => byId.set(workItem.id, workItem));
  return byId;
}

interface Dependencies {
  /** Predecessors of each work item; undefined when they cannot be told */
  predecessors: Map<number, WorkItem[] | undefined>;
  /** Successors of each work item; undefined when they cannot be told */
  successors: Map<number, WorkItem[] | undefined>;
}

/**
 * Predecessors and successors of the work items (the ones in the list included), fetched in one batched request.
 * Each work item gets its own predecessors, or undefined when they cannot be told (the request failed or one is
 * not found): the cards then say nothing about them. The successors (for the "fixes bugs" links) are lenient:
 * the ones not found (deleted) are left out, and they are only unknown when the request failed
 */
async function fetchDependencies(client: AzdoClient, workItems: WorkItem[]): Promise<Dependencies> {
  const byId = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const missing = [
    ...new Set(workItems.flatMap((workItem) => [...workItem.links.predecessorIds, ...workItem.links.successorIds])),
  ].filter((id) => !byId.has(id));
  let failed = false;
  try {
    (await client.getWorkItems(missing)).forEach((workItem) => byId.set(workItem.id, workItem));
  } catch {
    // The ones not in the list stay unknown
    failed = true;
  }
  const found = (ids: number[]) => ids.map((id) => byId.get(id)).filter((related): related is WorkItem => !!related);
  return {
    predecessors: new Map(
      workItems.map((workItem) => {
        const ids = workItem.links.predecessorIds;
        const related = found(ids);
        return [workItem.id, related.length === ids.length ? related : undefined];
      })
    ),
    successors: new Map(
      workItems.map((workItem) => {
        const ids = workItem.links.successorIds;
        const related = found(ids);
        return [workItem.id, failed && related.length < ids.length ? undefined : related];
      })
    ),
  };
}

/** "Integrated in Build" can be filled automatically from the last release of the deploy image */
function withQuickFixes(alerts: WorkItemAlert[], integrationBuildField: string | undefined): WorkItemAlert[] {
  return alerts.map((alert) =>
    alert.rule === 'missingField' && integrationBuildField && alert.field === integrationBuildField
      ? { ...alert, action: 'fillIntegrationBuild' as const }
      : alert
  );
}

/** Problems of the work item, from its child tasks, PRs, tags and fields */
function alertsOf(
  workItem: WorkItem,
  related: Map<number, WorkItem>,
  pullRequests: PullRequestDetails[],
  rules: AlertRules & { integrationBuildField?: string }
): WorkItemAlert[] {
  const tasks = workItem.links.childIds
    .map((id) => related.get(id))
    .filter((child): child is WorkItem => child?.type === 'Task')
    .map(({ id, title, state, links }) => ({
      id,
      title,
      state,
      pullRequestIds: links.pullRequests.map((link) => link.id),
    }));
  return withQuickFixes(
    findAlerts(
      {
        type: workItem.type,
        state: workItem.state,
        tags: parseTags(workItem.fields['System.Tags']),
        fields: workItem.fields,
        tasks,
        pullRequests: pullRequests.map((pr) => ({ id: pr.pullRequestId, status: pr.status, isDraft: pr.isDraft })),
      },
      rules
    ),
    rules.integrationBuildField
  );
}

async function alertRules(client: AzdoClient): Promise<(AlertRules & { integrationBuildField?: string }) | undefined> {
  const s = settings().alerts;
  if (!s.enabled) {
    return undefined;
  }
  // Without the field names, only the required fields cannot be checked
  const fields = await client.getFields().catch(() => []);
  let pullRequestTaskPattern: RegExp;
  try {
    pullRequestTaskPattern = new RegExp(s.pullRequestTaskPattern, 'i');
  } catch {
    pullRequestTaskPattern = DEFAULT_PULL_REQUEST_TASK_PATTERN;
  }
  return {
    workItemTypes: s.workItemTypes,
    blockingTags: s.blockingTags,
    pullRequestTaskPattern,
    requiredFields: resolveRequiredFields(s.requiredFields, fields),
    integrationBuildField: resolveFieldName(settings().integrationBuild.field, fields),
  };
}

/** Last CI run of each pipeline of the given PRs. PRs whose runs cannot be fetched are skipped */
async function fetchRuns(client: AzdoClient, pullRequestIds: number[]): Promise<Map<number, RunModel[]>> {
  const results = await Promise.allSettled(
    pullRequestIds.map(
      async (id) =>
        [id, await runDetailsLoader.enrich(client, latestRuns(await client.getPullRequestBuilds(id)))] as const
    )
  );
  return new Map(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
}

/** Loads and keeps the work items of the current iterations with their branches and pull requests */
export class WorkItemsStore {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly loadEmitter = new vscode.EventEmitter<void>();
  /** Fired after the work items are reloaded from Azure DevOps, e.g. after changing a state */
  readonly onDidLoad = this.loadEmitter.event;

  status: ViewModel['status'] = 'loading';
  error?: string;
  entries: WorkItemEntry[] = [];
  /** Current iterations of the listed teams */
  iterations: TeamIteration[] = [];
  /** Dates of the iterations of the project, to rate the risk of the predecessors; undefined when not loaded */
  private schedule?: ScheduledIteration[];
  /** Repository open in VS Code, in Azure DevOps; undefined until the first load */
  private repositoryId?: string;
  /** CI runs of the followed PRs, by PR */
  private readonly tracker = new RunsTracker();
  private readonly followEmitter = new vscode.EventEmitter<void>();
  /** Fired when the PRs registered with followPullRequests change: their runs must be loaded */
  readonly onDidChangeFollowed = this.followEmitter.event;
  private loading?: Promise<void>;
  /** Worktrees of the repository, to offer "Open worktree" instead of Checkout */
  worktrees: Worktree[] = [];

  private readonly gate: RepositoryGate;

  constructor(private readonly git: GitAPI) {
    this.gate = new RepositoryGate({
      git,
      pick: () => this.repository(),
      overridesSet: () => {
        const { organization, project, repository } = settings();
        return !!organization && !!project && !!repository;
      },
    });
  }

  /**
   * Resolves when the Azure DevOps context can be resolved: at startup the git extension announces the repository
   * before its remotes are loaded. Await it before `resolveContext`; resolved once, it costs nothing afterwards
   */
  whenRepositoryReady(): Promise<void> {
    return this.gate.whenReady();
  }

  /** The settings that give the context may have changed */
  recheckRepository(): void {
    this.gate.recheck();
  }

  get workItems(): WorkItemEntry[] {
    return this.entries;
  }

  private get runs(): Map<number, RunModel[]> {
    return this.tracker.runs;
  }

  /** The active PRs linked to the work items plus the ones registered with followPullRequests */
  private activePullRequestIds(): number[] {
    const linked = this.entries.flatMap((entry) =>
      entry.pullRequests.filter((pr) => pr.status === 'active').map((pr) => pr.pullRequestId)
    );
    return followedPullRequestIds(linked, this.tracker.extraIds);
  }

  /** Also follows the CI runs of these PRs (e.g. the active ones of the user), replacing the previous ones */
  followPullRequests(pullRequests: { id: number; title: string }[]): void {
    if (this.tracker.follow(pullRequests)) {
      this.followEmitter.fire();
    }
  }

  /** True while a CI run of an active PR is queued or running */
  get hasActiveRuns(): boolean {
    return [...this.runs.values()].some((runs) => runs.some((run) => isActive(run.state)));
  }

  /** CI runs of the active PRs with the PR they validate */
  get pullRequestRuns(): { pullRequestId: number; title: string; run: RunModel }[] {
    const titles = new Map(
      this.entries.flatMap((entry) => entry.pullRequests).map((pr) => [pr.pullRequestId, pr.title])
    );
    return [...this.runs].flatMap(([pullRequestId, runs]) =>
      runs.map((run) => ({
        pullRequestId,
        title: titles.get(pullRequestId) ?? this.tracker.titleOf(pullRequestId) ?? '',
        run,
      }))
    );
  }

  /** CI runs of a followed PR; undefined when the store does not follow it (yet) */
  runsOf(pullRequestId: number): RunModel[] | undefined {
    return this.runs.get(pullRequestId);
  }

  findRun(runId: number): RunModel | undefined {
    return [...this.runs.values()].flat().find((run) => run.id === runId);
  }

  /**
   * Reloads only the CI runs (much cheaper than a full refresh).
   * Returns the runs that finished since the previous check, with their PR; undefined when another reload is in progress
   */
  refreshRuns(): Promise<{ pullRequestId: number; run: RunModel }[] | undefined> {
    return withFeature('ci', () => this.runRefreshRuns());
  }

  private async runRefreshRuns(): Promise<{ pullRequestId: number; run: RunModel }[] | undefined> {
    await this.whenRepositoryReady();
    const client = resolveContext(this.repository()).client;
    const finished = await this.tracker.refresh(this.activePullRequestIds(), (ids) => fetchRuns(client, ids));
    if (finished) {
      this.changeEmitter.fire();
    }
    return finished;
  }

  /** Work items with problems the developers must fix ASAP */
  get withAlerts(): WorkItemEntry[] {
    return this.entries.filter((entry) => entry.alerts.length);
  }

  find(id: number): WorkItemEntry | undefined {
    return this.entries.find((entry) => entry.workItem.id === id);
  }

  /** A PR linked to a work item of the list or to one of their tasks, e.g. the ones assigned to other developers */
  findPullRequest(pullRequestId: number): PullRequestDetails | undefined {
    return this.entries
      .flatMap((entry) => [entry.pullRequests, ...entry.otherTasks.map((task) => task.pullRequests)].flat())
      .find((pr) => pr.pullRequestId === pullRequestId);
  }

  repository(): Repository | undefined {
    return this.git.repositories.length ? pickRepository(this.git) : undefined;
  }

  async ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    await this.loading;
  }

  async refresh(): Promise<void> {
    // A load waiting for the git extension already reads everything once it is ready
    if (this.loading && !this.gate.isReady) {
      await this.loading;
      return;
    }
    this.loading = this.load();
    await this.loading;
  }

  /** Folders of the repository open in this window: its branch is not "in another worktree" */
  openFolders(): string[] {
    const root = this.repository()?.rootUri.fsPath;
    if (!root) {
      return [];
    }
    try {
      return [root, realpathSync(root)];
    } catch {
      return [root];
    }
  }

  /** Worktree (other than the folder open in this window) where the branch is checked out */
  worktreeFor(branch: string | undefined): Worktree | undefined {
    return branch ? findWorktree(this.worktrees, branch, this.openFolders()) : undefined;
  }

  /** Reads the worktrees with one git call. Returns whether they changed */
  async refreshWorktrees(): Promise<boolean> {
    const root = this.repository()?.rootUri.fsPath;
    let next: Worktree[] = [];
    if (root) {
      try {
        next = await listWorktrees(root);
      } catch {
        // Old git or not a repository: no worktrees
      }
    }
    const changed =
      next.length !== this.worktrees.length ||
      next.some(
        (w, i) =>
          w.path !== this.worktrees[i].path ||
          w.branch !== this.worktrees[i].branch ||
          w.prunable !== this.worktrees[i].prunable
      );
    this.worktrees = next;
    return changed;
  }

  /** Lets the view re-render, e.g. when the checked out branch changes */
  notify(): void {
    this.changeEmitter.fire();
  }

  private readonly repositoryNameCache = new Map<string, Promise<string>>();

  private load(): Promise<void> {
    return withFeature('sidebar', () => this.runLoad());
  }

  private async runLoad(): Promise<void> {
    this.status = 'loading';
    this.changeEmitter.fire();
    try {
      await this.whenRepositoryReady();
      await this.refreshWorktrees();
      this.entries = await this.fetch();
      this.tracker.runs = await fetchRuns(resolveContext(this.repository()).client, this.activePullRequestIds());
      this.status = 'ready';
      this.error = undefined;
      this.loadEmitter.fire();
    } catch (error) {
      this.status = 'error';
      this.error = (error as Error).message;
    }
    this.changeEmitter.fire();
  }

  private async fetch(): Promise<WorkItemEntry[]> {
    const repository = this.repository();
    const { client, repositoryName } = resolveContext(repository);
    const s = settings();
    const [azdoRepository, branches, workItems] = await Promise.all([
      client.getRepository(repositoryName),
      listBranches(repository, s.remote),
      (async () => {
        this.iterations = await client.getCurrentIterations(await client.resolveTeams(s.teams));
        return client.getMyWorkItems(this.iterations.map(({ iteration }) => iteration.path));
      })(),
    ]);
    const listed = new Set(workItems.map((workItem) => workItem.id));
    const relatedRequest = fetchRelated(client, workItems);
    const [pullRequests, related, rules, dependencies, schedule] = await Promise.all([
      // The PRs of the tasks of other developers are fetched with the ones of the work items, once their tasks are known
      relatedRequest.then((relatedItems) =>
        fetchPullRequests(
          client,
          [...workItems, ...workItems.flatMap((workItem) => otherTasksOf(workItem, relatedItems, listed))].flatMap(
            (workItem) => workItem.links.pullRequests
          ),
          azdoRepository.project.id
        )
      ),
      relatedRequest,
      alertRules(client),
      fetchDependencies(client, workItems),
      // Without the schedule the predecessors are listed without their risk
      client.getIterationSchedule().catch(() => undefined),
    ]);
    this.schedule = schedule;
    this.repositoryId = azdoRepository.id;
    const repositoryNames = await this.repositoryNames(
      client,
      workItems,
      [...pullRequests.values()],
      azdoRepository.id
    );
    const pullRequestsOf = (item: WorkItem) =>
      item.links.pullRequests.map((link) => pullRequests.get(link.id)).filter((pr): pr is PullRequestDetails => !!pr);
    const entries: WorkItemEntry[] = workItems.map((workItem) => {
      const parent = workItem.links.parentId === undefined ? undefined : related.get(workItem.links.parentId);
      const itemPullRequests = pullRequestsOf(workItem);
      return {
        workItem,
        otherTasks: otherTasksOf(workItem, related, listed).map((task) => ({
          workItem: task,
          pullRequests: pullRequestsOf(task),
        })),
        parent: parent && { id: parent.id, title: parent.title, type: parent.type },
        ...findBranch(workItem, branches, azdoRepository.id),
        branches: collectBranches({
          workItem,
          local: branches.local,
          remote: branches.remote,
          pullRequests: itemPullRequests,
          repositoryId: azdoRepository.id,
          repositoryNames,
        }),
        pullRequests: itemPullRequests,
        alerts: rules ? alertsOf(workItem, related, itemPullRequests, rules) : [],
        predecessors: dependencies.predecessors.get(workItem.id),
        successors: dependencies.successors.get(workItem.id),
      };
    });
    await Promise.all(
      entries.map(async (entry) => {
        entry.leftoverBranch = await findLeftoverBranch(client, azdoRepository.id, entry, branches);
      })
    );
    return entries;
  }

  /**
   * Names of the other repositories of the Development links (the PRs already say theirs), by lower case id. One
   * request per repository, kept for the session; the ones that fail are left out and tried again next time
   */
  private async repositoryNames(
    client: AzdoClient,
    workItems: WorkItem[],
    pullRequests: PullRequestDetails[],
    repositoryId: string
  ): Promise<Map<string, string>> {
    const names = new Map(pullRequests.map((pr) => [pr.repository.id.toLowerCase(), pr.repository.name]));
    const missing = unknownRepositoryIds(workItems, repositoryId, names);
    await Promise.all(
      missing.map(async (id) => {
        const key = `${client.organization}/${client.project}/${id}`;
        let request = this.repositoryNameCache.get(key);
        if (!request) {
          request = client.getRepository(id).then((repository) => repository.name);
          this.repositoryNameCache.set(key, request);
          request.catch(() => this.repositoryNameCache.delete(key));
        }
        try {
          names.set(id, await request);
        } catch {
          // Shown as "another repository"
        }
      })
    );
    return names;
  }

  /** State of the parent work item when it is in the list (the task rows are shown in its card) */
  private parentState(workItem: WorkItem): string | undefined {
    const { parentId } = workItem.links;
    return parentId === undefined ? undefined : this.find(parentId)?.workItem.state;
  }

  /** PRs of a task as the popovers of their icons show them */
  private taskPullRequests(pullRequests: PullRequestDetails[]): TaskPullRequestModel[] {
    const context = { repositoryId: this.repositoryId, baseBranch: settings().baseBranch };
    return sortTaskPullRequests(
      pullRequests.map((pr) => toTaskPullRequestModel(pr, { ...context, runs: this.runs.get(pr.pullRequestId) }))
    );
  }

  private toModel(
    {
      workItem,
      parent,
      alerts,
      branch,
      branchLocation,
      branches,
      leftoverBranch,
      pullRequests,
      predecessors,
      successors,
      otherTasks,
    }: WorkItemEntry,
    currentBranch: string | undefined,
    completedStates: string[],
    levels: Map<number, WorkingOnLevel>
  ): WorkItemModel {
    return {
      id: workItem.id,
      title: workItem.title,
      type: workItem.type,
      state: workItem.state,
      iterationPath: workItem.iterationPath,
      url: workItem.url,
      parentId: workItem.links.parentId,
      parent,
      alerts,
      priority: parsePriority(workItem.fields[PRIORITY_FIELD]),
      severity: (workItem.fields[SEVERITY_FIELD] as string | undefined) || undefined,
      branch,
      branchLocation,
      isCurrentBranch: !!branch && branch === currentBranch,
      branches: toBranchModels(branches, {
        currentBranch,
        mainBranch: branch,
        worktreeFor: (name) => this.worktreeFor(name)?.path,
      }),
      workingOn: levels.get(workItem.id),
      worktree: branch === currentBranch ? undefined : this.worktreeFor(branch)?.path,
      leftoverBranch: leftoverBranch && {
        name: leftoverBranch.name,
        local: leftoverBranch.local,
        remote: !!leftoverBranch.remoteObjectId,
      },
      // Active PRs first, then the most recent
      pullRequests: pullRequests
        .map((pr) => toPullRequestModel(pr, this.runs.get(pr.pullRequestId) ?? [], this.repositoryId))
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.id - a.id),
      openPredecessors: predecessors && openPredecessors(workItem, predecessors, completedStates, this.schedule),
      ...fixLinks(workItem, predecessors, successors),
      taskPullRequests: workItem.type === 'Task' ? this.taskPullRequests(pullRequests) : [],
      canCreateBranch:
        workItem.type === 'Task' &&
        canCreateBranchForTask({
          taskState: workItem.state,
          parentState: this.parentState(workItem),
          branches: workItem.links.branches,
        }),
      canCreatePullRequest:
        workItem.type === 'Task' &&
        canCreatePullRequestForTask({
          taskState: workItem.state,
          parentState: this.parentState(workItem),
          pullRequests,
        }),
      otherTasks: otherTasks.map(({ workItem: task, pullRequests: taskPullRequests }) => ({
        id: task.id,
        title: task.title,
        type: task.type,
        state: task.state,
        assignedTo: task.assignedTo,
        taskPullRequests: this.taskPullRequests(taskPullRequests),
        canCreateBranch: canCreateBranchForTask({
          taskState: task.state,
          parentState: workItem.state,
          branches: task.links.branches,
        }),
        canCreatePullRequest: canCreatePullRequestForTask({
          taskState: task.state,
          parentState: workItem.state,
          pullRequests: taskPullRequests,
        }),
      })),
    };
  }

  /** Work items being worked on: their branch (or the PR of the branch) is checked out here or in another worktree */
  private workingOnLevels(currentBranch: string | undefined): Map<number, WorkingOnLevel> {
    const { showWorktrees, includeLinkedWorkItems } = settings().workingOn;
    return workingOnLevels({
      currentBranch,
      worktreeBranches: showWorktrees ? otherWorktreeBranches(this.worktrees, this.openFolders()) : [],
      entries: this.entries,
      includeLinked: includeLinkedWorkItems,
    });
  }

  /** Card data of one work item, or undefined when it is not in the current iterations */
  workItemModel(id: number): WorkItemModel | undefined {
    const entry = this.find(id);
    const currentBranch = this.repository()?.state.HEAD?.name;
    return (
      entry &&
      this.toModel(entry, currentBranch, settings().dependencies.completedStates, this.workingOnLevels(currentBranch))
    );
  }

  toViewModel(
    filter: FilterModel
  ): Omit<ViewModel, 'alwaysShowAlerts' | 'coverage' | 'layout' | 'pullRequests' | 'reviews' | 'workingOn'> {
    const currentBranch = this.repository()?.state.HEAD?.name;
    const { completedStates } = settings().dependencies;
    const levels = this.workingOnLevels(currentBranch);
    const workItems = this.entries.map((entry) => this.toModel(entry, currentBranch, completedStates, levels));
    return {
      status: this.status,
      error: this.error,
      iterations: this.iterations.map(({ iteration, teams }) => ({
        name: iteration.name,
        path: iteration.path,
        teams,
      })),
      workItems,
      filter,
      stateOrder: settings().stateOrder,
    };
  }
}
