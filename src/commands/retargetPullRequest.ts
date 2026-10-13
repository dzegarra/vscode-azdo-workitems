import * as vscode from 'vscode';
import { AzdoClient } from '../azdoClient';
import { AuthoredPullRequest } from '../myPullRequests';

// Rule FLOW-RETARGET-1
/** Moves a PR of the user to the base branch, after confirming: its base was merged, so the branch may need a rebase */
export async function retargetPullRequest(
  client: AzdoClient,
  pr: AuthoredPullRequest,
  baseBranch: string,
  refresh: () => Promise<void>
): Promise<void> {
  const retarget = `Retarget to ${baseBranch}`;
  const choice = await vscode.window.showWarningMessage(
    `Retarget PR ${pr.pullRequestId} to ${baseBranch}?`,
    {
      modal: true,
      detail:
        'You may need to rebase the branch: the base was probably squash-merged, so its commits would appear again.',
    },
    retarget
  );
  if (choice !== retarget) {
    return;
  }
  await client.updatePullRequestTarget(pr.repository.id, pr.pullRequestId, `refs/heads/${baseBranch}`);
  void vscode.window.showInformationMessage(`PR ${pr.pullRequestId} now targets ${baseBranch}.`);
  await refresh();
}
