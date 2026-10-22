import * as vscode from 'vscode';
import { baseConfigKey } from '../baseBranch';
import { pickFromCatalogOrExtra } from '../catalog';
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
import { pickBaseBranch } from './pickBaseBranch';

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

/** Module picker with the "Base: …" row; picking the row asks for the base and comes back to the modules */
async function pickModuleAndBase(
  repository: Repository,
  entry: WorkItemEntry,
  type: string
): Promise<{ module: string; base: string } | undefined> {
  const { remote, baseBranch } = settings();
  let base = baseBranch;
  for (;;) {
    const pick = await pickFromCatalogOrExtra({
      setting: 'branches.modules',
      title: `${type}/<module>/${entry.workItem.id}-…`,
      placeholder: 'Select the module affected by the changes',
      newItemPrompt: 'New module name (kebab-case, e.g. fui-apps-xyz)',
      validate: (value) => (isValidModule(value) ? undefined : 'Use lowercase letters, numbers and dashes'),
      extraItem: {
        label: `$(git-branch) Base: ${remote}/${base} · change…`,
        description: base === baseBranch ? 'team default' : 'the pull request will target it',
      },
    });
    if (pick?.kind !== 'extra') {
      return pick && { module: pick.value, base };
    }
    base = (await pickBaseBranch(repository, entry)) ?? base;
  }
}

/** Questions of the branch name: module and short name. The id and type are the ones of the Backlog Item / Bug */
async function askBranchName(
  repository: Repository,
  entry: WorkItemEntry,
  suggestedName: string
): Promise<{ name: string; base: string } | undefined> {
  const { workItem } = entry;
  const type = branchTypeFor(workItem.type, settings().branchTypeByWorkItemType);
  const picked = await pickModuleAndBase(repository, entry, type);
  if (!picked) {
    return undefined;
  }
  const slug = await vscode.window.showInputBox({
    title: `${type}/${picked.module}/${workItem.id}-<name>`,
    prompt: 'Short branch name',
    value: slugify(suggestedName),
    ignoreFocusOut: true,
    validateInput: (value) => (slugify(value) ? undefined : 'Name is required'),
  });
  return slug === undefined
    ? undefined
    : { name: buildBranchName(type, picked.module, workItem.id, slug), base: picked.base };
}

/** Remembers the base of a branch that does not start from the default one: Create PR targets it */
async function rememberBase(repository: Repository, branchName: string, base: string): Promise<void> {
  try {
    await repository.setConfig(baseConfigKey(branchName), base);
  } catch (error) {
    void vscode.window.showWarningMessage(
      `Branch ${branchName} was created, but its base "${base}" could not be remembered: ${
        (error as Error).message
      }. Choose the target when you create the pull request.`
    );
  }
}

// Rules FLOW-BRANCH-5, FLOW-BRANCH-6
/** Creates the branch from the base branch (no checkout), publishes it and links it to the work items */
async function createAndLinkBranch(
  repository: Repository,
  branchName: string,
  base: string,
  linkIds: number[]
): Promise<void> {
  const s = settings();
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Creating ${branchName}` },
    async (progress) => {
      progress.report({ message: `fetching ${s.remote}/${base}` });
      await repository.fetch(s.remote, base);
      progress.report({ message: 'creating the branch' });
      await repository.createBranch(branchName, false, `${s.remote}/${base}`);
      if (base !== s.baseBranch) {
        await rememberBase(repository, branchName, base);
      }

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

// Rule FLOW-BRANCH-1
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

  // Rule FLOW-BRANCH-2
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

  const asked = await askBranchName(repository, target, (task ?? workItem).title);
  if (!asked) {
    return;
  }
  const branchName = asked.name;
  await createAndLinkBranch(repository, branchName, asked.base, task ? [workItem.id, task.id] : [workItem.id]);

  // Rule FLOW-BRANCH-7
  await moveToStartedState(repository, workItem);
  if (task) {
    await moveTaskToStartedState(repository, task);
  }
  void store.refresh();
  // The store refreshes first (the card shows the branch at once); the notification then waits for the user's answer
  await offerBranchActions(git, store, { branch: branchName }, `Branch ${branchName} created.`);
}
