import * as vscode from 'vscode';
import { settings } from '../config';
import { GitAPI, pickRepository } from '../git';
import { ReviewRequestModel } from '../reviewRequests';

/**
 * Checks out the branch of a PR to review it locally: fetches it, switches to it (git creates the local branch
 * tracking the remote one) and, when the local branch existed and is behind, pulls the latest commits
 */
export async function checkoutPullRequest(git: GitAPI, request: ReviewRequestModel): Promise<void> {
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
  void vscode.window.showInformationMessage(`Checked out ${branch} to review PR ${request.id}: ${request.title}`);
}
