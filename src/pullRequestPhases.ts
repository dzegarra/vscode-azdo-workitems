/**
 * Phases of a completed PR: how long it spent in draft, waiting for review, waiting for the author and waiting to
 * be merged, computed from the system threads already fetched (no extra requests). Durations are working time.
 * Pure, so no "vscode" import
 */
import type { ThreadResponse } from './reviewThreads';
import { DEFAULT_WORKING_DAYS, workingMsBetween } from './workingTime';

export type PhaseKind = 'draft' | 'review' | 'author' | 'merge';
export type PhaseEventKind = 'published' | 'approve' | 'wait' | 'reject' | 'push' | 'autoComplete';

export const PHASE_KINDS: readonly PhaseKind[] = ['draft', 'review', 'author', 'merge'];
export const PHASE_LABELS: Record<PhaseKind, string> = {
  draft: 'Draft',
  review: 'In review',
  author: 'Waiting for author',
  merge: 'Ready to merge',
};

export interface PhasesSource {
  creationDate: string;
  closedDate?: string;
  isDraft: boolean;
  createdBy: { id?: string; displayName?: string };
  reviewers: { displayName: string; isRequired?: boolean; isContainer?: boolean }[];
}

export interface PhaseSegment {
  kind: PhaseKind;
  /** ISO dates */
  start: string;
  end: string;
  /** Working time */
  ms: number;
  /** Of the total working time (0 to 1); the segments add up to 1 */
  share: number;
}

export interface PhaseEvent {
  kind: PhaseEventKind;
  at: string;
  /** Where it falls along the working time of the PR (0 to 1) */
  share: number;
  text: string;
}

export interface PullRequestPhases {
  segments: PhaseSegment[];
  events: PhaseEvent[];
  /** Working time from creation to completion */
  totalMs: number;
}

type SystemType = 'publish' | 'draft' | 'push' | 'vote' | 'reset' | 'autoComplete';

interface SystemEvent {
  at: number;
  type: SystemType;
  vote?: number;
  voter?: string;
  count?: number;
}

const VOTE_APPROVED = 5;
const VOTE_WAITING = -5;
const VOTE_REJECTED = -10;

function property(thread: ThreadResponse, name: string): string {
  const value = thread.properties?.[name]?.$value;
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}

function voterName(thread: ThreadResponse): string | undefined {
  const key = property(thread, 'CodeReviewVotedByIdentity');
  const identity = key ? thread.identities?.[key]?.displayName : undefined;
  return identity ?? /^(.+) voted -?\d+/.exec((thread.comments?.[0]?.content ?? '').trim())?.[1];
}

function toSystemEvent(thread: ThreadResponse): SystemEvent | undefined {
  const at = Date.parse(thread.publishedDate);
  switch (property(thread, 'CodeReviewThreadType')) {
    case 'IsDraftUpdate':
      return { at, type: property(thread, 'CodeReviewIsDraftNowSet') === '0' ? 'publish' : 'draft' };
    case 'VoteUpdate':
      return { at, type: 'vote', vote: Number(property(thread, 'CodeReviewVoteResult')), voter: voterName(thread) };
    case 'ResetMultipleVotes':
      return { at, type: 'reset' };
    case 'RefUpdate':
      return { at, type: 'push', count: Number(property(thread, 'CodeReviewRefNewCommitsCount')) || undefined };
    case 'AutoCompleteUpdate':
      return property(thread, 'CodeReviewAutoCompleteNowSet') === '1' ? { at, type: 'autoComplete' } : undefined;
    default:
      return undefined;
  }
}

function systemEvents(threads: ThreadResponse[], from: number, to: number): SystemEvent[] {
  return threads
    .map(toSystemEvent)
    .filter((event): event is SystemEvent => !!event && event.at >= from && event.at <= to)
    .sort((a, b) => a.at - b.at);
}

// Rule MYPR-PHASE-7
/**
 * Votes that move the PR between phases: the ones of the required reviewers when they voted, otherwise of anybody
 * but the author
 */
