/**
 * The user's observations (comment threads they started) on the PRs they review, and their replies and
 * resolutions. Pure, so no "vscode" import
 */

/** Thread of a PR, as returned by the threads API */
export interface ThreadResponse {
  id: number;
  status?: string;
  publishedDate: string;
  threadContext?: { filePath?: string } | null;
  properties?: Partial<Record<string, { $value?: unknown }>>;
  comments?: {
    id: number;
    author: { id: string; displayName: string };
    content?: string;
    commentType?: string;
    isDeleted?: boolean;
  }[];
}

export interface ObservationComment {
  id: number;
  authorId: string;
  author: string;
  content: string;
}

/** A comment thread started by the user */
export interface Observation {
  threadId: number;
  /** active, pending, fixed, wontFix, closed, byDesign… */
  status: string;
  /** File the comment is about, e.g. "/packages/fui-admin/Header.tsx"; undefined for general comments */
  filePath?: string;
  /** The user's comment that started the thread */
  content: string;
  comments: ObservationComment[];
}

/** Text threads whose first comment (not deleted) was written by the user */
export function myObservations(threads: ThreadResponse[], myId: string): Observation[] {
  return threads.flatMap((thread) => {
    const comments = (thread.comments ?? []).filter((comment) => comment.commentType === 'text' && !comment.isDeleted);
    const [first] = thread.comments ?? [];
    if (!first || first.isDeleted || first.commentType !== 'text' || first.author.id !== myId) {
      return [];
    }
    return [
      {
        threadId: thread.id,
        status: thread.status ?? 'active',
        filePath: thread.threadContext?.filePath ?? undefined,
        content: first.content ?? '',
        comments: comments.map((comment) => ({
          id: comment.id,
          authorId: comment.author.id,
          author: comment.author.displayName,
          content: comment.content ?? '',
        })),
      },
    ];
  });
}

/** States of a thread that still needs an answer */
const OPEN_STATUSES = ['active', 'pending', 'unknown'];

export function isOpen(observation: Pick<Observation, 'status'>): boolean {
  return OPEN_STATUSES.includes(observation.status);
}

const STATUS_NAMES: Partial<Record<string, string>> = {
  fixed: 'Resolved',
  wontFix: "Won't fix",
  closed: 'Closed',
  byDesign: 'By design',
};

export interface ObservedPullRequest {
  id: number;
  title: string;
  url: string;
  repositoryId: string;
}

/** What is remembered of each PR between checks */
export interface StoredObservedPullRequest extends ObservedPullRequest {
  threads: Partial<Record<number, { status: string; commentIds: number[] }>>;
}

export type StoredObservations = Partial<Record<number, StoredObservedPullRequest>>;

export interface ObservationEvent {
  /** "resolved" also carries the replies that came with the resolution */
  kind: 'replied' | 'resolved';
  pullRequest: ObservedPullRequest;
  observation: Observation;
  /** New comments of other people */
  replies: ObservationComment[];
}

/**
 * Replies of other people and resolutions since the previous check, one event per thread.
 * A PR seen for the first time only establishes a baseline
 */
export function detectObservationEvents(
  previous: StoredObservedPullRequest | undefined,
  pullRequest: ObservedPullRequest,
  observations: Observation[],
  myId: string
): ObservationEvent[] {
  if (!previous) {
    return [];
  }
  return observations.flatMap((observation): ObservationEvent[] => {
    const before = previous.threads[observation.threadId];
    const known = new Set(before?.commentIds ?? []);
    const replies = observation.comments.filter((comment) => !known.has(comment.id) && comment.authorId !== myId);
    const wasOpen = !before || OPEN_STATUSES.includes(before.status);
    if (wasOpen && !isOpen(observation)) {
      return [{ kind: 'resolved', pullRequest, observation, replies }];
    }
    return replies.length ? [{ kind: 'replied', pullRequest, observation, replies }] : [];
  });
}

export function toStoredObservations(
  pullRequest: ObservedPullRequest,
  observations: Observation[]
): StoredObservedPullRequest {
  return {
    ...pullRequest,
    threads: Object.fromEntries(
      observations.map((observation) => [
        observation.threadId,
        { status: observation.status, commentIds: observation.comments.map((comment) => comment.id) },
      ])
    ),
  };
}

/** True while one of the user's observations is still open: the PR is checked even after it is completed */
export function hasOpenObservations(stored: StoredObservedPullRequest): boolean {
  return Object.values(stored.threads).some((thread) => !!thread && OPEN_STATUSES.includes(thread.status));
}

const MAX_EXCERPT = 80;

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_EXCERPT ? `${flat.slice(0, MAX_EXCERPT)}…` : flat;
}

/** Link to the thread in the PR page */
export function threadUrl(pullRequestUrl: string, threadId: number): string {
  return `${pullRequestUrl}?discussionId=${threadId}`;
}

export function describeObservationEvent(event: ObservationEvent): string {
  const { observation, pullRequest, replies } = event;
  const file = observation.filePath ? ` (${observation.filePath.split('/').at(-1) ?? ''})` : '';
  const target = `your comment on PR ${pullRequest.id}${file}`;
  const lastReply = replies.at(-1);
  const answer = lastReply ? `${lastReply.author}: "${excerpt(lastReply.content)}"` : '';
  if (event.kind === 'resolved') {
    const status = STATUS_NAMES[observation.status] ?? observation.status;
    const comment = `"${excerpt(observation.content)}"`;
    return `${target[0].toUpperCase()}${target.slice(1)} was marked ${status}: ${lastReply ? answer : comment}`;
  }
  const authors = [...new Set(replies.map((reply) => reply.author))];
  return replies.length === 1
    ? `${lastReply?.author ?? ''} replied to ${target}: "${excerpt(lastReply?.content ?? '')}"`
    : `${replies.length} replies to ${target} (${authors.join(', ')}): ${answer}`;
}
