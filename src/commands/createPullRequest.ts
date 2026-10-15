import { access } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AzdoClient, GitRepository } from '../azdoClient';
import { pickFromCatalog } from '../catalog';
import { buildNotesSettings, resolveContext, settings } from '../config';
import { localDiffChangesFile } from '../buildNotes';
import { baseConfigKey, usableStoredBase } from '../baseBranch';
import { GitAPI, pickRepository, REF_TYPE_HEAD, Repository } from '../git';
import { buildPrDescription, buildPrTitle, parseBranchName } from '../naming';
import { chooseTaskBranch, PullRequestTaskRef } from '../pullRequestTasks';
import { linkCandidates } from '../workingOn';
import {
  createPullRequestTask,
  findChildTask,
  pickPullRequestTask,
  PullRequestTaskChoice,
  startNewPullRequestTask,
} from './pullRequestTask';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
import { remoteBranchNames } from './pickBaseBranch';
import { git as runGit } from '../worktreeGit';

/**
 * The work item in the branch name, plus any other the user wants to link. The ones that already use the branch
 * (Development link, same branch…) come first, pre-selected
 */
async function pickWorkItemIds(
  store: WorkItemsStore,
  primaryId: number | undefined,
  branch: string
): Promise<number[] | undefined> {
  await store.ensureLoaded();
  const candidates = linkCandidates(store.workItems, primaryId, branch);
  const primary = primaryId ? [primaryId] : [];
  if (!candidates.length) {
    return primary;
  }
  const extra = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: `${candidate.id} ${candidate.title}`,
      description: candidate.likely ? `${candidate.type} · uses this branch` : candidate.type,
      picked: candidate.likely,
      id: candidate.id,
    })),
    {
      title: primaryId ? `Other work items to link besides ${primaryId} (optional)` : 'Work items to link',
      canPickMany: true,
      ignoreFocusOut: true,
    }
  );
  if (!extra) {
    return undefined;
  }
  const ids = [...primary, ...extra.map((item) => item.id)];
  if (!ids.length) {
    void vscode.window.showWarningMessage('A pull request needs at least one work item.');
  }
  return ids;
}

/** Short description of the PR, prefilled with the title of the first work item */
async function askDescription(
  client: AzdoClient,
  store: WorkItemsStore,
  workItemIds: number[],
  featureName: string
): Promise<string | undefined> {
  const [firstId] = workItemIds;
  const firstTitle =
    store.workItems.find((wi) => wi.workItem.id === firstId)?.workItem.title ??
    (await client.getWorkItems([firstId])).at(0)?.title ??
    '';
  return vscode.window.showInputBox({
    title: `[${workItemIds.join(',')}] ${featureName}: <description>`,
    prompt: 'Short description of the changes in the PR',
    value: firstTitle,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : 'Description is required'),
  });
}

/** Offers to open the active PR of the branch, if there is one */
async function openExistingPullRequest(
  client: AzdoClient,
  repository: GitRepository,
  branch: string
): Promise<boolean> {
  const existing = await client.findActivePullRequest(repository, branch);
  if (!existing) {
    return false;
  }
  const open = await vscode.window.showInformationMessage(
    `Pull request ${existing.pullRequestId} is already active for "${branch}".`,
    'Open'
  );
  if (open) {
    await vscode.env.openExternal(vscode.Uri.parse(existing.webUrl));
  }
  return true;
}

// Rule FLOW-PR-7
function pickDraft(title: string, placeHolder: string): Thenable<{ isDraft: boolean } | undefined> {
  return vscode.window.showQuickPick(
    [
      { label: 'Create', isDraft: false },
      { label: 'Create as Draft', isDraft: true },
    ],
    { title, placeHolder, ignoreFocusOut: true }
  );
}

