/**
 * "Working on" work items: the ones whose branch (or the PR of that branch) is checked out in this window
 * ("here") or in another worktree of the repository ("worktree"). Pure: no "vscode" import
 */
import { branchBelongsToWorkItem } from './naming';

export type WorkingOnLevel = 'here' | 'worktree';

export const WORKING_ON_ANIMATIONS = ['none', 'borderLight', 'runningBorder', 'glow', 'stripes'] as const;
/** totalflowx.workingOn.animation: what the card of a work item being worked on "here" does */
export type WorkingOnAnimation = (typeof WORKING_ON_ANIMATIONS)[number];

// Rule WORKON-5
/** Unknown values (a typo in settings.json) mean no animation */
export function normalizeWorkingOnAnimation(value: string | undefined): WorkingOnAnimation {
  return WORKING_ON_ANIMATIONS.find((animation) => animation === value) ?? 'none';
}

/** CSS classes (on the list) that switch the animations on; the stylesheet only animates the "here" cards */
export function workingOnAnimationClasses(animation: WorkingOnAnimation, pulseBadge: boolean): string[] {
  return [animation === 'none' ? '' : `anim-${animation}`, pulseBadge ? 'pulse-badge' : ''].filter(Boolean);
}

/** The part of a work item entry the levels are computed from */
export interface WorkingOnEntry {
  workItem: { id: number; links: { branches: { name: string }[] } };
  /** Branch of the work item (by name, or linked to it) */
  branch?: string;
  pullRequests: { status: string; sourceRefName: string }[];
  /** Names of the branches (this repository) linked to its tasks, own and of other developers */
  taskBranches?: string[];
}

const HEADS = 'refs/heads/';

function stripHeads(ref: string): string {
  return ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref;
}

// Rules WORKON-1, WORKON-2
/**
 * Work items that a checked out branch belongs to. Always the one whose branch it is; with `includeLinked`, also the
 * ones whose ID is in the branch name, whose active PR has the branch as source, or whose Development section links to it
 * or one of whose tasks links to it (the developer forgot to link it to the work item: see the alerts)
 */
export function workItemsOfBranch(branch: string, entries: WorkingOnEntry[], includeLinked: boolean): number[] {
  return entries
    .filter(({ workItem, branch: entryBranch, pullRequests, taskBranches }) => {
      if (entryBranch === branch) {
        return true;
      }
      return (
        includeLinked &&
        (branchBelongsToWorkItem(branch, workItem.id) ||
          pullRequests.some((pr) => pr.status === 'active' && stripHeads(pr.sourceRefName) === branch) ||
          workItem.links.branches.some((link) => stripHeads(link.name) === branch) ||
          !!taskBranches?.some((name) => stripHeads(name) === branch))
      );
    })
    .map(({ workItem }) => workItem.id);
}

/** A work item offered to be linked to a new PR */
export interface LinkCandidate {
  id: number;
  title: string;
  type: string;
  /** It already uses the branch of the PR: pre-selected */
  likely: boolean;
}

/**
 * The work items to offer when creating a PR from a branch, all but the primary one (always linked). The ones that
 * already use the branch (same branch, Development link, ID in its name, PR from it) come first, to be pre-selected
 */
export function linkCandidates(
  entries: (WorkingOnEntry & { workItem: { title: string; type: string } })[],
  primaryId: number | undefined,
  branch: string
): LinkCandidate[] {
  const likely = new Set(workItemsOfBranch(branch, entries, true));
  const candidates = entries
    .filter(({ workItem }) => workItem.id !== primaryId)
    .map(({ workItem: { id, title, type } }) => ({ id, title, type, likely: likely.has(id) }));
  return [
    ...candidates.filter((candidate) => candidate.likely),
    ...candidates.filter((candidate) => !candidate.likely),
  ];
}

export interface WorkingOnInput {
  /** Branch checked out in this window */
  currentBranch?: string;
  /** Branches checked out in the other worktrees; empty when they are not wanted */
  worktreeBranches: string[];
  entries: WorkingOnEntry[];
  /** Also the work items linked to the branch through their PR or Development section, or by the ID in its name */
  includeLinked: boolean;
}

/** Level of every work item being worked on. "here" wins over "worktree" */
export function workingOnLevels({
  currentBranch,
  worktreeBranches,
  entries,
  includeLinked,
}: WorkingOnInput): Map<number, WorkingOnLevel> {
  const levels = new Map<number, WorkingOnLevel>();
  for (const branch of worktreeBranches) {
    for (const id of workItemsOfBranch(branch, entries, includeLinked)) {
      levels.set(id, 'worktree');
    }
  }
  if (currentBranch) {
    for (const id of workItemsOfBranch(currentBranch, entries, includeLinked)) {
      levels.set(id, 'here');
    }
  }
  return levels;
}

// Rule TASK-WORK-1
/** Level of a task row: "here" when one of its branches is the checked out one, "worktree" when another worktree has one */
export function taskWorkingOn(
  branchNames: string[],
  currentBranch: string | undefined,
  worktreeBranches: string[]
): WorkingOnLevel | undefined {
  const names = branchNames.map(stripHeads);
  if (currentBranch && names.includes(stripHeads(currentBranch))) {
    return 'here';
  }
  return worktreeBranches.some((branch) => names.includes(stripHeads(branch))) ? 'worktree' : undefined;
}

export interface WorkingOnBadge {
  glyph: string;
  label: string;
  title: string;
}

/** Text of the badge of a card (and of the compact signal) */
export function workingOnBadge(level: WorkingOnLevel, worktreePath?: string): WorkingOnBadge {
  if (level === 'here') {
    return {
      glyph: '●',
      label: 'Working on',
      title: 'You are working on this: its branch (or the PR of the branch) is checked out in this window',
    };
  }
  return {
    glyph: '⧉',
    label: 'In worktree',
    title: worktreePath
      ? `Checked out in the worktree ${worktreePath}`
      : 'Its branch (or the PR of the branch) is checked out in another worktree of this repository',
  };
}

// Rule WORKON-3
/**
 * Splits the visible cards into the "Working on" section (here first, then worktree; the order of the rest is kept)
 * and the rest. Without a section, nothing moves
 */
export function splitWorkingOn<T extends { workingOn?: WorkingOnLevel }>(
  items: T[],
  section: boolean
): { workingOn: T[]; rest: T[] } {
  if (!section) {
    return { workingOn: [], rest: items };
  }
  const workingOn = items.filter((item) => item.workingOn);
  return {
    workingOn: [
      ...workingOn.filter((item) => item.workingOn === 'here'),
      ...workingOn.filter((item) => item.workingOn === 'worktree'),
    ],
    rest: items.filter((item) => !item.workingOn),
  };
}
