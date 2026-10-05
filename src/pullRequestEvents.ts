/** Pure detection of the events of the user's PRs, by comparing two snapshots. No "vscode" import */

export interface CommentSnapshot {
  /** "<threadId>:<commentId>" */
  key: string;
  authorId: string;
  author: string;
  content: string;
}

export interface ReviewerSnapshot {
  id: string;
  name: string;
  vote: number;
}

/** State of a PR as fetched from Azure DevOps */
export interface PullRequestSnapshot {
  id: number;
  title: string;
  status: string;
  url: string;
  reviewers: ReviewerSnapshot[];
  /** Comments of the threads; undefined when they were not fetched (e.g. completed PRs) */
  comments?: CommentSnapshot[];
}

/** What is remembered between polls */
export interface StoredPullRequest {
  status: string;
  votes: Record<string, number>;
  commentKeys: string[];
}

export type StoredSnapshot = Partial<Record<number, StoredPullRequest>>;

export type PullRequestEvent =
  | { kind: 'comments'; pullRequest: PullRequestSnapshot; comments: CommentSnapshot[] }
  | { kind: 'merged'; pullRequest: PullRequestSnapshot }
  | { kind: 'vote'; pullRequest: PullRequestSnapshot; reviewer: ReviewerSnapshot };

export type PullRequestEventKind = PullRequestEvent['kind'];

export function toStored(pullRequests: PullRequestSnapshot[], previous: StoredSnapshot): StoredSnapshot {
  return Object.fromEntries(
    pullRequests.map((pr) => [
      pr.id,
      {
        status: pr.status,
        votes: Object.fromEntries(pr.reviewers.map((reviewer) => [reviewer.id, reviewer.vote])),
        // Keep the known comments when the threads were not fetched this time
        commentKeys: pr.comments?.map((comment) => comment.key) ?? previous[pr.id]?.commentKeys ?? [],
      },
    ])
  );
}

/** Events since the previous snapshot. PRs not seen before only establish a baseline */
export function detectEvents(
  previous: StoredSnapshot,
  current: PullRequestSnapshot[],
  myId: string
): PullRequestEvent[] {
  const events: PullRequestEvent[] = [];
  for (const pullRequest of current) {
    const before = previous[pullRequest.id];
    if (!before) {
      continue;
    }
    if (before.status === 'active' && pullRequest.status === 'completed') {
      events.push({ kind: 'merged', pullRequest });
    }
    for (const reviewer of pullRequest.reviewers) {
      // A vote reset to 0 ("no vote") is not worth a notification
      if (reviewer.id !== myId && reviewer.vote !== 0 && reviewer.vote !== (before.votes[reviewer.id] ?? 0)) {
        events.push({ kind: 'vote', pullRequest, reviewer });
      }
    }
    const known = new Set(before.commentKeys);
    const comments = (pullRequest.comments ?? []).filter(
      (comment) => !known.has(comment.key) && comment.authorId !== myId
    );
    if (comments.length) {
      events.push({ kind: 'comments', pullRequest, comments });
    }
  }
  return events;
}

const MAX_EXCERPT = 100;

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_EXCERPT ? `${flat.slice(0, MAX_EXCERPT)}…` : flat;
}

const VOTE_VERBS: Partial<Record<number, string>> = {
  10: 'approved',
  5: 'approved with suggestions',
  [-5]: 'is waiting for the author on',
  [-10]: 'rejected',
};

export function describeEvent(event: PullRequestEvent): string {
  const pr = `PR ${event.pullRequest.id}`;
  switch (event.kind) {
    case 'merged':
      return `${pr} was merged: ${event.pullRequest.title}`;
    case 'vote':
      return `${event.reviewer.name} ${VOTE_VERBS[event.reviewer.vote] ?? 'voted on'} ${pr}: ${
        event.pullRequest.title
      }`;
    case 'comments': {
      const [first] = event.comments;
      if (event.comments.length === 1) {
        return `${first.author} commented on ${pr}: "${excerpt(first.content)}"`;
      }
      const authors = [...new Set(event.comments.map((comment) => comment.author))].join(', ');
      return `${event.comments.length} new comments on ${pr} (${authors}): ${event.pullRequest.title}`;
    }
  }
}
