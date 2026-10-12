/**
 * Branches linked to the tasks nested in a work item card: summarised by the pill of the task row.
 * Pure, so no "vscode" import: the webview bundles it
 */
import { isOtherRepository } from './pullRequestModel';
import { pullRequestStatus, PullRequestState, PullRequestTone } from './workItemLinks';

/** checked out here / exists / gone (the Development link remains) / in another repository */
export type TaskBranchState = 'current' | 'exists' | 'deleted' | 'other';

export interface TaskBranchModel {
  name: string;
  state: TaskBranchState;
  /** Repository name, when the branch is in another one and the name is known */
  repository?: string;
  /** "local and remote", "remote only", "local only", "not verified"; none for deleted / other repository */
  where?: string;
  /** The branch of this repository exists and can be checked out (or opened in its worktree) */
  canCheckout: boolean;
  /** The PR of the branch was completed and the branch still exists: it can be deleted (see deletableBranches.ts) */
  deletable?: boolean;
  /** The PR of the task that has this branch as source */
  pullRequest?: { id: number; status: string; tone: PullRequestTone };
}

export interface TaskBranchLink {
  repositoryId: string;
  name: string;
}

export interface TaskBranchPullRequest extends PullRequestState {
  pullRequestId: number;
  sourceRefName: string;
  repository: { id: string };
}

export interface TaskBranchContext {
  /** Id of the repository open in VS Code; undefined when unknown (every branch is then taken as being in it) */
  repositoryId?: string;
  repositoryNames?: ReadonlyMap<string, string>;
  currentBranch?: string;
  /** Names of the local branches */
  local: readonly string[];
  /** Names of the branches to delete (merged PR, still existing); see deletableBranches.ts */
  deletable?: readonly string[];
  /** Whether Azure DevOps has the branch (asked there, cached); undefined: unknown */
  remoteExists: (name: string) => boolean | undefined;
}

const HEADS_PREFIX = 'refs/heads/';

function whereOf(local: boolean, remote: boolean | undefined): string {
  if (remote === undefined) {
    return local ? 'local' : 'remote, not verified';
  }
  if (local) {
    return remote ? 'local and remote' : 'local only';
  }
  return 'remote only';
}

function pullRequestOf(
  link: TaskBranchLink,
  pullRequests: TaskBranchPullRequest[]
): TaskBranchModel['pullRequest'] | undefined {
  const matches = pullRequests.filter(
    (pr) =>
      pr.sourceRefName.replace(HEADS_PREFIX, '') === link.name &&
      pr.repository.id.toLowerCase() === link.repositoryId.toLowerCase()
  );
  const pr =
    matches.find((candidate) => candidate.status === 'active') ??
    matches.sort((a, b) => b.pullRequestId - a.pullRequestId)[0];
  if (!pr) {
    return undefined;
  }
  const { label, tone } = pullRequestStatus(pr);
  return { id: pr.pullRequestId, status: label, tone };
}

function toTaskBranch(
  link: TaskBranchLink,
  pullRequests: TaskBranchPullRequest[],
  context: TaskBranchContext
): TaskBranchModel {
  const pullRequest = pullRequestOf(link, pullRequests);
  if (isOtherRepository(link.repositoryId, context.repositoryId)) {
    return {
      name: link.name,
      state: 'other',
      repository: context.repositoryNames?.get(link.repositoryId.toLowerCase()),
      canCheckout: false,
      pullRequest,
    };
  }
  const local = context.local.includes(link.name);
  const remote = context.remoteExists(link.name);
  if (!local && remote === false) {
    return { name: link.name, state: 'deleted', canCheckout: false, pullRequest };
  }
  const isCurrent = link.name === context.currentBranch;
  return {
    name: link.name,
    state: isCurrent ? 'current' : 'exists',
    where: whereOf(local, remote),
    // Already checked out: nothing to do
    canCheckout: !isCurrent,
    ...(context.deletable?.includes(link.name) ? { deletable: true } : {}),
    pullRequest,
  };
}

const RANK: Record<TaskBranchState, number> = { current: 0, exists: 1, deleted: 2, other: 3 };

/**
 * The branches linked to a task (once each), the checked out one first, then the ones that exist, the deleted
 * ones and the ones of other repositories
 */
export function toTaskBranchModels(
  links: TaskBranchLink[],
  pullRequests: TaskBranchPullRequest[],
  context: TaskBranchContext
): TaskBranchModel[] {
  const seen = new Set<string>();
  const unique = links.filter((link) => {
    const key = `${link.repositoryId.toLowerCase()}\n${link.name}`;
    const duplicate = seen.has(key);
    seen.add(key);
    return !duplicate;
  });
  return unique.map((link) => toTaskBranch(link, pullRequests, context)).sort((a, b) => RANK[a.state] - RANK[b.state]);
}

/** Names of the linked branches of this repository whose existence in Azure DevOps is needed (not yet known) */
export function branchesToVerify(
  links: TaskBranchLink[],
  repositoryId: string | undefined,
  isKnown: (name: string) => boolean
): string[] {
  const names = links
    .filter((link) => !isOtherRepository(link.repositoryId, repositoryId))
    .map((link) => link.name)
    .filter((name) => !isKnown(name));
  return [...new Set(names)];
}

/** State of the branch in words, for tooltips */
export function describeTaskBranch(branch: Pick<TaskBranchModel, 'state' | 'where' | 'repository'>): string {
  switch (branch.state) {
    case 'current':
      return `checked out (${branch.where})`;
    case 'exists':
      return branch.where ?? 'exists';
    case 'deleted':
      return 'deleted';
    case 'other':
      return `in another repository${branch.repository ? ` (${branch.repository})` : ''}`;
  }
}
