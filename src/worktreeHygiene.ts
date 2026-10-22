/**
 * Leftover worktrees: where each one came from and whether it is still needed (its PR was merged, the review is over,
 * its work item is closed…). Pure: no "vscode" import
 */
import * as path from 'node:path';
import { isProtectedBranch } from './deletableBranches';
import { isClosedState } from './states';
import type { CheckoutKind } from './viewModel';
import { removalBlocker, samePath, Worktree, worktreesRoot } from './worktrees';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** A vote of "Approved with suggestions" (5) or "Approved" (10) */
const APPROVED_VOTE = 5;

/**
 * Where a worktree created by the extension came from: the card / PR whose Checkout or Open in a worktree created it.
 * `id` is the work item, task or PR id, after `kind`
 */
export interface WorktreeOrigin {
  path: string;
  branch: string;
  kind: CheckoutKind;
  id: number;
  /** ISO date */
  createdAt: string;
}

// Rule WORKTREE-ORIGIN-1
/** The origins with this one: it replaces the one of the same folder (a folder re-created for another branch) */
export function recordOrigin(origins: readonly WorktreeOrigin[], origin: WorktreeOrigin): WorktreeOrigin[] {
  return [...origins.filter((known) => !samePath(known.path, origin.path)), origin];
}

// Rule WORKTREE-ORIGIN-1
/**
 * Forgets the origins of the worktrees of this repository that are gone: those inside "<repo>.worktrees" that `git
 * worktree list` no longer has. The origins of other repositories (other windows) are kept. Nothing is forgotten when
 * the list is empty (git could not be read)
 */
export function pruneOrigins(origins: readonly WorktreeOrigin[], worktrees: readonly Worktree[]): WorktreeOrigin[] {
  const main = worktrees.at(0);
  if (!main) {
    return [...origins];
  }
  const root = worktreesRoot(main.path);
  return origins.filter(
    (origin) =>
      !path.resolve(origin.path).startsWith(root + path.sep) ||
      worktrees.some((worktree) => samePath(worktree.path, origin.path))
  );
}

/** The origin of a worktree: same folder and still the same branch (a worktree can switch branches) */
export function originOf(origins: readonly WorktreeOrigin[], worktree: Worktree): WorktreeOrigin | undefined {
  return origins.find((origin) => samePath(origin.path, worktree.path) && origin.branch === worktree.branch);
}

/** What local git says about a branch */
export interface BranchFacts {
  /** It had an upstream branch that is gone (deleted in the remote, then pruned by a fetch) */
  upstreamGone: boolean;
  /** Unix time in ms of its last commit */
  lastCommitAt?: number;
}

/**
 * Parses `git for-each-ref --format=%(refname:short)%09%(upstream:track)%09%(committerdate:unix) refs/heads`: one
 * line per local branch
 */
export function parseBranchFacts(output: string): Map<string, BranchFacts> {
  const facts = new Map<string, BranchFacts>();
  for (const line of output.split(/\r?\n/)) {
    const [name, track = '', date = ''] = line.split('\t');
    if (!name) {
      continue;
    }
    const seconds = Number(date);
    facts.set(name, {
      upstreamGone: track.includes('gone'),
      lastCommitAt: date && Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined,
    });
  }
  return facts;
}

/** A PR of the open repository known from the work items, the user's PRs or the user's reviews */
export interface KnownPullRequest {
  id: number;
  title?: string;
  /** Without "refs/heads/" */
  sourceBranch: string;
  status: string;
  /** Created by the user */
  mine?: boolean;
}

/** An active PR of the open repository where the user is a reviewer */
export interface ActiveReview {
  id: number;
  title?: string;
  sourceBranch: string;
  /** The user's vote: 10 approved, 5 with suggestions, 0 none, -5 waiting for author, -10 rejected */
  myVote: number;
}

/** A work item or task of the list, with the branches of the open repository it is linked to */
export interface KnownWorkItem {
  id: number;
  title: string;
  state: string;
  branches: string[];
}

export interface HygieneInput {
  worktrees: readonly Worktree[];
  /** Folders open in this window: never offered for removal */
  openFolders: readonly string[];
  origins: readonly WorktreeOrigin[];
  /** By branch name */
  branchFacts: ReadonlyMap<string, BranchFacts>;
  /** Folders of the worktrees with uncommitted changes */
  dirtyFolders?: readonly string[];
  pullRequests: readonly KnownPullRequest[];
  /** Undefined while the reviews are not loaded: no review is "over" then */
  activeReviews?: readonly ActiveReview[];
  /** Ids of the user's active PRs; undefined while My Pull Requests is not loaded */
  activeOwnPullRequests?: readonly number[];
  /** Undefined while the work items are not loaded */
  workItems?: readonly KnownWorkItem[];
  now: number;
  /** totalflowx.worktrees.idleDays; 0: never idle */
  idleDays: number;
}

