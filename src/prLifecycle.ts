/**
 * The lifecycle of a PR on the Sprint timeline: the station it is at, moment by moment (Rule TIMELINE-16), the phases
 * its own row draws (Rule TIMELINE-17: implementation, draft, review, ready to merge, merged) and the events along them
 * (Rule TIMELINE-27: pushes, CI runs, reviewers added, votes, auto-complete, comments, conflicts). It reads what the
 * threads of the PR and the history of its CI runs say; what is not known yet is drawn approximate and refined when
 * the history arrives. Pure, so no "vscode" import
 */
import type { RunModel } from './pipelines';
import { relevantVoter, toSystemEvent, type SystemEvent } from './pullRequestPhases';
import type { ThreadResponse } from './reviewThreads';
import { initials, shortPersonName } from './teamView';

/** The stations of a PR in order: the work item row draws them (Rule TIMELINE-16) */
export type StationKind = 'branch' | 'ci' | 'needsYou' | 'pullRequest' | 'ready' | 'review';

/** What the PR row draws (Rule TIMELINE-17) */
export type LifecyclePhaseKind = 'draft' | 'implementation' | 'ready' | 'review';

/** The station a "needs you" span stands for */
export type NeedsYouOf = 'ci' | 'done' | 'ready' | 'review';

export interface StationSpan {
  kind: StationKind;
  start: number;
  end: number;
  /** needsYou: the station that waits for the user */
  of?: NeedsYouOf;
  /** needsYou: "CI failed", "Jonas waits for the author" */
  reason?: string;
  /** The PR the span belongs to (the work item row says "in PR 14021") */
  prId?: number;
  /** Not known exactly: part of what it says is a guess until the history arrives */
  approximate?: boolean;
}

export interface LifecyclePhase {
  kind: LifecyclePhaseKind;
  start: number;
  end: number;
  approximate?: boolean;
  /** Hover: what the phase is and where it starts from */
  detail: string;
}

export type LifecycleEventKind =
  | 'approve'
  | 'autoComplete'
  | 'ci'
  | 'comments'
  | 'conflicts'
  | 'push'
  | 'reject'
  | 'reviewers'
  | 'wait';

export interface LifecycleEvent {
  kind: LifecycleEventKind;
  at: number;
  /** What the marker says: initials, "+2", "3" comments */
  text: string;
  /** ci: how the run ended; a run that is not finished is drawn dashed */
  tone?: 'fail' | 'pass' | 'running';
  /** The tooltip */
  title: string;
  lines: string[];
}

export interface LifecycleReviewer {
  name: string;
  isRequired: boolean;
  isContainer: boolean;
}

/** The board's say on the PR now: the last span of an open PR follows it so both tabs agree */
export interface CurrentStation {
  kind: 'ci' | 'needsYou' | 'pullRequest' | 'ready' | 'review';
  of?: NeedsYouOf;
  reason?: string;
  /** Since when (not known: the span is approximate) */
  since?: number;
}

export interface PrFacts {
  id: number;
  created: number;
  /** Merged or abandoned */
  closed?: number;
  /** It is a draft now (the threads say how it was before) */
  isDraft: boolean;
  /** Left draft for the last time, when the threads are not known */
  published?: number;
  /** Display name of the author */
  author?: string;
  reviewers: readonly LifecycleReviewer[];
  conflicts: boolean;
  /** The threads of the PR; undefined: not read yet */
  threads?: readonly ThreadResponse[];
  /** CI runs: the whole history when `runsComplete`, else the latest run of each pipeline */
  runs?: readonly Pick<RunModel, 'finishTime' | 'id' | 'pipeline' | 'startTime' | 'state'>[];
  runsComplete?: boolean;
  /** Where the implementation starts (Rule TIMELINE-20) */
  implementation?: { at: number; approximate: boolean; detail: string };
  /** The board's say on the PR now (open PRs) */
  current?: CurrentStation;
  /** Threads not known: the moment nothing stopped the merge (the latest vote or green run) */
  readySince?: number;
  now: number;
}

