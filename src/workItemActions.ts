import * as vscode from 'vscode';
import { resolveContext } from './config';
import { testsUrl } from './runDetails';
import { WorkItemActionMessage } from './viewModel';
import { WorkItemsStore } from './workItemsStore';

export type WorkItemAction = WorkItemActionMessage;

const COMMANDS = {
  checkout: 'azdoWorkItems.checkout',
  createBranch: 'azdoWorkItems.createBranch',
  createPullRequest: 'azdoWorkItems.createPullRequest',
  deleteBranch: 'azdoWorkItems.deleteBranch',
};

/** Runs a button of the work items view or of the details panel */
export async function runWorkItemAction(store: WorkItemsStore, message: WorkItemAction): Promise<void> {
  const entry = store.find(message.id);
  switch (message.type) {
    case 'openDetails':
    case 'openDependencyMap':
    case 'changeState':
    case 'addTask':
    case 'fillIntegrationBuild':
      // These work with any work item, including parents / children not assigned to the user
      await vscode.commands.executeCommand(`azdoWorkItems.${message.type}`, message.id);
      return;
    case 'openWorkItem': {
      // Parents and children shown in the details may not be assigned to the user
      const url = entry?.workItem.url ?? resolveContext(store.repository()).client.workItemWebUrl(message.id);
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    case 'openRun': {
      const run = message.runId === undefined ? undefined : store.findRun(message.runId);
      if (run) {
        await vscode.env.openExternal(vscode.Uri.parse(message.tests ? testsUrl(run.url) : run.url));
      }
      return;
    }
    case 'openPullRequest': {
      // Task PRs may belong to tasks of other developers, which are not entries of the list
      const pr =
        entry?.pullRequests.find((p) => p.pullRequestId === message.pullRequestId) ??
        (message.pullRequestId === undefined ? undefined : store.findPullRequest(message.pullRequestId));
      if (pr) {
        await vscode.env.openExternal(vscode.Uri.parse(pr.webUrl));
      }
      return;
    }
    case 'checkout':
    case 'createBranch':
    case 'createPullRequest':
    case 'deleteBranch':
      if (entry) {
        await vscode.commands.executeCommand(COMMANDS[message.type], entry, message.branch);
      }
  }
}
