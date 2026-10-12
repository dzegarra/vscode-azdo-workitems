import * as vscode from 'vscode';
import { baseCandidates, BaseCandidate } from '../baseBranch';
import { settings } from '../config';
import { REF_TYPE_REMOTE_HEAD, Repository } from '../git';
import { WorkItemEntry } from '../workItemsStore';

interface BaseItem extends vscode.QuickPickItem {
  /** The branch; undefined for the "Other branch…" row */
  branch?: string;
}

const OTHER_LABEL = '$(search) Other branch…';

/** Branches of the remote without the remote name (and without its HEAD alias) */
export async function remoteBranchNames(repository: Repository): Promise<string[]> {
  const { remote } = settings();
  const refs = await repository.getBranches({ remote: true });
  return refs
    .filter((ref) => ref.type === REF_TYPE_REMOTE_HEAD && ref.remote === remote && ref.name)
    .map((ref) => (ref.name ?? '').slice(remote.length + 1))
    .filter((name) => name && name !== 'HEAD');
}

function toItem(candidate: BaseCandidate): BaseItem {
  return {
    label: candidate.completed ? `$(warning) ${candidate.name}` : candidate.name,
    description: candidate.description,
    detail: candidate.completed
      ? 'Its PR is completed: its changes are probably already in the base branch'
      : undefined,
    branch: candidate.name,
  };
}

const separator = (label: string): BaseItem => ({ label, kind: vscode.QuickPickItemKind.Separator });

/** The work item's branches of this repository, the main one first */
function branchesOf(entry: WorkItemEntry): string[] {
  const own = entry.branches.filter((branch) => !branch.otherRepository).map((branch) => branch.name);
  return entry.branch ? [entry.branch, ...own] : own;
}

/**
 * Asks which branch the new branch starts from: the team default, a branch of the work item (with the status of
 * its PR), or any other remote branch. Undefined when cancelled: the base stays as it was
 */
export async function pickBaseBranch(repository: Repository, entry: WorkItemEntry): Promise<string | undefined> {
  const remoteBranches = await remoteBranchNames(repository);
  const candidates = baseCandidates({
    defaultBase: settings().baseBranch,
    workItemBranches: branchesOf(entry),
    pullRequests: entry.pullRequests.map((pr) => ({
      id: pr.pullRequestId,
      sourceBranch: pr.sourceRefName.replace(/^refs\/heads\//, ''),
      status: pr.status,
    })),
    remoteBranches,
  });
  const items: BaseItem[] = [{ ...toItem(candidates.defaultBase), description: 'team default' }];
  if (candidates.workItem.length) {
    items.push(separator(`Branches of ${entry.workItem.id}`), ...candidates.workItem.map(toItem));
  }
  if (candidates.others.length) {
    items.push(separator(''), { label: OTHER_LABEL, alwaysShow: true });
  }
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Base branch of the new branch',
    placeHolder: `The branch starts from ${settings().remote}/<base>; the pull request will target it`,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }
  if (picked.branch) {
    return picked.branch;
  }
  const other = await vscode.window.showQuickPick(candidates.others.map(toItem), {
    title: 'Other base branch',
    placeHolder: 'Filter the branches of the remote',
    ignoreFocusOut: true,
  });
  return other?.branch;
}
