import { withFeature } from './requestContext';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { AzdoClient, WorkItem } from './azdoClient';
import { resolveContext } from './config';
import { DetailsData, RelatedWorkItem, renderDetailsBody, RICH_TEXT_FIELDS } from './detailsHtml';
import { imageSources, isOrganizationUrl, replaceImageSources } from './richTextImages';
import { isFigmaExtensionInstalled, openFigmaLinks } from './figma';
import { findFigmaLinks } from './figmaLinks';
import { escapeHtml } from './html';
import { dependencyRisk } from './schedule';
import { WebviewMessage } from './viewModel';
import { runWorkItemAction } from './workItemActions';
import { WorkItemsStore } from './workItemsStore';

type DetailsMessage =
  | WebviewMessage
  | { type: 'openFigma'; id: number }
  | { type: 'openFigmaInBrowser'; id: number }
  | { type: 'reload'; id: number };

interface OpenPanel {
  panel: vscode.WebviewPanel;
  data?: Omit<DetailsData, 'card'>;
  error?: string;
}

const MAX_TITLE_LENGTH = 40;

/**
 * Replaces the images of the rich text fields (Azure DevOps attachments, which need authentication)
 * with data URIs. Images that cannot be downloaded keep their URL; the rest of the details is shown anyway
 */
async function embedImages(client: AzdoClient, fields: Record<string, unknown>): Promise<Record<string, unknown>> {
  const richText = RICH_TEXT_FIELDS.map(([, name]) => name).filter((name) => typeof fields[name] === 'string');
  const sources = [...new Set(richText.flatMap((name) => imageSources(fields[name] as string)))].filter((url) =>
    isOrganizationUrl(url, client.organization)
  );
  if (!sources.length) {
    return fields;
  }
  const downloads = await Promise.allSettled(sources.map((url) => client.getImageAsDataUri(url)));
  const replacements = new Map<string, string>();
  downloads.forEach((download, index) => {
    if (download.status === 'fulfilled') {
      replacements.set(sources[index], download.value);
    }
  });
  return {
    ...fields,
    ...Object.fromEntries(richText.map((name) => [name, replaceImageSources(fields[name] as string, replacements)])),
  };
}

function toRelated({ id, title, type, state, iterationPath }: WorkItem): RelatedWorkItem {
  return { id, title, type, state, iterationPath };
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
    const panel = vscode.window.createWebviewPanel('totalflowx.details', String(id), vscode.ViewColumn.Active, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    });
    const open: OpenPanel = { panel };
    this.panels.set(id, open);
    panel.onDidDispose(() => this.panels.delete(id));
    panel.webview.onDidReceiveMessage((message: DetailsMessage) => this.onMessage(id, open, message));
    this.render(id, open);
    await this.load(id, open);
  }

  private async onMessage(id: number, open: OpenPanel, message: DetailsMessage): Promise<void> {
    if (message.type === 'reload') {
      await this.load(id, open);
    } else if (message.type === 'openFigma' || message.type === 'openFigmaInBrowser') {
      await openFigmaLinks(open.data?.figmaLinks ?? [], message.type === 'openFigmaInBrowser');
    } else {
      await this.onAction(message);
    }
  }

  private async onAction(message: WebviewMessage): Promise<void> {
    try {
      if ('kind' in message) {
        await vscode.commands.executeCommand(`totalflowx.${message.type}`, message.kind, message.id, message.branch);
      } else if ('id' in message) {
        await runWorkItemAction(this.store, message);
      }
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
    }
  }

  private load(id: number, open: OpenPanel): Promise<void> {
    return withFeature('details', () => this.runLoad(id, open));
  }

  private async runLoad(id: number, open: OpenPanel): Promise<void> {
    try {
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      const [details, schedule] = await Promise.all([client.getWorkItemDetails(id), client.getIterationSchedule()]);
      const { parentId, childIds, predecessorIds, successorIds } = details.links;
      const relatedIds = [
        ...new Set([...(parentId ? [parentId] : []), ...childIds, ...predecessorIds, ...successorIds]),
      ];
      const related = new Map((await client.getWorkItems(relatedIds)).map((wi) => [wi.id, wi]));
      const pick = (ids: number[]) =>
        ids.map((relatedId) => related.get(relatedId)).filter((wi): wi is WorkItem => !!wi);
      const parent = parentId === undefined ? undefined : related.get(parentId);
      open.data = {
        id: details.id,
        title: details.title,
        type: details.type,
        state: details.state,
        fields: await embedImages(client, details.fields),
        figmaLinks: findFigmaLinks(
          RICH_TEXT_FIELDS.map(([, name]) => details.fields[name])
            .filter((value): value is string => typeof value === 'string')
            .join('\n')
        ),
        parent: parent && toRelated(parent),
        children: pick(childIds).map(toRelated),
        predecessors: pick(predecessorIds).map((wi) => ({
          ...toRelated(wi),
          risk: dependencyRisk(wi, details, schedule),
        })),
        successors: pick(successorIds).map((wi) => ({
          ...toRelated(wi),
          risk: dependencyRisk(details, wi, schedule),
        })),
        iterationNames: Object.fromEntries(schedule.map((iteration) => [iteration.path, iteration.name])),
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
      body = renderDetailsBody({
        ...data,
        card: this.store.workItemModel(id),
        figmaInVsCode: isFigmaExtensionInstalled(),
      });
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
        const { action, id, pr, kind, branch } = target.dataset;
        vscode.postMessage({ type: action, id: Number(id), pullRequestId: pr ? Number(pr) : undefined, kind, branch });
      }
    });
  </script>
</body>
</html>`;
  }
}