/** Base stored when the branch was created from another branch; undefined when none (or git cannot tell) */
async function storedBase(repository: Repository, branch: string): Promise<string | undefined> {
  try {
    return (await repository.getConfig(baseConfigKey(branch))).trim() || undefined;
  } catch {
    // The variable is not set: the branch starts from the default base
    return undefined;
  }
}

/** Whether the PR of the base branch is completed; unknown (false) when the question fails */
async function isBaseCompleted(client: AzdoClient, azdoRepository: GitRepository, base: string): Promise<boolean> {
  try {
    return await client.hasCompletedPullRequestFrom(azdoRepository, base);
  } catch {
    return false;
  }
}

// Rule FLOW-PR-4
/**
 * Branch the PR merges into: the base the branch was created from while that branch still exists and its own PR
 * is not completed (the user chooses between it and the default), otherwise the default. Undefined when cancelled
 */
async function resolveTarget(
  repository: Repository,
  client: AzdoClient,
  azdoRepository: GitRepository,
  branch: string
): Promise<string | undefined> {
  const { baseBranch } = settings();
  const stored = await storedBase(repository, branch);
  if (!stored || stored === baseBranch) {
    return baseBranch;
  }
  const remoteBranches = await remoteBranchNames(repository);
  const exists = remoteBranches.includes(stored);
  const base = usableStoredBase({
    stored,
    defaultBase: baseBranch,
    remoteBranches,
    baseCompleted: exists && (await isBaseCompleted(client, azdoRepository, stored)),
  });
  if (!base) {
    return baseBranch;
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: base, description: 'the branch it was created from', target: base },
      { label: baseBranch, description: 'team default', target: baseBranch },
    ],
    { title: `Target branch of ${branch}`, placeHolder: 'The pull request merges into…', ignoreFocusOut: true }
  );
  return picked?.target;
}

const WRITE_NOTES = "Yes, I'll write the notes";

// Rule FLOW-PR-5
/**
 * Team rule: the branch explains its changes for testers in the build notes file or the PR is tagged. Checked
 * locally (no request), before any other question: stopping to write the notes loses no answer. Returns the tags
 * to put on the PR, or undefined when the user wants to stop
 */
async function checkBuildNotes(root: string, base: string, head: string): Promise<string[] | undefined> {
  const notes = buildNotesSettings();
  if (!notes.enabled) {
    return [];
  }
  let changed: boolean;
  try {
    await access(path.join(root, notes.path));
    changed = localDiffChangesFile(await runGit(root, ['diff', '--name-only', `${base}...${head}`]), notes.path);
  } catch {
    // No notes file in this repository, or the base branch is not available locally: nothing to check
    return [];
  }
  if (changed) {
    return [];
  }
  const tagChoice = `No, tag the PR "${notes.skipTag}"`;
  const choice = await vscode.window.showWarningMessage(
    `This branch does not change ${notes.path}. Does it have changes testers should know about?`,
    { modal: true },
    WRITE_NOTES,
    tagChoice
  );
  if (choice === WRITE_NOTES) {
    await vscode.window.showTextDocument(vscode.Uri.file(path.join(root, notes.path)));
    return undefined;
  }
  return choice === tagChoice ? [notes.skipTag] : undefined;
}

// Rule FLOW-PR-6
/** Work items, feature name and description: the title "[ids] Feature: description". Undefined when cancelled */
async function askTitle(
  client: AzdoClient,
  store: WorkItemsStore,
  branch: string,
  workItemId: number | undefined
): Promise<{ workItemIds: number[]; title: string; description: string } | undefined> {
  const parsed = parseBranchName(branch);
  const workItemIds = await pickWorkItemIds(store, workItemId ?? parsed?.id, branch);
  if (!workItemIds?.length) {
    return undefined;
  }
  const featureName = await pickFromCatalog({
    setting: 'prFeatureNames',
    title: `[${workItemIds.join(',')}] <Feature Name>: …`,
    placeholder: 'Select the feature that best aligns with the changes',
    preselected: parsed ? settings().moduleToFeature[parsed.module] : undefined,
    newItemPrompt: 'New feature name, following the style of the existing ones (e.g. FUI Something)',
  });
  if (!featureName) {
    return undefined;
  }
  const description = await askDescription(client, store, workItemIds, featureName);
  return description
    ? { workItemIds, description, title: buildPrTitle(workItemIds, featureName, description) }
    : undefined;
}

