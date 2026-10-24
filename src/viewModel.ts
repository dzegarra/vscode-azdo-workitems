/**
 * Data exchanged between the extension and the work items webview.
 * Shared by both sides, so it must not import "vscode".
 */
import type { ActionMenuSection } from './actionMenu';
import type { WorkItemAlert } from './alerts';
import type { NotUpdated } from './workItemReminders';
import { duplicateFilterValue, type DuplicateLink } from './duplicates';
import type { FixLink } from './fixLinks';
import { OpenPredecessor, predecessorFilterValue } from './predecessors';
import { priorityFilterValue } from './priority';
import type { CoverageThresholds } from './coverage';
import type { CompletedPeriod, MyPullRequestModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import type { RunView } from './runDetails';
import type { ReviewRequestModel } from './reviewRequests';
import type { ReviewedPeriod, ReviewedRequest } from './reviewedRequests';
import type { TaskBranchModel } from './taskBranches';
import type { TaskPullRequestModel } from './taskPullRequests';
import { isClosedState, shownStateOf } from './states';
import type { PullRequestTone } from './workItemLinks';
import type { AttentionEffect } from './attentionEffect';
import type { HoverStyle } from './hoverStyle';
import type { TaskCountStyle } from './taskCountStyle';
import type { SoundId } from './sounds';
import type { BaseBranchBanner } from './baseBranchHealth';
import type { SprintCountdown } from './sprintCountdown';
import type { WorkingOnAnimation, WorkingOnLevel } from './workingOn';

export interface PullRequestModel {
  id: number;
  title: string;
  status: string;
  tone: PullRequestTone;
  url: string;
  isActive: boolean;
  /** Last CI run of each pipeline validating the PR */
  runs: RunModel[];
  /** Name of the repository of the PR */
  repository: string;
  /** The PR is in a repository other than the one open in VS Code */
  otherRepository: boolean;
}

export interface OtherTaskModel {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo?: string;
  taskPullRequests: TaskPullRequestModel[];
  taskBranches?: TaskBranchModel[];
  /** A branch of the task is checked out here or in another worktree: its row is highlighted */
  taskWorkingOn?: WorkingOnLevel;
  /** The "Create branch" button of the task row is offered (see canCreateBranchForTask) */
  canCreateBranch?: boolean;
  /** The "Create PR" button of the task row is offered (see canCreatePullRequestForTask) */
  canCreatePullRequest?: boolean;
  /** The "Link …" items of the task pill are offered (see canLinkBranchForTask) */
  canLinkBranch?: boolean;
}

/** A git branch of a work item (see workItemBranches.ts) */
export interface BranchModel {
  name: string;
  /** "current": checked out here; "local" / "remote": exist in the open repository; "linked": only known from a link or a PR */
  location: 'current' | 'linked' | 'local' | 'remote';
  isCurrent: boolean;
  /** Another worktree has the branch checked out: its folder */
  worktree?: string;
  /** Name of the repository, when the branch is in another one */
  repository?: string;
  /** The branch is in a repository other than the open one: shown dimmed, it cannot be checked out */
  otherRepository: boolean;
}

export interface WorkItemModel {
  id: number;
  title: string;
  type: string;
  state: string;
  /** State to show: In review (Rule STATE-10) or the real state. Filters, sorting and the state button use it */
  displayState: string;
  iterationPath: string;
  url: string;
  parentId?: number;
  /** Title and type of the parent, which may not be in the list (e.g. a Feature) */
  parent?: { id: number; title: string; type: string };
  /** Problems the developers must fix ASAP */
  alerts: WorkItemAlert[];
  /** 1 (most urgent) to 4 */
  priority?: number;
  /** Bugs only, e.g. "2 - High" */
  severity?: string;
  branch?: string;
  /** "local": the branch is checked out locally; "remote": only exists in the remote */
  branchLocation?: 'local' | 'remote';
  isCurrentBranch: boolean;
  /** Every branch of the work item (main branch included): current first, then the main one, the rest of this repository and the other repositories */
  branches: BranchModel[];
  /** The user is working on it: its branch (or the PR of the branch) is checked out here or in another worktree */
  workingOn?: WorkingOnLevel;
  /** Another worktree has the branch checked out: its folder */
  worktree?: string;
  /** Branches of this repository that still exist and whose PR was completed: they should be deleted (see deletableBranches.ts) */
  deletableBranches?: string[];
  pullRequests: PullRequestModel[];
  /** Tasks only: their PRs for the icons of the task rows, active ones first */
  taskPullRequests?: TaskPullRequestModel[];
  /** Tasks only: their linked branches for the icons of the task rows */
  taskBranches?: TaskBranchModel[];
  /** Tasks only: a branch of the task is checked out here or in another worktree: its row is highlighted */
  taskWorkingOn?: WorkingOnLevel;
  /** Tasks only: the "Create branch" button of the task row is offered (see canCreateBranchForTask) */
  canCreateBranch?: boolean;
  /** Tasks only: the "Create PR" button of the task row is offered (see canCreatePullRequestForTask) */
  canCreatePullRequest?: boolean;
  /** Tasks only: the "Link …" items of the task pill are offered (see canLinkBranchForTask) */
  canLinkBranch?: boolean;
  /**
   * Tasks under the work item that are not in the list (assigned to other developers or in other iterations),
   * shown with the tasks of the list
   */
  otherTasks?: OtherTaskModel[];
  /**
   * Predecessors not completed, the riskiest first. Empty: none open. Undefined: unknown (they could not be
   * loaded), so nothing is said about them
   */
  openPredecessors?: OpenPredecessor[];
  /** Tags of the work item that are in `alerts.blockingTags`. Empty for closed work items */
  blockingTags?: string[];
  /** Display names of the empty fields that keep a Backlog Item from being completed. Empty for closed work items */
  missingFields?: string[];
  /** Team conventions of a Backlog Item it does not follow (COMPLETE-5, COMPLETE-6). Empty for closed work items */
  conventions?: string[];
  /** In progress but not updated for a while (REMIND-1): the "zZ" badge of the title. Not a completion issue */
  notUpdated?: NotUpdated;
  /** Backlog Items only: the bugs they fix (successors of type Bug). Undefined: not applicable or unknown */
  fixesBugs?: FixLink[];
  /** Bugs only: the Backlog Items that fix them (predecessors). Undefined: not applicable or unknown */
  fixedBy?: FixLink[];
  /** The original it duplicates ("Duplicate Of"). Undefined: unknown */
  duplicateOf?: DuplicateLink[];
  /** The work items duplicating it. Undefined: unknown */
  duplicates?: DuplicateLink[];
}

/** "task": a branch linked to a task, from the icons of its row (`id` is the task) */
export type CheckoutKind = 'myPullRequest' | 'review' | 'task' | 'workItem';

export interface IterationModel {
  name: string;
  path: string;
  teams: string[];
  /** Last day of the sprint (midnight UTC); undefined when not planned */
  finishDate?: string;
  /** "🌱 6 days left" (totalflowx.fun.enabled only) */
  countdown?: SprintCountdown;
}

export interface FilterModel {
  /** Work item types shown. Empty: all */
  types: string[];
  /** States hidden */
  hiddenStates: string[];
  /** PR states hidden, including NO_PULL_REQUEST */
  hiddenPullRequestStates: string[];
  /** Priorities hidden: "P1" … "P4" or NO_PRIORITY */
  hiddenPriorities: string[];
  /** Predecessor states hidden: "Incomplete predecessors" or "Complete predecessors" */
  hiddenPredecessorStates: string[];
  /** "Duplicates": the work items that duplicate another one are hidden */
  hiddenDuplicates: string[];
}

/** totalflowx.workItems.layout: compact rows (2 lines) or the large cards */
export type Layout = 'compact' | 'large';

/** The two PR boxes above the work items */
export type PanelId = 'myPullRequests' | 'reviews';

export interface ViewModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  iterations: IterationModel[];
  workItems: WorkItemModel[];
  filter: FilterModel;
  /** States in the order the work items are sorted */
  stateOrder: string[];
  /** PRs waiting for the user's review, most urgent first */
  reviews: ReviewsModel;
  /** PRs created by the user, with what is missing to merge them */
  pullRequests: MyPullRequestsModel;
  /** Work items with alerts skip the state / PR / priority filters (totalflowx.filter.alwaysShowAlerts) */
  alwaysShowAlerts: boolean;
  layout: Layout;
  /** How the cards and PR tiles react to the pointer (totalflowx.appearance.hoverStyle) */
  hoverStyle: HoverStyle;
  /** The cards of forgotten work items pulse in orange (totalflowx.appearance.asleepPulse, Rule REMIND-3) */
  asleepPulse: boolean;
  /** Milliseconds before the popovers (task details, coverage, predecessors, PR history) appear on hover (totalflowx.popovers.hoverDelay) */
  popoverDelay: number;
  /** How the counts on the bar of the Tasks header look (totalflowx.tasks.countStyle) */
  tasksCountStyle: TaskCountStyle;
  coverage: CoverageViewModel;
  workingOn: WorkingOnViewModel;
  /** Rule BASE-CI-8: the CI of the base branch is red (undefined: green, off or not known) */
  baseBranch?: BaseBranchBanner;
}

