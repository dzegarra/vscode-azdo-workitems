import { migratePredecessorStates } from './predecessors';
import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { showActionPicker } from './actionPickerUi';
import {
  coverageThresholds,
  funEnabled,
  recordsScope,
  SECTION,
  settings,
  workingDaysSetting,
  worktreeSettings,
} from './config';
import { safeRelativePath } from './coverage';
import { describeRecords } from './coverageRecords';
import { CoverageRecordsStore } from './coverageRecordsStore';
import {
  ADD_BUILD_NOTES_SKIP_TAG_COMMAND,
  RETARGET_PULL_REQUEST_COMMAND,
  COMPLETE_PULL_REQUEST_COMMAND,
  RESTART_PULL_REQUEST_MERGE_COMMAND,
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
  ViewModel,
  WebviewMessage,
} from './viewModel';
import type { SoundId } from './sounds';
import { baseBranchBanner } from './baseBranchHealth';
import { SHOW_BASE_BRANCH_COMMAND } from './baseBranchAlert';
import { sprintCountdown, sprintProgress } from './sprintCountdown';
import type { WorktreeTracker } from './worktreeTracker';
import { runWorkItemAction } from './workItemActions';
import { WorkItemsStore } from './workItemsStore';
import { CLEAN_UP_WORKTREES_COMMAND } from './worktreeTracker';
import type { SidebarTab } from './sidebarTabs';

export const VIEW_ID = 'totalflowx.myItems';
export const REVEAL_WORK_ITEM_COMMAND = 'totalflowx.revealWorkItem';
export const SHOW_SIDEBAR_TAB_COMMAND = 'totalflowx.showSidebarTab';
/** "Delete Branch of a Completed PR" (lists every branch that can go) */
const DELETE_BRANCH_COMMAND = 'totalflowx.deleteBranch';

export function filterSettings(): FilterModel {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    types: config.get<string[]>('filter.types', []),
    hiddenStates: config.get<string[]>('filter.hiddenStates', []),
    hiddenPullRequestStates: migratePullRequestStates(config.get<string[]>('filter.hiddenPullRequestStates', [])),
    hiddenPriorities: config.get<string[]>('filter.hiddenPriorities', []),
    hiddenPredecessorStates: migratePredecessorStates(config.get<string[]>('filter.hiddenPredecessorStates', [])),
    hiddenDuplicates: config.get<string[]>('filter.hiddenDuplicates', []),
  };
}

export function workingOnSettings(): ViewModel['workingOn'] {
  const { ignoreFilters, animation, pulseBadge } = settings().workingOn;
  return { ignoreFilters, animation, pulseBadge };
}

