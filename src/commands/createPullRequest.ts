import { access } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AzdoClient, GitRepository } from '../azdoClient';
import { pickFromCatalog } from '../catalog';
import { buildNotesSettings, resolveContext, settings } from '../config';
import { localDiffChangesFile } from '../buildNotes';
import { GitAPI, pickRepository } from '../git';
import { buildPrDescription, buildPrTitle, parseBranchName } from '../naming';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
import { git as runGit } from '../worktreeGit';

/** The work item in the branch name, plus any other the user wants to link */
async function pickWorkItemIds(store: WorkItemsStore, primaryId: number | undefined): Promise<number[] | undefined> {
  await store.ensureLoaded();
  const otherItems = store.workItems.filter((wi) => wi.workItem.id !== primaryId);
  const primary = primaryId ? [primaryId] : [];
  if (!otherItems.length) {
    return primary;
  }
  const extra = await vscode.window.showQuickPick(
    otherItems.map((wi) => ({
      label: `${wi.workItem.id} ${wi.workItem.title}`,
      description: wi.workItem.type,
      id: wi.workItem.id,
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

function pickDraft(title: string, placeHolder: string): Thenable<{ isDraft: boolean } | undefined> {
  return vscode.window.showQuickPick(
    [
      { label: 'Create', isDraft: false },
      { label: 'Create as Draft', isDraft: true },
    ],
    { title, placeHolder, ignoreFocusOut: true }
  );
}

const WRITE_NOTES = "Yes, I'll write the notes";

/**
 * Team rule: the branch explains its changes for testers in the build notes file or the PR is tagged. Checked
 * locally (no request). Returns the tags to put on the PR, or undefined when the user wants to stop
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

/** Draft or not, then the build notes rule. Undefined when the user cancels or wants to write the notes first */
async function askCreateOptions(
  title: string,
  placeHolder: string,
  root: string,
  base: string,
  head: string
): Promise<{ isDraft: boolean; labels: string[] } | undefined> {
  const draft = await pickDraft(title, placeHolder);
  const labels = draft && (await checkBuildNotes(root, base, head));
  return draft && labels ? { isDraft: draft.isDraft, labels } : undefined;
}

export async function createPullRequest(git: GitAPI, store: WorkItemsStore, node?: WorkItemEntry): Promise<void> {
  const repository = pickRepository(git);
  const s = settings();

  // From a work item: its branch. From the command palette: the current branch
  const branch = node ? node.branch : repository.state.HEAD?.name;
  const isLocal = !node || node.branchLocation === 'local';
  if (!branch) {
    void vscode.window.showWarningMessage(
      node ? `Work item ${node.workItem.id} has no branch. Create one first.` : 'No branch is checked out.'
    );
    return;
  }
  if (branch === s.baseBranch) {
    void vscode.window.showWarningMessage(`Cannot create a pull request from the base branch "${s.baseBranch}".`);
    return;
  }

  const { client, repositoryName } = resolveContext(repository);
  const azdoRepository = await client.getRepository(repositoryName);

  if (await openExistingPullRequest(client, azdoRepository, branch)) {
    return;
  }

  const parsed = parseBranchName(branch);
  const workItemIds = await pickWorkItemIds(store, node?.workItem.id ?? parsed?.id);
  if (!workItemIds?.length) {
    return;
  }

  const featureName = await pickFromCatalog({
    setting: 'prFeatureNames',
    title: `[${workItemIds.join(',')}] <Feature Name>: …`,
    placeholder: 'Select the feature that best aligns with the changes',
    preselected: parsed ? s.moduleToFeature[parsed.module] : undefined,
    newItemPrompt: 'New feature name, following the style of the existing ones (e.g. FUI Something)',
  });
  if (!featureName) {
    return;
  }

  const description = await askDescription(client, store, workItemIds, featureName);
  if (!description) {
    return;
  }
  const title = buildPrTitle(workItemIds, featureName, description);

  const options = await askCreateOptions(
    title,
    `${branch} → ${s.baseBranch}`,
    repository.rootUri.fsPath,
    `${s.remote}/${s.baseBranch}`,
    isLocal ? branch : `${s.remote}/${branch}`
  );
  if (!options) {
    return;
  }

  const pr = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Creating pull request' },
    async (progress) => {
      // A branch that only exists in the remote is already pushed
      if (isLocal) {
        progress.report({ message: `pushing ${branch}` });
        await repository.push(s.remote, branch, true);
      }
      const head = isLocal ? branch : `${s.remote}/${branch}`;
      const commits = await repository.log({ range: `${s.remote}/${s.baseBranch}..${head}` });
      progress.report({ message: 'creating pull request' });
      return client.createPullRequest(azdoRepository, {
        source: branch,
        target: s.baseBranch,
        title,
        description: buildPrDescription(commits.map((c) => c.message.split('\n')[0]).reverse()),
        isDraft: options.isDraft,
        workItemIds,
        labels: options.labels,
      });
    }
  );

  void store.refresh();
  const open = await vscode.window.showInformationMessage(`Pull request ${pr.pullRequestId} created: ${title}`, 'Open');
  if (open) {
    await vscode.env.openExternal(vscode.Uri.parse(pr.webUrl));
  }
}