export type HygieneReason =
  | { kind: 'missing' }
  | { kind: 'merged'; pullRequestId: number }
  | { kind: 'abandoned'; pullRequestId: number }
  | { kind: 'reviewOver'; pullRequestId: number }
  | { kind: 'pullRequestClosed'; pullRequestId: number }
  | { kind: 'upstreamGone' }
  | { kind: 'workItemClosed'; workItemId: number; state: string }
  | { kind: 'idle'; days: number }
  | { kind: 'approved'; pullRequestId: number };

/** stale: can be removed; idle: probably not needed; inUse: nothing says it is done */
export type WorktreeStatus = 'idle' | 'inUse' | 'stale';

/** What the worktree is for */
export interface WorktreeOwner {
  kind: CheckoutKind;
  id: number;
  title?: string;
}

export interface ClassifiedWorktree {
  worktree: Worktree;
  status: WorktreeStatus;
  /** Why it is stale or idle, the strongest first; empty when in use */
  reasons: HygieneReason[];
  owner?: WorktreeOwner;
  dirty: boolean;
  /** Unix time in ms of the last commit of its branch */
  lastCommitAt?: number;
}

const STALE_KINDS: readonly HygieneReason['kind'][] = [
  'missing',
  'merged',
  'abandoned',
  'reviewOver',
  'pullRequestClosed',
  'upstreamGone',
  'workItemClosed',
];

export function isStaleReason(reason: HygieneReason): boolean {
  return STALE_KINDS.includes(reason.kind);
}

/** The PRs from the branch; the same PR may come from several sources (work items, my PRs, reviews) */
function pullRequestsOf(branch: string, pullRequests: readonly KnownPullRequest[]): KnownPullRequest[] {
  return pullRequests.filter((pr) => pr.sourceBranch === branch);
}

// Rule WORKTREE-OWNER-1
/**
 * The work item or PR the worktree is for: its recorded origin, else the user's PR from the branch (the active one
 * first), else an active review of it, else a work item linked to it
 */
export function ownerOf(
  worktree: Worktree,
  input: Pick<HygieneInput, 'activeReviews' | 'origins' | 'pullRequests' | 'workItems'>
): WorktreeOwner | undefined {
  const branch = worktree.branch;
  const origin = originOf(input.origins, worktree);
  const prTitle = (id: number) =>
    input.pullRequests.find((pr) => pr.id === id)?.title ?? input.activeReviews?.find((pr) => pr.id === id)?.title;
  if (origin) {
    const title =
      origin.kind === 'myPullRequest' || origin.kind === 'review'
        ? prTitle(origin.id)
        : input.workItems?.find((item) => item.id === origin.id)?.title;
    return { kind: origin.kind, id: origin.id, title };
  }
  if (!branch) {
    return undefined;
  }
  const mine = pullRequestsOf(branch, input.pullRequests).filter((pr) => pr.mine);
  const own = mine.find((pr) => pr.status === 'active') ?? mine.at(0);
  if (own) {
    return { kind: 'myPullRequest', id: own.id, title: own.title };
  }
  const review = input.activeReviews?.find((pr) => pr.sourceBranch === branch);
  if (review) {
    return { kind: 'review', id: review.id, title: review.title };
  }
  const item = input.workItems?.find((candidate) => candidate.branches.includes(branch));
  return item && { kind: 'workItem', id: item.id, title: item.title };
}

// Rules WORKTREE-STALE-2, WORKTREE-STALE-3
function pullRequestReasons(branch: string, pullRequests: readonly KnownPullRequest[]): HygieneReason[] {
  if (isProtectedBranch(branch)) {
    return [];
  }
  const own = pullRequestsOf(branch, pullRequests);
  if (own.some((pr) => pr.status === 'active')) {
    return [];
  }
  const completed = own.find((pr) => pr.status === 'completed');
  if (completed) {
    return [{ kind: 'merged', pullRequestId: completed.id }];
  }
  const abandoned = own.find((pr) => pr.status === 'abandoned');
  return abandoned ? [{ kind: 'abandoned', pullRequestId: abandoned.id }] : [];
}

// Rules WORKTREE-STALE-4, WORKTREE-STALE-8
/**
 * The PR the worktree was created for (a review or one of the user's PRs) is no longer active, and its merge or
 * abandon is not known (the lists only keep recent completed PRs, and the user's abandoned ones are not fetched)
 */
