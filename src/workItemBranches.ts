/** Every git branch of a work item, for its card. Pure, so no "vscode" import: the webview bundles part of it */
import type { PullRequestDetails } from './azdoClient';
import { branchBelongsToWorkItem } from './naming';
import { isOtherRepository } from './pullRequestModel';
import type { BranchModel } from './viewModel';

export type BranchLocation = 'local' | 'remote' | 'linked';

/** A branch found for the work item, before knowing what is checked out */
export interface EntryBranch {
  name: string;
  /** "local" / "remote": it exists in the open repository; "linked": only known from a link or a PR */
  location: BranchLocation;
  /** Name of the repository when it is another one and the name could be found */
  repository?: string;
  otherRepository: boolean;
}

export interface CollectBranchesInput {
  workItem: { id: number; links: { branches: { repositoryId: string; name: string }[] } };
  /** Names of the local branches and of the ones in the remote (without the remote name) of the open repository */
  local: string[];
  remote: string[];
  pullRequests: Pick<PullRequestDetails, 'sourceRefName' | 'status' | 'repository'>[];
  /** Id of the open repository; unknown: every branch is taken as being in it */
  repositoryId?: string;
  /** Names of the repositories by id (lower case) for the Development links of other repositories */
  repositoryNames?: ReadonlyMap<string, string>;
}

const HEADS_PREFIX = 'refs/heads/';

function locationIn(name: string, local: string[], remote: string[]): BranchLocation {
  if (local.includes(name)) {
    return 'local';
  }
  return remote.includes(name) ? 'remote' : 'linked';
}

// Rules BRANCH-SET-1..3
/**
 * Branches of the work item, once each (by repository and name): local and remote branches named after it, the ones
 * linked in its Development section and the source branches of its active PRs
 */
export function collectBranches({
  workItem,
  local,
  remote,
  pullRequests,
  repositoryId,
  repositoryNames,
}: CollectBranchesInput): EntryBranch[] {
  const found = new Map<string, EntryBranch>();
  const add = (name: string, branchRepositoryId: string | undefined, repositoryName?: string) => {
    const otherRepository = !!branchRepositoryId && isOtherRepository(branchRepositoryId, repositoryId);
    const key = `${otherRepository ? branchRepositoryId.toLowerCase() : ''}\n${name}`;
    if (found.has(key)) {
      return;
    }
    const location = otherRepository ? 'linked' : locationIn(name, local, remote);
    found.set(key, {
      name,
      location,
      otherRepository,
      repository: otherRepository
        ? repositoryName ?? repositoryNames?.get(branchRepositoryId.toLowerCase())
        : undefined,
    });
  };
  for (const name of local.filter((candidate) => branchBelongsToWorkItem(candidate, workItem.id))) {
    add(name, undefined);
  }
  for (const name of remote.filter((candidate) => branchBelongsToWorkItem(candidate, workItem.id))) {
    add(name, undefined);
  }
  for (const link of workItem.links.branches) {
    add(link.name, link.repositoryId);
  }
  for (const pr of pullRequests.filter((candidate) => candidate.status === 'active')) {
    add(pr.sourceRefName.replace(HEADS_PREFIX, ''), pr.repository.id, pr.repository.name);
  }
  return [...found.values()];
}

/** Ids of the other repositories whose name is not known yet (the PRs already say theirs) */
export function unknownRepositoryIds(
  workItems: CollectBranchesInput['workItem'][],
  repositoryId: string,
  known: ReadonlyMap<string, string>
): string[] {
  const ids = workItems
    .flatMap((workItem) => workItem.links.branches)
    .map((link) => link.repositoryId)
    .filter((id) => isOtherRepository(id, repositoryId) && !known.has(id.toLowerCase()));
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}

function rank(branch: BranchModel, mainBranch: string | undefined): number {
  if (branch.otherRepository) {
    return 3;
  }
  if (branch.isCurrent) {
    return 0;
  }
  return branch.name === mainBranch ? 1 : 2;
}

export interface BranchContext {
  currentBranch?: string;
  /** The branch the card's buttons act on */
  mainBranch?: string;
  worktreeFor: (branch: string) => string | undefined;
}

// Rule BRANCH-SET-4
/** Branches as the card shows them: the checked out one first, then the main branch, the rest of this repository and the other repositories */
export function toBranchModels(branches: EntryBranch[], context: BranchContext): BranchModel[] {
  return branches
    .map((branch): BranchModel => {
      const isCurrent = !branch.otherRepository && branch.name === context.currentBranch;
      return {
        name: branch.name,
        location: isCurrent ? 'current' : branch.location,
        isCurrent,
        worktree: branch.otherRepository || isCurrent ? undefined : context.worktreeFor(branch.name),
        repository: branch.repository,
        otherRepository: branch.otherRepository,
      };
    })
    .sort((a, b) => rank(a, context.mainBranch) - rank(b, context.mainBranch));
}

/** A branch of the open repository that can be checked out */
export function isCheckoutBranch(branches: Pick<EntryBranch, 'name' | 'otherRepository'>[], name: string): boolean {
  return branches.some((branch) => branch.name === name && !branch.otherRepository);
}

export function branchTooltip(
  branch: Pick<BranchModel, 'name' | 'location' | 'repository' | 'otherRepository'>
): string {
  if (branch.otherRepository) {
    return `${branch.name}${branch.repository ? ` · ${branch.repository}` : ''} — in another repository`;
  }
  return `${branch.name} (${branch.location})`;
}