/** totalflowx.workingOn.* */
export interface WorkingOnViewModel {
  /** The work items being worked on skip the State / PR / Priority filters and the "Show only these" toggle */
  ignoreFilters: boolean;
  /** They are moved to a "Working on" section at the top of the list */
  section: boolean;
  /** Animation of the "here" cards (totalflowx.workingOn.animation) */
  animation: WorkingOnAnimation;
  /** The ● of the "here" badge and dot pulses (totalflowx.workingOn.pulseBadge) */
  pulseBadge: boolean;
}

export interface CoverageViewModel {
  thresholds: CoverageThresholds;
  /** "Your best: 98% · streak: 4 PRs ≥ 80%" */
  records?: string;
}

export interface ReviewsModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  requests: ReviewRequestModel[];
  maxWaitHours: number;
  /** Hours before the maximum wait when a PR is due soon */
  dueSoonHours: number;
  /** totalflowx.reviews.includeOptional: the optional reviews are in `requests` */
  includeOptional: boolean;
  /** Optional reviews not in the list because of includeOptional */
  hiddenOptional: number;
  /** totalflowx.reviews.reviewedPeriod */
  reviewedPeriod: ReviewedPeriod;
  /** PRs already reviewed by the user, for the "Reviewed" section: they never count as waiting */
  reviewed: ReviewedRequest[];
  /** totalflowx.reviews.layout */
  layout: Layout;
}

