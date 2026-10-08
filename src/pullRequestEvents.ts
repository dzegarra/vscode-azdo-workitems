import { excerpt } from './reviewThreads';

/** Pure detection of the events of the user's PRs, by comparing two snapshots. No "vscode" import */

export interface CommentSnapshot {
  /** "<threadId>:<commentId>" */
  key: string;
  threadId: number;
  authorId: string;
  author: string;
  content: string;
  /** File the thread is about, e.g. "/packages/fui-admin/Header.tsx"; undefined for PR-level threads */
  filePath?: string;
  /** Author of the first comment of the thread */
  threadStarterId: string;
  /** The comment is the first one of its thread */
  startsThread: boolean;
}

/** Text thread (its first comment is a non-deleted text comment) */
export interface ThreadSnapshot {
  id: number;
  /** active, pending, fixed, wontFix, closed, byDesign… */
  status: string;
  filePath?: string;
  /** Text of the first comment */
  firstContent: string;
}

export interface ReviewerSnapshot {
  id: string;
  name: string;
  vote: number;
  required: boolean;
  declined: boolean;
}

export interface Person {
  id: string;
  name: string;
}

/** added: now a required reviewer; required/optional: switch of an existing reviewer */
export type ReviewerChangeKind = 'added' | 'removed' | 'declined' | 'required' | 'optional';

export interface ReviewerChange {
  kind: ReviewerChangeKind;
  /** Who did it; undefined when only the reviewer list told */
  actor?: Person;
  target: Person;
}

/** Change explained by a "ReviewersUpdate" system thread */
export interface ReviewerUpdate extends ReviewerChange {
  threadId: number;
}

/** State of a PR as fetched from Azure DevOps */
export interface PullRequestSnapshot {
  id: number;
  title: string;
  status: string;
  url: string;
  /** People only: groups are left out */
  reviewers: ReviewerSnapshot[];
  /** Comments of the threads; undefined when they were not fetched (e.g. completed PRs) */
  comments?: CommentSnapshot[];
  /** Text threads; undefined when the threads were not fetched */
  threads?: ThreadSnapshot[];
  /** People changes of the reviewers explained by system threads; undefined when the threads were not fetched */
  reviewerUpdates?: ReviewerUpdate[];
  /** IDs of all the "ReviewersUpdate" threads (also of groups); undefined when the threads were not fetched */
  reviewerUpdateIds?: number[];
}

/** What is remembered between polls */
export interface StoredPullRequest {
  status: string;
  votes: Record<string, number>;
  commentKeys: string[];
  /** Missing in snapshots stored by older versions: the new kinds of events only establish a baseline */
  reviewers?: Record<string, { name: string; required: boolean; declined: boolean }>;
  reviewerUpdateIds?: number[];
  threadStatuses?: Record<number, string>;
}

export type StoredSnapshot = Partial<Record<number, StoredPullRequest>>;

export interface NotifiedComment extends CommentSnapshot {
  /** The thread was started by the user */
  startedByMe: boolean;
}

export type PullRequestEvent =
  | { kind: 'comments'; pullRequest: PullRequestSnapshot; comments: NotifiedComment[] }
  | { kind: 'merged'; pullRequest: PullRequestSnapshot }
  | { kind: 'vote'; pullRequest: PullRequestSnapshot; reviewer: ReviewerSnapshot }
  | { kind: 'reviewers'; pullRequest: PullRequestSnapshot; changes: ReviewerChange[] }
  | {
      kind: 'reopened';
      pullRequest: PullRequestSnapshot;
      thread: ThreadSnapshot;
      /** Author of the latest new comment of the thread by someone else */
      by?: string;
    };

export type PullRequestEventKind = PullRequestEvent['kind'];

export function toStored(pullRequests: PullRequestSnapshot[], previous: StoredSnapshot): StoredSnapshot {
  return Object.fromEntries(
    pullRequests.map((pr) => [
      pr.id,
      {
        status: pr.status,
        votes: Object.fromEntries(pr.reviewers.map((reviewer) => [reviewer.id, reviewer.vote])),
        // Keep the known data when the threads were not fetched this time
        commentKeys: pr.comments?.map((comment) => comment.key) ?? previous[pr.id]?.commentKeys ?? [],
        reviewers: Object.fromEntries(
          pr.reviewers.map((reviewer) => [
            reviewer.id,
            { name: reviewer.name, required: reviewer.required, declined: reviewer.declined },
          ])
        ),
        reviewerUpdateIds: pr.reviewerUpdateIds ?? previous[pr.id]?.reviewerUpdateIds,
        threadStatuses: pr.threads
          ? Object.fromEntries(pr.threads.map((thread) => [thread.id, thread.status]))
          : previous[pr.id]?.threadStatuses,
      },
    ])
  );
}

