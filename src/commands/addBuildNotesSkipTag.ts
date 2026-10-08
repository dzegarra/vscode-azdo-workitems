import * as vscode from 'vscode';
import { AzdoClient } from '../azdoClient';
import { buildNotesSettings } from '../config';
import { AuthoredPullRequest } from '../myPullRequests';

const ADD_TAG = 'Add tag';

/** Tags a PR of the user as having no changes for testers, after confirming */
export async function addBuildNotesSkipTag(
  client: AzdoClient,
  pr: AuthoredPullRequest,
  refresh: () => Promise<void>
): Promise<void> {
  const { skipTag } = buildNotesSettings();
  const choice = await vscode.window.showWarningMessage(
    `Tag PR ${pr.pullRequestId} with "${skipTag}"? Do this only if the PR has no changes testers should know about.`,
    { modal: true },
    ADD_TAG
  );
  if (choice !== ADD_TAG) {
    return;
  }
  await client.addPullRequestLabel(pr.repository.id, pr.pullRequestId, skipTag);
  void vscode.window.showInformationMessage(`PR ${pr.pullRequestId} tagged "${skipTag}".`);
  await refresh();
}