export interface MyPullRequestsModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  /** totalflowx.myPullRequests.showDrafts */
  showDrafts: boolean;
  /** Drafts not in the list because of showDrafts */
  hiddenDrafts: number;
  /** totalflowx.myPullRequests.completedPeriod */
  completedPeriod: CompletedPeriod;
  /** Completed PRs (last 24 hours) not in the list because the period is "hidden" */
  hiddenCompleted: number;
  /** Median time and main phase of the completed PRs listed; undefined with fewer than 2 */
  completedSummary?: string;
  /** totalflowx.myPullRequests.layout */
  layout: Layout;
  /** totalflowx.myPullRequests.attentionEffect */
  attentionEffect: AttentionEffect;
  items: MyPullRequestModel[];
}

export type WebviewMessage =
  | {
      type:
        | 'addTask'
        | 'changeState'
        | 'checkout'
        | 'clearIntegrationBuild'
        | 'createBranch'
        | 'createPullRequest'
        | 'deleteBranch'
        | 'fillIntegrationBuild'
        | 'linkBranchToTask'
        | 'linkTaskBranch'
        | 'linkTaskPullRequest'
        | 'openDependencyMap'
        | 'openDetails'
        | 'openPullRequest'
        | 'openRun'
        | 'openWorkItem';
      id: number;
      pullRequestId?: number;
      runId?: number;
      /** openRun: show this tab of the run (its tests, its coverage) instead of its summary */
      view?: RunView;
      /**
       * checkout: a branch of the work item other than its main one; linkTaskBranch: the branch of a task to link;
       * linkBranchToTask: the branch to link to the task (none: the user picks one)
       */
      branch?: string;
      /** createBranch / createPullRequest / linkBranchToTask from a task row: `id` is the parent work item, this the task */
      taskId?: number;
    }
  | { type: 'openFile'; path: string }
  /** Sidebar: a trigger (task pill, branch row, ... of a Checkout button) asks for the native picker of its actions */
  | { type: 'showActions'; title: string; sections: ActionMenuSection[] }
  /** The ... of a Checkout button (details panel: the extension builds the picker) and "Open worktree": the id is the work item or the PR; `branch`: a branch of the row of a work item */
  | {
      type: 'checkoutMenu' | 'checkoutHere' | 'openWorktree' | 'removeWorktree' | 'worktreeMenu';
      kind: CheckoutKind;
      id: number;
      branch?: string;
    }
  | { type: 'checkReviewRequests' }
  | { type: 'checkoutReviewRequest'; pullRequestId: number }
  | { type: 'openReviewRequest' | 'openMyPullRequest'; url: string }
  | { type: 'checkMyPullRequests' }
  | {
      type:
        | 'addBuildNotesSkipTag'
        | 'checkoutMyPullRequest'
        | 'completeMyPullRequest'
        | 'publishMyPullRequest'
        | 'restartMyPullRequestMerge'
        | 'retargetMyPullRequest';
      pullRequestId: number;
    }
  | { type: 'setShowDrafts' | 'setShowOptional'; show: boolean }
  | { type: 'setCompletedPeriod'; period: CompletedPeriod }
  | { type: 'setReviewedPeriod'; period: ReviewedPeriod }
  /** The reviewed PRs unfolded in the box: the only ones whose details the extension fetches */
  | { type: 'setReviewedExpanded'; ids: number[] }
  /** Layout of one of the PR boxes */
  | { type: 'setPanelLayout'; panel: PanelId; layout: Layout }
  | { type: 'ready' }
  | { type: 'refresh' }
  /** The banner of a broken base branch: the picker of what broke it */
  | { type: 'showBaseBranchAlert' }
  | { type: 'setFilter'; filter: FilterModel }
  | { type: 'setLayout'; layout: Layout };