const CLOSED_STATUSES = ['fixed', 'wontFix', 'closed', 'byDesign'];
const REOPENED_STATUSES = ['active', 'pending'];

function detectReopened(
  before: StoredPullRequest,
  pullRequest: PullRequestSnapshot,
  myId: string
): Extract<PullRequestEvent, { kind: 'reopened' }>[] {
  if (!before.threadStatuses || !pullRequest.threads) {
    return [];
  }
  const { threadStatuses } = before;
  const known = new Set(before.commentKeys);
  return pullRequest.threads.flatMap((thread) => {
    const was = threadStatuses[thread.id];
    if (!was || !CLOSED_STATUSES.includes(was) || !REOPENED_STATUSES.includes(thread.status)) {
      return [];
    }
    const added = (pullRequest.comments ?? []).filter(
      (comment) => comment.threadId === thread.id && !known.has(comment.key)
    );
    const others = added.filter((comment) => comment.authorId !== myId);
    // Only comments of the user came with it: the user reopened it
    if (added.length && !others.length) {
      return [];
    }
    return [{ kind: 'reopened' as const, pullRequest, thread, by: others.at(-1)?.author }];
  });
}

/** Fallback for the reviewers without any "ReviewersUpdate" thread: the changes are told by the list alone */
function diffReviewers(
  stored: NonNullable<StoredPullRequest['reviewers']>,
  reviewers: ReviewerSnapshot[],
  touched: Set<string>,
  myId: string
): ReviewerChange[] {
  const changes: ReviewerChange[] = [];
  for (const reviewer of reviewers) {
    const was = stored[reviewer.id];
    const target = { id: reviewer.id, name: reviewer.name };
    if (touched.has(reviewer.id) || reviewer.id === myId) {
      continue;
    }
    if (!was) {
      if (reviewer.required) {
        changes.push({ kind: 'added', target });
      }
    } else if (reviewer.declined && !was.declined) {
      changes.push({ kind: 'declined', target });
    } else if (reviewer.required !== was.required) {
      changes.push({ kind: reviewer.required ? 'required' : 'optional', target });
    }
  }
  const present = new Set(reviewers.map((reviewer) => reviewer.id));
  for (const [id, was] of Object.entries(stored)) {
    if (!present.has(id) && !touched.has(id) && id !== myId) {
      changes.push({ kind: 'removed', target: { id, name: was.name } });
    }
  }
  return changes;
}

/** People that became required reviewers, left, declined or switched between required and optional */
function detectReviewerChanges(before: StoredPullRequest, pullRequest: PullRequestSnapshot, myId: string) {
  const { reviewerUpdates } = pullRequest;
  if (!before.reviewers || !before.reviewerUpdateIds || !reviewerUpdates) {
    return [];
  }
  const known = new Set(before.reviewerUpdateIds);
  const current = new Map(pullRequest.reviewers.map((reviewer) => [reviewer.id, reviewer]));
  const fresh = reviewerUpdates.filter(
    (update) =>
      !known.has(update.threadId) &&
      update.actor?.id !== myId &&
      // Added as optional: not worth a notification
      (update.kind !== 'added' || current.get(update.target.id)?.required)
  );
  const added = new Set(fresh.filter((update) => update.kind === 'added').map((update) => update.target.id));
  const fromThreads = fresh.filter((update) => update.kind !== 'required' || !added.has(update.target.id));
  const touched = new Set(reviewerUpdates.map((update) => update.target.id));
  return [
    ...fromThreads.map(({ kind, actor, target }): ReviewerChange => ({ kind, actor, target })),
    ...diffReviewers(before.reviewers, pullRequest.reviewers, touched, myId),
  ];
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
    const changes = detectReviewerChanges(before, pullRequest, myId);
    if (changes.length) {
      events.push({ kind: 'reviewers', pullRequest, changes });
    }
    const reopened = detectReopened(before, pullRequest, myId);
    events.push(...reopened);
    const reopenedThreads = new Set(reopened.map((event) => event.thread.id));
    const known = new Set(before.commentKeys);
    const comments = (pullRequest.comments ?? [])
      .filter(
        (comment) => !known.has(comment.key) && comment.authorId !== myId && !reopenedThreads.has(comment.threadId)
      )
      .map((comment) => ({ ...comment, startedByMe: comment.threadStarterId === myId }));
    if (comments.length) {
      events.push({ kind: 'comments', pullRequest, comments });
    }
  }
  return events;
}

