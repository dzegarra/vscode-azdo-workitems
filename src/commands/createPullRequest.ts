import { access } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AzdoClient, GitRepository } from '../azdoClient';
import { pickFromCatalog } from '../catalog';
import { buildNotesSettings, resolveContext, settings } from '../config';
import { localDiffChangesFile } from '../buildNotes';
import { GitAPI, pickRepository } from '../git';
import { buildPrDescription, buildPrTitle, parseBranchName } from '../naming';
import { linkCandidates } from '../workingOn';
import { WorkItemEntry, WorkItemsStore } from '../workItemsStore';
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

/** Work items, feature name and description: the title "[ids] Feature: description". Undefined when cancelled */
async function askTitle(
  client: AzdoClient,
  store: WorkItemsStore,
  branch: string,
  workItemId: number | undefined
): Promise<{ workItemIds: number[]; title: string } | undefined> {
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
  return description ? { workItemIds, title: buildPrTitle(workItemIds, featureName, description) } : undefined;
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

  // First question: answering "I'll write the notes" stops here, before any other answer is given
  const head = isLocal ? branch : `${s.remote}/${branch}`;
  const labels = await checkBuildNotes(repository.rootUri.fsPath, `${s.remote}/${s.baseBranch}`, head);
  if (!labels) {
    return;
  }

  const content = await askTitle(client, store, branch, node?.workItem.id);
  if (!content) {
    return;
  }
  const { workItemIds, title } = content;

  const draft = await pickDraft(title, `${branch} → ${s.baseBranch}`);
  if (!draft) {
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
      const commits = await repository.log({ range: `${s.remote}/${s.baseBranch}..${head}` });
      progress.report({ message: 'creating pull request' });
      return client.createPullRequest(azdoRepository, {
        source: branch,
        target: s.baseBranch,
        title,
        description: buildPrDescription(commits.map((c) => c.message.split('\n')[0]).reverse()),
        isDraft: draft.isDraft,
        workItemIds,
        labels,
      });
    }
  );

  void store.refresh();
  const open = await vscode.window.showInformationMessage(`Pull request ${pr.pullRequestId} created: ${title}`, 'Open');
  if (open) {
    await vscode.env.openExternal(vscode.Uri.parse(pr.webUrl));
  }
}
