import * as vscode from 'vscode';
import { createBranch } from './commands/createBranch';
import { checkoutPullRequest } from './commands/checkoutPullRequest';
import { isCheckoutBranch } from './workItemBranches';
import { BranchTarget, checkoutBranch, openWorktree, showCheckoutMenu } from './commands/checkoutBranch';
import { removeWorktreesCommand, showWorktreeMenu } from './commands/removeWorktree';
import { runPendingWorktreeSetup } from './worktreeSetup';
import { CheckoutKind } from './viewModel';
import { publishPullRequest } from './commands/publishPullRequest';
import { addBuildNotesSkipTag } from './commands/addBuildNotesSkipTag';
import { createPullRequest } from './commands/createPullRequest';
import { deleteBranch } from './commands/deleteBranch';
import { resolveContext, SECTION, settings } from './config';
import { getGitApi, pickRepository, Repository } from './git';
import { resolveWorkItemEntry } from './commands/pickWorkItem';
import { fillIntegrationBuild } from './commands/integrationBuild';
import { addTask, changeState } from './commands/workItemEdits';
import { registerDiagnostics } from './diagnostics';
import { withFeature } from './requestContext';
import { DependencyMapPanel } from './dependencyMap';
import { CurrentWorkItemStatusBar } from './currentWorkItemStatusBar';
import {
  ADD_BUILD_NOTES_SKIP_TAG_COMMAND,
  CHECKOUT_MY_PULL_REQUEST_COMMAND,
  MyPullRequestsWatcher,
  PUBLISH_PULL_REQUEST_COMMAND,
} from './myPullRequestsWatcher';
import { CoverageRecordsStore } from './coverageRecordsStore';
import { PipelineStatusBar } from './pipelineStatusBar';
import { PipelineWatcher } from './pipelineWatcher';
import { PullRequestNotifier } from './pullRequestNotifier';
import { ReviewStatusBar } from './reviewStatusBar';
import { PullRequestExtrasLoader } from './pullRequestExtras';
import { CHECKOUT_REVIEW_COMMAND, ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { WorkItemDetailsPanels } from './workItemDetails';
import { WorkItemEntry, WorkItemsStore } from './workItemsStore';
import {
  LAYOUT_CONTEXT,
  layoutSetting,
  REVEAL_WORK_ITEM_COMMAND,
  VIEW_ID,
  WorkItemsViewProvider,
} from './workItemsView';

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
  void runPendingWorktreeSetup();
  const git = await getGitApi();
  const store = new WorkItemsStore(git);
  const details = new WorkItemDetailsPanels(context.extensionUri, store);
  const notifier = new PullRequestNotifier(context.globalState, store);
  const dependencyMap = new DependencyMapPanel(context.extensionUri, store);
  const pipelineStatusBar = new PipelineStatusBar(store);
  const currentWorkItemStatusBar = new CurrentWorkItemStatusBar(git, store);
  // One loader for both PR boxes: they share what it caches
  const pullRequestExtras = new PullRequestExtrasLoader(store);
  const reviewRequests = new ReviewRequestsWatcher(context.globalState, store, pullRequestExtras);
  const reviewStatusBar = new ReviewStatusBar(reviewRequests);
  const myPullRequests = new MyPullRequestsWatcher(store, pullRequestExtras);
  const coverageRecords = new CoverageRecordsStore(context.globalState);
  const pipelineWatcher = new PipelineWatcher(store, myPullRequests, coverageRecords);
  const view = new WorkItemsViewProvider(context.extensionUri, store, reviewRequests, myPullRequests, coverageRecords);
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
          return { branch };
        }
        if (!entry?.branch) {
          throw new Error(`Work item ${id} has no branch.`);
        }
        return { branch: entry.branch };
      }
      case 'review': {
        const request = reviewRequests.models().find((r) => r.id === id);
        if (!request) {
          throw new Error(`PR ${id} is no longer waiting for your review.`);
        }
        return { branch: request.sourceBranch, pullRequest: { id, title: request.title } };
      }
      case 'myPullRequest': {
        const pullRequest = myPullRequests.models().items.find((item) => item.id === id);
        if (!pullRequest) {
          throw new Error(`PR ${id} is no longer in your list of pull requests.`);
        }
        return { branch: pullRequest.sourceBranch, pullRequest: { id, title: pullRequest.title } };
      }
    }
  };

  // Visible even when the sidebar is closed
  const alertsStatus = vscode.window.createStatusBarItem('totalflowx.alerts', vscode.StatusBarAlignment.Left);
  alertsStatus.name = 'Work items needing attention';
  alertsStatus.command = `${VIEW_ID}.focus`;
  alertsStatus.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  const updateAlertsStatus = () => {
    const entries = store.withAlerts;
    if (!entries.length) {
      alertsStatus.hide();
      return;
    }
    alertsStatus.text = `$(warning) ${entries.length} work item${entries.length === 1 ? '' : 's'}`;
    alertsStatus.tooltip = new vscode.MarkdownString(
      [
        '**Work items needing attention**',
        ...entries.map((e) => `- ${e.workItem.id} ${e.workItem.title}: ${e.alerts.map((a) => a.message).join('; ')}`),
      ].join('\n')
    );
    alertsStatus.show();
  };

  const command = (id: string, handler: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        await withFeature('commands', () => handler(...args));
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
      }
    });

  // The title bar shows the button of the layout the user is not using
  const updateLayoutContext = () => void vscode.commands.executeCommand('setContext', LAYOUT_CONTEXT, layoutSetting());
  const setLayout = (layout: 'compact' | 'large') =>
    vscode.workspace.getConfiguration(SECTION).update('layout', layout, vscode.ConfigurationTarget.Global);
  updateLayoutContext();

  // Re-render when the checked out branch changes, without reloading from Azure DevOps
  let debounce: NodeJS.Timeout | undefined;
  const watchRepository = (repository: Repository) =>
    repository.state.onDidChange(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        view.post();
        // Worktrees created or removed outside VS Code show up with the next change of the repository
        void store.refreshWorktrees().then((changed) => changed && view.post());
      }, DEBOUNCE_MS);
    });

  context.subscriptions.push(
    ...registerDiagnostics(),
    vscode.window.registerWebviewViewProvider(VIEW_ID, view),
    command('totalflowx.useCompactLayout', () => setLayout('compact')),
    command('totalflowx.useLargeLayout', () => setLayout('large')),
    command(REVEAL_WORK_ITEM_COMMAND, (id: number) => view.reveal(id)),
    command('totalflowx.expandTasks', () => view.setTasksExpanded(true)),
    command('totalflowx.collapseTasks', () => view.setTasksExpanded(false)),
    details,
    notifier,
    dependencyMap,
    pipelineWatcher,
    pipelineStatusBar,
    currentWorkItemStatusBar,
    reviewRequests,
    reviewStatusBar,
    reviewRequests.onDidChange(() => view.post()),
    myPullRequests,
    myPullRequests.onDidChange(() => view.post()),
    alertsStatus,
    store.onDidChange(() => {
      view.post();
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
      if (!event.affectsConfiguration(SECTION)) {
        return;
      }
      if (event.affectsConfiguration(`${SECTION}.notifications`)) {
        notifier.start();
      }
      if (event.affectsConfiguration(`${SECTION}.reviews`)) {
        // The check lists every PR (optional ones included) and reads the rules when it needs them: only the
        // polling interval needs to fetch again. The status bar listens to the settings by itself
        if (event.affectsConfiguration(`${SECTION}.reviews.pollIntervalSeconds`)) {
          reviewRequests.start();
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
        // Only the polling interval needs to fetch again: showing or hiding the drafts and the completed PRs, and
        // the layout, are done by the view
        if (event.affectsConfiguration(`${SECTION}.myPullRequests.pollIntervalSeconds`)) {
          myPullRequests.start();
        }
        view.post();
        return;
      }
      if (event.affectsConfiguration(`${SECTION}.layout`)) {
        updateLayoutContext();
      }
      // Filters and the layout are applied by the view; other settings need to reload the work items
      const onlyFilters = ['teams', 'organization', 'project', 'repository', 'remote', 'alerts'].every(
        (key) => !event.affectsConfiguration(`${SECTION}.${key}`)
      );
      if (onlyFilters) {
        view.post();
      } else {
        void store.refresh();
      }
    }),
    command('totalflowx.refresh', () => store.refresh()),
    command('totalflowx.createBranch', (entry?: WorkItemEntry) => createBranch(git, store, entry)),
    command('totalflowx.createPullRequest', (entry?: WorkItemEntry) => createPullRequest(git, store, entry)),
    command('totalflowx.deleteBranch', (entry?: WorkItemEntry) => deleteBranch(git, store, entry)),
    command('totalflowx.checkout', async (entry: WorkItemEntry, branch?: string) => {
      // The main branch of the card, or the branch of one of its rows. For a branch that only exists in the
      // remote, git creates the local tracking branch
      const target = branch
        ? branchTarget('workItem', entry.workItem.id, branch)
        : entry.branch && { branch: entry.branch };
      if (target) {
        await checkoutBranch(git, store, target);
      }
    }),
    command('totalflowx.checkoutMenu', async (kind: CheckoutKind, id: number, branch?: string) =>
      showCheckoutMenu(git, store, branchTarget(kind, id, branch))
    ),
    command('totalflowx.openWorktree', async (kind: CheckoutKind, id: number, branch?: string) =>
      openWorktree(store, branchTarget(kind, id, branch).branch)
    ),
    command('totalflowx.worktreeMenu', async (kind: CheckoutKind, id: number, branch?: string) =>
      showWorktreeMenu(store, git, branchTarget(kind, id, branch).branch)
    ),
    command('totalflowx.removeWorktrees', () => removeWorktreesCommand(git, store)),
    command('totalflowx.openDetails', async (id?: number) => {
      // From the command palette: pick one of the work items
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await details.open(workItemId);
      }
    }),
    command('totalflowx.changeState', async (id?: number) => {
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await changeState(store, workItemId);
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
    command('totalflowx.openDependencyMap', (id?: number) => dependencyMap.open(id)),
    command('totalflowx.checkPullRequests', () => notifier.poll(true)),
    command('totalflowx.checkReviewRequests', () => reviewRequests.poll()),
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
          : requests.find((r) => r.id === pullRequestId);
      if (pullRequestId !== undefined && !request) {
        throw new Error(`PR ${pullRequestId} is no longer waiting for your review.`);
      }
      if (request) {
        await checkoutPullRequest(git, store, request);
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
        await checkoutPullRequest(git, store, pullRequest);
      }
    }),
    command(PUBLISH_PULL_REQUEST_COMMAND, async (pullRequestId: number) => {
      const pullRequest = myPullRequests.find(pullRequestId);
      if (!pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      await publishPullRequest(resolveContext(currentRepository()).client, pullRequest, () => myPullRequests.poll());
    }),
    command(ADD_BUILD_NOTES_SKIP_TAG_COMMAND, async (pullRequestId: number) => {
      const pullRequest = myPullRequests.find(pullRequestId);
      if (!pullRequest) {
        throw new Error(`PR ${pullRequestId} is no longer in your list of pull requests.`);
      }
      await addBuildNotesSkipTag(resolveContext(currentRepository()).client, pullRequest, () => myPullRequests.poll());
    }),
    command('totalflowx.openIterationBoard', () => openIterationBoard(currentRepository(), store)),
    command('totalflowx.selectTeams', () => selectTeams(currentRepository()))
  );
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
