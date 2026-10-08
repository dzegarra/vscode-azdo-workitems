/**
 * PRs linked to the tasks nested in a work item card: an icon per PR and a popover with what it is about.
 * Pure, so no "vscode" import: the webview bundles it
 */
import { isOtherRepository } from './pullRequestModel';
import { reviewerModels, ReviewerModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import { pullRequestStatus, PullRequestState, PullRequestTone } from './workItemLinks';

/** PR icons shown in a task row; the rest are listed in the tooltip of "+N" */
export const MAX_TASK_PULL_REQUEST_ICONS = 3;
/** Reviewers listed in the popover; the rest are counted */
export const MAX_TASK_REVIEWERS = 5;

/** What the popover of a PR icon shows */
export interface TaskPullRequestModel {
  id: number;
  title: string;
  /** "In review", "Draft", "Completed"… */
  status: string;
  tone: PullRequestTone;
  url: string;
  repository: string;
  /** The PR is in a repository other than the one open in VS Code */
  otherRepository: boolean;
  author?: string;
  /** Target branch; only when it is not the base branch */
  target?: string;
  /** Required reviewers first, at most MAX_TASK_REVIEWERS */
  reviewers: ReviewerModel[];
  /** Reviewers not listed */
  moreReviewers: number;
  /** Last CI run of each pipeline, when known (they are only followed for the PRs of the user's tasks) */
  runs: RunModel[];
}

export interface TaskPullRequestSource extends PullRequestState {
  pullRequestId: number;
  title: string;
  webUrl: string;
  targetRefName?: string;
  createdBy?: { id?: string; displayName?: string };
  repository: { id: string; name: string };
}

export interface TaskPullRequestContext {
  /** Id of the repository open in VS Code; undefined when unknown (no PR is then flagged) */
  repositoryId?: string;
  baseBranch: string;
  runs?: RunModel[];
}

function stripHeads(ref: string): string {
  return ref.replace(/^refs\/heads\//, '');
}

/** Pure shaping of a PR for the popover */
export function toTaskPullRequestModel(
  pr: TaskPullRequestSource,
  context: TaskPullRequestContext
): TaskPullRequestModel {
  const { label, tone } = pullRequestStatus(pr);
  const target = pr.targetRefName ? stripHeads(pr.targetRefName) : undefined;
  const reviewers = reviewerModels({ reviewers: pr.reviewers, createdBy: { id: pr.createdBy?.id } });
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: label,
    tone,
    url: pr.webUrl,
    repository: pr.repository.name,
    otherRepository: isOtherRepository(pr.repository.id, context.repositoryId),
    author: pr.createdBy?.displayName,
    target: target && target !== context.baseBranch ? target : undefined,
    reviewers: reviewers.slice(0, MAX_TASK_REVIEWERS),
    moreReviewers: Math.max(0, reviewers.length - MAX_TASK_REVIEWERS),
    runs: pr.status === 'active' ? context.runs ?? [] : [],
  };
}

/** Active PRs first, then the most recent one */
export function sortTaskPullRequests<T extends { id: number; tone: PullRequestTone }>(prs: T[]): T[] {
  const rank = (pr: T) => (pr.tone === 'completed' || pr.tone === 'abandoned' ? 1 : 0);
  return [...prs].sort((a, b) => rank(a) - rank(b) || b.id - a.id);
}

/** The PRs that get an icon and the ones that only appear in the tooltip of "+N" */
export function splitTaskPullRequests<T>(prs: T[], max = MAX_TASK_PULL_REQUEST_ICONS): { shown: T[]; hidden: T[] } {
  return { shown: prs.slice(0, max), hidden: prs.slice(max) };
}

/** One line of the tooltip of "+N" */
export function describeTaskPullRequest(pr: Pick<TaskPullRequestModel, 'id' | 'status' | 'title'>): string {
  return `PR ${pr.id} · ${pr.status} · ${pr.title}`;
}
