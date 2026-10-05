import * as vscode from 'vscode';
import { pickFromCatalog } from '../catalog';
import { resolveContext, settings } from '../config';
import { GitAPI, pickRepository } from '../git';
import { branchTypeFor, buildBranchName, isValidModule, slugify } from '../naming';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
import { resolveWorkItemEntry } from './pickWorkItem';

export async function createBranch(git: GitAPI, store: WorkItemsStore, node?: WorkItemEntry): Promise<void> {
  const target = await resolveWorkItemEntry(store, node);
  if (!target) {
    return;
  }
  const { workItem } = target;
  const repository = pickRepository(git);
  const s = settings();

  if (target.branch) {
    const choice = await vscode.window.showInformationMessage(
      `Work item ${workItem.id} already has the branch "${target.branch}".`,
      'Checkout',
      'Create Another'
    );
    if (choice === 'Checkout') {
      await repository.checkout(target.branch);
      return;
    }
    if (choice !== 'Create Another') {
      return;
    }
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

  const hasChanges = repository.state.workingTreeChanges.length + repository.state.indexChanges.length > 0;
  if (hasChanges) {
    const proceed = await vscode.window.showWarningMessage(
      'You have uncommitted changes. They will be carried over to the new branch.',
      { modal: true },
      'Continue'
    );
    if (proceed !== 'Continue') {
      return;
    }
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating ${branchName}` },
    async (progress) => {
      progress.report({ message: `fetching ${s.remote}/${s.baseBranch}` });
      await repository.fetch(s.remote, s.baseBranch);
      progress.report({ message: 'creating branch' });
      await repository.createBranch(branchName, true, `${s.remote}/${s.baseBranch}`);

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

  void store.refresh();
  void vscode.window.showInformationMessage(`Switched to the new branch "${branchName}".`);
}
