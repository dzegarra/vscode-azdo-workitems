import { withFeature } from './requestContext';
import * as vscode from 'vscode';
import { AzdoClient, PullRequestDetails, WorkItem } from './azdoClient';
import { resolveContext, settings, compilePullRequestTaskPattern } from './config';
import { RepositoryGate } from './repositoryGate';
import { GitAPI, pickRepository, Ref, REF_TYPE_HEAD, Repository } from './git';
import { TeamIteration } from './iterations';
import { branchBelongsToWorkItem } from './naming';
import { collectBranches, EntryBranch, toBranchModels, unknownRepositoryIds } from './workItemBranches';
import { isClosedState, stateCategory } from './states';
import { completionIssues, type CompletionIssues } from './completionIssues';
import { branchesToCheckRemotely, deletableBranches, isProtectedBranch } from './deletableBranches';
import { duplicateLinks, iterationLabel } from './duplicates';
import { fixLinks } from './fixLinks';
import { openPredecessors } from './predecessors';
import { ScheduledIteration } from './schedule';
import { branchesToVerify, TaskBranchModel, toTaskBranchModels } from './taskBranches';
import { sortTaskPullRequests, TaskPullRequestModel, toTaskPullRequestModel } from './taskPullRequests';
import { FilterModel, ViewModel, WorkItemModel } from './viewModel';
import { runDetailsLoader } from './runDetailsLoader';
import { BranchRun, isActive, latestBranchRuns, latestRuns, MergeRun, mergeRuns, RunModel } from './pipelines';
import { FinishedRun, FollowedPullRequest, followedPullRequestIds, RunsSnapshot, RunsTracker } from './runsPolling';
import { isOtherRepository, toPullRequestModel } from './pullRequestModel';
import { listWorktrees } from './worktreeGit';
import { findWorktree, otherWorktreeBranches, Worktree } from './worktrees';
import { taskWorkingOn, WorkingOnLevel, workingOnLevels } from './workingOn';
import { realpathSync } from 'node:fs';
import {
  canCreateBranchForTask,
  canCreatePullRequestForTask,
  canLinkBranchForTask,
  isInReview,
  shownState,
} from './pullRequestTasks';
import { parsePriority, PRIORITY_FIELD, SEVERITY_FIELD } from './priority';
import {
  AlertDuplicate,
  AlertIteration,
  AlertRules,
  findAlerts,
  parseTags,
  resolveFieldName,
  resolveRequiredFields,
  WorkItemAlert,
} from './alerts';

export interface WorkItemEntry {
  workItem: WorkItem;
  parent?: { id: number; title: string; type: string };
  alerts: WorkItemAlert[];
  /** Rule STATE-10 holds for the work item (whatever the setting says) */
  inReview: boolean;
  branch?: string;
  branchLocation?: 'local' | 'remote';
  /** Every branch of the work item (the main one included), in this repository and in others */
  branches: EntryBranch[];
  /** Branches of this work item (of this repository) that still exist and whose PR was completed: to be deleted */
  deletableBranches: string[];
  pullRequests: PullRequestDetails[];
  /** Tasks under the work item that are not in the list (assigned to other people or in other iterations) */
  otherTasks: OtherTaskEntry[];
  /** Names of the branches (this repository) linked to its child tasks: they also mark the work item as "working on" */
  taskBranches: string[];
  /** PR links (with project and repository) of its child tasks: the ones the quick fix of an unlinked PR may add */
  taskPullRequestLinks: { id: number; projectId: string; repositoryId: string }[];
  /** Blocking tags and empty fields that keep it from being completed (COMPLETE-2..4); undefined without alert rules */
  completion?: CompletionIssues;
  /** Work items that must be done before this one; undefined when they could not be loaded */
  predecessors?: WorkItem[];
  /** Work items that depend on this one; undefined when they could not be loaded */
  successors?: WorkItem[];
  /** The originals it duplicates ("Duplicate Of"); undefined when they could not be loaded */
  duplicateOf?: WorkItem[];
  /** The work items duplicating it; undefined when they could not be loaded */
  duplicates?: WorkItem[];
}

interface WorkingOnState {
  levels: Map<number, WorkingOnLevel>;
  /** Branches checked out in the other worktrees; empty when they are not wanted */
  worktreeBranches: string[];
}

