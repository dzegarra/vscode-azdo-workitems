/** Publishing a draft PR: confirmation, request and refresh. Pure (the steps are injected), so it can be tested */

export interface PublishSteps {
  /** Asks the user; true when they accept */
  confirm(message: string): Promise<boolean>;
  publish(): Promise<void>;
  /** Reloads the list once the PR is published */
  refresh(): Promise<void>;
}

// Rules FLOW-PUBLISH-1, FLOW-PUBLISH-2
/** Returns false when the user cancels: nothing is sent to Azure DevOps then */
export async function publishDraft(pullRequestId: number, isDraft: boolean, steps: PublishSteps): Promise<boolean> {
  if (!isDraft) {
    throw new Error(`PR ${pullRequestId} is not a draft any more.`);
  }
  if (!(await steps.confirm(`Publish PR ${pullRequestId}? Reviewers will be notified.`))) {
    return false;
  }
  await steps.publish();
  await steps.refresh();
  return true;
}