interface SourceBranch {
  branch: string;
  /** The branch is checked out or exists locally: it has to be pushed */
  isLocal: boolean;
}

/** Branch for a PR created from a task row: see chooseTaskBranch */
async function pickTaskBranch(
  repository: Repository,
  node: WorkItemEntry,
  taskBranchNames: string[]
): Promise<SourceBranch | undefined> {
  const current = repository.state.HEAD?.name;
  const choice = chooseTaskBranch(current, node.branches, taskBranchNames);
  let branch: string | undefined;
  if (choice.kind === 'none') {
    void vscode.window.showWarningMessage(`Work item ${node.workItem.id} has no branch. Create a branch first.`);
    return undefined;
  }
  if (choice.kind === 'branch') {
    branch = choice.name;
  } else {
    branch = await vscode.window.showQuickPick(choice.names, {
      title: `Branch of work item ${node.workItem.id}`,
      placeHolder: 'Select the branch of the pull request',
      ignoreFocusOut: true,
    });
  }
  const location = node.branches.find((candidate) => candidate.name === branch)?.location;
  return branch ? { branch, isLocal: branch === current || location === 'local' } : undefined;
}

/** Whether the branch is a local branch of the repository (a task branch may not be among those of the work item) */
async function isLocalBranch(repository: Repository, node: WorkItemEntry, branch: string): Promise<boolean> {
  if (
    branch === repository.state.HEAD?.name ||
    node.branches.some((c) => c.name === branch && c.location === 'local')
  ) {
    return true;
  }
  const local = await repository.getBranches({ remote: false });
  return local.some((ref) => ref.type === REF_TYPE_HEAD && ref.name === branch);
}

// Rule FLOW-PR-1
/**
 * From a work item: its branch. From the command palette: the current branch. From a task row: the branch chosen in
 * its menu, else see pickTaskBranch
 */
async function resolveSourceBranch(
  store: WorkItemsStore,
  repository: Repository,
  node: WorkItemEntry | undefined,
  options: { taskId?: number; branch?: string }
): Promise<SourceBranch | undefined> {
  const { taskId, branch: chosen } = options;
  if (node && taskId !== undefined && chosen) {
    return { branch: chosen, isLocal: await isLocalBranch(repository, node, chosen) };
  }
  if (node && taskId !== undefined) {
    return pickTaskBranch(repository, node, findChildTask(store, node, taskId)?.branchNames ?? []);
  }
  const branch = node ? node.branch : repository.state.HEAD?.name;
  if (!branch) {
    void vscode.window.showWarningMessage(
      node ? `Work item ${node.workItem.id} has no branch. Create one first.` : 'No branch is checked out.'
    );
    return undefined;
  }
  return { branch, isLocal: !node || node.branchLocation === 'local' };
}

// Rule FLOW-PR-8
/** The PR task of the new PR: the task of the row, or the answer to the "PR task" question */
async function resolvePullRequestTask(
  store: WorkItemsStore,
  node: WorkItemEntry | undefined,
  taskId: number | undefined,
  content: { workItemIds: number[]; description: string }
): Promise<PullRequestTaskChoice | undefined> {
  if (node && taskId !== undefined) {
    const task = findChildTask(store, node, taskId);
    return task ? { kind: 'existing', task } : { kind: 'none' };
  }
  const [primaryId] = content.workItemIds;
  const primary = store.find(primaryId)?.workItem;
  // Tasks do not have PR tasks of their own
  return !primary || primary.type === 'Task'
    ? { kind: 'none' }
    : pickPullRequestTask(store, primaryId, content.description);
}

