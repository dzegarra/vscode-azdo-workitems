/**
 * When a branch should be deleted: its PR was completed (merged). The team deletes the branches once their PR is
 * merged, whatever the state of the work item. Pure, so no "vscode" import
 */
import { isOtherRepository } from './pullRequestModel';

/** The part of a PR the rule needs */
export interface BranchPullRequest {
  sourceRefName: string;
  status: string;
  repository: { id: string };
}

const HEADS_PREFIX = 'refs/heads/';

function sourceBranch(pr: Pick<BranchPullRequest, 'sourceRefName'>): string {
  return pr.sourceRefName.replace(HEADS_PREFIX, '');
}

/** Branches that PRs merge into and out of, never offered for deletion even if a PR (e.g. develop to a release) used them as source */
export function isProtectedBranch(name: string): boolean {
  return ['develop', 'main', 'master'].includes(name) || name.startsWith('release/');
}

/**
 * Whether the PRs say the branch is merged: one of them (source = the branch, in this repository) is completed and
 * none is still active (a new PR may have been opened from the same branch). Abandoned PRs do not count; base
 * branches never are.
 * Whether the branch still exists is not part of this: see `deletableBranches`
 */
export function isBranchMerged(name: string, pullRequests: BranchPullRequest[], repositoryId?: string): boolean {
  if (isProtectedBranch(name)) {
    return false;
  }
  const own = pullRequests.filter(
    (pr) => sourceBranch(pr) === name && !(repositoryId && isOtherRepository(pr.repository.id, repositoryId))
  );
  return own.some((pr) => pr.status === 'completed') && !own.some((pr) => pr.status === 'active');
}

/** The branches (once each) that the PRs say are merged: the only ones worth asking Azure DevOps about */
export function mergedBranches(names: string[], pullRequests: BranchPullRequest[], repositoryId?: string): string[] {
  return [...new Set(names)].filter((name) => isBranchMerged(name, pullRequests, repositoryId));
}

export interface DeletableInput {
  /** Branches of this repository to consider (those of a work item, a task…) */
  names: string[];
  pullRequests: BranchPullRequest[];
  repositoryId?: string;
  /** Names of the local branches */
  local: readonly string[];
  /** Whether Azure DevOps has the branch (asked there, cached); undefined: unknown */
  remoteExists: (name: string) => boolean | undefined;
}

/**
 * The merged branches that still exist, locally or in Azure DevOps. A branch whose remote existence is unknown and
 * that is not local is left out (it is asked again next time)
 */
export function deletableBranches({
  names,
  pullRequests,
  repositoryId,
  local,
  remoteExists,
}: DeletableInput): string[] {
  return mergedBranches(names, pullRequests, repositoryId).filter(
    (name) => local.includes(name) || remoteExists(name) === true
  );
}

/** The merged branches that are not local: their existence in Azure DevOps has to be asked */
export function branchesToCheckRemotely(
  names: string[],
  pullRequests: BranchPullRequest[],
  local: readonly string[],
  repositoryId?: string
): string[] {
  return mergedBranches(names, pullRequests, repositoryId).filter((name) => !local.includes(name));
}

/** Text for the branch rows, signals and tooltips */
export function mergedBranchHint(): string {
  return 'The PR is merged: the branch should be deleted';
}

/** Title of the confirmation, naming the work item the branch belongs to when known */
export function deleteBranchQuestion(name: string, owner?: { type: string; id: number; state?: string }): string {
  if (!owner) {
    return `Delete the branch ${name}?`;
  }
  return `Delete the branch ${name} of ${owner.type} ${owner.id}${owner.state ? ` (${owner.state})` : ''}?`;
}

/** Question of the notification of a completed PR whose branch still exists */
export function deleteBranchOffer(pullRequestId: number, branch: string): string {
  return `PR ${pullRequestId} completed. Delete the branch ${branch}?`;
}
