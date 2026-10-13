/**
 * Base branch of a new branch. Branches start from the team's base branch (develop) by default; a different base
 * is opt-in, remembered in the local git config and used as the target of the PR. Pure, so no "vscode" import
 */

/** Local git config key that remembers the base of a branch created from another branch */
export function baseConfigKey(branch: string): string {
  return `branch.${branch}.totalflowxBase`;
}

export interface BaseBranchPullRequest {
  id: number;
  /** Without "refs/heads/" */
  sourceBranch: string;
  /** active, completed, abandoned… */
  status: string;
}

export interface BaseCandidate {
  name: string;
  /** PR status shown as description, e.g. "PR 13770 completed" */
  description?: string;
  /** The PR of the branch is completed: its changes are probably already in the base branch */
  completed: boolean;
}

export interface BaseCandidates {
  /** The team default, always first */
  defaultBase: BaseCandidate;
  /** Remote branches of the work item, the main one first */
  workItem: BaseCandidate[];
  /** All the other remote branches */
  others: BaseCandidate[];
}

export interface BaseCandidatesInput {
  defaultBase: string;
  /** Branches of the work item in this repository, in the order to show them (the main one first) */
  workItemBranches: string[];
  pullRequests: BaseBranchPullRequest[];
  /** Branches of the remote, without the remote name */
  remoteBranches: string[];
}

/** The PR to describe a branch: the active one, else the most recent (highest id) */
function pullRequestOf(branch: string, pullRequests: BaseBranchPullRequest[]): BaseBranchPullRequest | undefined {
  const own = pullRequests.filter((pr) => pr.sourceBranch === branch);
  return own.find((pr) => pr.status === 'active') ?? own.sort((a, b) => b.id - a.id).at(0);
}

function toCandidate(name: string, pullRequests: BaseBranchPullRequest[]): BaseCandidate {
  const pr = pullRequestOf(name, pullRequests);
  return { name, description: pr && `PR ${pr.id} ${pr.status}`, completed: pr?.status === 'completed' };
}

// Rule FLOW-BRANCH-5
/** Orders the branches a new branch can start from. Only branches that exist in the remote are candidates */
export function baseCandidates(input: BaseCandidatesInput): BaseCandidates {
  const { defaultBase, pullRequests } = input;
  const remote = new Set(input.remoteBranches);
  const ofWorkItem = [...new Set(input.workItemBranches)].filter((name) => name !== defaultBase && remote.has(name));
  const listed = new Set([defaultBase, ...ofWorkItem]);
  return {
    defaultBase: { name: defaultBase, completed: false },
    workItem: ofWorkItem.map((name) => toCandidate(name, pullRequests)),
    others: [...remote]
      .filter((name) => !listed.has(name))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, completed: false })),
  };
}

export interface TargetInput {
  /** Base stored for the branch; undefined or empty when none */
  stored: string | undefined;
  defaultBase: string;
  /** Branches of the remote, without the remote name */
  remoteBranches: string[];
  /** The base branch has a completed PR: it is probably merged into the default base */
  baseCompleted: boolean;
}

// Rule FLOW-PR-4
/** The stored base when it still makes sense as a target; undefined when the default applies */
export function usableStoredBase({
  stored,
  defaultBase,
  remoteBranches,
  baseCompleted,
}: TargetInput): string | undefined {
  const base = stored?.trim();
  if (!base || base === defaultBase || baseCompleted || !remoteBranches.includes(base)) {
    return undefined;
  }
  return base;
}
