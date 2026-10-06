import * as vscode from 'vscode';
import { createBranch } from './commands/createBranch';
import { checkoutPullRequest } from './commands/checkoutPullRequest';
import { createPullRequest } from './commands/createPullRequest';
import { deleteBranch } from './commands/deleteBranch';
import { resolveContext, SECTION, settings } from './config';
import { getGitApi, pickRepository, Repository } from './git';
import { resolveWorkItemEntry } from './commands/pickWorkItem';
import { fillIntegrationBuild } from './commands/integrationBuild';
import { addTask, changeState } from './commands/workItemEdits';
import { DependencyMapPanel } from './dependencyMap';
import { PipelineStatusBar } from './pipelineStatusBar';
import { PipelineWatcher } from './pipelineWatcher';
import { PullRequestNotifier } from './pullRequestNotifier';
import { ReviewStatusBar } from './reviewStatusBar';
import { CHECKOUT_REVIEW_COMMAND, ReviewRequestsWatcher } from './reviewRequestsWatcher';
import { WorkItemDetailsPanels } from './workItemDetails';
import { WorkItemEntry, WorkItemsStore } from './workItemsStore';
import { VIEW_ID, WorkItemsViewProvider } from './workItemsView';

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
  const git = await getGitApi();
  const store = new WorkItemsStore(git);
  const details = new WorkItemDetailsPanels(context.extensionUri, store);
  const notifier = new PullRequestNotifier(context.globalState, store);
  const dependencyMap = new DependencyMapPanel(context.extensionUri, store);
  const pipelineWatcher = new PipelineWatcher(store);
  const pipelineStatusBar = new PipelineStatusBar(store);
  const reviewRequests = new ReviewRequestsWatcher(context.globalState, store);
  const reviewStatusBar = new ReviewStatusBar(reviewRequests);
  const view = new WorkItemsViewProvider(context.extensionUri, store, reviewRequests);
  const currentRepository = () => (git.repositories.length ? pickRepository(git) : undefined);

  // Visible even when the sidebar is closed
  const alertsStatus = vscode.window.createStatusBarItem('azdoWorkItems.alerts', vscode.StatusBarAlignment.Left);
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
        await handler(...args);
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
      }
    });

  // Re-render when the checked out branch changes, without reloading from Azure DevOps
  let debounce: NodeJS.Timeout | undefined;
  const watchRepository = (repository: Repository) =>
    repository.state.onDidChange(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => view.post(), DEBOUNCE_MS);
    });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, view),
    details,
    notifier,
    dependencyMap,
    pipelineWatcher,
    pipelineStatusBar,
    reviewRequests,
    reviewStatusBar,
    reviewRequests.onDidChange(() => view.post()),
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
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration(SECTION)) {
        return;
      }
      if (event.affectsConfiguration(`${SECTION}.notifications`)) {
        notifier.start();
      }
      if (event.affectsConfiguration(`${SECTION}.reviews`)) {
        reviewRequests.start();
        return;
      }
      // Filters are applied by the view; other settings need to reload the work items
      const onlyFilters = ['teams', 'organization', 'project', 'repository', 'remote', 'alerts'].every(
        (key) => !event.affectsConfiguration(`${SECTION}.${key}`)
      );
      if (onlyFilters) {
        view.post();
      } else {
        void store.refresh();
      }
    }),
    command('azdoWorkItems.refresh', () => store.refresh()),
    command('azdoWorkItems.createBranch', (entry?: WorkItemEntry) => createBranch(git, store, entry)),
    command('azdoWorkItems.createPullRequest', (entry?: WorkItemEntry) => createPullRequest(git, store, entry)),
    command('azdoWorkItems.deleteBranch', (entry?: WorkItemEntry) => deleteBranch(git, store, entry)),
    command('azdoWorkItems.checkout', async (entry: WorkItemEntry) => {
      if (entry.branch) {
        // For a branch that only exists in the remote, git creates the local tracking branch
        await pickRepository(git).checkout(entry.branch);
        await store.refresh();
      }
    }),
    command('azdoWorkItems.openDetails', async (id?: number) => {
      // From the command palette: pick one of the work items
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await details.open(workItemId);
      }
    }),
    command('azdoWorkItems.changeState', async (id?: number) => {
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await changeState(store, workItemId);
      }
    }),
    command('azdoWorkItems.addTask', async (id?: number) => {
      const parentId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (parentId) {
        await addTask(store, parentId);
      }
    }),
    command('azdoWorkItems.fillIntegrationBuild', async (id?: number) => {
      const workItemId = id ?? (await resolveWorkItemEntry(store, undefined))?.workItem.id;
      if (workItemId) {
        await fillIntegrationBuild(store, workItemId);
      }
    }),
    command('azdoWorkItems.openDependencyMap', (id?: number) => dependencyMap.open(id)),
    command('azdoWorkItems.checkPullRequests', () => notifier.poll(true)),
    command('azdoWorkItems.checkReviewRequests', () => reviewRequests.poll()),
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
        await checkoutPullRequest(git, request);
      }
    }),
    command('azdoWorkItems.openIterationBoard', () => openIterationBoard(currentRepository(), store)),
    command('azdoWorkItems.selectTeams', () => selectTeams(currentRepository()))
  );
  // When the repository is not open yet, it starts from onDidOpenRepository
  if (git.repositories.length) {
    notifier.start();
    reviewRequests.start();
    // Loads the work items even if the sidebar is closed, so the alerts show up in the status bar
    void store.ensureLoaded();
  }
}

export function deactivate(): void {}
