import * as vscode from 'vscode';
import { createBranch } from './commands/createBranch';
import { checkoutPullRequest } from './commands/checkoutPullRequest';
import { isCheckoutBranch } from './workItemBranches';
import { BranchTarget, checkoutBranch, openOrCreateWorktree } from './commands/checkoutBranch';
import { removeWorktreeAt, removeWorktreeOf, removeWorktreesCommand } from './commands/removeWorktree';
import { runPendingWorktreeSetup } from './worktreeSetup';
import { showActionPicker } from './actionPickerUi';
import { checkoutMenuSections } from './checkoutMenu';
import { CheckoutKind } from './viewModel';
import { publishPullRequest } from './commands/publishPullRequest';
import { addBuildNotesSkipTag } from './commands/addBuildNotesSkipTag';
import { retargetPullRequest } from './commands/retargetPullRequest';
import { completePullRequest } from './commands/completePullRequest';
import { restartPullRequestMerge } from './commands/restartPullRequestMerge';
import { createPullRequest } from './commands/createPullRequest';
import { deleteBranch } from './commands/deleteBranch';
import {
  baseBranchAlarmSoundEnabled,
  funEnabled,
  funSoundsEnabled,
  isOwnZoomChange,
  resolveContext,
  SECTION,
  settings,
  worktreeSettings,
} from './config';
import { BaseBranchAlert } from './baseBranchAlert';
import { getGitApi, pickRepository, Repository } from './git';
import { resolveWorkItemEntry } from './commands/pickWorkItem';
import { clearIntegrationBuild, fillIntegrationBuild } from './commands/integrationBuild';
import { linkBranchToTask } from './commands/linkBranchToTask';
import { linkTaskBranch } from './commands/linkTaskBranch';
import { linkTaskPullRequest } from './commands/linkTaskPullRequest';
import { addTask, changeState } from './commands/workItemEdits';
import { registerDiagnostics } from './diagnostics';
import { reportError } from './errorLog';
import { withFeature } from './requestContext';
import { DependencyMapPanel } from './dependencyMap';
import { OPEN_SPRINT_TIMELINE_COMMAND, SprintTimelinePanel } from './sprintTimeline';
import { TeamWorkStore } from './teamWorkStore';
import { OPEN_TRACK_BOARD_COMMAND, TrackBoardPanel } from './trackBoard';
import { CurrentWorkItemStatusBar, PICK_BRANCH_WORK_ITEM_COMMAND } from './currentWorkItemStatusBar';
import {
  ADD_BUILD_NOTES_SKIP_TAG_COMMAND,
  RETARGET_PULL_REQUEST_COMMAND,
  COMPLETE_PULL_REQUEST_COMMAND,
  RESTART_PULL_REQUEST_MERGE_COMMAND,
  CHECKOUT_MY_PULL_REQUEST_COMMAND,
  MyPullRequestsWatcher,
  PUBLISH_PULL_REQUEST_COMMAND,
} from './myPullRequestsWatcher';
import { CoverageRecordsStore } from './coverageRecordsStore';
import { MyPullRequestsStatusBar } from './myPullRequestsStatusBar';
import { PipelineStatusBar } from './pipelineStatusBar';
import { PipelineWatcher } from './pipelineWatcher';
import { PullRequestNotifier } from './pullRequestNotifier';
import { PullRequestTaskStarter } from './pullRequestTaskStarter';
import { ReviewStatusBar } from './reviewStatusBar';
import { SummaryView } from './summaryView';
import { CLEAN_UP_WORKTREES_COMMAND, REMOVE_WORKTREE_AT_COMMAND, WorktreeTracker } from './worktreeTracker';
import { rowOf, WorktreesView } from './worktreesView';
import { STATUS_BAR_PRIORITY, toFixText, toFixTooltipLines } from './statusBarOrder';
import { WorktreeStatusBar } from './worktreeStatusBar';
import { FunJournalStore } from './funJournalStore';
import { SHOW_SPRINT_RECAP_COMMAND, SprintRecapPanel } from './sprintRecapPanel';
import type { SoundId } from './sounds';
import { PullRequestExtrasLoader } from './pullRequestExtras';
import { CHECKOUT_REVIEW_COMMAND, ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { WorkItemDetailsPanels } from './workItemDetails';
import { WorkItemEntry, WorkItemsStore } from './workItemsStore';
import { REVEAL_WORK_ITEM_COMMAND, SHOW_SIDEBAR_TAB_COMMAND, VIEW_ID, WorkItemsViewProvider } from './workItemsView';
import type { SidebarTab } from './sidebarTabs';

/** Opens the sprint board of a team. When there are several, the user picks one */
async function openIterationBoard(repository: Repository | undefined, store: WorkItemsStore): Promise<void> {
  const { client } = resolveContext(repository);
  const iterations = store.iterations.length
    ? store.iterations
    : await client.getCurrentIterations(await client.resolveTeams(settings().teams));
  const boards = iterations.flatMap(({ iteration, teams }) =>
    teams.map((team) => ({ label: team, description: iteration.name, team, iteration }))
  );
  const picked =
    boards.length > 1 ? await vscode.window.showQuickPick(boards, { title: 'Open the sprint board of' }) : boards.at(0);
  if (!picked) {
    if (!boards.length) {
      void vscode.window.showWarningMessage('None of your teams has a current iteration.');
    }
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(client.iterationBoardWebUrl(picked.team, picked.iteration)));
}

/** Teams whose current iteration is listed. Selecting none lists all the teams the user belongs to */
async function selectTeams(repository: Repository | undefined): Promise<void> {
  const { client } = resolveContext(repository);
  const configured = settings().teams;
  const teams = await client.getTeams();
  const picked = await vscode.window.showQuickPick(
    teams.map((team) => ({ label: team.name, picked: configured.includes(team.name) })),
    {
      title: 'Teams whose current iteration is listed',
      placeHolder: 'Select none to list all your teams',
      canPickMany: true,
      ignoreFocusOut: true,
    }
  );
  if (!picked) {
    return;
  }
  // An empty list means "all my teams"
  await vscode.workspace
    .getConfiguration(SECTION)
    .update('teams', picked.length ? picked.map((item) => item.label) : undefined, vscode.ConfigurationTarget.Global);
}

const DEBOUNCE_MS = 300;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // A window opened on a new worktree runs `npm ci` once; never blocks nor breaks the activation
  const pendingDetails = runPendingWorktreeSetup();
  const git = await getGitApi();
  const store = new WorkItemsStore(git);
  const details = new WorkItemDetailsPanels(context.extensionUri, store);
  const funJournal = new FunJournalStore(context.globalState);
  const pullRequestTaskStarter = new PullRequestTaskStarter(store);
  const dependencyMap = new DependencyMapPanel(context.extensionUri, store);
  const pipelineStatusBar = new PipelineStatusBar(git, store, funJournal);
  const currentWorkItemStatusBar = new CurrentWorkItemStatusBar(git, store);
  // One loader for both PR boxes: they share what it caches
  const pullRequestExtras = new PullRequestExtrasLoader(store);
  const reviewRequests = new ReviewRequestsWatcher(context.globalState, store, pullRequestExtras, funJournal);
  const reviewStatusBar = new ReviewStatusBar(reviewRequests);
  const myPullRequests = new MyPullRequestsWatcher(store, pullRequestExtras);
  const myPullRequestsStatusBar = new MyPullRequestsStatusBar(myPullRequests, store);
  const coverageRecords = new CoverageRecordsStore(context.globalState);
  const view = new WorkItemsViewProvider(context.extensionUri, store, reviewRequests, myPullRequests, coverageRecords);
  // Rule FUN-SOUND-2: the sounds need totalflowx.fun.sounds on top of totalflowx.fun.enabled
  const celebrate = (confetti: boolean, sound: SoundId) =>
    view.celebrate(confetti, funSoundsEnabled() ? sound : undefined);
  const pipelineWatcher = new PipelineWatcher(store, myPullRequests, coverageRecords, funJournal, (sound) =>
    celebrate(false, sound)
  );
  // Rule BASE-CI-9: the alarm has its own setting: it is not a fun feature
  const baseBranchAlert = new BaseBranchAlert(context.globalState, store, myPullRequests, () =>
    view.celebrate(false, baseBranchAlarmSoundEnabled() ? 'alarm' : undefined)
  );
  view.setBaseBranchAlert(baseBranchAlert);
  const notifier = new PullRequestNotifier(context.globalState, store, funJournal, () => celebrate(true, 'merged'));
  const sprintRecap = new SprintRecapPanel(context.extensionUri, store, funJournal);
  details.setMyPullRequests(myPullRequests);
  const teamWork = new TeamWorkStore(context.globalState, store);
  const trackBoard = new TrackBoardPanel(context.extensionUri, store, reviewRequests, myPullRequests, teamWork);
  const sprintTimeline = new SprintTimelinePanel(context.extensionUri, store, reviewRequests, myPullRequests, teamWork);
  const worktreeTracker = new WorktreeTracker(context.globalState, { store, reviews: reviewRequests, myPullRequests });
  view.setWorktrees(worktreeTracker);
  const worktreesView = new WorktreesView(worktreeTracker);
  const worktreeStatusBar = new WorktreeStatusBar(git, store, worktreeTracker);
  // Native tree view: it exists from the activation, so its badge shows on the activity bar icon from a cold start
  const summary = new SummaryView({
    store,
    reviews: reviewRequests,
    myPullRequests,
    celebrateCleanBoard: () => funEnabled() && settings().alerts.enabled,
    worktrees: worktreeTracker,
    showStaleWorktrees: () => worktreeSettings().showInSummary,
  });
  const currentRepository = () => (git.repositories.length ? pickRepository(git) : undefined);

  /** Branch (and PR) behind the Checkout button of a card */
  const branchTarget = (kind: CheckoutKind, id: number, branch?: string): BranchTarget => {
    switch (kind) {
      case 'workItem': {
        const entry = store.find(id);
        if (branch) {
          // A row of the card: any branch of the work item in this repository
          if (!entry || !isCheckoutBranch(entry.branches, branch)) {
            throw new Error(`${branch} is not a branch of work item ${id} in this repository.`);
          }
          return { branch, origin: { kind, id } };
        }
        if (!entry?.branch) {
          throw new Error(`Work item ${id} has no branch.`);
        }
        return { branch: entry.branch, origin: { kind, id } };
      }
      case 'task': {
        if (!branch || !store.taskBranchNames(id).includes(branch)) {
          throw new Error(`${branch ?? 'The branch'} is not a branch of task ${id} in this repository.`);
        }
        return { branch, origin: { kind, id } };
      }
      case 'review': {
        const request = reviewRequests.branchTarget(id);
        if (!request) {
          throw new Error(`PR ${id} is no longer active.`);
        }
        return {
          branch: request.sourceBranch,
          pullRequest: { id, title: request.title },
          origin: { kind, id },
          showDetails: reviewRequests.workItemsToVerify(id),
        };
      }
      case 'myPullRequest': {
        const pullRequest = myPullRequests.models().items.find((item) => item.id === id);
        if (!pullRequest) {
          throw new Error(`PR ${id} is no longer in your list of pull requests.`);
        }
        return {
          branch: pullRequest.sourceBranch,
          pullRequest: { id, title: pullRequest.title },
          origin: { kind, id },
        };
      }
    }
  };

  /**
   * The ... of a Checkout / Open worktree button of the details panel: the native picker of the sidebar (same sections,
   * built from the current state of the branch). What is chosen runs the command of the matching button
   */
  const showBranchActions = async (kind: CheckoutKind, id: number, branch?: string): Promise<void> => {
    const name = branchTarget(kind, id, branch).branch;
    const sections = checkoutMenuSections({ id, kind, branch, name, worktree: store.worktreeFor(name)?.path });
    const message = await showActionPicker(name, sections);
    if (message && 'kind' in message) {
      await vscode.commands.executeCommand(`totalflowx.${message.type}`, message.kind, message.id, message.branch);
    }
  };

  // Rule ALERT-SHOW-5
  // Visible even when the sidebar is closed
  const alertsStatus = vscode.window.createStatusBarItem(
    'totalflowx.alerts',
    vscode.StatusBarAlignment.Left,
    STATUS_BAR_PRIORITY.toFix
  );
  alertsStatus.name = 'Work items to fix';
  // Rule STATUSBAR-FIX-1: opens the sidebar on the Work tab, where the work items with alerts are listed
  alertsStatus.command = {
    command: SHOW_SIDEBAR_TAB_COMMAND,
    title: 'Show the work items to fix',
    arguments: ['work'],
  };
  alertsStatus.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  const updateAlertsStatus = () => {
    const entries = store.withAlerts;
    const text = toFixText(entries.length);
    if (!text) {
      alertsStatus.hide();
      return;
    }
    alertsStatus.text = text;
    const [title, ...lines] = toFixTooltipLines(entries);
    alertsStatus.tooltip = new vscode.MarkdownString(
      [`**${title}**`, ...lines.map((line) => `- ${line.replace(/([\\`*_{}[\]<>#])/g, '\\$1')}`)].join('\n')
    );
    alertsStatus.show();
  };

  const command = (id: string, handler: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        // Right after a cold start the git extension may not know the "origin" remote yet (resolved instantly later)
        await store.whenRepositoryReady();
        await withFeature('commands', () => handler(...args));
      } catch (error) {
        reportError(error, id);
      }
    });

  // Re-render when the checked out branch changes, without reloading from Azure DevOps
  let debounce: NodeJS.Timeout | undefined;
  const watchRepository = (repository: Repository) =>
    repository.state.onDidChange(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        view.post();
        trackBoard.post();
        sprintTimeline.post();
        // Worktrees created or removed outside VS Code show up with the next change of the repository
        void store.refreshWorktrees().then((changed) => {
          if (changed) {
            view.post();
            trackBoard.post();
            sprintTimeline.post();
          }
        });
      }, DEBOUNCE_MS);
    });

  context.subscriptions.push(
    ...registerDiagnostics(),
    vscode.window.registerWebviewViewProvider(VIEW_ID, view),
    command(REVEAL_WORK_ITEM_COMMAND, (id: number) => view.reveal(id)),
    command(SHOW_SIDEBAR_TAB_COMMAND, (tab: SidebarTab) => view.showTab(tab)),
    command('totalflowx.expandTasks', () => view.setTasksExpanded(true)),
    command(SHOW_SPRINT_RECAP_COMMAND, (path?: string) => sprintRecap.show(path)),
    funJournal,
    sprintRecap,
    command('totalflowx.collapseTasks', () => view.setTasksExpanded(false)),
    details,
    notifier,
    pullRequestTaskStarter,
    dependencyMap,
    teamWork,
    teamWork.onDidChange(() => {
      trackBoard.post();
      sprintTimeline.post();
    }),
    trackBoard,
    command(OPEN_TRACK_BOARD_COMMAND, (key?: string) => trackBoard.open(key)),
    sprintTimeline,
    command(OPEN_SPRINT_TIMELINE_COMMAND, () => sprintTimeline.open()),
    pipelineWatcher,
    pipelineStatusBar,
    baseBranchAlert,
    currentWorkItemStatusBar,
    reviewRequests,
    reviewStatusBar,
    summary,
    worktreeTracker,
    worktreeTracker.onDidChange(() => view.post()),
    worktreesView,
    worktreeStatusBar,
    reviewRequests.onDidChange(() => {
      view.post();
      trackBoard.post();
      sprintTimeline.post();
    }),
    myPullRequests,
    myPullRequestsStatusBar,
    myPullRequests.onDidChange(() => {
      view.post();
      trackBoard.post();
      sprintTimeline.post();
    }),
    alertsStatus,
    store.onDidChange(() => {
      view.post();
      trackBoard.post();
      sprintTimeline.post();
      updateAlertsStatus();
    }),
    ...git.repositories.map(watchRepository),
    // The remote is only known once the git extension has opened the repository
    git.onDidOpenRepository((repository) => {
      context.subscriptions.push(watchRepository(repository));
      void store.refresh();
      notifier.start();
      reviewRequests.start();
      myPullRequests.start();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(SECTION) || isOwnZoomChange(event)) {
        // Rule TIMELINE-48: the zoom of the timeline written by its own webview needs no redraw
        return;
      }
      // The look, the review deadline and the days of the sprint show on the board
      trackBoard.post();
      sprintTimeline.post();
      // Settings such as reviews.includeOptional change what the Summary counts
      summary.update();
      // Organization / project / repository set in the settings make the git remote unnecessary
      store.recheckRepository();
      if (
        event.affectsConfiguration(`${SECTION}.myPullRequests.notifications`) ||
        event.affectsConfiguration(`${SECTION}.myPullRequests.notificationsPollIntervalSeconds`)
      ) {
        notifier.start();
      }
      if (event.affectsConfiguration(`${SECTION}.reviews`)) {
        // The check lists every PR (optional ones included) and reads the rules when it needs them: only the
        // polling interval needs to fetch again. The status bar listens to the settings by itself
        if (event.affectsConfiguration(`${SECTION}.reviews.pollIntervalSeconds`)) {
          reviewRequests.start();
        }
        if (event.affectsConfiguration(`${SECTION}.reviews.reviewedPeriod`)) {
          // The PRs completed or abandoned are only fetched while the period lists them
          void reviewRequests.refreshReviewed();
        }
        if (event.affectsConfiguration(`${SECTION}.reviews.includeOptional`)) {
          // The details of the optional PRs were not fetched while they were hidden
          void reviewRequests.refreshDetails();
        }
        view.post();
        return;
      }
      if (event.affectsConfiguration(`${SECTION}.buildNotes`)) {
        void myPullRequests.poll();
        return;
      }
      if (event.affectsConfiguration(`${SECTION}.myPullRequests`)) {
        // Only the polling interval needs to fetch again: showing or hiding the drafts, and
        // the layout, are done by the view
        if (event.affectsConfiguration(`${SECTION}.myPullRequests.pollIntervalSeconds`)) {
          myPullRequests.start();
        }
        if (event.affectsConfiguration(`${SECTION}.myPullRequests.completedPeriod`)) {
          // The threads of the completed PRs that the new period brings in are fetched
          void myPullRequests.poll();
        }
        view.post();
        return;
      }
      if (event.affectsConfiguration(`${SECTION}.workItems.showInReviewState`)) {
        // Display only: the panels redraw what they have, nothing is fetched
        details.rerender();
        dependencyMap.repost();
      }
      // Filters and the layout are applied by the view; other settings need to reload the work items
      const onlyFilters = [
        'teams',
        'organization',
        'project',
        'repository',
        'remote',
        'alerts',
        'branches.baseBranch',
        'pipelines.baseBranchAlert',
        'pipelines.baseBranchIgnoredPipelines',
      ].every((key) => !event.affectsConfiguration(`${SECTION}.${key}`));
      if (onlyFilters) {
        view.post();
      } else {
        void store.refresh();
      }
    }),
    command('totalflowx.refresh', () => store.refresh()),
    command('totalflowx.createBranch', (entry?: WorkItemEntry, options?: { taskId?: number }) =>
      createBranch(git, store, entry, options)
    ),
    command('totalflowx.createPullRequest', (entry?: WorkItemEntry, options?: { taskId?: number; branch?: string }) =>
      createPullRequest(git, store, entry, options)
    ),
    command('totalflowx.deleteBranch', (entry?: WorkItemEntry, branch?: string) =>
      deleteBranch(git, store, entry, branch)
    ),
    command('totalflowx.checkout', async (entry: WorkItemEntry, branch?: string) => {
      // The main branch of the card, or the branch of one of its rows. For a branch that only exists in the
      // remote, git creates the local tracking branch
      const target = branch
        ? branchTarget('workItem', entry.workItem.id, branch)
        : entry.branch && { branch: entry.branch, origin: { kind: 'workItem' as const, id: entry.workItem.id } };
      if (target) {
        await checkoutBranch(git, store, target);
      }
    }),
    // The ... of the Checkout / Open worktree buttons of the details panel: the same picker as the sidebar's
    command('totalflowx.checkoutMenu', showBranchActions),
    command('totalflowx.checkoutHere', async (kind: CheckoutKind, id: number, branch?: string) =>
      checkoutBranch(git, store, branchTarget(kind, id, branch), 'here')
    ),
    command('totalflowx.openWorktree', async (kind: CheckoutKind, id: number, branch?: string) =>
      openOrCreateWorktree(git, store, branchTarget(kind, id, branch))
    ),
    command('totalflowx.worktreeMenu', showBranchActions),
    command('totalflowx.removeWorktree', async (kind: CheckoutKind, id: number, branch?: string) =>
      removeWorktreeOf(store, git, branchTarget(kind, id, branch).branch)
    ),
    command('totalflowx.removeWorktrees', () => removeWorktreesCommand(git, store, worktreeTracker)),
    command(CLEAN_UP_WORKTREES_COMMAND, () => removeWorktreesCommand(git, store, worktreeTracker, true)),
    command(REMOVE_WORKTREE_AT_COMMAND, async (folder?: unknown) => {
      // From the notification (a folder) or from a row of the Worktrees view (its node)
      const target = typeof folder === 'string' ? folder : rowOf(folder)?.path;
      if (target) {
        await removeWorktreeAt(store, git, target);
      }
    }),
    command('totalflowx.worktrees.refresh', () => worktreeTracker.refresh()),
    command('totalflowx.worktrees.open', async (node?: unknown) => {
      const row = rowOf(node);
      if (row) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(row.path), { forceNewWindow: true });
      }
    }),
    command('totalflowx.worktrees.openOwner', async (node?: unknown) => {
      const owner = rowOf(node)?.owner;
      if (!owner) {
        return;
      }
      if (owner.kind === 'workItem' || owner.kind === 'task') {
        await details.open(owner.id);
        return;
      }
      const { client, repositoryName } = resolveContext(currentRepository());
      await vscode.env.openExternal(vscode.Uri.parse(client.pullRequestWebUrlByName(repositoryName, owner.id)));
    }),
    command('totalflowx.openDetails', async (id?: number) => {
      // From the command palette: pick one of the work items
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await details.open(workItemId);
      }
    }),
    command('totalflowx.changeState', async (id?: number, state?: string) => {
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await changeState(store, workItemId, state);
      }
    }),
    command('totalflowx.addTask', async (id?: number) => {
      const parentId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (parentId) {
        await addTask(store, parentId);
      }
    }),
    command('totalflowx.fillIntegrationBuild', async (id?: number) => {
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await fillIntegrationBuild(store, workItemId);
      }
    }),
    command('totalflowx.clearIntegrationBuild', async (id?: number) => {
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await clearIntegrationBuild(store, workItemId);
      }
    }),
    command('totalflowx.linkBranchToTask', async (parentId?: number, taskId?: number, branch?: string) => {
      if (parentId !== undefined && taskId !== undefined) {
        await linkBranchToTask(git, store, parentId, taskId, branch);
      }
    }),
    command('totalflowx.linkTaskBranch', async (id?: number, branch?: string) => {
      if (id !== undefined && branch) {
        await linkTaskBranch(store, id, branch);
      }
    }),
    command('totalflowx.linkTaskPullRequest', async (id?: number, pullRequestId?: number) => {
      if (id !== undefined && pullRequestId !== undefined) {
        await linkTaskPullRequest(store, id, pullRequestId);
      }
    }),
    command('totalflowx.openDependencyMap', (id?: number) => dependencyMap.open(id)),
    command('totalflowx.checkPullRequests', () => notifier.poll(true)),
    command('totalflowx.checkReviewRequests', () => reviewRequests.poll(true)),
    command(CHECKOUT_REVIEW_COMMAND, async (pullRequestId?: number) => {
      const requests = reviewRequests.models();
      // From the command palette: pick one of the PRs waiting for review
      const request =
        pullRequestId === undefined
          ? (
              await vscode.window.showQuickPick(
                requests
                  .filter((r) => r.canCheckout)
                  .map((r) => ({
                    label: `PR ${r.id}: ${r.title}`,
                    description: r.sourceBranch,
                    detail: r.timeLeft,
                    request: r,
                  })),
                { title: 'Check out the branch of a PR waiting for your review' }
              )
            )?.request
          : reviewRequests.branchTarget(pullRequestId);
      if (pullRequestId !== undefined && !request) {
        throw new Error(`PR ${pullRequestId} is no longer active.`);
      }
      if (request) {
        await checkoutPullRequest(
          git,
          store,
          request,
          'review',
          undefined,
          reviewRequests.workItemsToVerify(request.id)
        );
      }
    }),
    command('totalflowx.checkMyPullRequests', () => myPullRequests.poll()),
    command(CHECKOUT_MY_PULL_REQUEST_COMMAND, async (pullRequestId?: number) => {
      const { items } = myPullRequests.models();
      // From the command palette: pick one of the PRs whose branch is in the open repository
      const pullRequest =
        pullRequestId === undefined
          ? (
              await vscode.window.showQuickPick(
                items
                  .filter((item) => item.canCheckout && !item.isCompleted && !item.isCurrentBranch)
                  .map((item) => ({
                    label: `PR ${item.id}: ${item.title}`,
                    description: item.sourceBranch,
                    item,
                  })),
                { title: 'Check out the branch of one of your PRs' }
              )
            )?.item
          : items.find((item) => item.id === pullRequestId);
      if (pullRequestId !== undefined && !pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      if (pullRequest) {
        await checkoutPullRequest(git, store, pullRequest, 'myPullRequest');
      }
    }),
    command(PUBLISH_PULL_REQUEST_COMMAND, async (pullRequestId: number) => {
      const pullRequest = myPullRequests.find(pullRequestId);
      if (!pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      await publishPullRequest(resolveContext(currentRepository()).client, pullRequest, () => myPullRequests.poll());
      // The PR task may have moved: alerts and task rows
      void store.refresh();
    }),
    command(ADD_BUILD_NOTES_SKIP_TAG_COMMAND, async (pullRequestId: number) => {
      const pullRequest = myPullRequests.find(pullRequestId);
      if (!pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      await addBuildNotesSkipTag(resolveContext(currentRepository()).client, pullRequest, () => myPullRequests.poll());
    }),
    command(RETARGET_PULL_REQUEST_COMMAND, async (pullRequestId: number) => {
      const pullRequest = myPullRequests.find(pullRequestId);
      if (!pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      await retargetPullRequest(resolveContext(currentRepository()).client, pullRequest, settings().baseBranch, () =>
        myPullRequests.poll()
      );
    }),
    command(COMPLETE_PULL_REQUEST_COMMAND, async (pullRequestId: number) => {
      const pullRequest = myPullRequests.find(pullRequestId);
      if (!pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      await completePullRequest(resolveContext(currentRepository()).client, store, pullRequest, () =>
        myPullRequests.poll()
      );
    }),
    command(RESTART_PULL_REQUEST_MERGE_COMMAND, async (pullRequestId: number) => {
      const pullRequest = myPullRequests.find(pullRequestId);
      if (!pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      await restartPullRequestMerge(resolveContext(currentRepository()).client, pullRequest, () =>
        myPullRequests.poll()
      );
    }),
    command(PICK_BRANCH_WORK_ITEM_COMMAND, () => currentWorkItemStatusBar.pick()),
    command('totalflowx.openIterationBoard', () => openIterationBoard(currentRepository(), store)),
    command('totalflowx.selectTeams', () => selectTeams(currentRepository())),
    // No requests and no repository needed: does not wait for the repository like the commands above
    vscode.commands.registerCommand('totalflowx.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${context.extension.id}`)
    )
  );
  // Rule REVIEW-AC-1: a worktree opened for a review shows the acceptance criteria of its work items
  void pendingDetails.then((ids) => {
    for (const id of ids) {
      void vscode.commands.executeCommand('totalflowx.openDetails', id);
    }
  });
  // When the repository is not open yet, it starts from onDidOpenRepository
  if (git.repositories.length) {
    notifier.start();
    reviewRequests.start();
    myPullRequests.start();
    // Loads the work items even if the sidebar is closed, so the alerts show up in the status bar
    void store.ensureLoaded();
  }
}

export function deactivate(): void {}
