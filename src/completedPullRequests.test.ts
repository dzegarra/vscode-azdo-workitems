import { describe, expect, it } from 'vitest';
import type { AuthoredPullRequest } from './myPullRequests';
import type { ThreadResponse } from './reviewThreads';
import { completedPullRequestInfos, mergedInRange } from './completedPullRequests';

const day = (n: number): number => new Date(2026, 9, n, 12).getTime();
const iso = (n: number, hour = 12): string => new Date(2026, 9, n, hour).toISOString();

const author = { id: 'u', displayName: 'Ana' };
const published = (publishedDate: string): ThreadResponse => ({
  id: 1,
  publishedDate,
  threadContext: null,
  properties: { CodeReviewThreadType: { $value: 'IsDraftUpdate' }, CodeReviewIsDraftNowSet: { $value: '0' } },
  comments: [{ id: 1, author, content: 'published', commentType: 'system' }],
});

const authored = (overrides: Partial<AuthoredPullRequest> = {}): AuthoredPullRequest =>
  ({
    pullRequestId: 1,
    title: 'T',
    status: 'completed',
    isDraft: false,
    creationDate: iso(14, 9),
    closedDate: iso(16, 16),
    createdBy: { id: 'u' },
    targetRefName: 'refs/heads/develop',
    sourceRefName: 'refs/heads/x',
    repository: { id: 'r', name: 'User_Interface', project: { id: 'p' } },
    webUrl: '',
    reviewers: [],
    ...overrides,
  } as AuthoredPullRequest);

describe('completedPullRequestInfos (TIMELINE-17)', () => {
  it('takes the completed PRs of the list, without a request, with the publication when the threads are known', () => {
    const infos = completedPullRequestInfos([
      { pr: authored({ pullRequestId: 1 }), threads: [published(iso(14, 11))] },
      { pr: authored({ pullRequestId: 2 }) },
      { pr: authored({ pullRequestId: 3, status: 'active', closedDate: undefined }) },
      { pr: authored({ pullRequestId: 4, status: 'abandoned' }) },
    ]);
    expect(infos.map((pr) => pr.id)).toEqual([1, 2]);
    expect(infos[0]).toMatchObject({ publishedAt: iso(14, 11), threadsKnown: true, repository: 'User_Interface' });
    expect(infos[1]).toMatchObject({ publishedAt: undefined, threadsKnown: false });
  });

  it('takes the last vote from the threads (TIMELINE-16)', () => {
    const vote = {
      publishedDate: iso(15, 18),
      properties: { CodeReviewThreadType: { $value: 'VoteUpdate' }, CodeReviewVoteResult: { $value: '10' } },
    } as unknown as ThreadResponse;
    const [known, unknown] = completedPullRequestInfos([
      { pr: authored({ pullRequestId: 1 }), threads: [vote] },
      { pr: authored({ pullRequestId: 2 }) },
    ]);
    expect(known.lastVoteAt).toBe(iso(15, 18));
    expect(unknown.lastVoteAt).toBeUndefined();
  });

  it('knows the threads of a PR that was never a draft (no publication)', () => {
    expect(completedPullRequestInfos([{ pr: authored(), threads: [] }])[0]).toMatchObject({ threadsKnown: true });
  });
});

describe('mergedInRange (TIMELINE-17)', () => {
  it('is merged within the axis, from the start of its first day to the end of its last', () => {
    expect(mergedInRange({ closedDate: iso(16) }, day(12), day(24))).toBe(true);
    expect(mergedInRange({ closedDate: iso(5) }, day(12), day(24))).toBe(false);
    expect(mergedInRange({ closedDate: iso(30) }, day(12), day(24))).toBe(false);
  });
});
