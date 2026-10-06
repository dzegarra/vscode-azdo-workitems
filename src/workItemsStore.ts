import * as vscode from 'vscode';
import { AzdoClient, PullRequestDetails, WorkItem } from './azdoClient';
import { resolveContext, settings, DEFAULT_PULL_REQUEST_TASK_PATTERN } from './config';
import { GitAPI, pickRepository, Ref, REF_TYPE_HEAD, Repository } from './git';
import { TeamIteration } from './iterations';
import { branchBelongsToWorkItem } from './naming';
import { FilterModel, PullRequestModel, ViewModel, WorkItemModel } from './viewModel';
import { finishedRuns, isActive, latestRuns, RunModel } from './pipelines';
import { pullRequestStatus } from './workItemLinks';
import { parsePriority, PRIORITY_FIELD, SEVERITY_FIELD } from './priority';
import { AlertRules, findAlerts, parseTags, resolveFieldName, resolveRequiredFields, WorkItemAlert } from './alerts';

export interface WorkItemEntry {
  workItem: WorkItem;
  parent?: { id: number; title: string; type: string };
  alerts: WorkItemAlert[];
  branch?: string;
  branchLocation?: 'local' | 'remote';
  pullRequests: PullRequestDetails[];
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

/** PRs linked to the work items, fetched once even when linked to several of them */
async function fetchPullRequests(client: AzdoClient, workItems: WorkItem[]): Promise<Map<number, PullRequestDetails>> {
  const ids = [...new Set(workItems.flatMap((wi) => wi.links.pullRequests.map((pr) => pr.id)))];
  const results = await Promise.allSettled(ids.map((id) => client.getPullRequest(id)));
  const pullRequests = new Map<number, PullRequestDetails>();
  for (const result of results) {
    // PRs of other projects or deleted repositories are ignored
    if (result.status === 'fulfilled') {
      pullRequests.set(result.value.pullRequestId, result.value);
    }
  }
  return pullRequests;
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
    .map(({ id, title, state }) => ({ id, title, state }));
  return withQuickFixes(
    findAlerts(
      {
        type: workItem.type,
        state: workItem.state,
        tags: parseTags(workItem.fields['System.Tags']),
        fields: workItem.fields,
        tasks,
        pullRequests: pullRequests.map((pr) => ({ status: pr.status, isDraft: pr.isDraft })),
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

function toPullRequestModel(pr: PullRequestDetails, runs: RunModel[]): PullRequestModel {
  const { label, tone } = pullRequestStatus(pr);
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: label,
    tone,
    url: pr.webUrl,
    isActive: pr.status === 'active',
    runs,
  };
}

/** Last CI run of each pipeline of the given PRs. PRs whose runs cannot be fetched are skipped */
async function fetchRuns(client: AzdoClient, pullRequestIds: number[]): Promise<Map<number, RunModel[]>> {
  const results = await Promise.allSettled(
    pullRequestIds.map(async (id) => [id, latestRuns(await client.getPullRequestBuilds(id))] as const)
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
  /** CI runs of the active PRs, by PR */
  private runs = new Map<number, RunModel[]>();
  private loading?: Promise<void>;

  constructor(private readonly git: GitAPI) {}

  get workItems(): WorkItemEntry[] {
    return this.entries;
  }

  private activePullRequestIds(): number[] {
    const ids = this.entries.flatMap((entry) =>
      entry.pullRequests.filter((pr) => pr.status === 'active').map((pr) => pr.pullRequestId)
    );
    return [...new Set(ids)];
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
      runs.map((run) => ({ pullRequestId, title: titles.get(pullRequestId) ?? '', run }))
    );
  }

  findRun(runId: number): RunModel | undefined {
    return [...this.runs.values()].flat().find((run) => run.id === runId);
  }

  /**
   * Reloads only the CI runs (much cheaper than a full refresh).
   * Returns the runs that finished since the previous check, with their PR
   */
  async refreshRuns(): Promise<{ pullRequestId: number; run: RunModel }[]> {
    const previous = new Map([...this.runs.values()].flat().map((run) => [run.id, run.state]));
    const runs = await fetchRuns(resolveContext(this.repository()).client, this.activePullRequestIds());
    this.runs = runs;
    this.changeEmitter.fire();
    return [...runs].flatMap(([pullRequestId, prRuns]) =>
      finishedRuns(previous, prRuns).map((run) => ({ pullRequestId, run }))
    );
  }

  /** Work items with problems the developers must fix ASAP */
  get withAlerts(): WorkItemEntry[] {
    return this.entries.filter((entry) => entry.alerts.length);
  }

  find(id: number): WorkItemEntry | undefined {
    return this.entries.find((entry) => entry.workItem.id === id);
  }

  repository(): Repository | undefined {
    return this.git.repositories.length ? pickRepository(this.git) : undefined;
  }

  async ensureLoaded(): Promise<void> {
    this.loading ??= this.load();
    await this.loading;
  }

  async refresh(): Promise<void> {
    this.loading = this.load();
    await this.loading;
  }

  /** Lets the view re-render, e.g. when the checked out branch changes */
  notify(): void {
    this.changeEmitter.fire();
  }

  private async load(): Promise<void> {
    this.status = 'loading';
    this.changeEmitter.fire();
    try {
      this.entries = await this.fetch();
      this.runs = await fetchRuns(resolveContext(this.repository()).client, this.activePullRequestIds());
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
    const [pullRequests, related, rules] = await Promise.all([
      fetchPullRequests(client, workItems),
      fetchRelated(client, workItems),
      alertRules(client),
    ]);
    return workItems.map((workItem) => {
      const parent = workItem.links.parentId === undefined ? undefined : related.get(workItem.links.parentId);
      const itemPullRequests = workItem.links.pullRequests
        .map((link) => pullRequests.get(link.id))
        .filter((pr): pr is PullRequestDetails => !!pr);
      return {
        workItem,
        parent: parent && { id: parent.id, title: parent.title, type: parent.type },
        ...findBranch(workItem, branches, azdoRepository.id),
        pullRequests: itemPullRequests,
        alerts: rules ? alertsOf(workItem, related, itemPullRequests, rules) : [],
      };
    });
  }

  private toModel(
    { workItem, parent, alerts, branch, branchLocation, pullRequests }: WorkItemEntry,
    currentBranch: string | undefined
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
      // Active PRs first, then the most recent
      pullRequests: pullRequests
        .map((pr) => toPullRequestModel(pr, this.runs.get(pr.pullRequestId) ?? []))
        .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.id - a.id),
    };
  }

  /** Card data of one work item, or undefined when it is not in the current iterations */
  workItemModel(id: number): WorkItemModel | undefined {
    const entry = this.find(id);
    return entry && this.toModel(entry, this.repository()?.state.HEAD?.name);
  }

  toViewModel(filter: FilterModel): ViewModel {
    const currentBranch = this.repository()?.state.HEAD?.name;
    const workItems = this.entries.map((entry) => this.toModel(entry, currentBranch));
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