export interface OtherTaskEntry {
  workItem: WorkItem;
  pullRequests: PullRequestDetails[];
}

interface BranchCandidates {
  local: string[];
  remote: string[];
}

const REMOTE_REF_TYPE = 1;
// Rule DELETABLE-3: existence is cached this long
/** How long a branch found (or not found) in Azure DevOps is trusted before asking again */
const BRANCH_EXISTENCE_TTL_MS = 10 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
/** The manual and post-merge runs are fetched at most this often while none of them is active */
const BRANCH_RUNS_MIN_INTERVAL_MS = 60 * 1000;

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

// Rules BRANCH-MAIN-1, BRANCH-MAIN-2
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
  /** Originals ("Duplicate Of") of each work item; undefined when they cannot be told */
  duplicateOf: Map<number, WorkItem[] | undefined>;
  /** Work items duplicating each work item; undefined when they cannot be told */
  duplicates: Map<number, WorkItem[] | undefined>;
}

/**
 * Predecessors, successors and duplicates of the work items (the ones in the list included), fetched in one batched
 * request. Each work item gets its own predecessors, or undefined when they cannot be told (the request failed or one
 * is not found): the cards then say nothing about them. The successors (for the "fixes bugs" links) and the
 * duplicates are lenient: the ones not found (deleted) are left out, and they are only unknown when the request failed
 */
async function fetchDependencies(client: AzdoClient, workItems: WorkItem[]): Promise<Dependencies> {
  const byId = new Map(workItems.map((workItem) => [workItem.id, workItem]));
  const missing = [
    ...new Set(
      workItems.flatMap((workItem) => [
        ...workItem.links.predecessorIds,
        ...workItem.links.successorIds,
        ...workItem.links.duplicateOfIds,
        ...workItem.links.duplicateIds,
      ])
    ),
  ].filter((id) => !byId.has(id));
  let failed = false;
  try {
    (await client.getWorkItems(missing)).forEach((workItem) => byId.set(workItem.id, workItem));
  } catch {
    // The ones not in the list stay unknown
    failed = true;
  }
  const found = (ids: number[]) => ids.map((id) => byId.get(id)).filter((related): related is WorkItem => !!related);
  const lenient = (idsOf: (links: WorkItem['links']) => number[]) =>
    new Map(
      workItems.map((workItem) => {
        const ids = idsOf(workItem.links);
        const related = found(ids);
        return [workItem.id, failed && related.length < ids.length ? undefined : related];
      })
    );
  return {
    predecessors: new Map(
      workItems.map((workItem) => {
        const ids = workItem.links.predecessorIds;
        const related = found(ids);
        return [workItem.id, related.length === ids.length ? related : undefined];
      })
    ),
    successors: lenient((links) => links.successorIds),
    duplicateOf: lenient((links) => links.duplicateOfIds),
    duplicates: lenient((links) => links.duplicateIds),
  };
}

// Rule ALERT-FIX-2
/** "Integrated in Build" can be filled automatically from the last release of the deploy image */
function withQuickFixes(alerts: WorkItemAlert[], integrationBuildField: string | undefined): WorkItemAlert[] {
  return alerts.map((alert) =>
    alert.rule === 'missingField' && integrationBuildField && alert.field === integrationBuildField
      ? { ...alert, action: 'fillIntegrationBuild' as const }
      : alert
  );
}

/** Names of the linked branches that are in the repository */
function branchNamesOf(links: { repositoryId: string; name: string }[], repositoryId: string | undefined): string[] {
  return [
    ...new Set(links.filter((link) => !isOtherRepository(link.repositoryId, repositoryId)).map((link) => link.name)),
  ];
}

/** Names of the branches linked to the tasks of a work item (the ones of the list and of other people) */
function taskBranchNamesOf(
  workItem: WorkItem,
  related: Map<number, WorkItem>,
  repositoryId: string | undefined
): string[] {
  return [
    ...new Set(
      workItem.links.childIds
        .map((id) => related.get(id))
        .filter((child): child is WorkItem => child?.type === 'Task')
        .flatMap((child) => branchNamesOf(child.links.branches, repositoryId))
    ),
  ];
}

