/** Shaping of the PRs of a work item card. Pure, so no "vscode" import: the webview bundles part of it */
import type { PullRequestDetails } from './azdoClient';
import type { RunModel } from './pipelines';
import type { PullRequestModel } from './viewModel';
import { pullRequestStatus } from './workItemLinks';

/** The PR is in a repository other than the one open in VS Code. Unknown local repository: nothing is flagged */
export function isOtherRepository(prRepositoryId: string, localRepositoryId?: string): boolean {
  return !!localRepositoryId && prRepositoryId.toLowerCase() !== localRepositoryId.toLowerCase();
}

export function toPullRequestModel(
  pr: PullRequestDetails,
  runs: RunModel[],
  localRepositoryId?: string
): PullRequestModel {
  const { label, tone } = pullRequestStatus(pr);
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: label,
    tone,
    url: pr.webUrl,
    isActive: pr.status === 'active',
    runs,
    repository: pr.repository.name,
    otherRepository: isOtherRepository(pr.repository.id, localRepositoryId),
  };
}

/** Tooltip of a PR: the repository is named when it is not the open one */
export function pullRequestTooltip(
  pr: Pick<PullRequestModel, 'id' | 'title' | 'repository' | 'otherRepository'>
): string {
  return pr.otherRepository ? `PR ${pr.id} · ${pr.repository}: ${pr.title} — in another repository` : pr.title;
}
