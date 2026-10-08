import * as vscode from 'vscode';
import { pickFromCatalog } from '../catalog';
import { resolveContext, settings } from '../config';
import { WorkItem } from '../azdoClient';
import { GitAPI, pickRepository, Repository } from '../git';
import { branchTypeFor, buildBranchName, isValidModule, slugify } from '../naming';
import { stateAfterBranchCreated } from '../states';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
import { offerBranchActions } from './checkoutBranch';
import { resolveWorkItemEntry } from './pickWorkItem';
import { confirmStart } from './startCheck';

/** Moves the work item to "Committed" (or the configured state) when work on it starts */
async function moveToStartedState(repository: Repository, workItem: WorkItem): Promise<void> {
  const state = stateAfterBranchCreated(workItem.type, workItem.state, settings().stateOnBranchCreated);
  if (!state) {
    return;
  }
  try {
    await resolveContext(repository).client.updateWorkItemState(workItem.id, state);
  } catch (error) {
    // The branch is created anyway; the state can be changed by hand
    void vscode.window.showWarningMessage(
      `Unable to change work item ${workItem.id} to "${state}": ${(error as Error).message}`
    );
  }
}

export async function createBranch(git: GitAPI, store: WorkItemsStore, node?: WorkItemEntry): Promise<void> {
  const target = await resolveWorkItemEntry(store, node);
  if (!target) {
    return;
  }
  const { workItem } = target;
  const repository = pickRepository(git);
  const s = settings();

  if (target.branch) {
    const choice = await offerBranchActions(
      git,
      store,
      { branch: target.branch },
      `Work item ${workItem.id} already has the branch "${target.branch}".`,
      ['Create Another']
    );
    if (choice !== 'Create Another') {
      return;
    }
  }

  // Creating the branch starts the work (and usually moves the work item to a started state): asked once, here
  if (!(await confirmStart(store, workItem))) {
    return;
  }

  const type = branchTypeFor(workItem.type, s.branchTypeByWorkItemType);
  const module = await pickFromCatalog({
    setting: 'branchModules',
    title: `${type}/<module>/${workItem.id}-…`,
    placeholder: 'Select the module affected by the changes',
    newItemPrompt: 'New module name (kebab-case, e.g. fui-apps-xyz)',
    validate: (value) => (isValidModule(value) ? undefined : 'Use lowercase letters, numbers and dashes'),
  });
  if (!module) {
    return;
  }

  const slug = await vscode.window.showInputBox({
    title: `${type}/${module}/${workItem.id}-<name>`,
    prompt: 'Short branch name',
    value: slugify(workItem.title),
    ignoreFocusOut: true,
    validateInput: (value) => (slugify(value) ? undefined : 'Name is required'),
  });
  if (slug === undefined) {
    return;
  }
  const branchName = buildBranchName(type, module, workItem.id, slug);

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating ${branchName}` },
    async (progress) => {
      progress.report({ message: `fetching ${s.remote}/${s.baseBranch}` });
      await repository.fetch(s.remote, s.baseBranch);
      progress.report({ message: 'creating the branch' });
      await repository.createBranch(branchName, false, `${s.remote}/${s.baseBranch}`);

      if (s.linkBranchToWorkItem) {
        progress.report({ message: `publishing to ${s.remote}` });
        await repository.push(s.remote, branchName, true);
        progress.report({ message: 'linking to work item' });
        const { client, repositoryName } = resolveContext(repository);
        const azdoRepository = await client.getRepository(repositoryName);
        await client.linkBranchToWorkItem(workItem.id, azdoRepository, branchName);
      }
    }
  );

  await moveToStartedState(repository, workItem);
  void store.refresh();
  // The store refreshes first (the card shows the branch at once); the notification then waits for the user's answer
  await offerBranchActions(git, store, { branch: branchName }, `Branch ${branchName} created.`);
}
