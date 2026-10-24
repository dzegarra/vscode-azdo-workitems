/**
 * The track of a work item: the six stations its work goes through, from the branch to Done, each lit by the rules
 * that apply to it. Shared by the sidebar, the details panel, the Track board and the Sprint timeline, so it must
 * not import "vscode"
 */
import type { MyPullRequestModel, WarningConcern } from './myPullRequests';
import { worstRunState } from './compactSignals';
import { isFinishedState, normalizeState, stateCategory } from './states';
import type { PullRequestModel, WorkItemModel } from './viewModel';

export type StationId = 'branch' | 'ci' | 'done' | 'pullRequest' | 'ready' | 'review';

/**
 * done: passed; active: in flight, waiting for someone else (or a machine); needsYou: the next step is the
 * user's; broken: it breaks a team rule; pending: not reached yet
 */
export type StationState = 'active' | 'broken' | 'done' | 'needsYou' | 'pending';

export interface Station {
  id: StationId;
  /** Name of the station: "Ready to Test" replaces "Done" for Bugs */
  label: string;
  state: StationState;
  /** Short reason of the state, e.g. "draft", "2 of 2 approved"; undefined when there is nothing to add */
  detail?: string;
}

export type TrackItem = Pick<WorkItemModel, 'alerts' | 'branches' | 'pullRequests' | 'state' | 'type'>;

/** The user's own PR as My Pull Requests knows it: what the track adds about the merge */
export type TrackPullRequest = Pick<
  MyPullRequestModel,
  'autoComplete' | 'canComplete' | 'id' | 'isCompleted' | 'isDraft' | 'readyToMerge' | 'warnings'
>;

const isBug = (type: string): boolean => normalizeState(type) === normalizeState('Bug');

// Rule TRACK-1
/**
 * The PR the track follows: the first PR of the open repository, else the first one. The PRs of a work item
 * come active first, then the most recent (the same "main PR" as the PR filter and the compact rows)
 */
export function trackPullRequest(item: Pick<WorkItemModel, 'pullRequests'>): PullRequestModel | undefined {
  return item.pullRequests.find((pr) => !pr.otherRepository) ?? item.pullRequests.at(0);
}

// Rule TRACK-2
function branchStation(item: TrackItem, pr: PullRequestModel | undefined): Station {
  const reached = item.branches.length > 0 || pr !== undefined || isFinishedState(item.state);
  return { id: 'branch', label: 'Branch', state: reached ? 'done' : 'pending' };
}

/** The user's warnings about one concern (PullRequestWarning.concern; undefined is about the PR itself) */
function warningsAbout(mine: TrackPullRequest | undefined, concern: WarningConcern): number {
  return (mine?.warnings ?? []).filter((warning) => (warning.concern ?? 'pullRequest') === concern).length;
}

// Rule TRACK-3
/**
 * A draft is the active station: its author reviews it before publishing it. The user's published PR that breaks
 * a team rule about the PR itself (title, description, reviewers, links, build notes, target) is broken
 */
function pullRequestStation(pr: PullRequestModel | undefined, mine: TrackPullRequest | undefined): Station {
  const station = { id: 'pullRequest' as const, label: 'Pull request' };
  if (!pr || pr.tone === 'abandoned') {
    return { ...station, state: 'pending' };
  }
  if (pr.tone === 'draft') {
    return { ...station, state: 'active', detail: 'draft · self-review' };
  }
  const broken = mine && !mine.isCompleted ? warningsAbout(mine, 'pullRequest') : 0;
  return broken
    ? { ...station, state: 'broken', detail: `${String(broken)} team rule(s) not met` }
    : { ...station, state: 'done', detail: `PR ${String(pr.id)}` };
}

const isPublished = (pr: PullRequestModel | undefined): pr is PullRequestModel =>
  pr !== undefined && pr.tone !== 'draft' && pr.tone !== 'abandoned';

// Rule TRACK-4
/** CI starts when the PR is published: a draft has none. A failed run is the author's move */
function ciStation(pr: PullRequestModel | undefined): Station {
  const station = { id: 'ci' as const, label: 'CI' };
  if (!isPublished(pr)) {
    return { ...station, state: 'pending' };
  }
  if (pr.tone === 'completed') {
    return { ...station, state: 'done' };
  }
  switch (worstRunState(pr.runs)) {
    case 'failed':
      return { ...station, state: 'needsYou', detail: 'failed' };
    case 'partial':
      return { ...station, state: 'needsYou', detail: 'partially succeeded' };
    case 'running':
      return { ...station, state: 'active', detail: 'running' };
    case 'queued':
      return { ...station, state: 'active', detail: 'queued' };
    case 'succeeded':
      return { ...station, state: 'done', detail: 'passed' };
    case 'canceled':
    case undefined:
      return { ...station, state: 'pending' };
  }
}