/** Buttons of a work item: run by id */
export type WorkItemActionMessage = Exclude<
  Extract<WebviewMessage, { id: number }>,
  { type: 'checkoutMenu' | 'checkoutHere' | 'openWorktree' | 'removeWorktree' | 'worktreeMenu' }
>;

export type ExtensionMessage =
  /** Opens or closes the task list of every card */
  | { type: 'setTasksExpanded'; expanded: boolean }
  /** Scrolls to the card of the work item and flashes it, opening its iteration group when collapsed */
  | { type: 'revealWorkItem'; id: number }
  /** Confetti (a merged PR) and / or a sound (totalflowx.fun.enabled, totalflowx.fun.sounds) */
  | { type: 'celebrate'; confetti: boolean; sound?: SoundId }
  | { type: 'state'; model: ViewModel };

export const NO_PULL_REQUEST = 'No PR';

export type BranchAction = 'checkout' | 'createBranch' | 'createPullRequest' | 'deleteBranch';

// Rules CARD-ACT-1..5
/**
 * Branch actions offered for a work item. Finished or Removed work items (Done, Ready to Test, Removed…) get no new branch, checkout
 * or PR. "Delete branch" is offered whatever the state when exactly one branch is deletable (its PR was completed):
 * with several, each branch row has its own button
 */
export function branchActions(
  item: Pick<WorkItemModel, 'branch' | 'branches' | 'isCurrentBranch' | 'deletableBranches' | 'pullRequests' | 'state'>
): BranchAction[] {
  // Only the PRs of this repository count: an active PR in another one does not cover this branch
  const hasActivePullRequest = item.pullRequests.some((pr) => pr.isActive && !pr.otherRepository);
  const remove: BranchAction[] = item.deletableBranches?.length === 1 ? ['deleteBranch'] : [];
  if (isClosedState(item.state)) {
    return remove;
  }
  if (!item.branch) {
    return ['createBranch', ...remove];
  }
  return [
    // With several branches each branch row has its own Checkout (src/branchRows.ts): a card button would be ambiguous
    ...(item.isCurrentBranch || item.branches.length > 1 ? [] : ['checkout' as const]),
    ...(hasActivePullRequest ? [] : ['createPullRequest' as const]),
    ...remove,
  ];
}

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** Keys of the filter whose values differ (the order of the values does not matter) */
export function changedFilterKeys(a: FilterModel, b: FilterModel): (keyof FilterModel)[] {
  return (
    [
      'types',
      'hiddenStates',
      'hiddenPullRequestStates',
      'hiddenPriorities',
      'hiddenPredecessorStates',
      'hiddenDuplicates',
    ] as const
  ).filter((key) => !sameValues(a[key], b[key]));
}

/** State of the main PR of the work item (the first one: active PRs come first), used by the PR filter */
/** PR state labels renamed over time: old value -> current label */
const LEGACY_PULL_REQUEST_STATES: Record<string, string> = { 'Waiting for review': 'In review' };

/** Maps hidden PR states saved with old labels to the current ones (no duplicates) */
export function migratePullRequestStates(states: string[]): string[] {
  return [...new Set(states.map((state) => LEGACY_PULL_REQUEST_STATES[state] ?? state))];
}

export function pullRequestFilterValue(item: Pick<WorkItemModel, 'pullRequests'>): string {
  return item.pullRequests.at(0)?.status ?? NO_PULL_REQUEST;
}