/** Thread to open for the "Open Comment" button: the latest comment of a grouped event */
export function commentThreadId(event: PullRequestEvent): number | undefined {
  switch (event.kind) {
    case 'comments':
      return event.comments.at(-1)?.threadId;
    case 'reopened':
      return event.thread.id;
    case 'merged':
    case 'vote':
    case 'reviewers':
      return undefined;
  }
}

const VOTE_VERBS: Partial<Record<number, string>> = {
  10: 'approved',
  5: 'approved with suggestions',
  [-5]: 'is waiting for the author on',
  [-10]: 'rejected',
};

function fileName(filePath: string | undefined): string | undefined {
  return filePath?.split('/').at(-1) || undefined;
}

function describeComment(comment: NotifiedComment, pr: string): string {
  const file = fileName(comment.filePath);
  const quote = `"${excerpt(comment.content)}"`;
  if (comment.startsThread) {
    return `${comment.author} left a comment on ${file ? `${file} in ${pr}` : pr}: ${quote}`;
  }
  const where = file ? `${pr} (${file})` : pr;
  return comment.startedByMe
    ? `${comment.author} replied to your comment on ${where}: ${quote}`
    : `${comment.author} replied in a comment on ${where}: ${quote}`;
}

function describeReviewerChange({ kind, actor, target }: ReviewerChange, pr: string): string {
  const who = actor?.id === target.id ? 'themselves' : target.name;
  const changedBy = actor && actor.id !== target.id ? ` (changed by ${actor.name})` : '';
  switch (kind) {
    case 'added':
      return actor
        ? `${actor.name} added ${who} as a required reviewer of ${pr}`
        : `${target.name} is now a required reviewer of ${pr}`;
    case 'removed':
      return actor
        ? `${actor.name} removed ${who} as a reviewer of ${pr}`
        : `${target.name} is no longer a reviewer of ${pr}`;
    case 'declined':
      return `${target.name} declined to review ${pr}`;
    case 'required':
      return `${target.name} is now a required reviewer of ${pr}${changedBy}`;
    case 'optional':
      return `${target.name} is now an optional reviewer of ${pr}${changedBy}`;
  }
}

export function describeEvent(event: PullRequestEvent): string {
  const pr = `PR ${event.pullRequest.id}`;
  switch (event.kind) {
    case 'merged':
      return `${pr} was merged: ${event.pullRequest.title}`;
    case 'vote':
      return `${event.reviewer.name} ${VOTE_VERBS[event.reviewer.vote] ?? 'voted on'} ${pr}: ${
        event.pullRequest.title
      }`;
    case 'reviewers': {
      const [first] = event.changes;
      return event.changes.length === 1
        ? `${describeReviewerChange(first, pr)}: ${event.pullRequest.title}`
        : `${event.changes.length} reviewer changes on ${pr}: ${event.pullRequest.title}`;
    }
    case 'reopened': {
      const file = fileName(event.thread.filePath);
      const where = file ? `${pr} (${file})` : pr;
      const quote = `"${excerpt(event.thread.firstContent)}"`;
      return event.by
        ? `${event.by} reopened a comment on ${where}: ${quote}`
        : `A comment on ${where} was reopened: ${quote}`;
    }
    case 'comments': {
      const [first] = event.comments;
      if (event.comments.length === 1) {
        return describeComment(first, pr);
      }
      const authors = [...new Set(event.comments.map((comment) => comment.author))].join(', ');
      return `${event.comments.length} new comments on ${pr} (${authors}): ${event.pullRequest.title}`;
    }
  }
}
