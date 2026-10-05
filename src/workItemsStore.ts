import * as vscode from 'vscode';
import { AzdoClient, PullRequestDetails, WorkItem } from './azdoClient';
import { resolveContext, settings } from './config';
import { GitAPI, pickRepository, Ref, REF_TYPE_HEAD, Repository } from './git';
import { TeamIteration } from './iterations';
import { branchBelongsToWorkItem } from './naming';
import { FilterModel, PullRequestModel, ViewModel, WorkItemModel } from './viewModel';
import { pullRequestStatus } from './workItemLinks';

export interface WorkItemEntry {
  workItem: WorkItem;
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

function toPullRequestModel(pr: PullRequestDetails): PullRequestModel {
  const { label, tone } = pullRequestStatus(pr);
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: label,
    tone,
    url: pr.webUrl,
    isActive: pr.status === 'active',
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
  private loading?: Promise<void>;

  constructor(private readonly git: GitAPI) {}

  get workItems(): WorkItemEntry[] {
    return this.entries;
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
    const pullRequests = await fetchPullRequests(client, workItems);
    return workItems.map((workItem) => ({
      workItem,
      ...findBranch(workItem, branches, azdoRepository.id),
      pullRequests: workItem.links.pullRequests
        .map((link) => pullRequests.get(link.id))
        .filter((pr): pr is PullRequestDetails => !!pr),
    }));
  }

  private toModel(
    { workItem, branch, branchLocation, pullRequests }: WorkItemEntry,
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
      childCount: workItem.links.childIds.length,
      branch,
      branchLocation,
      isCurrentBranch: !!branch && branch === currentBranch,
      // Active PRs first, then the most recent
      pullRequests: pullRequests
        .map(toPullRequestModel)
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
