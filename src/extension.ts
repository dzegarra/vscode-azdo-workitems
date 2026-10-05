import * as vscode from 'vscode';
import { createBranch } from './commands/createBranch';
import { createPullRequest } from './commands/createPullRequest';
import { resolveContext, SECTION, settings } from './config';
import { getGitApi, pickRepository, Repository } from './git';
import { WorkItemNode, WorkItemsTreeProvider } from './workItemsTree';

/** Opens the sprint board of a team. When there are several, the user picks one */
async function openIterationBoard(repository: Repository | undefined, tree: WorkItemsTreeProvider): Promise<void> {
  const { client } = resolveContext(repository);
  const iterations = tree.iterations.length
    ? tree.iterations
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const git = await getGitApi();
  const tree = new WorkItemsTreeProvider(git);
  const currentRepository = () => (git.repositories.length ? pickRepository(git) : undefined);

  const command = (id: string, handler: (...args: never[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: never[]) => {
      try {
        await handler(...args);
      } catch (error) {
        void vscode.window.showErrorMessage((error as Error).message);
      }
    });

  context.subscriptions.push(
    vscode.window.createTreeView('azdoWorkItems.myItems', { treeDataProvider: tree, showCollapseAll: true }),
    // The remote is only known once the git extension has opened the repository
    git.onDidOpenRepository(() => tree.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SECTION)) {
        tree.refresh();
      }
    }),
    command('azdoWorkItems.refresh', () => tree.refresh()),
    command('azdoWorkItems.createBranch', (node?: WorkItemNode) => createBranch(git, tree, node)),
    command('azdoWorkItems.createPullRequest', (node?: WorkItemNode) => createPullRequest(git, tree, node)),
    command('azdoWorkItems.openInBrowser', (node: WorkItemNode) =>
      vscode.env.openExternal(vscode.Uri.parse(node.workItem.url))
    ),
    command('azdoWorkItems.copyId', (node: WorkItemNode) => vscode.env.clipboard.writeText(String(node.workItem.id))),
    command('azdoWorkItems.openIterationBoard', () => openIterationBoard(currentRepository(), tree)),
    command('azdoWorkItems.selectTeams', () => selectTeams(currentRepository()))
  );
}

export function deactivate(): void {}