/** Creates the task or takes the chosen one; undefined when the PR goes without task */
async function prepareTask(
  client: AzdoClient,
  store: WorkItemsStore,
  choice: PullRequestTaskChoice,
  content: { workItemIds: number[]; description: string }
): Promise<PullRequestTaskRef | undefined> {
  if (choice.kind === 'existing') {
    return choice.task;
  }
  const parent = store.find(content.workItemIds[0])?.workItem;
  return choice.kind === 'create' && parent ? createPullRequestTask(client, parent, content.description) : undefined;
}

export async function createPullRequest(
  git: GitAPI,
  store: WorkItemsStore,
  node?: WorkItemEntry,
  /** From a task row of a card: `node` is the parent work item and the task is the PR task */
  options: { taskId?: number; branch?: string } = {}
): Promise<void> {
  const repository = pickRepository(git);
  const s = settings();

  const source = await resolveSourceBranch(store, repository, node, options);
  if (!source) {
    return;
  }
  const { branch, isLocal } = source;
  // Rule FLOW-PR-2
  if (branch === s.baseBranch) {
    void vscode.window.showWarningMessage(`Cannot create a pull request from the base branch "${s.baseBranch}".`);
    return;
  }

  const { client, repositoryName } = resolveContext(repository);
  const azdoRepository = await client.getRepository(repositoryName);

  // Rule FLOW-PR-3
  if (await openExistingPullRequest(client, azdoRepository, branch)) {
    return;
  }

  const targetBranch = await resolveTarget(repository, client, azdoRepository, branch);
  if (!targetBranch) {
    return;
  }

  // First question: answering "I'll write the notes" stops here, before any other answer is given
  const head = isLocal ? branch : `${s.remote}/${branch}`;
  const labels = await checkBuildNotes(repository.rootUri.fsPath, `${s.remote}/${targetBranch}`, head);
  if (!labels) {
    return;
  }

  const content = await askTitle(client, store, branch, node?.workItem.id);
  if (!content) {
    return;
  }
  const { workItemIds, title } = content;

  const draft = await pickDraft(title, `${branch} → ${targetBranch}`);
  if (!draft) {
    return;
  }

  const taskChoice = await resolvePullRequestTask(store, node, options.taskId, content);
  if (!taskChoice) {
    return;
  }

  // Rule FLOW-PR-9
  const pr = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Creating pull request' },
    async (progress) => {
      const task = await prepareTask(client, store, taskChoice, content);
      // A branch that only exists in the remote is already pushed
      if (isLocal) {
        progress.report({ message: `pushing ${branch}` });
        await repository.push(s.remote, branch, true);
      }
      const commits = await repository.log({ range: `${s.remote}/${targetBranch}..${head}` });
      progress.report({ message: 'creating pull request' });
      try {
        const created = await client.createPullRequest(azdoRepository, {
          source: branch,
          target: targetBranch,
          title,
          description: buildPrDescription(commits.map((c) => c.message.split('\n')[0]).reverse()),
          isDraft: draft.isDraft,
          workItemIds,
          taskIds: task ? [task.id] : [],
          labels,
        });
        if (task) {
          progress.report({ message: `updating task ${task.id}` });
          await startNewPullRequestTask(client, task, draft.isDraft);
        }
        return created;
      } catch (error) {
        if (task && taskChoice.kind === 'create') {
          void vscode.window.showWarningMessage(`The PR task ${task.id} was created, but the pull request was not.`);
        }
        throw error;
      }
    }
  );

  void store.refresh();
  const open = await vscode.window.showInformationMessage(`Pull request ${pr.pullRequestId} created: ${title}`, 'Open');
  if (open) {
    await vscode.env.openExternal(vscode.Uri.parse(pr.webUrl));
  }
}
