/**
 * What happened to a PR, from its fields and its threads: the timeline shown when hovering the age of a card,
 * and the date the PR was published. Pure, so no "vscode" import
 */
import type { ThreadResponse } from './reviewThreads';

/** Events kept in the timeline: the latest ones */
export const MAX_TIMELINE_EVENTS = 20;
const EXCERPT_LENGTH = 70;

export interface TimelineEvent {
  /** Short local date and time, e.g. "Oct 5, 21:24" */
  when: string;
  /** E.g. "Daniel Zegarra EXT added Szymon Kwasek EXT as a reviewer" */
  text: string;
}

export interface Timeline {
  events: TimelineEvent[];
  /** Events older than the ones listed */
  earlier: number;
}

/** The fields of the PR that tell its story */
export interface TimelineSource {
  status: string;
  isDraft: boolean;
  creationDate: string;
  closedDate?: string;
  createdBy: { displayName?: string };
}

export type DateFormatter = (isoDate: string) => string;

/** "Oct 5, 21:24" in the given time zone (the local one by default), whatever the locale of the machine */
export function formatTimelineDate(isoDate: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).formatToParts(new Date(isoDate));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('month')} ${part('day')}, ${part('hour')}:${part('minute')}`;
}

function threadType(thread: ThreadResponse): string | undefined {
  const type = thread.properties?.CodeReviewThreadType?.$value;
  return typeof type === 'string' ? type : undefined;
}

const property = (thread: ThreadResponse, name: string): string => String(thread.properties?.[name]?.$value ?? '');

/** Draft updates, oldest first. "0" in CodeReviewIsDraftNowSet means published, "1" back to draft */
function draftUpdates(threads: ThreadResponse[]): ThreadResponse[] {
  return threads
    .filter((thread) => threadType(thread) === 'IsDraftUpdate')
    .sort((a, b) => a.publishedDate.localeCompare(b.publishedDate));
}

/**
 * When the PR was published: when it left draft for the last time. Undefined when it was never a draft
 * (the creation is then its publication) or when the threads could not be read
 */
export function publicationDate(threads: ThreadResponse[] | undefined): string | undefined {
  return draftUpdates(threads ?? [])
    .filter((thread) => property(thread, 'CodeReviewIsDraftNowSet') === '0')
    .at(-1)?.publishedDate;
}

/** Date from which the PR waits for its reviewers: its publication, or its creation */
export function publishedAt(pr: Pick<TimelineSource, 'creationDate'>, threads: ThreadResponse[] | undefined): string {
  return publicationDate(threads) ?? pr.creationDate;
}

/** First comment of a system thread, without the final period */
function systemText(thread: ThreadResponse): string {
  const content = (thread.comments?.[0]?.content ?? '').trim().replace(/\.$/, '');
  return content;
}

const VOTE_TEXTS: Partial<Record<string, string>> = {
  '10': 'approved',
  '5': 'approved with suggestions',
  '0': 'reset the vote',
  '-5': 'is waiting for the author',
  '-10': 'rejected',
};

function voteText(thread: ThreadResponse): string {
  const matched = /^(.+) voted (-?\d+)$/.exec(systemText(thread));
  const result = VOTE_TEXTS[matched?.[2] ?? property(thread, 'CodeReviewVoteResult')];
  if (matched && result) {
    return `${matched[1]} ${result}`;
  }
  return systemText(thread) || 'A vote was cast';
}

function pushText(thread: ThreadResponse): string {
  const count = Number(thread.properties?.CodeReviewRefNewCommitsCount?.$value);
  if (!count) {
    return 'The branch was updated';
  }
  return `${count} new commit${count === 1 ? '' : 's'} pushed`;
}

function fileName(thread: ThreadResponse): string | undefined {
  return thread.threadContext?.filePath?.split('/').filter(Boolean).at(-1);
}

function excerpt(content: string): string {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH - 1)}…` : text;
}

function commentText(thread: ThreadResponse): string | undefined {
  const [first] = thread.comments ?? [];
  if (!first || first.isDeleted || first.commentType !== 'text') {
    return undefined;
  }
  const file = fileName(thread);
  return `${first.author.displayName} commented${file ? ` on ${file}` : ''}: “${excerpt(first.content ?? '')}”`;
}

/** The description of the thread, or undefined for the ones that are not worth listing (e.g. policy updates) */
function threadText(thread: ThreadResponse): string | undefined {
  switch (threadType(thread)) {
    case undefined:
      return commentText(thread);
    case 'IsDraftUpdate':
      return (
        systemText(thread) || (property(thread, 'CodeReviewIsDraftNowSet') === '0' ? 'Published' : 'Marked as draft')
      );
    case 'ReviewersUpdate':
      return systemText(thread) || 'The reviewers were updated';
    case 'ResetMultipleVotes':
      return systemText(thread) || 'The votes were reset';
    case 'VoteUpdate':
      return voteText(thread);
    case 'RefUpdate':
      return pushText(thread);
    case 'AutoCompleteUpdate':
      return (
        systemText(thread) ||
        (property(thread, 'CodeReviewAutoCompleteNowSet') === '1'
          ? 'Auto-complete was set'
          : 'Auto-complete was cancelled')
      );
    case 'StatusUpdate':
      return systemText(thread) || `Status updated to ${property(thread, 'CodeReviewStatus')}`;
    default:
      return undefined;
  }
}

/** True when the PR was a draft from the start: its first draft update is a publication */
function createdAsDraft(pr: TimelineSource, threads: ThreadResponse[]): boolean {
  const [first] = draftUpdates(threads);
  return first ? property(first, 'CodeReviewIsDraftNowSet') === '0' : pr.isDraft;
}

interface DatedEvent {
  at: string;
  text: string;
}

/**
 * The events of the PR, latest first: its creation, the system threads that tell something (publication, reviewers,
 * votes, pushes, auto-complete, status), the comments written by people and its completion. At most the latest
 * MAX_TIMELINE_EVENTS are kept. Undefined threads (not fetched) give just the creation and the completion
 */
export function buildTimeline(
  pr: TimelineSource,
  threads: ThreadResponse[] | undefined,
  format: DateFormatter = formatTimelineDate
): Timeline {
  const known = threads ?? [];
  const author = pr.createdBy.displayName;
  const events: DatedEvent[] = [
    {
      at: pr.creationDate,
      text: `${author ? `${author} created the pull request` : 'Pull request created'}${
        createdAsDraft(pr, known) ? ' as a draft' : ''
      }`,
    },
    ...known
      .slice()
      .sort((a, b) => a.publishedDate.localeCompare(b.publishedDate) || a.id - b.id)
      .flatMap((thread) => {
        const text = threadText(thread);
        return text ? [{ at: thread.publishedDate, text }] : [];
      }),
  ];
  const hasStatusUpdate = known.some((thread) => threadType(thread) === 'StatusUpdate');
  if (pr.status === 'completed' && pr.closedDate && !hasStatusUpdate) {
    events.push({ at: pr.closedDate, text: 'Pull request completed' });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  const earlier = Math.max(0, events.length - MAX_TIMELINE_EVENTS);
  return {
    // Latest first: what happened last is what matters
    events: events
      .slice(earlier)
      .reverse()
      .map(({ at, text }) => ({ when: format(at), text })),
    earlier,
  };
}
