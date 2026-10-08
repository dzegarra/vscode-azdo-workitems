import type { CommentSnapshot, Person, ReviewerUpdate, ThreadSnapshot } from './pullRequestEvents';
import type { ThreadResponse } from './reviewThreads';

/**
 * Pure conversion of the threads of a PR into what the notifications compare. No "vscode" import.
 *
 * "ReviewersUpdate" system threads (property "CodeReviewThreadType") carry, as strings:
 * - CodeReviewReviewersUpdatedByIdentity: who did it
 * - CodeReviewReviewersUpdatedAddedIdentity / RemovedIdentity / ChangedIdentity: the reviewer concerned
 * - CodeReviewReviewersUpdatedChangedToRequired: "True" / "False"
 * The identities are keys ("1", "2") of the thread's "identities" map. A reviewer that declines shows as
 * RemovedIdentity equal to ByIdentity, with the content "<name> declined to review"
 */

const PREFIX = 'CodeReviewReviewersUpdated';

function property(thread: ThreadResponse, name: string): string | undefined {
  const value = thread.properties?.[name]?.$value;
  return typeof value === 'string' ? value : undefined;
}

function isReviewersUpdate(thread: ThreadResponse): boolean {
  return property(thread, 'CodeReviewThreadType') === 'ReviewersUpdate';
}

function person(thread: ThreadResponse, name: string): (Person & { isContainer: boolean }) | undefined {
  const key = property(thread, `${PREFIX}${name}`);
  const identity = key === undefined ? undefined : thread.identities?.[key];
  return identity && { id: identity.id, name: identity.displayName, isContainer: !!identity.isContainer };
}

/** The change a "ReviewersUpdate" thread tells; undefined for groups and unknown shapes */
function toReviewerUpdate(thread: ThreadResponse): ReviewerUpdate | undefined {
  const actor = person(thread, 'ByIdentity');
  const added = person(thread, 'AddedIdentity');
  const removed = person(thread, 'RemovedIdentity');
  const changed = person(thread, 'ChangedIdentity');
  const target = added ?? removed ?? changed;
  if (!target || target.isContainer) {
    return undefined;
  }
  let kind: ReviewerUpdate['kind'] = 'added';
  if (removed) {
    const declined = removed.id === actor?.id && /declined/i.test(thread.comments?.[0]?.content ?? '');
    kind = declined ? 'declined' : 'removed';
  } else if (changed) {
    kind = property(thread, `${PREFIX}ChangedToRequired`) === 'True' ? 'required' : 'optional';
  }
  return {
    threadId: thread.id,
    kind,
    actor: actor && { id: actor.id, name: actor.name },
    target: { id: target.id, name: target.name },
  };
}

export interface ThreadSnapshots {
  comments: CommentSnapshot[];
  threads: ThreadSnapshot[];
  reviewerUpdates: ReviewerUpdate[];
  reviewerUpdateIds: number[];
}

export function snapshotThreads(threads: ThreadResponse[]): ThreadSnapshots {
  const comments: CommentSnapshot[] = [];
  const textThreads: ThreadSnapshot[] = [];
  for (const thread of threads) {
    const [first] = thread.comments ?? [];
    const filePath = thread.threadContext?.filePath ?? undefined;
    if (first && first.commentType === 'text' && !first.isDeleted) {
      textThreads.push({
        id: thread.id,
        status: thread.status ?? 'active',
        filePath,
        firstContent: first.content ?? '',
      });
    }
    for (const comment of thread.comments ?? []) {
      if (comment.commentType === 'text' && !comment.isDeleted) {
        comments.push({
          key: `${thread.id}:${comment.id}`,
          threadId: thread.id,
          authorId: comment.author.id,
          author: comment.author.displayName,
          content: comment.content ?? '',
          filePath,
          threadStarterId: first.author.id,
          startsThread: comment.id === first.id,
        });
      }
    }
  }
  const updateThreads = threads.filter(isReviewersUpdate);
  return {
    comments,
    threads: textThreads,
    reviewerUpdates: updateThreads.flatMap((thread) => toReviewerUpdate(thread) ?? []),
    reviewerUpdateIds: updateThreads.map((thread) => thread.id),
  };
}