function relevantVoter(pr: PhasesSource, events: SystemEvent[]): (name: string | undefined) => boolean {
  const required = new Set(pr.reviewers.filter((r) => r.isRequired && !r.isContainer).map((r) => r.displayName));
  if (events.some((event) => event.type === 'vote' && event.voter && required.has(event.voter))) {
    return (name) => !!name && required.has(name);
  }
  return (name) => !name || name !== pr.createdBy.displayName;
}

// Rule MYPR-PHASE-6
/** The last approval after which nobody asked for changes or reset the votes */
function mergeStart(events: SystemEvent[], isRelevant: (name: string | undefined) => boolean): number | undefined {
  let start: number | undefined;
  events.forEach((event) => {
    const blocks = event.type === 'reset' || (event.type === 'vote' && isRelevant(event.voter) && event.vote === 0);
    const asksChanges = event.type === 'vote' && isRelevant(event.voter) && (event.vote ?? 0) <= VOTE_WAITING;
    const approves = event.type === 'vote' && isRelevant(event.voter) && (event.vote ?? 0) >= VOTE_APPROVED;
    if (blocks || asksChanges) {
      start = undefined;
    } else if (approves) {
      start = event.at;
    }
  });
  return start;
}

// Rules MYPR-PHASE-4, MYPR-PHASE-5
function voteKind(kind: PhaseKind, event: SystemEvent, isRelevant: (name: string | undefined) => boolean): PhaseKind {
  const vote = event.vote ?? 0;
  if (!isRelevant(event.voter) || kind === 'draft') {
    return kind;
  }
  if (vote <= VOTE_WAITING) {
    return 'author';
  }
  return kind === 'author' ? 'review' : kind;
}

// Rules MYPR-PHASE-3, MYPR-PHASE-5
function nextKind(kind: PhaseKind, event: SystemEvent, isRelevant: (name: string | undefined) => boolean): PhaseKind {
  switch (event.type) {
    case 'publish':
      return kind === 'draft' ? 'review' : kind;
    case 'draft':
      return 'draft';
    case 'push':
    case 'reset':
      return kind === 'author' ? 'review' : kind;
    case 'vote':
      return voteKind(kind, event, isRelevant);
    case 'autoComplete':
      return kind;
  }
}

/** The first draft update is a publication: the PR was created as a draft */
function createdAsDraft(events: SystemEvent[]): boolean {
  const first = events.find((event) => event.type === 'publish' || event.type === 'draft');
  return first?.type === 'publish';
}

interface Transition {
  at: number;
  kind: PhaseKind;
}

