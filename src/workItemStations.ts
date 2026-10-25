/**
 * The station of a work item at every moment of the sprint (Rule TIMELINE-16), from the stations of its PRs: the row of
 * a work item draws these, its PRs draw their own lifecycle. Pure, so no "vscode" import
 */
import { STATION_RANK, type NeedsYouOf, type StationKind, type StationSpan } from './prLifecycle';

/** A PR as the work item sees it: when it lived and the stations it went through */
export interface PrStations {
  id: number;
  created: number;
  /** Merged or abandoned; undefined: open */
  closed?: number;
  stations: readonly StationSpan[];
}

export interface WorkItemStationInput {
  now: number;
  /** Where the work began: the first implementation, a task in progress, or the activation of the work item */
  started?: { at: number; approximate: boolean };
  /** The work item reached Done (its last state change): nothing is drawn after the last merge */
  finished?: number;
  prs: readonly PrStations[];
  /** A task is still open: a merged PR sends the work back to coding (Rule TRACK-7) */
  tasksOpen: boolean;
}

export interface WorkItemStationSpan {
  kind: StationKind;
  start: number;
  end: number;
  of?: NeedsYouOf;
  reason?: string;
  /** The PR that decides the station, when one does */
  prId?: number;
  approximate?: boolean;
}

/** The station at one moment: what the rule says, and the PR it comes from */
export interface StationAt {
  kind: StationKind | 'done';
  of?: NeedsYouOf;
  reason?: string;
  prId?: number;
  approximate?: boolean;
}

const spanAt = (pr: PrStations, t: number): StationSpan | undefined =>
  pr.stations.find((span) => span.start <= t && t < span.end);

const isOpenAt = (pr: PrStations, t: number): boolean => pr.created <= t && (pr.closed === undefined || t < pr.closed);

// Rule TIMELINE-16
/**
 * The station of a work item at moment `t`:
 * - some open PR needs the user (CI failed, a reviewer sent it back): needs you, the first PR that does;
 * - else the least advanced open PR (Pull request < CI < Review < Ready to be merged);
 * - no open PR: Branch while work is left (before the first PR, between PRs, or merged PRs that left tasks open: Rule
 *   TRACK-7); a work item that is finished is Done; one whose last PR was merged with no task left waits for the user
 *   to move it to Done
 */
export function stationAt(input: WorkItemStationInput, t: number): StationAt | undefined {
  const { prs, finished } = input;
  const begin = Math.min(input.started?.at ?? Infinity, ...prs.map((pr) => pr.created));
  if (t < begin) {
    return undefined;
  }
  const open = prs.filter((pr) => isOpenAt(pr, t));
  const spans = open.flatMap((pr) => {
    const span = spanAt(pr, t);
    return span ? [span] : [];
  });
  const needs = spans.find((span) => span.kind === 'needsYou');
  if (needs) {
    return { kind: 'needsYou', of: needs.of, reason: needs.reason, prId: needs.prId, approximate: needs.approximate };
  }
  const least = spans
    .filter((span): span is StationSpan & { kind: Exclude<StationKind, 'needsYou'> } => span.kind !== 'needsYou')
    .sort((a, b) => STATION_RANK[a.kind] - STATION_RANK[b.kind])
    .at(0);
  if (least) {
    return { kind: least.kind, prId: least.prId, approximate: least.approximate };
  }
  if (open.length) {
    // An open PR without dates for this moment: it is coding as far as anybody knows
    return { kind: 'branch' };
  }
  if (finished !== undefined && t >= finished) {
    return { kind: 'done' };
  }
  const later = prs.some((pr) => pr.created > t);
  const merged = prs.some((pr) => pr.closed !== undefined && pr.closed <= t);
  if (!merged || later || input.tasksOpen) {
    return { kind: 'branch', approximate: input.started?.approximate && !merged ? true : undefined };
  }
  // Every PR is closed and no task is left: finished work that has not been moved to Done (the last PR decides)
  return finished === undefined
    ? { kind: 'needsYou', of: 'done', reason: 'PR merged · move it to Done' }
    : { kind: 'done' };
}

/** The same station: the PRs and the reasons behind it may change from one moment to the next, the work item is still at it */
const sameStation = (a: WorkItemStationSpan, b: WorkItemStationSpan): boolean =>
  a.kind === b.kind && a.approximate === b.approximate;

// Rule TIMELINE-16
/**
 * The stations of the work item over time: from its start to now (or to the moment it finished; after its last merge
 * nothing is drawn, the mark says "done"). Adjacent moments with the same station are one span
 */
export function workItemStations(input: WorkItemStationInput): WorkItemStationSpan[] {
  const end = input.finished ?? input.now;
  const marks = new Set<number>([end]);
  if (input.started !== undefined) {
    marks.add(input.started.at);
  }
  for (const pr of input.prs) {
    marks.add(pr.created);
    if (pr.closed !== undefined) {
      marks.add(pr.closed);
    }
    for (const span of pr.stations) {
      marks.add(span.start);
      marks.add(span.end);
    }
  }
  const first = Math.min(...marks);
  const begin = input.started === undefined ? first : Math.min(input.started.at, first);
  const points = [...marks].filter((at) => at >= begin && at <= end).sort((a, b) => a - b);
  const spans: WorkItemStationSpan[] = [];
  for (const [index, start] of points.entries()) {
    const next = points.at(index + 1);
    if (next === undefined) {
      break;
    }
    const at = stationAt(input, start);
    if (!at || at.kind === 'done') {
      continue;
    }
    const span: WorkItemStationSpan = {
      kind: at.kind,
      start,
      end: next,
      of: at.of,
      reason: at.reason,
      prId: at.prId,
      approximate: at.approximate,
    };
    const last = spans.at(-1);
    if (last && last.end === span.start && sameStation(last, span)) {
      // The latest PR and reason are the ones the bar says when it is the station of now
      Object.assign(last, { end: span.end, of: span.of, reason: span.reason, prId: span.prId });
    } else {
      spans.push(span);
    }
  }
  return spans;
}
