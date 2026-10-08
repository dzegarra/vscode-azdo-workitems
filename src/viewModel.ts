/**
 * Data exchanged between the extension and the work items webview.
 * Shared by both sides, so it must not import "vscode".
 */
import type { WorkItemAlert } from './alerts';
import { OpenPredecessor, predecessorFilterValue } from './predecessors';
import { priorityFilterValue } from './priority';
import type { CoverageThresholds } from './coverage';
import type { MyPullRequestModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import type { ReviewRequestModel } from './reviewRequests';
import type { TaskPullRequestModel } from './taskPullRequests';
import { isFinishedState } from './states';
import type { PullRequestTone } from './workItemLinks';
import type { WorkingOnLevel } from './workingOn';

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
  /** Finished work items (Done, Ready to Test…) whose branch still exists: it should be deleted */
  leftoverBranch?: { name: string; local: boolean; remote: boolean };
  pullRequests: PullRequestModel[];
  /** Tasks only: their PRs for the icons of the task rows, active ones first */
  taskPullRequests?: TaskPullRequestModel[];
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
}

export type CheckoutKind = 'myPullRequest' | 'review' | 'workItem';

export interface IterationModel {
  name: string;
  path: string;
  teams: string[];
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
}

/** azdoWorkItems.layout: compact rows (2 lines) or the large cards */
export type Layout = 'compact' | 'large';

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
  /** Work items with alerts skip the state / PR / priority filters (azdoWorkItems.filter.alwaysShowAlerts) */
  alwaysShowAlerts: boolean;
  layout: Layout;
  coverage: CoverageViewModel;
  workingOn: WorkingOnViewModel;
}

/** azdoWorkItems.workingOn.* */
export interface WorkingOnViewModel {
  /** The work items being worked on skip the State / PR / Priority filters and the "Show only these" toggle */
  ignoreFilters: boolean;
  /** They are moved to a "Working on" section at the top of the list */
  section: boolean;
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
}

export interface MyPullRequestsModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  /** azdoWorkItems.myPullRequests.showDrafts */
  showDrafts: boolean;
  /** Drafts not in the list because of showDrafts */
  hiddenDrafts: number;
  items: MyPullRequestModel[];
}

export type WebviewMessage =
  | {
      type:
        | 'addTask'
        | 'changeState'
        | 'checkout'
        | 'createBranch'
        | 'createPullRequest'
        | 'deleteBranch'
        | 'fillIntegrationBuild'
        | 'openDependencyMap'
        | 'openDetails'
        | 'openPullRequest'
        | 'openRun'
        | 'openWorkItem';
      id: number;
      pullRequestId?: number;
      runId?: number;
      /** openRun: show the tests of the run instead of the run */
      tests?: boolean;
      /** checkout: a branch of the work item other than its main one */
      branch?: string;
    }
  | { type: 'openFile'; path: string }
  /** The ▾ of a Checkout button (menu) and "Open worktree": the id is the work item or the PR; `branch`: a branch of the row of a work item */
  | { type: 'checkoutMenu' | 'openWorktree' | 'worktreeMenu'; kind: CheckoutKind; id: number; branch?: string }
  | { type: 'checkReviewRequests' }
  | { type: 'checkoutReviewRequest'; pullRequestId: number }
  | { type: 'openReviewRequest' | 'openMyPullRequest'; url: string }
  | { type: 'checkMyPullRequests' }
  | { type: 'addBuildNotesSkipTag' | 'checkoutMyPullRequest' | 'publishMyPullRequest'; pullRequestId: number }
  | { type: 'setShowDrafts'; show: boolean }
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setFilter'; filter: FilterModel }
  | { type: 'setLayout'; layout: Layout };

/** Buttons of a work item: run by id */
export type WorkItemActionMessage = Exclude<
  Extract<WebviewMessage, { id: number }>,
  { type: 'checkoutMenu' | 'openWorktree' | 'worktreeMenu' }
>;

export type ExtensionMessage =
  /** Opens or closes the task list of every card */
  | { type: 'setTasksExpanded'; expanded: boolean }
  /** Scrolls to the card of the work item and flashes it, opening its iteration group when collapsed */
  | { type: 'revealWorkItem'; id: number }
  | { type: 'state'; model: ViewModel };

export const NO_PULL_REQUEST = 'No PR';

export type BranchAction = 'checkout' | 'createBranch' | 'createPullRequest' | 'deleteBranch';

/**
 * Branch actions offered for a work item. Finished work items (Done, Ready to Test…) get no new branch, checkout
 * or PR: their branch only needs to be deleted, when it still exists and no PR is still active on it
 */
export function branchActions(
  item: Pick<WorkItemModel, 'branch' | 'isCurrentBranch' | 'leftoverBranch' | 'pullRequests' | 'state'>
): BranchAction[] {
  // Only the PRs of this repository count: an active PR in another one does not cover this branch
  const hasActivePullRequest = item.pullRequests.some((pr) => pr.isActive && !pr.otherRepository);
  if (isFinishedState(item.state)) {
    return item.leftoverBranch && !hasActivePullRequest ? ['deleteBranch'] : [];
  }
  if (!item.branch) {
    return ['createBranch'];
  }
  return [
    ...(item.isCurrentBranch ? [] : ['checkout' as const]),
    ...(hasActivePullRequest ? [] : ['createPullRequest' as const]),
  ];
}

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** Keys of the filter whose values differ (the order of the values does not matter) */
export function changedFilterKeys(a: FilterModel, b: FilterModel): (keyof FilterModel)[] {
  return (
    ['types', 'hiddenStates', 'hiddenPullRequestStates', 'hiddenPriorities', 'hiddenPredecessorStates'] as const
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

/**
 * True when the work item passes the type / state / PR / priority / predecessors filters and matches the search text.
 * With "alwaysShowAlerts", work items with alerts skip the state / PR / priority / predecessors filters: they must be fixed
 * ASAP, e.g. a "Done" work item with open tasks would be hidden by the default "Done" filter. With "workingOnIgnoresFilters",
 * so do the ones being worked on (workingOn.ignoreFilters)
 */
export function isVisible(
  item: Pick<WorkItemModel, 'branch' | 'id' | 'pullRequests' | 'state' | 'title' | 'type'> & {
    alerts?: unknown[];
    workingOn?: WorkingOnLevel;
    priority?: number;
    openPredecessors?: unknown[];
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
  if (!hasAlerts && filter.hiddenStates.includes(item.state)) {
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
  const query = text.trim().toLowerCase();
  return (
    !query || [String(item.id), item.title, item.branch ?? ''].some((value) => value.toLowerCase().includes(query))
  );
}

type FilterableItem = Pick<WorkItemModel, 'pullRequests' | 'state' | 'type'> & {
  priority?: number;
  openPredecessors?: unknown[];
};

/**
 * Filter values hiding something among the given work items: types left out, and states, PR states, priorities and
 * predecessor states hidden. Values no work item has are not counted: they have no chip to switch back on
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
    hiddenAmong(
      present((item) => item.state),
      filter.hiddenStates
    ) +
    hiddenAmong(present(pullRequestFilterValue), filter.hiddenPullRequestStates) +
    hiddenAmong(present(priorityFilterValue), filter.hiddenPriorities) +
    hiddenAmong(present(predecessorFilterValue), filter.hiddenPredecessorStates)
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
