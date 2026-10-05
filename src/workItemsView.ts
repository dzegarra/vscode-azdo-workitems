import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { SECTION } from './config';
import { ExtensionMessage, FilterModel, WebviewMessage } from './viewModel';
import { WorkItemsStore } from './workItemsStore';

export const VIEW_ID = 'azdoWorkItems.myItems';
const STATUS_MESSAGE_MS = 2000;
const COMMANDS = {
  checkout: 'azdoWorkItems.checkout',
  createBranch: 'azdoWorkItems.createBranch',
  createPullRequest: 'azdoWorkItems.createPullRequest',
};

export function filterSettings(): FilterModel {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    types: config.get<string[]>('filter.types', []),
    hiddenStates: config.get<string[]>('filter.hiddenStates', []),
  };
}

/** Sidebar view rendering the work items as cards */
export class WorkItemsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri, private readonly store: WorkItemsStore) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    const roots = [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')];
    view.webview.options = { enableScripts: true, localResourceRoots: roots };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => this.onMessage(message));
    view.onDidChangeVisibility(() => view.visible && this.post());
  }

  /** Sends the current state to the webview */
  post(): void {
    if (!this.view) {
      return;
    }
    const message: ExtensionMessage = { type: 'state', model: this.store.toViewModel(filterSettings()) };
    void this.view.webview.postMessage(message);
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.post();
        await this.store.ensureLoaded();
        return;
      case 'refresh':
        await this.store.refresh();
        return;
      case 'setFilter': {
        // Filters are personal: saved in the user settings
        const config = vscode.workspace.getConfiguration(SECTION);
        await config.update('filter.types', message.filter.types, vscode.ConfigurationTarget.Global);
        await config.update('filter.hiddenStates', message.filter.hiddenStates, vscode.ConfigurationTarget.Global);
        return;
      }
      case 'openWorkItem':
      case 'openPullRequest':
      case 'copyId':
      case 'checkout':
      case 'createBranch':
      case 'createPullRequest':
        await this.runAction(message);
    }
  }

  private async runAction(message: Extract<WebviewMessage, { id: number }>): Promise<void> {
    const entry = this.store.find(message.id);
    if (!entry) {
      return;
    }
    switch (message.type) {
      case 'openWorkItem':
        await vscode.env.openExternal(vscode.Uri.parse(entry.workItem.url));
        return;
      case 'openPullRequest': {
        const pr = entry.pullRequests.find((p) => p.pullRequestId === message.pullRequestId);
        if (pr) {
          await vscode.env.openExternal(vscode.Uri.parse(pr.webUrl));
        }
        return;
      }
      case 'copyId':
        await vscode.env.clipboard.writeText(String(entry.workItem.id));
        void vscode.window.setStatusBarMessage(`Copied ${entry.workItem.id}`, STATUS_MESSAGE_MS);
        return;
      case 'checkout':
      case 'createBranch':
      case 'createPullRequest':
        await vscode.commands.executeCommand(COMMANDS[message.type], entry);
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const asset = (...path: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...path));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
    webview.cspSource
  }; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset('media', 'webview.css').toString()}">
  <title>Work Items</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset('dist', 'webview.js').toString()}"></script>
</body>
</html>`;
  }
}