/** Sidebar view rendering the work items as cards */
export class WorkItemsViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  /** The webview has loaded its script and asked for the state (it does not survive a hidden view) */
  private ready = false;
  /** Work item to reveal as soon as the webview can: the view may still be opening */
  private pendingReveal?: number;
  /** Tab to show as soon as the webview can */
  private pendingTab?: SidebarTab;
  /** Worktrees that can be removed, for the clean row of the Now tab (the tracker is created after the view) */
  private worktrees?: Pick<WorktreeTracker, 'stale'>;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: WorkItemsStore,
    private readonly reviews: ReviewRequestsWatcher,
    private readonly myPullRequests: MyPullRequestsWatcher,
    private readonly coverageRecords: CoverageRecordsStore
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.ready = false;
    const roots = [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'media')];
    view.webview.options = { enableScripts: true, localResourceRoots: roots };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message: WebviewMessage) => this.onMessage(message));
    view.onDidChangeVisibility(() => {
      // A hidden webview is destroyed: it asks for the state again when it is shown
      this.ready &&= view.visible;
      if (view.visible) {
        this.post();
      }
    });
  }

  /** The worktrees to clean up count in the Now tab once the tracker exists */
  setWorktrees(worktrees: Pick<WorktreeTracker, 'stale'>): void {
    this.worktrees = worktrees;
    this.post();
  }

  /** Sends the current state to the webview */
  post(): void {
    if (!this.view) {
      return;
    }
    const { items, hiddenDrafts, hiddenCompleted, completedSummary } = this.myPullRequests.models();
    const reviewConfig = reviewSettings();
    const pullRequestConfig = myPullRequestSettings();
    const base = this.store.toViewModel(filterSettings());
    const fun = funEnabled();
    const now = new Date();
    const model: ViewModel = {
      ...base,
      // Rule FUN-COUNTDOWN-4
      iterations: base.iterations.map((iteration) => ({
        ...iteration,
        countdown: fun ? sprintCountdown(iteration.finishDate, now, workingDaysSetting()) : undefined,
        progress: sprintProgress(iteration.startDate, iteration.finishDate, now, workingDaysSetting()),
      })),
      // Like the Summary row (SUMMARY-10): only when worktrees.showInSummary is on
      staleWorktrees: this.worktrees && worktreeSettings().showInSummary ? this.worktrees.stale().length : 0,
      alwaysShowAlerts: vscode.workspace.getConfiguration(SECTION).get<boolean>('filter.alwaysShowAlerts', false),
      hoverStyle: settings().hoverStyle,
      asleepPulse: settings().asleepPulse,
      popoverDelay: settings().popoverDelay,
      tasksCountStyle: settings().tasksCountStyle,
      workingOn: workingOnSettings(),
      coverage: this.coverageModel(),
      baseBranch: baseBranchBanner(this.store.baseBranch, now),
      reviews: {
        status: this.reviews.status,
        error: this.reviews.error,
        requests: this.reviews.models(),
        maxWaitHours: reviewConfig.maxWaitHours,
        dueSoonHours: reviewConfig.dueSoonHours,
        includeOptional: reviewConfig.includeOptional,
        hiddenOptional: this.reviews.hiddenOptional(),
        reviewedPeriod: reviewConfig.reviewedPeriod,
        reviewed: this.reviews.reviewed(),
        layout: reviewConfig.layout,
      },
      pullRequests: {
        status: this.myPullRequests.status,
        error: this.myPullRequests.error,
        showDrafts: pullRequestConfig.showDrafts,
        hiddenDrafts,
        completedPeriod: pullRequestConfig.completedPeriod,
        hiddenCompleted,
        completedSummary,
        layout: pullRequestConfig.layout,
        attentionEffect: pullRequestConfig.attentionEffect,
        items,
      },
    };
    // The activity bar badge lives on the Summary tree view: a webview view only exists once it is shown
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

  /** Shows the view and scrolls its card of the work item into view (the webview flashes it) */
  async reveal(id: number): Promise<void> {
    this.pendingReveal = id;
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    this.flushReveal();
  }

  // Rule TABS-4
  /** Shows the view on one of its tabs (a click on a Summary row) */
  async showTab(tab: SidebarTab): Promise<void> {
    this.pendingTab = tab;
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
    this.flushTab();
  }

  private flushTab(): void {
    if (this.pendingTab === undefined || !this.ready || !this.view?.visible) {
      return;
    }
    const message: ExtensionMessage = { type: 'showTab', tab: this.pendingTab };
    this.pendingTab = undefined;
    void this.view.webview.postMessage(message);
  }

  private flushReveal(): void {
    if (this.pendingReveal === undefined || !this.ready || !this.view?.visible) {
      return;
    }
    const message: ExtensionMessage = { type: 'revealWorkItem', id: this.pendingReveal };
    this.pendingReveal = undefined;
    void this.view.webview.postMessage(message);
  }

  // Rules FUN-MERGE-4, FUN-SOUND-2
  /** Confetti and / or a sound in the sidebar, only when it is open and showing: nothing is queued for later */
  celebrate(confetti: boolean, sound: SoundId | undefined): void {
    if (!this.ready || !this.view?.visible || (!confetti && !sound)) {
      return;
    }
    const message: ExtensionMessage = { type: 'celebrate', confetti, sound };
    void this.view.webview.postMessage(message);
  }

  /** Opens or closes the task list of every card */
  setTasksExpanded(expanded: boolean): void {
    const message: ExtensionMessage = { type: 'setTasksExpanded', expanded };
    void this.view?.webview.postMessage(message);
  }

  /**
   * The native picker of a trigger of the view. What is chosen runs through onMessage, as if the webview had posted the
   * message of that button: the picker only validated it (src/actionPicker.ts)
   */
  private async showActions(title: unknown, sections: unknown): Promise<void> {
    const message = await showActionPicker(typeof title === 'string' ? title : 'Actions', sections);
    if (message) {
      await this.onMessage(message);
    }
  }

  private async onMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.ready = true;
        this.post();
        this.flushTab();
        this.flushReveal();
        await this.store.ensureLoaded();
        return;
      case 'showBaseBranchAlert':
        await vscode.commands.executeCommand(SHOW_BASE_BRANCH_COMMAND);
        return;
      case 'cleanUp':
        // Rule NOW-5: the existing flows, which ask before removing anything
        await vscode.commands.executeCommand(
          message.what === 'worktrees' ? CLEAN_UP_WORKTREES_COMMAND : DELETE_BRANCH_COMMAND
        );
        return;
      case 'refresh':
        await Promise.all([this.store.refresh(), this.reviews.poll(true), this.myPullRequests.poll()]);
        return;
      case 'checkReviewRequests':
        await this.reviews.poll(true);
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
      case 'retargetMyPullRequest':
        await vscode.commands.executeCommand(RETARGET_PULL_REQUEST_COMMAND, message.pullRequestId);
        break;
      case 'completeMyPullRequest':
        await vscode.commands.executeCommand(COMPLETE_PULL_REQUEST_COMMAND, message.pullRequestId);
        break;
      case 'restartMyPullRequestMerge':
        await vscode.commands.executeCommand(RESTART_PULL_REQUEST_MERGE_COMMAND, message.pullRequestId);
        return;
      case 'addBuildNotesSkipTag':
        await vscode.commands.executeCommand(ADD_BUILD_NOTES_SKIP_TAG_COMMAND, message.pullRequestId);
        return;
      case 'setShowDrafts':
        // Personal preference: saved in the user settings, which re-renders the view
        await vscode.workspace
          .getConfiguration(`${SECTION}.myPullRequests`)
          .update('showDrafts', message.show, vscode.ConfigurationTarget.Global);
        return;
      case 'setCompletedPeriod':
        await vscode.workspace
          .getConfiguration(`${SECTION}.myPullRequests`)
          .update('completedPeriod', message.period, vscode.ConfigurationTarget.Global);
        return;
      case 'setReviewedPeriod':
        await vscode.workspace
          .getConfiguration(`${SECTION}.reviews`)
          .update('reviewedPeriod', message.period, vscode.ConfigurationTarget.Global);
        return;
      case 'setReviewedExpanded':
        await this.reviews.setReviewedExpanded(message.ids);
        return;
      case 'setShowOptional':
        await vscode.workspace
          .getConfiguration(`${SECTION}.reviews`)
          .update('includeOptional', message.show, vscode.ConfigurationTarget.Global);
        return;
      case 'setPanelLayout':
        await vscode.workspace
          .getConfiguration(`${SECTION}.${message.panel}`)
          .update('layout', message.layout, vscode.ConfigurationTarget.Global);
        return;
      case 'openFile':
        await this.openFile(message.path);
        return;
      case 'checkoutMenu':
      case 'checkoutHere':
      case 'openWorktree':
      case 'removeWorktree':
      case 'worktreeMenu':
        await vscode.commands.executeCommand(`totalflowx.${message.type}`, message.kind, message.id, message.branch);
        return;
      case 'showActions':
        await this.showActions(message.title, message.sections);
        return;
      case 'openMyPullRequest':
      case 'openReviewRequest':
        await vscode.env.openExternal(vscode.Uri.parse(message.url));
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
