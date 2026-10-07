import * as vscode from 'vscode';
import { settings } from '../config';
import { GitAPI, pickRepository } from '../git';

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
 * tracking the remote one) and, when the local branch existed and is behind, pulls the latest commits
 */
export async function checkoutPullRequest(git: GitAPI, request: CheckoutTarget): Promise<void> {
  if (!request.canCheckout) {
    throw new Error(`PR ${request.id} belongs to the ${request.repository} repository, which is not open in VS Code.`);
  }
  const repository = pickRepository(git);
  const branch = request.sourceBranch;
  const diverged = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Checking out ${branch} (PR ${request.id})…` },
    async () => {
      await repository.fetch(settings().remote, branch);
      await repository.checkout(branch);
      const local = await repository.getBranch(branch);
      if (local.behind && !local.ahead) {
        await repository.pull();
        return false;
      }
      return !!local.behind;
    }
  );
  if (diverged) {
    void vscode.window.showWarningMessage(
      `Checked out ${branch}, but it has local commits that are not in PR ${request.id}: it may not match the PR.`
    );
    return;
  }
  void vscode.window.showInformationMessage(`Checked out ${branch} (PR ${request.id}: ${request.title})`);
}