// Rule MYPR-PHASE-2
function transitions(
  events: SystemEvent[],
  start: number,
  end: number,
  isRelevant: (name: string | undefined) => boolean
): Transition[] {
  const merge = mergeStart(events, isRelevant) ?? end;
  const result: Transition[] = [{ at: start, kind: createdAsDraft(events) ? 'draft' : 'review' }];
  events
    .filter((event) => event.at < merge)
    .forEach((event) => {
      const kind = nextKind(result[result.length - 1].kind, event, isRelevant);
      if (kind !== result[result.length - 1].kind) {
        result.push({ at: event.at, kind });
      }
    });
  result.push({ at: merge, kind: 'merge' });
  return result;
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** Working time as a fraction of the total; calendar time when there is no working time at all */
function scaleOf(startMs: number, endMs: number, days: readonly number[]): (from: number, to: number) => number {
  const working = workingMsBetween(new Date(startMs), new Date(endMs), days);
  return working > 0
    ? (from, to) => workingMsBetween(new Date(from), new Date(to), days)
    : (from, to) => Math.max(0, to - from);
}

function voteEvent(event: SystemEvent, who: string, at: string): PhaseEvent | undefined {
  const vote = event.vote ?? 0;
  if (vote >= VOTE_APPROVED) {
    return { kind: 'approve', at, share: 0, text: `${who} approved` };
  }
  if (vote <= VOTE_REJECTED) {
    return { kind: 'reject', at, share: 0, text: `${who} rejected` };
  }
  return vote <= VOTE_WAITING ? { kind: 'wait', at, share: 0, text: `${who} is waiting for the author` } : undefined;
}

function eventOf(event: SystemEvent): PhaseEvent | undefined {
  const at = iso(event.at);
  const who = event.voter ?? 'A reviewer';
  switch (event.type) {
    case 'publish':
      return { kind: 'published', at, share: 0, text: 'Published' };
    case 'push':
      return {
        kind: 'push',
        at,
        share: 0,
        text: event.count ? `${event.count} new commit${event.count === 1 ? '' : 's'} pushed` : 'Branch updated',
      };
    case 'autoComplete':
      return { kind: 'autoComplete', at, share: 0, text: 'Auto-complete set' };
    case 'vote':
      return voteEvent(event, who, at);
    case 'draft':
    case 'reset':
      return undefined;
  }
}

// Rules MYPR-PHASE-1, MYPR-PHASE-8
/**
 * Segments from the creation to the completion, without gaps or overlaps, and the events to mark on them.
 * Without a completion date (or with unreadable dates) there are no phases. Without threads the PR waited for review
 * until it was completed
 */
export function pullRequestPhases(
  pr: PhasesSource,
  threads: ThreadResponse[] | undefined,
  workingDays: readonly number[] = DEFAULT_WORKING_DAYS
): PullRequestPhases | undefined {
  const start = Date.parse(pr.creationDate);
  const end = Date.parse(pr.closedDate ?? '');
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) {
    return undefined;
  }
  const events = systemEvents(threads ?? [], start, end);
  const isRelevant = relevantVoter(pr, events);
  const list = transitions(events, start, end, isRelevant);
  const measure = scaleOf(start, end, workingDays);
  const totalMs = measure(start, end);
  const share = (ms: number) => (totalMs > 0 ? ms / totalMs : 0);
  const segments = list
    .map((transition, index) => ({ kind: transition.kind, from: transition.at, to: list[index + 1]?.at ?? end }))
    .filter(({ kind, from, to }) => to > from || kind === 'merge')
    .reduce<{ kind: PhaseKind; from: number; to: number }[]>((merged, item) => {
      const last = merged.at(-1);
      if (last && last.kind === item.kind) {
        last.to = item.to;
      } else {
        merged.push({ ...item });
      }
      return merged;
    }, [])
    .map(({ kind, from, to }) => {
      const ms = measure(from, to);
      return { kind, start: iso(from), end: iso(to), ms, share: share(ms) };
    });
  const marks = events.flatMap((event) => {
    const mark = eventOf(event);
    return mark ? [{ ...mark, share: share(measure(start, event.at)) }] : [];
  });
  return { segments, events: marks, totalMs };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const MOSTLY: Record<PhaseKind, string> = {
  draft: 'mostly in draft',
  review: 'mostly waiting for review',
  author: 'mostly waiting for the author',
  merge: 'mostly waiting to be merged',
};

/**
 * Header summary of the completed PRs listed: the median time they took and the phase with the biggest median
 * share. Undefined with fewer than two PRs with phases
 */
export function summarizeCompleted(
  all: (PullRequestPhases | undefined)[],
  format: (ms: number) => string
): string | undefined {
  const known = all.filter((phases): phases is PullRequestPhases => !!phases);
  if (known.length < 2) {
    return undefined;
  }
  const shareOf = (phases: PullRequestPhases, kind: PhaseKind) =>
    phases.segments.filter((segment) => segment.kind === kind).reduce((sum, segment) => sum + segment.share, 0);
  const medians = PHASE_KINDS.map((kind) => ({ kind, value: median(known.map((phases) => shareOf(phases, kind))) }));
  const top = medians.reduce((best, item) => (item.value > best.value ? item : best));
  const took = format(median(known.map((phases) => phases.totalMs)));
  return `Completed PRs: median ${took}${top.value > 0 ? `, ${MOSTLY[top.kind]}` : ''}`;
}
