/**
 * Data exchanged between the extension and the work items webview.
 * Shared by both sides, so it must not import "vscode".
 */
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
  childCount: number;
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
}

export interface ViewModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  iterations: IterationModel[];
  workItems: WorkItemModel[];
  filter: FilterModel;
}

export type WebviewMessage =
  | {
      type: 'checkout' | 'copyId' | 'createBranch' | 'createPullRequest' | 'openPullRequest' | 'openWorkItem';
      id: number;
      pullRequestId?: number;
    }
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setFilter'; filter: FilterModel };

export type ExtensionMessage = { type: 'state'; model: ViewModel };

/** True when the work item passes the type / state filters and matches the search text */
export function isVisible(
  item: Pick<WorkItemModel, 'branch' | 'id' | 'state' | 'title' | 'type'>,
  filter: FilterModel,
  text = ''
): boolean {
  if (filter.types.length && !filter.types.includes(item.type)) {
    return false;
  }
  if (filter.hiddenStates.includes(item.state)) {
    return false;
  }
  const query = text.trim().toLowerCase();
  return (
    !query || [String(item.id), item.title, item.branch ?? ''].some((value) => value.toLowerCase().includes(query))
  );
}
