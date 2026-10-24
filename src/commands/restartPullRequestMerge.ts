import * as vscode from 'vscode';
import { AzdoClient } from '../azdoClient';
import { AuthoredPullRequest } from '../myPullRequests';

// Rule MYPR-ACT-7
/**
 * "Restart merge" of a PR whose branch is behind its target: Azure DevOps only finds the conflicts with the new
 * commits of the target when it merges again (a push, a completion or this). Asks first: it is a write
 */
export async function restartPullRequestMerge(
  client: AzdoClient,
  pr: AuthoredPullRequest,
  refresh: () => Promise<void>
): Promise<void> {
  const target = pr.targetRefName.replace(/^refs\/heads\//, '');
  const restart = 'Restart merge';
  const answer = await vscode.window.showInformationMessage(
    `Restart the merge of PR ${pr.pullRequestId}?`,
    {
      modal: true,
      detail: `Azure DevOps merges the branch again with the latest ${target}: conflicts with the commits added since show on the card.`,
    },
    restart
  );
  if (answer !== restart) {
    return;
  }
  await client.restartPullRequestMerge(pr.repository.id, pr.pullRequestId);
  void vscode.window.setStatusBarMessage(`$(sync) PR ${pr.pullRequestId}: merge restarted`, 5000);
  await refresh();
}