// Rule TRACK-5
/** Peers may review while CI runs: the review station does not wait for the CI one */
function reviewStation(pr: PullRequestModel | undefined, mine: TrackPullRequest | undefined): Station {
  const station = { id: 'review' as const, label: 'Review' };
  if (!isPublished(pr)) {
    return { ...station, state: 'pending' };
  }
  switch (pr.tone) {
    case 'rejected':
      return { ...station, state: 'needsYou', detail: 'rejected' };
    case 'waiting':
      return { ...station, state: 'needsYou', detail: 'waiting for the author' };
    case 'approved':
    case 'completed':
      return { ...station, state: 'done' };
    case 'review':
      return mine?.readyToMerge ? { ...station, state: 'done' } : { ...station, state: 'active', detail: 'in review' };
    case 'abandoned':
    case 'draft':
      return { ...station, state: 'pending' };
  }
}

// Rule TRACK-6
/**
 * Active once nothing stops the merge (PR-READY): the author completes it, or auto-complete will. Auto-complete
 * settings that break a team rule (PR-WARN-3, PR-WARN-4, PR-WARN-11) break this station; the other warnings keep
 * the PR from being ready (PR-EFFECT) and light their own station
 */
function readyStation(pr: PullRequestModel | undefined, mine: TrackPullRequest | undefined): Station {
  const station = { id: 'ready' as const, label: 'Ready to be merged' };
  if (pr?.tone === 'completed') {
    return { ...station, state: 'done', detail: 'merged' };
  }
  if (!mine || mine.isDraft || mine.isCompleted) {
    return { ...station, state: 'pending' };
  }
  if (warningsAbout(mine, 'merge')) {
    return { ...station, state: 'broken', detail: 'auto-complete breaks a team rule' };
  }
  if (!mine.readyToMerge) {
    return { ...station, state: 'pending' };
  }
  return mine.autoComplete
    ? { ...station, state: 'active', detail: 'will complete automatically' }
    : { ...station, state: 'needsYou', detail: 'complete it' };
}

// Rule TRACK-7
/**
 * Developers finish a Bug at Ready to Test (only testers move it to Done), a Backlog Item at Done. A finished work
 * item that still breaks a team rule is broken; a merged PR whose work item is not finished is the user's move
 */
function doneStation(item: TrackItem, pr: PullRequestModel | undefined): Station {
  const station = { id: 'done' as const, label: isBug(item.type) ? 'Ready to Test' : 'Done' };
  if (isFinishedState(item.state)) {
    return item.alerts.length
      ? { ...station, state: 'broken', detail: `${String(item.alerts.length)} team rule(s) broken` }
      : { ...station, state: 'done' };
  }
  return pr?.tone === 'completed'
    ? { ...station, state: 'needsYou', detail: `PR merged, move it to ${station.label}` }
    : { ...station, state: 'pending' };
}

/**
 * The six stations of a work item, in order: Branch, Pull request, CI, Review, Ready to be merged, Done (Ready to
 * Test for Bugs). `mine`: the user's own PR when the track PR is one of theirs, for what only My Pull Requests
 * knows (ready to merge, auto-complete, warnings)
 */
export function workItemTrack(item: TrackItem, mine?: TrackPullRequest): Station[] {
  const pr = trackPullRequest(item);
  const own = mine && pr && mine.id === pr.id ? mine : undefined;
  if (stateCategory(item.state) === 'removed') {
    // Rule TRACK-8
    return [
      branchStation({ ...item, branches: [] }, undefined),
      pullRequestStation(undefined, undefined),
      ciStation(undefined),
      reviewStation(undefined, undefined),
      readyStation(undefined, undefined),
      { id: 'done', label: isBug(item.type) ? 'Ready to Test' : 'Done', state: 'pending', detail: 'removed' },
    ];
  }
  return [
    branchStation(item, pr),
    pullRequestStation(pr, own),
    ciStation(pr),
    reviewStation(pr, own),
    readyStation(pr, own),
    doneStation(item, pr),
  ];
}

// Rule TRACK-9
/** The station to point at: the first that needs the user or is broken, else the first one not passed */
export function currentStation(track: Station[]): Station | undefined {
  return (
    track.find((station) => station.state === 'needsYou' || station.state === 'broken') ??
    track.find((station) => station.state !== 'done')
  );
}
