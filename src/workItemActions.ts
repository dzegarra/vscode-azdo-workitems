import * as vscode from 'vscode';
import { resolveContext } from './config';
import { WebviewMessage } from './viewModel';
import { WorkItemsStore } from './workItemsStore';

export type WorkItemAction = Extract<WebviewMessage, { id: number }>;

const COMMANDS = {
  checkout: 'azdoWorkItems.checkout',
  createBranch: 'azdoWorkItems.createBranch',
  createPullRequest: 'azdoWorkItems.createPullRequest',
};

/** Runs a button of the work items view or of the details panel */
export async function runWorkItemAction(store: WorkItemsStore, message: WorkItemAction): Promise<void> {
  const entry = store.find(message.id);
  switch (message.type) {
    case 'openDetails':
      await vscode.commands.executeCommand('azdoWorkItems.openDetails', message.id);
      return;
    case 'openWorkItem': {
      // Parents and children shown in the details may not be assigned to the user
      const url = entry?.workItem.url ?? resolveContext(store.repository()).client.workItemWebUrl(message.id);
      await vscode.env.openExternal(vscode.Uri.parse(url));
      return;
    }
    case 'openPullRequest': {
      const pr = entry?.pullRequests.find((p) => p.pullRequestId === message.pullRequestId);
      if (pr) {
        await vscode.env.openExternal(vscode.Uri.parse(pr.webUrl));
      }
      return;
    }
    case 'checkout':
    case 'createBranch':
    case 'createPullRequest':
      if (entry) {
        await vscode.commands.executeCommand(COMMANDS[message.type], entry);
      }
  }
}
