import { describe, expect, it } from 'vitest';
import {
  MAX_TASK_REVIEWERS,
  sortTaskPullRequests,
  TaskPullRequestSource,
  toTaskPullRequestModel,
} from './taskPullRequests';
import type { RunModel } from './pipelines';

function source(overrides: Partial<TaskPullRequestSource> = {}): TaskPullRequestSource {
  return {
    pullRequestId: 13713,
    title: 'Improves WiFi mode label handling',
    webUrl: 'https://dev.azure.com/o/p/_git/User_Interface/pullrequest/13713',
    status: 'active',
    isDraft: false,
    reviewers: [],
    targetRefName: 'refs/heads/develop',
    createdBy: { id: 'author', displayName: 'Daniel Zegarra EXT' },
    repository: { id: 'REPO-1', name: 'User_Interface' },
    ...overrides,
  };
}

const context = { repositoryId: 'repo-1', baseBranch: 'develop' };
const run: RunModel = { id: 1, pipeline: 'CI', state: 'succeeded', url: 'https://example.com/run/1' };

describe('toTaskPullRequestModel', () => {
  it('shapes the status, the repository and the author', () => {
    const model = toTaskPullRequestModel(source(), context);
    expect(model).toMatchObject({
      id: 13713,
      status: 'In review',
      tone: 'review',
      repository: 'User_Interface',
      otherRepository: false,
      author: 'Daniel Zegarra EXT',
      url: 'https://dev.azure.com/o/p/_git/User_Interface/pullrequest/13713',
    });
  });

  it('flags the PRs of another repository, ignoring the case of the ids', () => {
    const other = toTaskPullRequestModel(source({ repository: { id: 'other', name: 'Common' } }), context);
    expect(other.otherRepository).toBe(true);
    expect(toTaskPullRequestModel(source({ repository: { id: 'Repo-1', name: 'x' } }), context).otherRepository).toBe(
      false
    );
  });

  it('flags nothing when the repository open in VS Code is unknown', () => {
    expect(toTaskPullRequestModel(source(), { baseBranch: 'develop' }).otherRepository).toBe(false);
  });

  it('shows the target branch only when it is not the base branch', () => {
    expect(toTaskPullRequestModel(source(), context).target).toBeUndefined();
    expect(toTaskPullRequestModel(source({ targetRefName: 'refs/heads/release/2.1' }), context).target).toBe(
      'release/2.1'
    );
    expect(toTaskPullRequestModel(source({ targetRefName: undefined }), context).target).toBeUndefined();
  });

  it('lists the reviewers with their votes, required first, without the author', () => {
    const model = toTaskPullRequestModel(
      source({
        reviewers: [
          { id: 'author', displayName: 'Daniel', vote: 0 },
          { id: 'a', displayName: 'Optional', vote: 10 },
          { id: 'b', displayName: 'Required', vote: -5, isRequired: true },
        ],
      }),
      context
    );
    expect(model.reviewers.map(({ name, vote }) => [name, vote])).toEqual([
      ['Required', 'waiting'],
      ['Optional', 'approved'],
    ]);
    expect(model.moreReviewers).toBe(0);
  });

  it('keeps a few reviewers and counts the rest', () => {
    const reviewers = Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, displayName: `R${index}`, vote: 0 }));
    const model = toTaskPullRequestModel(source({ reviewers }), context);
    expect(model.reviewers).toHaveLength(MAX_TASK_REVIEWERS);
    expect(model.moreReviewers).toBe(8 - MAX_TASK_REVIEWERS);
  });

  it('gives the CI runs of active PRs only', () => {
    expect(toTaskPullRequestModel(source(), { ...context, runs: [run] }).runs).toEqual([run]);
    expect(toTaskPullRequestModel(source({ status: 'completed' }), { ...context, runs: [run] }).runs).toEqual([]);
    expect(toTaskPullRequestModel(source(), context).runs).toEqual([]);
  });

  it.each([
    [{ isDraft: true }, 'Draft', 'draft'],
    [{ status: 'completed' as const }, 'Completed', 'completed'],
    [{ status: 'abandoned' as const }, 'Abandoned', 'abandoned'],
    [{ reviewers: [{ displayName: 'X', vote: -10 }] }, 'Rejected', 'rejected'],
  ])('uses the status pill of the PRs for %j', (overrides, status, tone) => {
    expect(toTaskPullRequestModel(source(overrides), context)).toMatchObject({ status, tone });
  });
});

describe('sortTaskPullRequests', () => {
  it('puts the open PRs first, then the most recent', () => {
    const sorted = sortTaskPullRequests([
      { id: 5, tone: 'completed' as const },
      { id: 3, tone: 'review' as const },
      { id: 9, tone: 'abandoned' as const },
      { id: 4, tone: 'draft' as const },
    ]);
    expect(sorted.map((pr) => pr.id)).toEqual([4, 3, 9, 5]);
  });
});