/** PR links of the child tasks of a work item (the ones of other people included), once per PR */
function taskPullRequestLinksOf(
  workItem: WorkItem,
  related: Map<number, WorkItem>
): { id: number; projectId: string; repositoryId: string }[] {
  const links = workItem.links.childIds
    .map((id) => related.get(id))
    .filter((child): child is WorkItem => child?.type === 'Task')
    .flatMap((child) => child.links.pullRequests);
  return [...new Map(links.map((link) => [link.id, link])).values()].map(({ id, projectId, repositoryId }) => ({
    id,
    projectId,
    repositoryId,
  }));
}

/** Child tasks of the work item (Removed ones included) with their PRs and branches */
function taskRefsOf(workItem: WorkItem, related: Map<number, WorkItem>, repositoryId: string) {
  return workItem.links.childIds
    .map((id) => related.get(id))
    .filter((child): child is WorkItem => child?.type === 'Task')
    .map(({ id, title, state, links }) => ({
      id,
      title,
      state,
      pullRequestIds: links.pullRequests.map((link) => link.id),
      branches: branchNamesOf(links.branches, repositoryId),
    }));
}

/** Problems of the work item, from its child tasks, PRs, tags and fields */
/** Iteration of a work item for the alerts: its path and the name to show */
function alertIteration(workItem: WorkItem, schedule: ScheduledIteration[] | undefined): AlertIteration {
  return { path: workItem.iterationPath, name: iterationLabel(workItem.iterationPath, schedule) };
}

/** The originals and the duplicates of the work item that could be loaded, for Rules ALERT-9, ALERT-10 */
function alertDuplicates(
  workItem: WorkItem,
  dependencies: Dependencies,
  schedule: ScheduledIteration[] | undefined
): AlertDuplicate[] {
  const refs = (items: WorkItem[] | undefined, role: AlertDuplicate['role']) =>
    (items ?? []).map((item) => ({
      id: item.id,
      state: item.state,
      iteration: alertIteration(item, schedule),
      role,
    }));
  return [
    ...refs(dependencies.duplicateOf.get(workItem.id), 'original'),
    ...refs(dependencies.duplicates.get(workItem.id), 'duplicate'),
  ];
}

function alertsOf(
  workItem: WorkItem,
  related: Map<number, WorkItem>,
  pullRequests: PullRequestDetails[],
  rules: AlertRules & { integrationBuildField?: string },
  repositoryId: string,
  abandonedPullRequestIds: number[],
  planning: { iteration: AlertIteration; duplicates: AlertDuplicate[] }
): WorkItemAlert[] {
  const tasks = taskRefsOf(workItem, related, repositoryId);
  return withQuickFixes(
    findAlerts(
      {
        type: workItem.type,
        state: workItem.state,
        tags: parseTags(workItem.fields['System.Tags']),
        fields: workItem.fields,
        tasks,
        pullRequests: pullRequests.map((pr) => ({ id: pr.pullRequestId, status: pr.status, isDraft: pr.isDraft })),
        branches: branchNamesOf(workItem.links.branches, repositoryId),
        linkedPullRequestIds: workItem.links.pullRequests.map((link) => link.id),
        abandonedPullRequestIds,
        ...planning,
      },
      rules
    ),
    rules.integrationBuildField
  );
}

/** Blocking tags and empty fields of the work item, from the same rules as the alerts */
function completionIssuesOf(workItem: WorkItem, rules: AlertRules): CompletionIssues {
  return completionIssues(
    {
      type: workItem.type,
      state: workItem.state,
      tags: parseTags(workItem.fields['System.Tags']),
      fields: workItem.fields,
    },
    rules
  );
}

// Rule ALERT-GATE-1
async function alertRules(client: AzdoClient): Promise<(AlertRules & { integrationBuildField?: string }) | undefined> {
  const s = settings().alerts;
  if (!s.enabled) {
    return undefined;
  }
  // Without the field names, only the required fields cannot be checked
  const fields = await client.getFields().catch(() => []);
  return {
    workItemTypes: s.workItemTypes,
    blockingTags: s.blockingTags,
    pullRequestTaskPattern: compilePullRequestTaskPattern(s.pullRequestTaskPattern),
    requiredFields: resolveRequiredFields(s.requiredFields, fields),
    integrationBuildField: resolveFieldName(settings().integrationBuild.field, fields),
  };
}

