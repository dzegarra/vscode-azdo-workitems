import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { WorkItem } from './azdoClient';
import { resolveContext } from './config';
import { DetailsData, RelatedWorkItem, renderDetailsBody } from './detailsHtml';
import { escapeHtml } from './html';
import { WebviewMessage } from './viewModel';
import { runWorkItemAction } from './workItemActions';
import { WorkItemsStore } from './workItemsStore';

type DetailsMessage = WebviewMessage | { type: 'reload'; id: number };

interface OpenPanel {
  panel: vscode.WebviewPanel;
  data?: Omit<DetailsData, 'card'>;
  error?: string;
}

const MAX_TITLE_LENGTH = 40;

function toRelated({ id, title, type, state }: WorkItem): RelatedWorkItem {
  return { id, title, type, state };
}

/** Editor tabs showing the details of work items, one per work item */
export class WorkItemDetailsPanels implements vscode.Disposable {
  private readonly panels = new Map<number, OpenPanel>();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly extensionUri: vscode.Uri, private readonly store: WorkItemsStore) {
    this.subscriptions = [
      // Branch and PRs come from the store: refresh them when it changes
      store.onDidChange(() => {
        for (const [id, open] of this.panels) {
          this.render(id, open);
        }
      }),
      // States, tasks… may have changed in Azure DevOps: reload the details
      store.onDidLoad(() => {
        for (const [id, open] of this.panels) {
          void this.load(id, open);
        }
      }),
    ];
  }

  dispose(): void {
    this.subscriptions.forEach((subscription) => subscription.dispose());
    for (const { panel } of this.panels.values()) {
      panel.dispose();
    }
  }

  async open(id: number): Promise<void> {
    const existing = this.panels.get(id);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel('azdoWorkItems.details', String(id), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    });
    const open: OpenPanel = { panel };
    this.panels.set(id, open);
    panel.onDidDispose(() => this.panels.delete(id));
    panel.webview.onDidReceiveMessage((message: DetailsMessage) =>
      message.type === 'reload' ? this.load(id, open) : this.onAction(message)
    );
    this.render(id, open);
    await this.load(id, open);
  }

  private async onAction(message: WebviewMessage): Promise<void> {
    try {
      if ('id' in message) {
        await runWorkItemAction(this.store, message);
      }
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  private async load(id: number, open: OpenPanel): Promise<void> {
    try {
      const { client } = resolveContext(this.store.repository());
      const details = await client.getWorkItemDetails(id);
      const { parentId, childIds } = details.links;
      const related = await client.getWorkItems(parentId ? [parentId, ...childIds] : childIds);
      const parent = related.find((wi) => wi.id === parentId);
      open.data = {
        id: details.id,
        title: details.title,
        type: details.type,
        state: details.state,
        fields: details.fields,
        parent: parent && toRelated(parent),
        children: related.filter((wi) => childIds.includes(wi.id)).map(toRelated),
      };
      open.error = undefined;
    } catch (error) {
      open.error = (error as Error).message;
    }
    this.render(id, open);
  }

  private render(id: number, { panel, data, error }: OpenPanel): void {
    const title = data ? `${id}: ${data.title}` : String(id);
    panel.title = title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH)}…` : title;
    let body = '<p class="muted">Loading…</p>';
    if (error) {
      body = `<p class="error">${escapeHtml(error)}</p>
        <button class="button primary" data-action="reload" data-id="${id}">Retry</button>`;
    } else if (data) {
      body = renderDetailsBody({ ...data, card: this.store.workItemModel(id) });
    }
    panel.webview.html = this.page(panel.webview, body);
  }

  private page(webview: vscode.Webview, body: string): string {
    const nonce = randomBytes(16).toString('base64');
    const css = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', name)).toString();
    // Images of the rich text fields are allowed; scripts other than the one below are blocked
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src ${
    webview.cspSource
  } 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${css('webview.css')}">
  <link rel="stylesheet" href="${css('details.css')}">
</head>
<body>
  ${body}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-action]');
      if (target) {
        const { action, id, pr } = target.dataset;
        vscode.postMessage({ type: action, id: Number(id), pullRequestId: pr ? Number(pr) : undefined });
      }
    });
  </script>
</body>
</html>`;
  }
}
