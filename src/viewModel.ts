/**
 * Data exchanged between the extension and the work items webview.
 * Shared by both sides, so it must not import "vscode".
 */
import type { WorkItemAlert } from './alerts';
import { priorityFilterValue } from './priority';
import type { MyPullRequestModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import type { ReviewRequestModel } from './reviewRequests';
import { isFinishedState } from './states';
import type { PullRequestTone } from './workItemLinks';

export interface PullRequestModel {
  id: number;
  title: string;
  status: string;
  tone: PullRequestTone;
  url: string;
  isActive: boolean;
  /** Last CI run of each pipeline validating the PR */
  runs: RunModel[];
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
  /** Finished work items (Done, Ready to Test…) whose branch still exists: it should be deleted */
  leftoverBranch?: { name: string; local: boolean; remote: boolean };
  pullRequests: PullRequestModel[];
}

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
}

export interface ReviewsModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  requests: ReviewRequestModel[];
  maxWaitHours: number;
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
    }
  | { type: 'checkReviewRequests' }
  | { type: 'checkoutReviewRequest'; pullRequestId: number }
  | { type: 'openReviewRequest' | 'openMyPullRequest'; url: string }
  | { type: 'checkMyPullRequests' }
  | { type: 'checkoutMyPullRequest' | 'publishMyPullRequest'; pullRequestId: number }
  | { type: 'setShowDrafts'; show: boolean }
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setFilter'; filter: FilterModel };

export type ExtensionMessage =
  /** Opens or closes the task list of every card */
  { type: 'setTasksExpanded'; expanded: boolean } | { type: 'state'; model: ViewModel };

export const NO_PULL_REQUEST = 'No PR';

export type BranchAction = 'checkout' | 'createBranch' | 'createPullRequest' | 'deleteBranch';

/**
 * Branch actions offered for a work item. Finished work items (Done, Ready to Test…) get no new branch, checkout
 * or PR: their branch only needs to be deleted, when it still exists and no PR is still active on it
 */
export function branchActions(
  item: Pick<WorkItemModel, 'branch' | 'isCurrentBranch' | 'leftoverBranch' | 'pullRequests' | 'state'>
): BranchAction[] {
  const hasActivePullRequest = item.pullRequests.some((pr) => pr.isActive);
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
  return (['types', 'hiddenStates', 'hiddenPullRequestStates', 'hiddenPriorities'] as const).filter(
    (key) => !sameValues(a[key], b[key])
  );
}

/** State of the main PR of the work item (the first one: active PRs come first), used by the PR filter */
export function pullRequestFilterValue(item: Pick<WorkItemModel, 'pullRequests'>): string {
  return item.pullRequests.at(0)?.status ?? NO_PULL_REQUEST;
}

/**
 * True when the work item passes the type / state / PR / priority filters and matches the search text.
 * With "alwaysShowAlerts", work items with alerts skip the state / PR / priority filters: they must be fixed
 * ASAP, e.g. a "Done" work item with open tasks would be hidden by the default "Done" filter
 */
export function isVisible(
  item: Pick<WorkItemModel, 'branch' | 'id' | 'pullRequests' | 'state' | 'title' | 'type'> & {
    alerts?: unknown[];
    priority?: number;
  },
  filter: FilterModel,
  text = '',
  alwaysShowAlerts = false
): boolean {
  if (filter.types.length && !filter.types.includes(item.type)) {
    return false;
  }
  const hasAlerts = alwaysShowAlerts && !!item.alerts?.length;
  if (!hasAlerts && filter.hiddenStates.includes(item.state)) {
    return false;
  }
  if (!hasAlerts && filter.hiddenPullRequestStates.includes(pullRequestFilterValue(item))) {
    return false;
  }
  if (!hasAlerts && filter.hiddenPriorities.includes(priorityFilterValue(item))) {
    return false;
  }
  const query = text.trim().toLowerCase();
  return (
    !query || [String(item.id), item.title, item.branch ?? ''].some((value) => value.toLowerCase().includes(query))
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
