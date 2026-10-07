import { migratePredecessorStates } from './predecessors';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { coverageThresholds, recordsScope, SECTION } from './config';
import { safeRelativePath } from './coverage';
import { describeRecords } from './coverageRecords';
import { CoverageRecordsStore } from './coverageRecordsStore';
import {
  CHECKOUT_MY_PULL_REQUEST_COMMAND,
  MyPullRequestsWatcher,
  myPullRequestSettings,
  PUBLISH_PULL_REQUEST_COMMAND,
} from './myPullRequestsWatcher';
import { CHECKOUT_REVIEW_COMMAND, ReviewRequestsWatcher, reviewSettings } from './reviewRequestsWatcher';
import {
  changedFilterKeys,
  migratePullRequestStates,
  ExtensionMessage,
  FilterModel,
  Layout,
  ViewModel,
  WebviewMessage,
} from './viewModel';
import { runWorkItemAction } from './workItemActions';
import { WorkItemsStore } from './workItemsStore';

export const VIEW_ID = 'azdoWorkItems.myItems';

export function filterSettings(): FilterModel {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    types: config.get<string[]>('filter.types', []),
    hiddenStates: config.get<string[]>('filter.hiddenStates', []),
    hiddenPullRequestStates: migratePullRequestStates(config.get<string[]>('filter.hiddenPullRequestStates', [])),
    hiddenPriorities: config.get<string[]>('filter.hiddenPriorities', []),
    hiddenPredecessorStates: migratePredecessorStates(config.get<string[]>('filter.hiddenPredecessorStates', [])),
  };
}

export const LAYOUT_CONTEXT = 'azdoWorkItems.layout';

export function layoutSetting(): Layout {
  return vscode.workspace.getConfiguration(SECTION).get<Layout>('layout', 'compact') === 'large' ? 'large' : 'compact';
}

/** Sidebar view rendering the work items as cards */
export class WorkItemsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: WorkItemsStore,
    private readonly reviews: ReviewRequestsWatcher,
    private readonly myPullRequests: MyPullRequestsWatcher,
    private readonly coverageRecords: CoverageRecordsStore
  ) {}

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
    const { items, hiddenDrafts } = this.myPullRequests.models();
    const model: ViewModel = {
      ...this.store.toViewModel(filterSettings()),
      alwaysShowAlerts: vscode.workspace.getConfiguration(SECTION).get<boolean>('filter.alwaysShowAlerts', false),
      layout: layoutSetting(),
      coverage: this.coverageModel(),
      reviews: {
        status: this.reviews.status,
        error: this.reviews.error,
        requests: this.reviews.models(),
        maxWaitHours: reviewSettings().maxWaitHours,
      },
      pullRequests: {
        status: this.myPullRequests.status,
        error: this.myPullRequests.error,
        showDrafts: myPullRequestSettings().showDrafts,
        hiddenDrafts,
        items,
      },
    };
    const withAlerts = model.workItems.filter((item) => item.alerts.length).length;
    const toReview = model.reviews.requests.length;
    // Number on the activity bar icon, visible while the view is closed
    const reasons = [
      withAlerts && `${withAlerts} work item${withAlerts === 1 ? ' needs' : 's need'} attention`,
      toReview && `${toReview} pull request${toReview === 1 ? ' is' : 's are'} waiting for your review`,
    ].filter(Boolean);
    this.view.badge = withAlerts + toReview ? { value: withAlerts + toReview, tooltip: reasons.join(', ') } : undefined;
    // Next to the view name ("Assigned to Me"): the sprint(s) the list comes from
    this.view.description = model.iterations.map((iteration) => iteration.name).join(', ') || undefined;
    const message: ExtensionMessage = { type: 'state', model };
    void this.view.webview.postMessage(message);
  }

  private coverageModel(): ViewModel['coverage'] {
    const thresholds = coverageThresholds();
    const scope = recordsScope(this.store.repository());
    return {
      thresholds,
      records: scope ? describeRecords(this.coverageRecords.records(scope), thresholds.target) : undefined,
    };
  }

  /** Opens a file of the repository (a path reported by the coverage of a run) in the editor */
  private async openFile(path: string): Promise<void> {
    const relative = safeRelativePath(path);
    const root = this.store.repository()?.rootUri;
    const uri = relative && root ? vscode.Uri.joinPath(root, relative) : undefined;
    let exists = false;
    if (uri) {
      try {
        await vscode.workspace.fs.stat(uri);
        exists = true;
      } catch {
        // Not in this checkout: renamed, deleted or only in the branch of the PR
      }
    }
    if (uri && exists) {
      await vscode.window.showTextDocument(uri);
    } else {
      void vscode.window.showInformationMessage(`${path} is not in the repository you have open.`);
    }
  }

  /** Opens or closes the task list of every card */
  setTasksExpanded(expanded: boolean): void {
    const message: ExtensionMessage = { type: 'setTasksExpanded', expanded };
    void this.view?.webview.postMessage(message);
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.post();
        await this.store.ensureLoaded();
        return;
      case 'refresh':
        await Promise.all([this.store.refresh(), this.reviews.poll(), this.myPullRequests.poll()]);
        return;
      case 'checkReviewRequests':
        await this.reviews.poll();
        return;
      case 'checkoutReviewRequest':
        await vscode.commands.executeCommand(CHECKOUT_REVIEW_COMMAND, message.pullRequestId);
        return;
      case 'checkMyPullRequests':
        await this.myPullRequests.poll();
        return;
      case 'checkoutMyPullRequest':
        await vscode.commands.executeCommand(CHECKOUT_MY_PULL_REQUEST_COMMAND, message.pullRequestId);
        return;
      case 'publishMyPullRequest':
        await vscode.commands.executeCommand(PUBLISH_PULL_REQUEST_COMMAND, message.pullRequestId);
        return;
      case 'setShowDrafts':
        // Personal preference: saved in the user settings, which re-renders the view
        await vscode.workspace
          .getConfiguration(`${SECTION}.myPullRequests`)
          .update('showDrafts', message.show, vscode.ConfigurationTarget.Global);
        return;
      case 'openFile':
        await this.openFile(message.path);
        return;
      case 'checkoutMenu':
      case 'openWorktree':
      case 'worktreeMenu':
        await vscode.commands.executeCommand(`azdoWorkItems.${message.type}`, message.kind, message.id);
        return;
      case 'openMyPullRequest':
      case 'openReviewRequest':
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
        return;
      case 'setLayout':
        // Personal, like the filters: the view is posted again when the setting changes
        await vscode.workspace
          .getConfiguration(SECTION)
          .update('layout', message.layout, vscode.ConfigurationTarget.Global);
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
      case 'deleteBranch':
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
