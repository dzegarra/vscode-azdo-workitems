import { withFeature } from './requestContext';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { AzdoClient, WorkItem } from './azdoClient';
import { resolveContext } from './config';
import { buildGraph, DependencyGraph, GraphItem } from './dependencyGraph';
import { WorkItemsStore } from './workItemsStore';

export type DependencyMapMessage =
  | { type: 'expand'; id: number }
  | { type: 'openDetails'; id: number }
  | { type: 'ready' }
  | { type: 'refresh' };

export type DependencyMapUpdate =
  | { type: 'error'; message: string }
  | { type: 'graph'; graph: DependencyGraph }
  | { type: 'loading' }
  /** Select the work item and scroll to it (each time the map is opened for it) */
  | { type: 'focus'; id: number };

function dependencyIds(workItem: WorkItem): number[] {
  return [...workItem.links.predecessorIds, ...workItem.links.successorIds];
}

function toGraphItem(workItem: WorkItem): GraphItem {
  return {
    id: workItem.id,
    title: workItem.title,
    type: workItem.type,
    state: workItem.state,
    iterationPath: workItem.iterationPath,
    assignedTo: workItem.assignedTo,
    predecessorIds: workItem.links.predecessorIds,
    successorIds: workItem.links.successorIds,
  };
}

/**
 * Editor tab with the dependencies of the user's work items: their predecessors and successors,
 * placed in the column of the iteration they are planned in
 */
export class DependencyMapPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly items = new Map<number, WorkItem>();
  private focusId?: number;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly extensionUri: vscode.Uri, private readonly store: WorkItemsStore) {
    // States or links may have changed: reload the map
    this.subscription = store.onDidLoad(() => this.panel && void this.load());
  }

  dispose(): void {
    this.subscription.dispose();
    this.panel?.dispose();
  }

  async open(focusId?: number): Promise<void> {
    this.focusId = focusId;
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'totalflowx.dependencyMap',
        'Dependency Map',
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [
            vscode.Uri.joinPath(this.extensionUri, 'dist'),
            vscode.Uri.joinPath(this.extensionUri, 'media'),
          ],
        }
      );
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.webview.onDidReceiveMessage((message: DependencyMapMessage) => this.onMessage(message));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.items.clear();
      });
    }
    await this.load();
    if (focusId !== undefined) {
      // Also when the map was already open on it: the user expects to see it
      void this.panel?.webview.postMessage({ type: 'focus', id: focusId } satisfies DependencyMapUpdate);
    }
  }

  private async onMessage(message: DependencyMapMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
          await this.post();
          return;
        case 'refresh':
          await this.load();
          return;
        case 'expand':
          await this.expand(message.id);
          return;
        case 'openDetails':
          await vscode.commands.executeCommand('totalflowx.openDetails', message.id);
      }
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  private client(): AzdoClient {
    return resolveContext(this.store.repository()).client;
  }

  /** Adds the given work items to the map, skipping the ones already loaded */
  private async add(ids: number[]): Promise<void> {
    const missing = [...new Set(ids)].filter((id) => !this.items.has(id));
    for (const workItem of await this.client().getWorkItems(missing)) {
      this.items.set(workItem.id, workItem);
    }
  }

  /** My work items (plus the focused one) and their direct predecessors / successors */
  private load(): Promise<void> {
    return withFeature('dependencyMap', () => this.runLoad());
  }

  private async runLoad(): Promise<void> {
    void this.panel?.webview.postMessage({ type: 'loading' } satisfies DependencyMapUpdate);
    try {
      await this.store.ensureLoaded();
      this.items.clear();
      // Tasks are not shown in the map
      const mine = this.store.workItems.map((entry) => entry.workItem).filter((workItem) => workItem.type !== 'Task');
      // All of them: the map shows the ones without dependencies on demand
      mine.forEach((workItem) => this.items.set(workItem.id, workItem));
      if (this.focusId !== undefined) {
        await this.add([this.focusId]);
      }
      await this.add([...this.items.values()].flatMap(dependencyIds));
      await this.post();
    } catch (error) {
      void this.panel?.webview.postMessage({
        type: 'error',
        message: (error as Error).message,
      } satisfies DependencyMapUpdate);
    }
  }

  /** Loads the predecessors / successors of a work item not shown yet */
  private async expand(id: number): Promise<void> {
    const workItem = this.items.get(id);
    if (workItem) {
      await this.add(dependencyIds(workItem));
      await this.post();
    }
  }

  private async post(): Promise<void> {
    if (!this.panel) {
      return;
    }
    const schedule = await this.client().getIterationSchedule();
    const mineIds = new Set(this.store.workItems.map((entry) => entry.workItem.id));
    const graph = buildGraph([...this.items.values()].map(toGraphItem), mineIds, schedule, new Date(), this.focusId);
    await this.panel.webview.postMessage({
      type: 'graph',
      graph,
    } satisfies DependencyMapUpdate);
  }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    const asset = (...path: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, ...path)).toString();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
    webview.cspSource
  }; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${asset('media', 'webview.css')}">
  <link rel="stylesheet" href="${asset('media', 'dependencies.css')}">
  <title>Dependency Map</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${asset('dist', 'dependencies.js')}"></script>
</body>
</html>`;
  }
}
