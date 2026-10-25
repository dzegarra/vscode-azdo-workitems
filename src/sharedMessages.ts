/**
 * The buttons that the sidebar and the Track board share: refresh, the PR and review buttons, and the buttons of a
 * work item. Both views post the same messages and this runs them, so the board has no flows of its own
 */
import * as vscode from 'vscode';
import {
  COMPLETE_PULL_REQUEST_COMMAND,
  CHECKOUT_MY_PULL_REQUEST_COMMAND,
  PUBLISH_PULL_REQUEST_COMMAND,
  type MyPullRequestsWatcher,
} from './myPullRequestsWatcher';
import { CHECKOUT_REVIEW_COMMAND, type ReviewRequestsWatcher } from './reviewRequestsWatcher';
import type { WorkItemActionMessage } from './viewModel';
import { runWorkItemAction } from './workItemActions';
import type { WorkItemsStore } from './workItemsStore';

const SHARED_TYPES = [
  'refresh',
  'checkoutReviewRequest',
  'checkoutMyPullRequest',
  'publishMyPullRequest',
  'completeMyPullRequest',
  'openMyPullRequest',
  'openReviewRequest',
  'addTask',
  'changeState',
  'checkout',
  'clearIntegrationBuild',
  'createBranch',
  'createPullRequest',
  'deleteBranch',
  'fillIntegrationBuild',
  'linkBranchToTask',
  'linkTaskBranch',
  'linkTaskPullRequest',
  'openDependencyMap',
  'openDetails',
  'openPullRequest',
  'openRun',
  'openWorkItem',
] as const;

export type SharedMessage =
  | { type: 'refresh' }
  | { type: 'checkoutReviewRequest'; pullRequestId: number }
  | { type: 'checkoutMyPullRequest' | 'completeMyPullRequest' | 'publishMyPullRequest'; pullRequestId: number }
  | { type: 'openMyPullRequest' | 'openReviewRequest'; url: string }
  | WorkItemActionMessage;

export function isSharedMessage(message: { type: string }): message is SharedMessage {
  return (SHARED_TYPES as readonly string[]).includes(message.type);
}

export interface SharedMessageDeps {
  store: WorkItemsStore;
  reviews: ReviewRequestsWatcher;
  myPullRequests: MyPullRequestsWatcher;
}

export async function runSharedMessage(deps: SharedMessageDeps, message: SharedMessage): Promise<void> {
  switch (message.type) {
    case 'refresh':
      await Promise.all([deps.store.refresh(), deps.reviews.poll(true), deps.myPullRequests.poll()]);
      return;
    case 'checkoutReviewRequest':
      await vscode.commands.executeCommand(CHECKOUT_REVIEW_COMMAND, message.pullRequestId);
      return;
    case 'checkoutMyPullRequest':
      await vscode.commands.executeCommand(CHECKOUT_MY_PULL_REQUEST_COMMAND, message.pullRequestId);
      return;
    case 'publishMyPullRequest':
      await vscode.commands.executeCommand(PUBLISH_PULL_REQUEST_COMMAND, message.pullRequestId);
      return;
    case 'completeMyPullRequest':
      await vscode.commands.executeCommand(COMPLETE_PULL_REQUEST_COMMAND, message.pullRequestId);
      return;
    case 'openMyPullRequest':
    case 'openReviewRequest':
      await vscode.env.openExternal(vscode.Uri.parse(message.url));
      return;
    case 'addTask':
    case 'changeState':
    case 'checkout':
    case 'clearIntegrationBuild':
    case 'createBranch':
    case 'createPullRequest':
    case 'deleteBranch':
    case 'fillIntegrationBuild':
    case 'linkBranchToTask':
    case 'linkTaskBranch':
    case 'linkTaskPullRequest':
    case 'openDependencyMap':
    case 'openDetails':
    case 'openPullRequest':
    case 'openRun':
    case 'openWorkItem':
      await runWorkItemAction(deps.store, message);
  }
}
