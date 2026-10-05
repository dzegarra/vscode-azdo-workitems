import * as vscode from 'vscode';
import { AzdoClient, GitRepository } from '../azdoClient';
import { pickFromCatalog } from '../catalog';
import { resolveContext, settings } from '../config';
import { GitAPI, pickRepository } from '../git';
import { buildPrDescription, buildPrTitle, parseBranchName } from '../naming';
import { WorkItemNode, WorkItemsTreeProvider } from '../workItemsTree';

/** The work item in the branch name, plus any other the user wants to link */
async function pickWorkItemIds(
  tree: WorkItemsTreeProvider,
  primaryId: number | undefined
): Promise<number[] | undefined> {
  await tree.getChildren();
  const otherItems = tree.workItems.filter((wi) => wi.workItem.id !== primaryId);
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
  tree: WorkItemsTreeProvider,
  workItemIds: number[],
  featureName: string
): Promise<string | undefined> {
  const [firstId] = workItemIds;
  const firstTitle =
    tree.workItems.find((wi) => wi.workItem.id === firstId)?.workItem.title ??
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

export async function createPullRequest(git: GitAPI, tree: WorkItemsTreeProvider, node?: WorkItemNode): Promise<void> {
  const repository = pickRepository(git);
  const s = settings();

  // From a work item: its local branch. From the command palette: the current branch
  const branch = node?.kind === 'workItem' ? node.branch : repository.state.HEAD?.name;
  if (!branch) {
    void vscode.window.showWarningMessage(
      node ? `Work item ${node.workItem.id} has no local branch. Create one first.` : 'No branch is checked out.'
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
  const workItemIds = await pickWorkItemIds(tree, node?.workItem.id ?? parsed?.id);
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

  const description = await askDescription(client, tree, workItemIds, featureName);
  if (!description) {
    return;
  }
  const title = buildPrTitle(workItemIds, featureName, description);

  const draft = await vscode.window.showQuickPick(
    [
      { label: 'Create', isDraft: false },
      { label: 'Create as Draft', isDraft: true },
    ],
    { title, placeHolder: `${branch} → ${s.baseBranch}`, ignoreFocusOut: true }
  );
  if (!draft) {
    return;
  }

  const pr = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Creating pull request' },
    async (progress) => {
      progress.report({ message: `pushing ${branch}` });
      await repository.push(s.remote, branch, true);
      const commits = await repository.log({ range: `${s.remote}/${s.baseBranch}..${branch}` });
      progress.report({ message: 'creating pull request' });
      return client.createPullRequest(azdoRepository, {
        source: branch,
        target: s.baseBranch,
        title,
        description: buildPrDescription(commits.map((c) => c.message.split('\n')[0]).reverse()),
        isDraft: draft.isDraft,
        workItemIds,
      });
    }
  );

  const open = await vscode.window.showInformationMessage(`Pull request ${pr.pullRequestId} created: ${title}`, 'Open');
  if (open) {
    await vscode.env.openExternal(vscode.Uri.parse(pr.webUrl));
  }
}
