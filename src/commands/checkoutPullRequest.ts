import { GitAPI } from '../git';
import { WorkItemsStore } from '../workItemsStore';
import { CheckoutChoice } from '../worktrees';
import { checkoutBranch } from './checkoutBranch';

/** What is needed to check out the branch of a PR: both the PRs to review and the PRs of the user fit */
export interface CheckoutTarget {
  id: number;
  title: string;
  repository: string;
  sourceBranch: string;
  /** The PR belongs to the repository open in VS Code */
  canCheckout?: boolean;
}

/**
 * Checks out the branch of a PR locally (to review it or to work on it): fetches it, switches to it (git creates the local branch
 * tracking the remote one) and, when the local branch existed and is behind, pulls the latest commits.
 * With uncommitted changes the user chooses between a worktree, stashing and checking out anyway
 */
export async function checkoutPullRequest(
  git: GitAPI,
  store: WorkItemsStore,
  request: CheckoutTarget,
  choice?: CheckoutChoice
): Promise<void> {
  if (!request.canCheckout) {
    throw new Error(`PR ${request.id} belongs to the ${request.repository} repository, which is not open in VS Code.`);
  }
  await checkoutBranch(
    git,
    store,
    { branch: request.sourceBranch, pullRequest: { id: request.id, title: request.title } },
    choice
  );
}
