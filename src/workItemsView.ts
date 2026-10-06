import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { SECTION } from './config';
import { changedFilterKeys, ExtensionMessage, FilterModel, WebviewMessage } from './viewModel';
import { runWorkItemAction } from './workItemActions';
import { WorkItemsStore } from './workItemsStore';

export const VIEW_ID = 'azdoWorkItems.myItems';

export function filterSettings(): FilterModel {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    types: config.get<string[]>('filter.types', []),
    hiddenStates: config.get<string[]>('filter.hiddenStates', []),
    hiddenPullRequestStates: config.get<string[]>('filter.hiddenPullRequestStates', []),
    hiddenPriorities: config.get<string[]>('filter.hiddenPriorities', []),
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
    const model = this.store.toViewModel(filterSettings());
    const withAlerts = model.workItems.filter((item) => item.alerts.length).length;
    // Number on the activity bar icon, visible while the view is closed
    this.view.badge = withAlerts
      ? { value: withAlerts, tooltip: `${withAlerts} work item${withAlerts === 1 ? ' needs' : 's need'} attention` }
      : undefined;
    // Next to the view name ("Assigned to Me"): the sprint(s) the list comes from
    this.view.description = model.iterations.map((iteration) => iteration.name).join(', ') || undefined;
    const message: ExtensionMessage = { type: 'state', model };
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
        // Filters are personal: saved in the user settings. Each write updates settings.json and
        // re-renders the view, so only the keys that changed are written
        const config = vscode.workspace.getConfiguration(SECTION);
        for (const key of changedFilterKeys(filterSettings(), message.filter)) {
          await config.update(`filter.${key}`, message.filter[key], vscode.ConfigurationTarget.Global);
        }
        return;
      }
      case 'addTask':
      case 'changeState':
      case 'checkout':
      case 'createBranch':
      case 'createPullRequest':
      case 'fillIntegrationBuild':
      case 'openDependencyMap':
      case 'openDetails':
      case 'openPullRequest':
      case 'openRun':
      case 'openWorkItem':
        await runWorkItemAction(this.store, message);
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
