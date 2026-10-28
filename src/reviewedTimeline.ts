/**
 * The PRs the user already reviewed, on the Sprint timeline (Rule TIMELINE-37): "REVIEWED BY YOU · THIS SPRINT", faded
 * like the finished work. Each row goes from the publication of the PR to the user's vote (the vote is its mark), then
 * a thin line until it closed or now. Display only: nothing here counts or notifies. Pure, so no "vscode" import
 */
import type { ThreadResponse } from './reviewThreads';
import { axisPosition, type TimelineDay } from './timelineAxis';
import { dayLabel, dayText } from './timelineSpans';
import type { TimelineRow, TimelineSegment } from './timelineTypes';
import { initials } from './teamView';

/** A PR of someone else the user is a reviewer of and voted on (the listing of the PRs where the user is a reviewer) */
export interface ReviewedPullRequestInfo {
  id: number;
  title: string;
  url: string;
  author: string;
  repositoryId: string;
  createdAt: string;
  closedAt?: string;
  status: 'abandoned' | 'active' | 'completed';
  /** The user's vote now (10, 5, -5, -10) */
  myVote: number;
}

export interface ReviewedInput {
  pullRequests: readonly ReviewedPullRequestInfo[];
  /** The threads read so far, by PR id: the moment of the vote and of the publication */
  threads: ReadonlyMap<number, readonly ThreadResponse[]>;
  /** The threads being read */
  loading: ReadonlySet<number>;
  myId: string;
  /** The user's name, for the initials of the mark */
  myName: string;
  days: readonly TimelineDay[];
  now: number;
}

const property = (thread: ThreadResponse, name: string): string => {
  const value = thread.properties?.[name]?.$value;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

function voteKind(vote: number): 'approve' | 'reject' | 'wait' {
  if (vote >= 5) {
    return 'approve';
  }
  return vote <= -10 ? 'reject' : 'wait';
}

const VOTE_TEXT: Record<'approve' | 'reject' | 'wait', string> = {
  approve: 'approved',
  reject: 'rejected',
  wait: 'waits for the author',
};

// Rule TIMELINE-37
/** The first vote of the user on the PR (not a reset), and when the PR was published last before it */
export function reviewMoments(
  threads: readonly ThreadResponse[],
  myId: string
): { vote?: { at: number; value: number }; published?: number } {
  const sorted = [...threads].sort((a, b) => Date.parse(a.publishedDate) - Date.parse(b.publishedDate));
  let published: number | undefined;
  for (const thread of sorted) {
    const at = Date.parse(thread.publishedDate);
    const type = property(thread, 'CodeReviewThreadType');
    if (type === 'IsDraftUpdate' && property(thread, 'CodeReviewIsDraftNowSet') === '0') {
      published = at;
    }
    if (type === 'VoteUpdate') {
      const key = property(thread, 'CodeReviewVotedByIdentity');
      const voter = key ? thread.identities?.[key]?.id : thread.comments?.at(0)?.author.id;
      const value = Number(property(thread, 'CodeReviewVoteResult'));
      if (voter === myId && value !== 0 && !Number.isNaN(value)) {
        return { vote: { at, value }, published };
      }
    }
  }
  return { published };
}

const instant = (value: string | undefined): number | undefined => {
  const ms = Date.parse(value ?? '');
  return Number.isNaN(ms) ? undefined : ms;
};

// Rule TIMELINE-37
/**
 * The rows: the PRs voted within the axis (until their threads are read, those still open or closed within it, drawn
 * approximate and without the mark), most recent vote last
 */
export function reviewedRows(input: ReviewedInput): TimelineRow[] {
  const { days, now } = input;
  if (!days.length) {
    return [];
  }
  const axisStart = days[0].startMs;
  const axisEnd = days[days.length - 1].endMs;
  const rows = input.pullRequests.flatMap((pr) => {
    const created = instant(pr.createdAt);
    if (created === undefined || pr.myVote === 0) {
      return [];
    }
    const closed = pr.status === 'active' ? undefined : instant(pr.closedAt);
    const threads = input.threads.get(pr.id);
    const moments = threads ? reviewMoments(threads, input.myId) : undefined;
    const vote = moments?.vote;
    if (vote ? vote.at < axisStart || vote.at >= axisEnd : closed !== undefined && closed < axisStart) {
      return [];
    }
    const published = moments?.published ?? created;
    const end = Math.min(closed ?? now, now);
    const position = (ms: number): number => axisPosition(ms, days);
    const segments: TimelineSegment[] = [];
    const waitedTo = vote?.at ?? end;
    if (position(waitedTo) > position(published)) {
      segments.push({
        kind: 'wait',
        start: position(published),
        end: position(waitedTo),
        tip: vote
          ? `Waited for your review · ${dayText(published)} – ${dayText(vote.at)}`
          : 'Published · the moment of your vote is read from its threads',
        approximate: !vote,
      });
    }
    if (vote && position(end) > position(vote.at)) {
      segments.push({
        kind: 'afterVote',
        start: position(vote.at),
        end: position(end),
        tip: `After your vote · ${dayText(vote.at)} – ${closed === undefined ? 'now' : dayText(closed)}`,
      });
    }
    const kind = vote ? voteKind(vote.value) : undefined;
    let closedText: string | undefined;
    if (closed !== undefined) {
      closedText = `${pr.status === 'completed' ? '✓ merged' : 'abandoned'} ${dayLabel(closed)}`;
    }
    const row: TimelineRow = {
      key: `reviewed:${String(pr.id)}`,
      section: 'review',
      id: pr.id,
      header: `PR ${String(pr.id)} · ${pr.author.split(' ').at(0) ?? pr.author}`,
      label: {
        pr: { text: `PR ${String(pr.id)}`, merged: pr.status === 'completed' },
        meta: pr.author.split(' ').at(0),
      },
      title: pr.title.replace(/^\[\d+\]\s*/, ''),
      faded: true,
      segments,
      ...(vote && kind
        ? {
            vote: {
              at: position(vote.at),
              kind,
              text: initials(input.myName),
              tip: { title: `YOU ${VOTE_TEXT[kind].toUpperCase()}`, lines: [dayText(vote.at)] },
            },
          }
        : {}),
      ...(closedText && closed !== undefined ? { merged: { at: position(closed), text: closedText } } : {}),
      ...(input.loading.has(pr.id) ? { loading: true } : {}),
      open: { type: 'openReviewRequest', url: pr.url },
      end: segments.at(-1)?.end ?? position(published),
    };
    return [{ row, at: vote?.at ?? end }];
  });
  return rows.sort((a, b) => a.at - b.at).map(({ row }) => row);
}

/** The threads the rows need: those of the PRs not read yet; a closed PR for good, an open one by the user's vote */
export function reviewedThreadsWanted(
  pullRequests: readonly ReviewedPullRequestInfo[],
  axisStart: number | undefined
): { id: number; key: string }[] {
  return pullRequests
    .filter((pr) => pr.myVote !== 0)
    .filter((pr) => axisStart === undefined || pr.status === 'active' || (instant(pr.closedAt) ?? 0) >= axisStart)
    .map((pr) => ({ id: pr.id, key: pr.status === 'active' ? `active:${String(pr.myVote)}` : 'closed' }));
}