// Rules FILTER-1..6, FILTER-8, ALERT-SHOW-3, WORKON-4
/**
 * True when the work item passes the type / state / PR / priority / predecessors / duplicates filters and matches the
 * search text. With "alwaysShowAlerts", work items with alerts skip the state / PR / priority / predecessors / duplicates filters: they must be fixed
 * ASAP, e.g. a "Done" work item with open tasks would be hidden by the default "Done" filter. With "workingOnIgnoresFilters",
 * so do the ones being worked on (workingOn.ignoreFilters)
 */
export function isVisible(
  item: Pick<WorkItemModel, 'branch' | 'id' | 'pullRequests' | 'state' | 'title' | 'type'> & {
    displayState?: string;
    alerts?: unknown[];
    workingOn?: WorkingOnLevel;
    priority?: number;
    openPredecessors?: unknown[];
    duplicateOf?: unknown[];
  },
  filter: FilterModel,
  text = '',
  alwaysShowAlerts = false,
  workingOnIgnoresFilters = false
): boolean {
  if (filter.types.length && !filter.types.includes(item.type)) {
    return false;
  }
  const hasAlerts = (alwaysShowAlerts && !!item.alerts?.length) || (workingOnIgnoresFilters && !!item.workingOn);
  if (!hasAlerts && filter.hiddenStates.includes(shownStateOf(item))) {
    return false;
  }
  if (!hasAlerts && filter.hiddenPullRequestStates.includes(pullRequestFilterValue(item))) {
    return false;
  }
  if (!hasAlerts && filter.hiddenPriorities.includes(priorityFilterValue(item))) {
    return false;
  }
  // Work items whose predecessors are unknown are never hidden by this filter
  const predecessors = predecessorFilterValue(item);
  if (!hasAlerts && predecessors !== undefined && filter.hiddenPredecessorStates.includes(predecessors)) {
    return false;
  }
  const duplicate = duplicateFilterValue(item);
  if (!hasAlerts && duplicate !== undefined && filter.hiddenDuplicates.includes(duplicate)) {
    return false;
  }
  const query = text.trim().toLowerCase();
  return (
    !query || [String(item.id), item.title, item.branch ?? ''].some((value) => value.toLowerCase().includes(query))
  );
}

type FilterableItem = Pick<WorkItemModel, 'pullRequests' | 'state' | 'type'> & { displayState?: string } & {
  priority?: number;
  openPredecessors?: unknown[];
  duplicateOf?: unknown[];
};

// Rule FILTER-7
/**
 * Filter values hiding something among the given work items: types left out, and states, PR states, priorities,
 * predecessor states and duplicates hidden. Values no work item has are not counted: they have no chip to switch back on
 */
export function activeFilterCount(filter: FilterModel, workItems: FilterableItem[]): number {
  const present = (key: (item: FilterableItem) => string | undefined): Set<string> => {
    const values = new Set<string>();
    for (const item of workItems) {
      const value = key(item);
      if (value !== undefined) {
        values.add(value);
      }
    }
    return values;
  };
  const hiddenAmong = (values: Set<string>, hidden: string[]): number =>
    [...values].filter((value) => hidden.includes(value)).length;
  const types = filter.types.length ? [...present((item) => item.type)].filter((t) => !filter.types.includes(t)) : [];
  return (
    types.length +
    hiddenAmong(present(shownStateOf), filter.hiddenStates) +
    hiddenAmong(present(pullRequestFilterValue), filter.hiddenPullRequestStates) +
    hiddenAmong(present(priorityFilterValue), filter.hiddenPriorities) +
    hiddenAmong(present(predecessorFilterValue), filter.hiddenPredecessorStates) +
    hiddenAmong(present(duplicateFilterValue), filter.hiddenDuplicates)
  );
}

/**
 * Scope of the list, so it is clear it only shows the work items assigned to the user,
 * e.g. "Assigned to you in Sprint 42 (FUI Team)"
 */
export function describeScope(iterations: Pick<IterationModel, 'name' | 'teams'>[]): {
  text: string;
  tooltip: string;
} {
  const details = iterations.map(({ name, teams }) => `${name} (${teams.join(', ')})`);
  if (!iterations.length) {
    return { text: 'Assigned to you', tooltip: 'Work items assigned to you' };
  }
  const tooltip = `Work items assigned to you in the current iteration of your teams:\n${details.join('\n')}`;
  if (iterations.length === 1) {
    return { text: `Assigned to you in ${details[0]}`, tooltip };
  }
  const teams = new Set(iterations.flatMap((iteration) => iteration.teams)).size;
  return { text: `Assigned to you in the current sprints of ${teams} teams`, tooltip };
}