const MS_PER_MINUTE = 60_000;
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** "We 21 16:30": the weekday, the day of the month and the hour, as the tooltips of the timeline say it */
export function stampText(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${WEEKDAYS[date.getDay()]} ${String(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const property = (thread: ThreadResponse, name: string): string => {
  const value = thread.properties?.[name]?.$value;
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
};

/** The rank of a station: the work item row shows the least advanced PR (Rule TIMELINE-16) */
export const STATION_RANK: Record<Exclude<StationKind, 'needsYou'>, number> = {
  branch: 0,
  pullRequest: 1,
  ci: 2,
  review: 3,
  ready: 4,
};

/* ---------- What the threads say ---------- */

interface Parsed {
  system: SystemEvent[];
  reviewersAdded: { at: number; count: number; names: string[] }[];
  comments: { at: number; author?: string }[];
}

function addedNames(thread: ThreadResponse): string[] {
  const key = property(thread, 'CodeReviewReviewersUpdatedAddedIdentity');
  const name = key ? thread.identities?.[key]?.displayName : undefined;
  return name ? [name] : [];
}

/** Rule TIMELINE-27: the events of the threads; the system ones are read as My Pull Requests reads them */
function parseThreads(threads: readonly ThreadResponse[]): Parsed {
  const system: SystemEvent[] = [];
  const reviewersAdded: Parsed['reviewersAdded'] = [];
  const comments: Parsed['comments'] = [];
  for (const thread of threads) {
    const type = property(thread, 'CodeReviewThreadType');
    const at = Date.parse(thread.publishedDate);
    if (Number.isNaN(at)) {
      continue;
    }
    if (type === '') {
      const first = thread.comments?.at(0);
      if (first && !first.isDeleted && first.commentType === 'text') {
        comments.push({ at, author: first.author.displayName });
      }
      continue;
    }
    if (type === 'ReviewersUpdate') {
      const count = Number(property(thread, 'CodeReviewReviewersUpdatedNumAdded'));
      if (count > 0) {
        reviewersAdded.push({ at, count, names: addedNames(thread) });
      }
      continue;
    }
    const event = toSystemEvent(thread);
    if (event) {
      // The same person is "Ana Ruiz EXT" in a thread and "Ana Ruiz" in the whole-team data: one form for both
      system.push(event.voter === undefined ? event : { ...event, voter: shortPersonName(event.voter) });
    }
  }
  system.sort((a, b) => a.at - b.at);
  reviewersAdded.sort((a, b) => a.at - b.at);
  comments.sort((a, b) => a.at - b.at);
  return { system, reviewersAdded, comments };
}

/* ---------- Stations moment by moment ---------- */

interface VoteState {
  /** Latest vote of each relevant voter, by name */
  votes: Map<string, number>;
  blocker?: { name: string; vote: number };
  approvals: number;
}

/** Latest vote of each relevant voter at `t`; a reset clears them all (Rule TIMELINE-16) */
function voteStateAt(
  system: readonly SystemEvent[],
  isRelevant: (name: string | undefined) => boolean,
  t: number
): VoteState {
  const votes = new Map<string, number>();
  for (const event of system) {
    if (event.at > t) {
      break;
    }
    if (event.type === 'reset') {
      votes.clear();
    } else if (event.type === 'vote' && isRelevant(event.voter)) {
      votes.set(event.voter ?? 'A reviewer', event.vote ?? 0);
    }
  }
  const entries = [...votes];
  const blocking = entries.find(([, vote]) => vote <= -5);
  return {
    votes,
    blocker: blocking && { name: blocking[0], vote: blocking[1] },
    approvals: entries.filter(([, vote]) => vote >= 5).length,
  };
}

/** Is the PR a draft at `t`? The first draft update says how it was born: a publication means a draft at first */
function draftAt(system: readonly SystemEvent[], isDraftNow: boolean, t: number): boolean {
  const toggles = system.filter((event) => event.type === 'publish' || event.type === 'draft');
  const first = toggles.at(0);
  if (!first) {
    return isDraftNow;
  }
  let draft = first.type === 'publish';
  for (const toggle of toggles) {
    if (toggle.at > t) {
      break;
    }
    draft = toggle.type === 'draft';
  }
  return draft;
}

type CiNow = 'failed' | 'green' | 'waiting';

interface CiRun {
  pipeline: string;
  start: number;
  finish?: number;
  state: RunModel['state'];
}

const ciRunsOf = (facts: PrFacts): CiRun[] =>
  (facts.runs ?? []).flatMap((run) => {
    const start = Date.parse(run.startTime ?? '');
    const finish = Date.parse(run.finishTime ?? '');
    return [
      {
        pipeline: run.pipeline,
        // A run that has not started yet belongs to the latest push
        start: Number.isNaN(start) ? facts.now : start,
        finish: Number.isNaN(finish) ? undefined : finish,
        state: run.state,
      },
    ];
  });

/**
 * The CI of the latest commit at `t`: the runs started after the latest push (or the creation), the latest of each
 * pipeline. A failure is the author's move; no run yet (queued) or one still running is CI; every pipeline green is
 * done. A PR with no run at all has no CI to wait for
 */
function ciAt(runs: readonly CiRun[], pushes: readonly number[], created: number, t: number): CiNow {
  const lastPush = pushes.filter((at) => at <= t).reduce((latest, at) => Math.max(latest, at), created);
  const latest = new Map<string, CiRun>();
  for (const run of runs) {
    if (run.start >= lastPush - 2000 && run.start <= t && run.state !== 'canceled') {
      const known = latest.get(run.pipeline);
      if (!known || known.start < run.start) {
        latest.set(run.pipeline, run);
      }
    }
  }
  if (!latest.size) {
    return runs.length ? 'waiting' : 'green';
  }
  const states = [...latest.values()].map((run) =>
    run.finish !== undefined && run.finish <= t ? run.state : ('running' as const)
  );
  if (states.some((state) => state === 'failed' || state === 'partial')) {
    return 'failed';
  }
  return states.every((state) => state === 'succeeded') ? 'green' : 'waiting';
}

const sameSpan = (a: StationSpan, b: StationSpan): boolean =>
  a.kind === b.kind && a.of === b.of && a.reason === b.reason && a.approximate === b.approximate;

function mergeAdjacent(spans: StationSpan[]): StationSpan[] {
  const merged: StationSpan[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (span.end <= span.start) {
      continue;
    }
    if (last && sameSpan(last, span) && last.end === span.start) {
      last.end = span.end;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

const required = (reviewers: readonly LifecycleReviewer[]): number =>
  Math.max(1, reviewers.filter((reviewer) => reviewer.isRequired && !reviewer.isContainer).length);

const phasesSource = (facts: PrFacts) => ({
  creationDate: new Date(facts.created).toISOString(),
  isDraft: facts.isDraft,
  createdBy: { displayName: facts.author === undefined ? undefined : shortPersonName(facts.author) },
  reviewers: facts.reviewers.map((reviewer) => ({
    displayName: shortPersonName(reviewer.name),
    isRequired: reviewer.isRequired,
    isContainer: reviewer.isContainer,
  })),
});

// Rule TIMELINE-16
/** The station of the PR from the history: threads (votes, pushes, publication) and, when known, its CI runs */
function stationsFromHistory(facts: PrFacts, parsed: Parsed): StationSpan[] {
  const end = facts.closed ?? facts.now;
  const { system } = parsed;
  const isRelevant = relevantVoter(phasesSource(facts), system);
  const ciKnown = facts.runsComplete === true;
  const runs = ciKnown ? ciRunsOf(facts) : [];
  const pushes = system.filter((event) => event.type === 'push').map((event) => event.at);
  const needed = required(facts.reviewers);
  const marks = new Set<number>([facts.created, end]);
  for (const event of system) {
    marks.add(event.at);
  }
  for (const run of runs) {
    marks.add(run.start);
    if (run.finish !== undefined) {
      marks.add(run.finish);
    }
  }
  const points = [...marks].filter((at) => at >= facts.created && at <= end).sort((a, b) => a - b);
  const spans: StationSpan[] = [];
  for (const [index, start] of points.entries()) {
    const next = points.at(index + 1);
    if (next === undefined) {
      break;
    }
    const base = { start, end: next, prId: facts.id };
    if (draftAt(system, facts.isDraft, start)) {
      spans.push({ ...base, kind: 'pullRequest' });
      continue;
    }
    const state = voteStateAt(system, isRelevant, start);
    const ci = ciKnown ? ciAt(runs, pushes, facts.created, start) : 'green';
    if (state.blocker) {
      const word = state.blocker.vote <= -10 ? 'rejected' : 'waits for the author';
      spans.push({ ...base, kind: 'needsYou', of: 'review', reason: `${state.blocker.name} ${word}` });
    } else if (ci === 'failed') {
      spans.push({ ...base, kind: 'needsYou', of: 'ci', reason: 'CI failed' });
    } else if (ci === 'waiting') {
      spans.push({ ...base, kind: 'ci' });
    } else {
      spans.push({ ...base, kind: state.approvals >= needed ? 'ready' : 'review' });
    }
  }
  const merged = mergeAdjacent(spans);
  if (!ciKnown) {
    // The CI before the current state is part of what is drawn as review until the history of the runs arrives
    const first = merged.find((span) => span.kind !== 'pullRequest');
    if (first?.kind === 'review') {
      first.approximate = true;
    }
  }
  return merged;
}

// Rules TIMELINE-16, TIMELINE-28
/** Threads not read yet: the draft split if known, then review up to the current state, all of it approximate */
function stationsWithoutHistory(facts: PrFacts): StationSpan[] {
  const end = facts.closed ?? facts.now;
  const spans: StationSpan[] = [];
  const base = (start: number, finish: number) => ({ start, end: finish, prId: facts.id });
  let from = facts.created;
  if (facts.isDraft) {
    spans.push({ ...base(from, end), kind: 'pullRequest' });
    return spans;
  }
  if (facts.published !== undefined && facts.published > facts.created) {
    spans.push({ ...base(from, Math.min(facts.published, end)), kind: 'pullRequest' });
    from = Math.min(facts.published, end);
  }
  if (facts.closed !== undefined) {
    const ready = facts.readySince === undefined ? undefined : Math.min(Math.max(facts.readySince, from), end);
    if (ready === undefined) {
      spans.push({ ...base(from, end), kind: 'review', approximate: true });
    } else {
      spans.push({ ...base(from, ready), kind: 'review', approximate: true });
      spans.push({ ...base(ready, end), kind: 'ready', approximate: true });
    }
    return spans;
  }
  const current = facts.current;
  if (!current || current.kind === 'pullRequest') {
    spans.push({ ...base(from, end), kind: 'review', approximate: true });
    return spans;
  }
  const since = Math.min(Math.max(current.since ?? from, from), end);
  spans.push({ ...base(from, since), kind: 'review', approximate: true });
  spans.push({
    ...base(since, end),
    kind: current.kind,
    of: current.of,
    reason: current.reason,
    approximate: current.since === undefined,
  });
  return spans;
}

const isSame = (span: StationSpan, current: CurrentStation): boolean =>
  span.kind === current.kind && (current.kind !== 'needsYou' || span.of === current.of);

// Rule TIMELINE-16
/**
 * The last span of an open PR is what the board says now (the two tabs never disagree): the history says how it got
 * there, the board says where it is. A different station starts when the board says it did, else the span is replaced
 */
function reconcile(spans: StationSpan[], facts: PrFacts): StationSpan[] {
  const current = facts.current;
  const last = spans.at(-1);
  if (facts.closed !== undefined || !current || !last || current.kind === 'pullRequest') {
    return spans;
  }
  if (isSame(last, current)) {
    last.reason = current.reason ?? last.reason;
    return spans;
  }
  const at = Math.min(Math.max(current.since ?? last.start, last.start), last.end);
  const rest = at > last.start ? [{ ...last, end: at }] : [];
  return [
    ...spans.slice(0, -1),
    ...rest,
    {
      start: at,
      end: last.end,
      prId: facts.id,
      kind: current.kind,
      of: current.of,
      reason: current.reason,
      approximate: current.since === undefined,
    },
  ];
}

// Rule TIMELINE-16
/** The stations of the PR from its creation to its closing (or now), contiguous */
export function pullRequestStations(facts: PrFacts): StationSpan[] {
  const end = facts.closed ?? facts.now;
  if (end <= facts.created) {
    return [];
  }
  const spans = facts.threads ? stationsFromHistory(facts, parseThreads(facts.threads)) : stationsWithoutHistory(facts);
  return reconcile(spans, facts);
}

/* ---------- Phases ---------- */

const PHASE_OF: Record<StationKind, LifecyclePhaseKind | undefined> = {
  branch: undefined,
  pullRequest: 'draft',
  ci: 'review',
  review: 'review',
  needsYou: undefined,
  ready: 'ready',
};

const PHASE_DETAIL: Record<LifecyclePhaseKind, string> = {
  implementation: 'implementation',
  draft: 'draft · self-review',
  review: 'review · CI and reviewers',
  ready: 'ready to merge',
};

function phaseKindOf(span: StationSpan): LifecyclePhaseKind {
  if (span.kind === 'needsYou') {
    return span.of === 'ready' ? 'ready' : 'review';
  }
  return PHASE_OF[span.kind] ?? 'review';
}

// Rule TIMELINE-17
/**
 * What the PR row draws: implementation (until the PR was created), draft, review (CI included), ready to merge. The
 * merge itself is a mark, not a phase
 */
export function pullRequestPhases(facts: PrFacts, stations: readonly StationSpan[]): LifecyclePhase[] {
  const phases: LifecyclePhase[] = [];
  const impl = facts.implementation;
  if (impl && impl.at < facts.created) {
    phases.push({
      kind: 'implementation',
      start: impl.at,
      end: facts.created,
      approximate: impl.approximate,
      detail: impl.detail,
    });
  }
  for (const span of stations) {
    const kind = phaseKindOf(span);
    const last = phases.at(-1);
    if (last && last.kind === kind && last.end === span.start) {
      last.end = span.end;
      last.approximate = last.approximate === true && span.approximate === true ? true : last.approximate;
    } else {
      phases.push({
        kind,
        start: span.start,
        end: span.end,
        approximate: span.approximate,
        detail: PHASE_DETAIL[kind],
      });
    }
  }
  return phases.map((phase) => ({ ...phase, approximate: phase.approximate === true ? true : undefined }));
}

/* ---------- Events ---------- */

const CLUSTER_MS = 10 * MS_PER_MINUTE;
const DAY_MS = 86_400_000;

const dayKey = (ms: number): string => {
  const date = new Date(ms);
  return `${String(date.getFullYear())}-${String(date.getMonth())}-${String(date.getDate())}`;
};

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

function voteEvents(facts: PrFacts, parsed: Parsed): LifecycleEvent[] {
  const isRelevant = relevantVoter(phasesSource(facts), parsed.system);
  const needed = required(facts.reviewers);
  const events: LifecycleEvent[] = [];
  for (const event of parsed.system) {
    if (event.type !== 'vote' || event.vote === undefined || event.vote === 0) {
      continue;
    }
    const who = event.voter ?? 'A reviewer';
    const state = voteStateAt(parsed.system, isRelevant, event.at);
    const when = stampText(event.at);
    if (event.vote >= 5) {
      const progress = `${String(state.approvals)} of ${plural(needed, 'required approval')}`;
      events.push({
        kind: 'approve',
        at: event.at,
        text: initials(who),
        title: `APPROVED · PR ${String(facts.id)}`,
        lines: [`${who} ${event.vote === 5 ? 'approved with suggestions' : 'approved'} · ${when}`, progress],
      });
    } else {
      const rejected = event.vote <= -10;
      events.push({
        kind: rejected ? 'reject' : 'wait',
        at: event.at,
        text: initials(who),
        title: `${rejected ? 'REJECTED' : 'WAITS FOR THE AUTHOR'} · PR ${String(facts.id)}`,
        lines: [`${who} ${rejected ? 'rejected' : 'is waiting for the author'} · ${when}`],
      });
    }
  }
  return events;
}

function pushEvents(facts: PrFacts, parsed: Parsed): LifecycleEvent[] {
  return parsed.system
    .filter((event) => event.type === 'push' && event.at > facts.created)
    .map((event) => ({
      kind: 'push' as const,
      at: event.at,
      text: '',
      title: `PUSH · PR ${String(facts.id)}`,
      lines: [`${event.count ? plural(event.count, 'new commit') : 'The branch was updated'} · ${stampText(event.at)}`],
    }));
}

/** The reviewers added within ten minutes of each other are one marker: "+4" */
function reviewerEvents(facts: PrFacts, parsed: Parsed): LifecycleEvent[] {
  const groups: { at: number; count: number; names: string[] }[] = [];
  for (const added of parsed.reviewersAdded) {
    const last = groups.at(-1);
    if (last && added.at - last.at <= CLUSTER_MS) {
      last.count += added.count;
      last.names.push(...added.names);
    } else {
      groups.push({ ...added, names: [...added.names] });
    }
  }
  return groups.map((group) => ({
    kind: 'reviewers' as const,
    at: group.at,
    text: `+${String(group.count)}`,
    title: `REVIEWERS ADDED · PR ${String(facts.id)}`,
    lines: [
      `${plural(group.count, 'reviewer')} added · ${stampText(group.at)}`,
      ...(group.names.length ? [group.names.join(', ')] : []),
    ],
  }));
}

/** The comment threads of a day are one marker: "💬 3" */
function commentEvents(facts: PrFacts, parsed: Parsed): LifecycleEvent[] {
  const days = new Map<string, { at: number; authors: Set<string>; count: number }>();
  for (const comment of parsed.comments) {
    const key = dayKey(comment.at);
    const day = days.get(key) ?? { at: comment.at, authors: new Set<string>(), count: 0 };
    day.count += 1;
    day.at = comment.at;
    if (comment.author) {
      day.authors.add(comment.author);
    }
    days.set(key, day);
  }
  return [...days.values()].map((day) => ({
    kind: 'comments' as const,
    at: day.at,
    text: String(day.count),
    title: `COMMENTS · PR ${String(facts.id)}`,
    lines: [
      `${plural(day.count, 'comment thread')} · ${stampText(day.at)}`,
      ...(day.authors.size ? [[...day.authors].join(', ')] : []),
    ],
  }));
}

const RUN_MARK: Record<'fail' | 'pass' | 'running', { text: string; outcome: string }> = {
  pass: { text: '✓', outcome: 'passed' },
  fail: { text: '✕', outcome: 'failed' },
  running: { text: '', outcome: 'running' },
};

function runTone(run: CiRun): 'fail' | 'pass' | 'running' {
  if (run.finish === undefined) {
    return 'running';
  }
  return run.state === 'succeeded' ? 'pass' : 'fail';
}

function runEvents(facts: PrFacts): LifecycleEvent[] {
  return ciRunsOf(facts).flatMap((run): LifecycleEvent[] => {
    if (run.state === 'canceled') {
      return [];
    }
    const tone = runTone(run);
    const { text, outcome } = RUN_MARK[tone];
    const at = run.finish ?? run.start;
    const when = run.finish === undefined ? ` since ${stampText(run.start)}` : ` · ${stampText(at)}`;
    return [
      {
        kind: 'ci',
        at,
        text,
        tone,
        title: `CI RUN ${outcome.toUpperCase()} · PR ${String(facts.id)}`,
        lines: [`${run.pipeline} ${outcome}${when}`],
      },
    ];
  });
}

// Rule TIMELINE-27
/**
 * The events along the PR row, oldest first. Pushes, reviewers added, votes, auto-complete and comments come from the
 * threads; the CI runs from the history of the runs (the latest ones until it is read); conflicts only as the PR has
 * them now, because Azure DevOps does not keep a history of them
 */
export function pullRequestEvents(facts: PrFacts): LifecycleEvent[] {
  const parsed = facts.threads ? parseThreads(facts.threads) : { system: [], reviewersAdded: [], comments: [] };
  const auto = parsed.system
    .filter((event) => event.type === 'autoComplete')
    .map(
      (event): LifecycleEvent => ({
        kind: 'autoComplete',
        at: event.at,
        text: 'A',
        title: `AUTO-COMPLETE · PR ${String(facts.id)}`,
        lines: [`Auto-complete was set · ${stampText(event.at)}`],
      })
    );
  const conflicts: LifecycleEvent[] =
    facts.conflicts && facts.closed === undefined
      ? [
          {
            kind: 'conflicts',
            at: facts.now,
            text: '⚠',
            title: `CONFLICTS · PR ${String(facts.id)}`,
            lines: ['The branch has conflicts with its target now', 'Past conflicts are not recorded by Azure DevOps'],
          },
        ]
      : [];
  const end = facts.closed ?? facts.now;
  return [
    ...pushEvents(facts, parsed),
    ...runEvents(facts),
    ...reviewerEvents(facts, parsed),
    ...voteEvents(facts, parsed),
    ...auto,
    ...commentEvents(facts, parsed),
    ...conflicts,
  ]
    .filter((event) => event.at >= facts.created - DAY_MS && event.at <= end + DAY_MS)
    .sort((a, b) => a.at - b.at);
}