function originPullRequestReasons(
  origin: WorktreeOrigin | undefined,
  input: Pick<HygieneInput, 'activeOwnPullRequests' | 'activeReviews'>,
  known: HygieneReason[]
): HygieneReason[] {
  if (!origin || (origin.kind !== 'review' && origin.kind !== 'myPullRequest')) {
    return [];
  }
  const active =
    origin.kind === 'review' ? input.activeReviews?.map((pr) => pr.id) : input.activeOwnPullRequests?.slice();
  const explained = known.some(
    (reason) => (reason.kind === 'merged' || reason.kind === 'abandoned') && reason.pullRequestId === origin.id
  );
  if (!active || explained || active.includes(origin.id)) {
    return [];
  }
  return [{ kind: origin.kind === 'review' ? 'reviewOver' : 'pullRequestClosed', pullRequestId: origin.id }];
}

// Rule WORKTREE-STALE-6
/** The origin's work item or task when it is closed; without origin, the work items linked to the branch, all closed */
function workItemReasons(
  branch: string,
  origin: WorktreeOrigin | undefined,
  workItems: HygieneInput['workItems']
): HygieneReason[] {
  if (!workItems) {
    return [];
  }
  let candidates: readonly KnownWorkItem[];
  if (origin) {
    candidates =
      origin.kind === 'workItem' || origin.kind === 'task' ? workItems.filter((item) => item.id === origin.id) : [];
  } else {
    candidates = workItems.filter((item) => item.branches.includes(branch));
  }
  const closed = candidates.filter((item) => isClosedState(item.state));
  const first = closed.at(0);
  return first && closed.length === candidates.length
    ? [{ kind: 'workItemClosed', workItemId: first.id, state: first.state }]
    : [];
}

// Rules WORKTREE-IDLE-1, WORKTREE-IDLE-2
function idleReasons(
  worktree: Worktree,
  origin: WorktreeOrigin | undefined,
  lastCommitAt: number | undefined,
  input: Pick<HygieneInput, 'activeReviews' | 'idleDays' | 'now'>
): HygieneReason[] {
  const reasons: HygieneReason[] = [];
  const reviewId =
    origin?.kind === 'review'
      ? origin.id
      : input.activeReviews?.find((pr) => !origin && pr.sourceBranch === worktree.branch)?.id;
  const review = input.activeReviews?.find((pr) => pr.id === reviewId);
  if (review && review.myVote >= APPROVED_VOTE) {
    reasons.push({ kind: 'approved', pullRequestId: review.id });
  }
  // A worktree created recently for an old branch is not idle
  const created = origin ? Date.parse(origin.createdAt) : NaN;
  const lastActivity = Math.max(lastCommitAt ?? NaN, Number.isNaN(created) ? -Infinity : created);
  if (input.idleDays > 0 && Number.isFinite(lastActivity)) {
    const days = Math.floor((input.now - lastActivity) / MS_PER_DAY);
    if (days >= input.idleDays) {
      reasons.push({ kind: 'idle', days });
    }
  }
  return reasons;
}

// Rules WORKTREE-STALE-1..8
/** Why one worktree is stale or idle, the strongest reason first */
function reasonsOf(worktree: Worktree, input: HygieneInput): HygieneReason[] {
  if (worktree.prunable) {
    return [{ kind: 'missing' }];
  }
  const branch = worktree.branch;
  const origin = originOf(input.origins, worktree);
  const facts = branch ? input.branchFacts.get(branch) : undefined;
  if (!branch) {
    return idleReasons(worktree, origin, undefined, input);
  }
  const stale = pullRequestReasons(branch, input.pullRequests);
  stale.push(...originPullRequestReasons(origin, input, stale));
  if (facts?.upstreamGone) {
    stale.push({ kind: 'upstreamGone' });
  }
  stale.push(...workItemReasons(branch, origin, input.workItems));
  return [...stale, ...idleReasons(worktree, origin, facts?.lastCommitAt, input)];
}

// Rule WORKTREE-STALE-7
/**
 * Every worktree that could be removed (not the main one, a bare entry or a folder open in this window), with its
 * status. Locked worktrees are listed but never stale: someone locked them on purpose
 */
export function classifyWorktrees(input: HygieneInput): ClassifiedWorktree[] {
  const openFolders = [...input.openFolders];
  return input.worktrees
    .filter((worktree) => !removalBlocker([...input.worktrees], worktree, openFolders))
    .map((worktree) => {
      const reasons = worktree.locked ? [] : reasonsOf(worktree, input);
      let status: WorktreeStatus = 'inUse';
      if (reasons.some(isStaleReason)) {
        status = 'stale';
      } else if (reasons.length) {
        status = 'idle';
      }
      return {
        worktree,
        status,
        reasons,
        owner: ownerOf(worktree, input),
        dirty: !!input.dirtyFolders?.some((folder) => samePath(folder, worktree.path)),
        lastCommitAt: worktree.branch ? input.branchFacts.get(worktree.branch)?.lastCommitAt : undefined,
      };
    });
}

