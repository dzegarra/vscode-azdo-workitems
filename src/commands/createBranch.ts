import * as vscode from 'vscode';
import { pickFromCatalog } from '../catalog';
import { resolveContext, settings } from '../config';
import { WorkItem } from '../azdoClient';
import { GitAPI, pickRepository, Repository } from '../git';
import { branchTypeFor, buildBranchName, isValidModule, slugify } from '../naming';
import { stateAfterBranchCreated } from '../states';
import { stateForNewBranchTask } from '../pullRequestTasks';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
import { offerBranchActions } from './checkoutBranch';
import { resolveWorkItemEntry } from './pickWorkItem';
import { findChildTaskWorkItem } from './pullRequestTask';
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

/** A task that starts with its branch moves to In Progress (a task has no "Committed" state) */
async function moveTaskToStartedState(repository: Repository, task: WorkItem): Promise<void> {
  const state = stateForNewBranchTask(task);
  if (!state) {
    return;
  }
  try {
    await resolveContext(repository).client.updateWorkItemState(task.id, state);
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Unable to change task ${task.id} to "${state}": ${(error as Error).message}`
    );
  }
}

/** Questions of the branch name: module and short name. The id and type are the ones of the Backlog Item / Bug */
async function askBranchName(workItem: WorkItem, suggestedName: string): Promise<string | undefined> {
  const type = branchTypeFor(workItem.type, settings().branchTypeByWorkItemType);
  const module = await pickFromCatalog({
    setting: 'branchModules',
    title: `${type}/<module>/${workItem.id}-…`,
    placeholder: 'Select the module affected by the changes',
    newItemPrompt: 'New module name (kebab-case, e.g. fui-apps-xyz)',
    validate: (value) => (isValidModule(value) ? undefined : 'Use lowercase letters, numbers and dashes'),
  });
  if (!module) {
    return undefined;
  }
  const slug = await vscode.window.showInputBox({
    title: `${type}/${module}/${workItem.id}-<name>`,
    prompt: 'Short branch name',
    value: slugify(suggestedName),
    ignoreFocusOut: true,
    validateInput: (value) => (slugify(value) ? undefined : 'Name is required'),
  });
  return slug === undefined ? undefined : buildBranchName(type, module, workItem.id, slug);
}

/** Creates the branch from the base branch (no checkout), publishes it and links it to the work items */
async function createAndLinkBranch(repository: Repository, branchName: string, linkIds: number[]): Promise<void> {
  const s = settings();
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
        for (const id of linkIds) {
          await client.linkBranchToWorkItem(id, azdoRepository, branchName);
        }
      }
    }
  );
}

/** The task of the row, or undefined (with a warning) when the store does not know it under the work item */
function resolveTask(store: WorkItemsStore, parent: WorkItem, taskId: number): WorkItem | undefined {
  const task = findChildTaskWorkItem(store, parent.id, taskId);
  if (!task) {
    void vscode.window.showWarningMessage(`Task ${taskId} was not found under work item ${parent.id}.`);
  }
  return task;
}

/**
 * Creates the branch of a work item. From a task row (`options.taskId`, `node` being the parent): the branch uses the
 * parent's id and type (team rule and branch detection), the name is proposed from the task title, and the branch
 * is linked to the task too, so the task knows its branch
 */
export async function createBranch(
  git: GitAPI,
  store: WorkItemsStore,
  node?: WorkItemEntry,
  options: { taskId?: number } = {}
): Promise<void> {
  const target = await resolveWorkItemEntry(store, node);
  if (!target) {
    return;
  }
  const { workItem } = target;
  const task = options.taskId === undefined ? undefined : resolveTask(store, workItem, options.taskId);
  if (options.taskId !== undefined && !task) {
    return;
  }
  const repository = pickRepository(git);

  // Several branches per work item are expected when they are created from its tasks
  if (!task && target.branch) {
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

  const branchName = await askBranchName(workItem, (task ?? workItem).title);
  if (!branchName) {
    return;
  }
  await createAndLinkBranch(repository, branchName, task ? [workItem.id, task.id] : [workItem.id]);

  await moveToStartedState(repository, workItem);
  if (task) {
    await moveTaskToStartedState(repository, task);
  }
  void store.refresh();
  // The store refreshes first (the card shows the branch at once); the notification then waits for the user's answer
  await offerBranchActions(git, store, { branch: branchName }, `Branch ${branchName} created.`);
}