/** Last CI run of each pipeline of the given PRs. PRs whose runs cannot be fetched are skipped */
async function fetchPullRequestRuns(client: AzdoClient, pullRequestIds: number[]): Promise<Map<number, RunModel[]>> {
  const results = await Promise.allSettled(
    pullRequestIds.map(
      async (id) =>
        [id, await runDetailsLoader.enrich(client, latestRuns(await client.getPullRequestBuilds(id)))] as const
    )
  );
  return new Map(results.filter((result) => result.status === 'fulfilled').map((result) => result.value));
}

interface BranchRunsSource {
  userId: string;
  repositoryId: string;
  /** The user's PRs, active and completed */
  ownPullRequestIds: number[];
  since: Date;
}

/** Runs queued by hand by the user, and runs queued by the merge of the user's PRs. Undefined when not fetched */
async function fetchBranchRuns(
  client: AzdoClient,
  source: BranchRunsSource
): Promise<Pick<RunsSnapshot, 'branchRuns' | 'mergeRuns'>> {
  const [manual, pushes] = await Promise.allSettled([
    client.getManualBuilds(source.userId, source.repositoryId, source.since),
    // Without own PRs no merge can match: no request
    source.ownPullRequestIds.length ? client.getPushBuilds(source.repositoryId, source.since) : Promise.resolve([]),
  ]);
  const enrich = async <T extends { run: RunModel }>(entries: T[]): Promise<T[]> => {
    const runs = await runDetailsLoader.enrich(
      client,
      entries.map(({ run }) => run)
    );
    return entries.map((entry, index) => ({ ...entry, run: runs[index] }));
  };
  return {
    branchRuns: manual.status === 'fulfilled' ? await enrich(latestBranchRuns(manual.value)) : undefined,
    mergeRuns:
      pushes.status === 'fulfilled' ? await enrich(mergeRuns(pushes.value, source.ownPullRequestIds)) : undefined,
  };
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

  /**
   * Also follows the CI runs of these PRs (the active ones of the user), replacing the previous ones. The completed
   * ones give the runs queued by their merge
   */
  followPullRequests(pullRequests: FollowedPullRequest[], completed: FollowedPullRequest[] = []): void {
    if (this.tracker.follow(pullRequests, completed)) {
      this.followEmitter.fire();
    }
  }

  /** True while a CI run is queued or running */
  get hasActiveRuns(): boolean {
    return this.allRuns().some((run) => isActive(run.state));
  }

  private allRuns(): RunModel[] {
    return [
      ...[...this.runs.values()].flat(),
      ...this.tracker.branchRuns.map(({ run }) => run),
      ...this.tracker.mergeRuns.map(({ run }) => run),
    ];
  }

  /** A PR linked to the work items or followed, with its title, source branch and page */
  private pullRequestInfo(pullRequestId: number): { title: string; sourceRefName?: string; webUrl?: string } {
    const linked = this.findPullRequest(pullRequestId);
    const followed = this.tracker.pullRequestOf(pullRequestId);
    return {
      title: linked?.title ?? followed?.title ?? '',
      sourceRefName: linked?.sourceRefName ?? followed?.sourceRefName,
      webUrl: linked?.webUrl ?? followed?.webUrl,
    };
  }

  /** CI runs of the active PRs with the PR they validate */
  get pullRequestRuns(): {
    pullRequestId: number;
    title: string;
    sourceRefName?: string;
    webUrl?: string;
    run: RunModel;
  }[] {
    return [...this.runs].flatMap(([pullRequestId, runs]) => {
      const info = this.pullRequestInfo(pullRequestId);
      return runs.map((run) => ({ pullRequestId, ...info, run }));
    });
  }

  /** Runs queued by hand by the user on a branch (no PR) */
  get branchRuns(): BranchRun[] {
    return this.tracker.branchRuns;
  }

  /** Runs queued by the merge of the user's PRs, with the title and page of the PR */
  get mergeRuns(): (MergeRun & { title: string; webUrl?: string })[] {
    return this.tracker.mergeRuns.map((entry) => {
      const { title, webUrl } = this.pullRequestInfo(entry.pullRequestId);
      return { ...entry, title, webUrl };
    });
  }

  /** CI runs of a followed PR; undefined when the store does not follow it (yet) */
  runsOf(pullRequestId: number): RunModel[] | undefined {
    return this.runs.get(pullRequestId);
  }

  findRun(runId: number): RunModel | undefined {
    return this.allRuns().find((run) => run.id === runId);
  }

  /**
   * Reloads only the CI runs (much cheaper than a full refresh).
   * Returns the runs that finished since the previous check, with their PR; undefined when another reload is in progress
   */
  refreshRuns(): Promise<FinishedRun[] | undefined> {
    return withFeature('ci', () => this.runRefreshRuns());
  }

  private async runRefreshRuns(): Promise<FinishedRun[] | undefined> {
    await this.whenRepositoryReady();
    const client = resolveContext(this.repository()).client;
    const finished = await this.tracker.refresh(this.activePullRequestIds(), async (ids) => {
      const [pullRequests, branchRuns] = await Promise.all([
        fetchPullRequestRuns(client, ids),
        this.fetchBranchRuns(client),
      ]);
      return { pullRequests, ...branchRuns };
    });
    if (finished) {
      this.changeEmitter.fire();
    }
    return finished;
  }

  private myId?: Promise<string>;
  /** When the manual and post-merge runs were last fetched */
  private branchRunsFetchedAt = 0;

  /**
   * Manual and post-merge runs, unless turned off or the repository is not known yet (empty: cleared). While only PR
   * runs are active they are fetched at the idle pace, not on every fast tick ({}: the last known ones are kept)
   */
  private async fetchBranchRuns(
    client: AzdoClient,
    force = false
  ): Promise<Pick<RunsSnapshot, 'branchRuns' | 'mergeRuns'>> {
    const hours = settings().branchRunsHours;
    const repositoryId = this.repositoryId;
    if (!hours) {
      return { branchRuns: [], mergeRuns: [] };
    }
    const active = [...this.tracker.branchRuns, ...this.tracker.mergeRuns].some(({ run }) => isActive(run.state));
    if (!repositoryId || (!force && !active && Date.now() - this.branchRunsFetchedAt < BRANCH_RUNS_MIN_INTERVAL_MS)) {
      return {};
    }
    this.branchRunsFetchedAt = Date.now();
    try {
      this.myId ??= client.getMyId();
      const userId = await this.myId;
      const since = new Date(Date.now() - hours * MS_PER_HOUR);
      return await fetchBranchRuns(client, {
        userId,
        repositoryId,
        ownPullRequestIds: this.tracker.ownIds,
        since,
      });
    } catch {
      this.myId = undefined;
      return {};
    }
  }

  /** Work items with problems the developers must fix ASAP */
  get withAlerts(): WorkItemEntry[] {
    return this.entries.filter((entry) => entry.alerts.length);
  }

  find(id: number): WorkItemEntry | undefined {
    return this.entries.find((entry) => entry.workItem.id === id);
  }

  /** State shown for a work item of the list (In review when STATE-10 holds and the setting is on); undefined if not listed */
  displayStateOf(id: number): string | undefined {
    const entry = this.find(id);
    return entry && shownState(entry.workItem.state, entry.inReview, settings().showInReviewState);
  }

  /** Title of a PR linked to the work items or followed; undefined when it is not known */
  pullRequestTitle(pullRequestId: number): string | undefined {
    return this.pullRequestInfo(pullRequestId).title || undefined;
  }

  /** Work items of the list and their tasks that are linked to a PR, by id */
  workItemIdsOfPullRequest(pullRequestId: number): number[] {
    const ids = this.entries
      .flatMap((entry) => [entry.workItem, ...entry.otherTasks.map((task) => task.workItem)])
      .filter((item) => item.links.pullRequests.some((link) => link.id === pullRequestId))
      .map((item) => item.id);
    return [...new Set(ids)].sort((a, b) => a - b);
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
  /** Whether Azure DevOps has a branch of the repository (lower case repository id + name), and when it was asked */
  private readonly branchExistenceCache = new Map<string, { exists: boolean; at: number }>();
  /** Names of the local branches, as read by the last load */
  private localBranches: string[] = [];
  /** Repositories (lower case id) and names already repositoryNames() found, for the task branches */
  private repositoryNameById: ReadonlyMap<string, string> = new Map();

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
      const client = resolveContext(this.repository()).client;
      const [runs, branchRuns] = await withFeature('ci', () =>
        Promise.all([fetchPullRequestRuns(client, this.activePullRequestIds()), this.fetchBranchRuns(client, true)])
      );
      this.tracker.runs = runs;
      this.tracker.branchRuns = branchRuns.branchRuns ?? this.tracker.branchRuns;
      this.tracker.mergeRuns = branchRuns.mergeRuns ?? this.tracker.mergeRuns;
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
    this.repositoryNameById = repositoryNames;
    this.localBranches = branches.local;
    await this.verifyTaskBranches(
      client,
      azdoRepository.id,
      [...workItems, ...workItems.flatMap((workItem) => otherTasksOf(workItem, related, listed))]
        .filter((item) => item.type === 'Task')
        .flatMap((task) => task.links.branches)
    );
    const pullRequestsOf = (item: WorkItem) =>
      item.links.pullRequests.map((link) => pullRequests.get(link.id)).filter((pr): pr is PullRequestDetails => !!pr);
    const pullRequestTaskPattern = compilePullRequestTaskPattern(s.alerts.pullRequestTaskPattern);
    const entries: WorkItemEntry[] = workItems.map((workItem) => {
      const parent = workItem.links.parentId === undefined ? undefined : related.get(workItem.links.parentId);
      const itemPullRequests = pullRequestsOf(workItem);
      const taskPullRequestLinks = taskPullRequestLinksOf(workItem, related);
      const abandonedTaskPullRequestIds = taskPullRequestLinks
        .filter((link) => pullRequests.get(link.id)?.status === 'abandoned')
        .map((link) => link.id);
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
        deletableBranches: [],
        alerts: rules
          ? alertsOf(workItem, related, itemPullRequests, rules, azdoRepository.id, abandonedTaskPullRequestIds, {
              iteration: alertIteration(workItem, schedule),
              duplicates: alertDuplicates(workItem, dependencies, schedule),
            })
          : [],
        inReview: isInReview(workItem.state, taskRefsOf(workItem, related, azdoRepository.id), pullRequestTaskPattern),
        taskBranches: taskBranchNamesOf(workItem, related, azdoRepository.id),
        taskPullRequestLinks,
        completion: rules && completionIssuesOf(workItem, rules),
        predecessors: dependencies.predecessors.get(workItem.id),
        successors: dependencies.successors.get(workItem.id),
        duplicateOf: dependencies.duplicateOf.get(workItem.id),
        duplicates: dependencies.duplicates.get(workItem.id),
      };
    });
    await this.findDeletableBranches(client, azdoRepository.id, entries, [...pullRequests.values()]);
    return entries;
  }

  // Rule DELETABLE-4
  /**
   * Sets the branches to delete of every entry: the ones of this repository with a completed PR (and no active
   * one) that still exist. Only those are asked to Azure DevOps (cached like the task branches)
   */
  private async findDeletableBranches(
    client: AzdoClient,
    repositoryId: string,
    entries: WorkItemEntry[],
    pullRequests: PullRequestDetails[]
  ): Promise<void> {
    const namesOf = (entry: WorkItemEntry) =>
      entry.branches.filter((branch) => !branch.otherRepository).map((branch) => branch.name);
    const toAsk = entries.flatMap((entry) =>
      branchesToCheckRemotely(namesOf(entry), pullRequests, this.localBranches, repositoryId)
    );
    await this.verifyBranches(client, repositoryId, toAsk);
    for (const entry of entries) {
      entry.deletableBranches = deletableBranches({
        names: namesOf(entry),
        pullRequests,
        repositoryId,
        local: this.localBranches,
        remoteExists: (name) => this.branchExistenceCache.get(this.branchKey(repositoryId, name))?.exists,
      });
    }
  }

  // Rule MYPR-OFFER-2
  /**
   * Source branch of a completed PR when it should be offered for deletion: it still exists (locally or in Azure
   * DevOps) in the open repository and no other PR from it is active. Up to three requests; undefined on any doubt
   */
  async mergedBranchToDelete(client: AzdoClient, pr: PullRequestDetails): Promise<string | undefined> {
    const name = pr.sourceRefName.replace('refs/heads/', '');
    if (pr.status !== 'completed' || isProtectedBranch(name) || name === settings().baseBranch) {
      return undefined;
    }
    const repository = this.repository();
    if (!repository || isOtherRepository(pr.repository.id, this.repositoryId)) {
      return undefined;
    }
    try {
      const [local, remoteObjectId, activeId] = await Promise.all([
        repository.getBranch(name).catch(() => undefined),
        client.getBranchObjectId(pr.repository.id, name),
        client.findActivePullRequestId(pr.repository.id, name),
      ]);
      return activeId === undefined && (local || remoteObjectId) ? name : undefined;
    } catch {
      return undefined;
    }
  }

  /** The branch was deleted from Azure DevOps: do not trust a cached "exists" for it */
  forgetBranch(name: string): void {
    if (this.repositoryId) {
      this.branchExistenceCache.set(this.branchKey(this.repositoryId, name), { exists: false, at: Date.now() });
    }
  }

  /** Every branch to delete of the work items in the list, once each, with the work item it was found on */
  deletableBranchList(): { name: string; entry: WorkItemEntry }[] {
    const seen = new Set<string>();
    const firstTime = (name: string): boolean => {
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    };
    return this.entries.flatMap((entry) => entry.deletableBranches.filter(firstTime).map((name) => ({ name, entry })));
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

  private branchKey(repositoryId: string, name: string): string {
    return `${repositoryId.toLowerCase()}\n${name}`;
  }

  /**
   * Asks Azure DevOps whether the branches linked to tasks exist: the Development links outlive deleted branches.
   * Only the ones not asked in the last BRANCH_EXISTENCE_TTL_MS; the ones that fail stay unknown and are asked again
   */
  private async verifyTaskBranches(
    client: AzdoClient,
    repositoryId: string,
    links: { repositoryId: string; name: string }[]
  ): Promise<void> {
    const now = Date.now();
    await this.verifyBranches(
      client,
      repositoryId,
      branchesToVerify(links, repositoryId, (name) => this.isExistenceFresh(repositoryId, name, now))
    );
  }

  private isExistenceFresh(repositoryId: string, name: string, now: number): boolean {
    const known = this.branchExistenceCache.get(this.branchKey(repositoryId, name));
    return !!known && now - known.at < BRANCH_EXISTENCE_TTL_MS;
  }

  /** Asks Azure DevOps whether the branches exist, except the ones asked recently; failures stay unknown */
  private async verifyBranches(client: AzdoClient, repositoryId: string, branchNames: string[]): Promise<void> {
    const now = Date.now();
    const names = [...new Set(branchNames)].filter((name) => !this.isExistenceFresh(repositoryId, name, now));
    await Promise.all(
      names.map(async (name) => {
        try {
          const objectId = await client.getBranchObjectId(repositoryId, name);
          this.branchExistenceCache.set(this.branchKey(repositoryId, name), { exists: !!objectId, at: now });
        } catch {
          // Unknown: shown as not verified
        }
      })
    );
  }

  /** Branches linked to a task as the icons of its row show them */
  private taskBranches(
    task: WorkItem,
    pullRequests: PullRequestDetails[],
    currentBranch: string | undefined,
    deletable: readonly string[] = []
  ): TaskBranchModel[] {
    const repositoryId = this.repositoryId;
    return toTaskBranchModels(task.links.branches, pullRequests, {
      repositoryId,
      repositoryNames: this.repositoryNameById,
      currentBranch,
      local: this.localBranches,
      deletable,
      remoteExists: (name) =>
        repositoryId ? this.branchExistenceCache.get(this.branchKey(repositoryId, name))?.exists : undefined,
    });
  }

  /** Branches linked to a task of the list or of another developer, of the open repository: the ones that can be checked out from its row */
  taskBranchNames(taskId: number): string[] {
    const task =
      this.find(taskId)?.workItem ??
      this.entries.flatMap((entry) => entry.otherTasks).find((other) => other.workItem.id === taskId)?.workItem;
    return (task?.links.branches ?? [])
      .filter((link) => !isOtherRepository(link.repositoryId, this.repositoryId))
      .map((link) => link.name);
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
      inReview,
      branch,
      branchLocation,
      branches,
      deletableBranches,
      pullRequests,
      predecessors,
      successors,
      duplicateOf,
      duplicates,
      otherTasks,
      completion,
    }: WorkItemEntry,
    currentBranch: string | undefined,
    completedStates: string[],
    { levels, worktreeBranches }: WorkingOnState
  ): WorkItemModel {
    const taskLevel = (task: WorkItem) =>
      taskWorkingOn(branchNamesOf(task.links.branches, this.repositoryId), currentBranch, worktreeBranches);
    const taskBranches =
      workItem.type === 'Task' ? this.taskBranches(workItem, pullRequests, currentBranch, deletableBranches) : [];
    return {
      id: workItem.id,
      title: workItem.title,
      type: workItem.type,
      state: workItem.state,
      displayState: shownState(workItem.state, inReview, settings().showInReviewState),
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
      deletableBranches,
      // Active PRs first, then the most recent
      pullRequests: pullRequests
        .map((pr) => toPullRequestModel(pr, this.runs.get(pr.pullRequestId) ?? [], this.repositoryId))
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.id - a.id),
      // Rule COMPLETE-1: a closed work item has nothing left to complete
      openPredecessors: isClosedState(workItem.state)
        ? predecessors && []
        : predecessors && openPredecessors(workItem, predecessors, completedStates, this.schedule),
      blockingTags: completion?.blockingTags,
      missingFields: completion?.missingFields,
      ...fixLinks(workItem, predecessors, successors),
      ...duplicateLinks(duplicateOf, duplicates, this.schedule),
      taskPullRequests: workItem.type === 'Task' ? this.taskPullRequests(pullRequests) : [],
      taskBranches,
      taskWorkingOn: workItem.type === 'Task' ? taskLevel(workItem) : undefined,
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
          branches: taskBranches,
        }),
      canLinkBranch:
        workItem.type === 'Task' &&
        canLinkBranchForTask({ taskState: workItem.state, parentState: this.parentState(workItem) }),
      otherTasks: otherTasks.map(({ workItem: task, pullRequests: taskPullRequests }) => {
        const otherBranches = this.taskBranches(task, taskPullRequests, currentBranch);
        return {
          id: task.id,
          title: task.title,
          type: task.type,
          state: task.state,
          assignedTo: task.assignedTo,
          taskPullRequests: this.taskPullRequests(taskPullRequests),
          taskBranches: otherBranches,
          taskWorkingOn: taskLevel(task),
          canCreateBranch: canCreateBranchForTask({
            taskState: task.state,
            parentState: workItem.state,
            branches: task.links.branches,
          }),
          canCreatePullRequest: canCreatePullRequestForTask({
            taskState: task.state,
            parentState: workItem.state,
            pullRequests: taskPullRequests,
            branches: otherBranches,
          }),
          canLinkBranch: canLinkBranchForTask({ taskState: task.state, parentState: workItem.state }),
        };
      }),
    };
  }

  /**
   * Work items being worked on: their branch (or the PR of the branch, or the branch of one of their tasks) is
   * checked out here or in another worktree. The worktree branches also mark the task rows
   */
  private workingOnState(currentBranch: string | undefined): WorkingOnState {
    const { showWorktrees, includeLinkedWorkItems } = settings().workingOn;
    const worktreeBranches = showWorktrees ? otherWorktreeBranches(this.worktrees, this.openFolders()) : [];
    return {
      worktreeBranches,
      levels: workingOnLevels({
        currentBranch,
        worktreeBranches,
        entries: this.entries,
        includeLinked: includeLinkedWorkItems,
      }),
    };
  }

  /** Card data of one work item, or undefined when it is not in the current iterations */
  workItemModel(id: number): WorkItemModel | undefined {
    const entry = this.find(id);
    const currentBranch = this.repository()?.state.HEAD?.name;
    return (
      entry &&
      this.toModel(entry, currentBranch, settings().dependencies.completedStates, this.workingOnState(currentBranch))
    );
  }

  toViewModel(
    filter: FilterModel
  ): Omit<
    ViewModel,
    | 'alwaysShowAlerts'
    | 'coverage'
    | 'popoverDelay'
    | 'hoverStyle'
    | 'layout'
    | 'pullRequests'
    | 'reviews'
    | 'tasksCountStyle'
    | 'workingOn'
  > {
    const currentBranch = this.repository()?.state.HEAD?.name;
    const { completedStates } = settings().dependencies;
    const state = this.workingOnState(currentBranch);
    const workItems = this.entries.map((entry) => this.toModel(entry, currentBranch, completedStates, state));
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
