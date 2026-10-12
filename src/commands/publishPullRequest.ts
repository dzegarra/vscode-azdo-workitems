import * as vscode from 'vscode';
import { AzdoClient } from '../azdoClient';
import { AuthoredPullRequest } from '../myPullRequests';
import { publishDraft } from '../publishFlow';
import { startPublishedPullRequestTasks } from './pullRequestTask';

const PUBLISH = 'Publish';

/** Takes a draft PR of the user out of draft, after confirming: the reviewers are notified */
export async function publishPullRequest(
  client: AzdoClient,
  pr: AuthoredPullRequest,
  refresh: () => Promise<void>
): Promise<void> {
  const published = await publishDraft(pr.pullRequestId, pr.isDraft, {
    confirm: async (message) => (await vscode.window.showWarningMessage(message, { modal: true }, PUBLISH)) === PUBLISH,
    publish: () => client.publishPullRequest(pr.repository.id, pr.pullRequestId),
    refresh,
  });
  if (published) {
    void vscode.window.showInformationMessage(`PR ${pr.pullRequestId} published: the reviewers were notified.`);
    await startPublishedPullRequestTasks(client, pr);
  }
}