/** Short text of a reason, for the picker, the tooltips and the notifications */
export function hygieneReasonText(reason: HygieneReason): string {
  switch (reason.kind) {
    case 'missing':
      return 'folder missing';
    case 'merged':
      return `PR ${String(reason.pullRequestId)} merged`;
    case 'abandoned':
      return `PR ${String(reason.pullRequestId)} abandoned`;
    case 'reviewOver':
      return `review over: PR ${String(reason.pullRequestId)} is no longer active`;
    case 'pullRequestClosed':
      return `PR ${String(reason.pullRequestId)} is no longer active`;
    case 'upstreamGone':
      return 'branch deleted in the remote';
    case 'workItemClosed':
      return `work item ${String(reason.workItemId)} is ${reason.state}`;
    case 'idle':
      return `no commits for ${String(reason.days)} days`;
    case 'approved':
      return `you approved PR ${String(reason.pullRequestId)}`;
  }
}

export function hygieneReasonsText(reasons: readonly HygieneReason[]): string {
  return reasons.map(hygieneReasonText).join(', ');
}

/** "#1234 Title", "PR 567 (review)" */
export function ownerText(owner: WorktreeOwner): string {
  const title = owner.title ? ` ${owner.title}` : '';
  switch (owner.kind) {
    case 'workItem':
      return `#${String(owner.id)}${title}`;
    case 'task':
      return `task #${String(owner.id)}${title}`;
    case 'myPullRequest':
      return `PR ${String(owner.id)}${title}`;
    case 'review':
      return `PR ${String(owner.id)} (review)${title}`;
  }
}

/** "today", "1 day ago", "12 days ago" */
export function ageText(since: number | undefined, now: number): string | undefined {
  if (since === undefined) {
    return undefined;
  }
  const days = Math.max(0, Math.floor((now - since) / MS_PER_DAY));
  if (!days) {
    return 'today';
  }
  return days === 1 ? '1 day ago' : `${String(days)} days ago`;
}

const STATUS_ORDER: Record<WorktreeStatus, number> = { stale: 0, idle: 1, inUse: 2 };

/** Stale first, then idle, then in use; by branch name in each group */
export function sortClassified(worktrees: readonly ClassifiedWorktree[]): ClassifiedWorktree[] {
  return [...worktrees].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.worktree.branch ?? a.worktree.path).localeCompare(b.worktree.branch ?? b.worktree.path)
  );
}

/** Identifies a stale worktree for the notifications: a folder can be re-used for another branch */
export function staleKey(worktree: Worktree): string {
  return `${path.resolve(worktree.path)}|${worktree.branch ?? ''}`;
}

// Rule WORKTREE-NUDGE-1
/**
 * The stale worktrees to notify: those not notified yet. Without a baseline (first check ever) nothing is notified:
 * the Summary and the Worktrees view list them. The new baseline keeps the keys of the worktrees that still exist, so
 * a worktree that stops looking stale for a while (a source that failed to load) is not notified twice
 */
export function newlyStale(
  baseline: readonly string[] | undefined,
  classified: readonly ClassifiedWorktree[]
): { notify: ClassifiedWorktree[]; baseline: string[] } {
  const stale = classified.filter((item) => item.status === 'stale');
  const staleKeys = stale.map((item) => staleKey(item.worktree));
  const existing = new Set(classified.map((item) => staleKey(item.worktree)));
  const kept = (baseline ?? []).filter((key) => existing.has(key));
  const next = [...new Set([...kept, ...staleKeys])].sort();
  if (!baseline) {
    return { notify: [], baseline: next };
  }
  const known = new Set(baseline);
  return { notify: stale.filter((item) => !known.has(staleKey(item.worktree))), baseline: next };
}

// Rule WORKTREE-NUDGE-2
/**
 * The stale worktrees worth a notification: not those whose only reason is the merge of one of the user's PRs when
 * the notifier already offers to delete its branch for that merge (which removes the worktree too)
 */
export function worktreesToNotify(
  items: readonly ClassifiedWorktree[],
  ownMergeOffered: (pullRequestId: number) => boolean
): ClassifiedWorktree[] {
  return items.filter((item) => {
    const stale = item.reasons.filter(isStaleReason);
    return !stale.every((reason) => reason.kind === 'merged' && ownMergeOffered(reason.pullRequestId));
  });
}
