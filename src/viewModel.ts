/**
 * Data exchanged between the extension and the work items webview.
 * Shared by both sides, so it must not import "vscode".
 */
import type { WorkItemAlert } from './alerts';
import type { PullRequestTone } from './workItemLinks';

export interface PullRequestModel {
  id: number;
  title: string;
  status: string;
  tone: PullRequestTone;
  url: string;
  isActive: boolean;
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
  branch?: string;
  /** "local": the branch is checked out locally; "remote": only exists in the remote */
  branchLocation?: 'local' | 'remote';
  isCurrentBranch: boolean;
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
}

export interface ViewModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  iterations: IterationModel[];
  workItems: WorkItemModel[];
  filter: FilterModel;
  /** States in the order the work items are sorted */
  stateOrder: string[];
}

export type WebviewMessage =
  | {
      type:
        | 'addTask'
        | 'changeState'
        | 'checkout'
        | 'createBranch'
        | 'createPullRequest'
        | 'openDependencyMap'
        | 'openDetails'
        | 'openPullRequest'
        | 'openWorkItem';
      id: number;
      pullRequestId?: number;
    }
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setFilter'; filter: FilterModel };

export type ExtensionMessage = { type: 'state'; model: ViewModel };

export const NO_PULL_REQUEST = 'No PR';

function sameValues(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/** Keys of the filter whose values differ (the order of the values does not matter) */
export function changedFilterKeys(a: FilterModel, b: FilterModel): (keyof FilterModel)[] {
  return (['types', 'hiddenStates', 'hiddenPullRequestStates'] as const).filter((key) => !sameValues(a[key], b[key]));
}

/** State of the main PR of the work item (the first one: active PRs come first), used by the PR filter */
export function pullRequestFilterValue(item: Pick<WorkItemModel, 'pullRequests'>): string {
  return item.pullRequests.at(0)?.status ?? NO_PULL_REQUEST;
}

/**
 * True when the work item passes the type / state / PR filters and matches the search text.
 * Work items with alerts skip the state / PR filters: they must be fixed ASAP, e.g. a "Done" work item
 * with open tasks would be hidden by the default "Done" filter
 */
export function isVisible(
  item: Pick<WorkItemModel, 'branch' | 'id' | 'pullRequests' | 'state' | 'title' | 'type'> & {
    alerts?: unknown[];
  },
  filter: FilterModel,
  text = ''
): boolean {
  if (filter.types.length && !filter.types.includes(item.type)) {
    return false;
  }
  const hasAlerts = !!item.alerts?.length;
  if (!hasAlerts && filter.hiddenStates.includes(item.state)) {
    return false;
  }
  if (!hasAlerts && filter.hiddenPullRequestStates.includes(pullRequestFilterValue(item))) {
    return false;
  }
  const query = text.trim().toLowerCase();
  return (
    !query || [String(item.id), item.title, item.branch ?? ''].some((value) => value.toLowerCase().includes(query))
  );
}
