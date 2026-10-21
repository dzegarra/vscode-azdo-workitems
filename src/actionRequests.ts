/**
 * What the webview asks the extension to show in the native picker (message `showActions`): the title and the sections
 * of each trigger, built from the pure section builders. Pure, so no "vscode" import: the webview bundles it
 */
import type { ActionMenuSection } from './actionMenu';
import { hasPickerActions } from './actionPicker';
import { branchMenuSections } from './branchMenu';
import { checkoutMenuSections } from './checkoutMenu';
import { taskMenuSections, type TaskMenuTask } from './taskMenu';
import type { CheckoutKind, WorkItemModel } from './viewModel';

export interface ActionsRequest {
  title: string;
  sections: ActionMenuSection[];
}

/** Undefined when nothing can be chosen: the trigger then does nothing */
function withActions(title: string, sections: ActionMenuSection[]): ActionsRequest | undefined {
  return hasPickerActions(sections) ? { title, sections } : undefined;
}

/** The pill of a task row; `parent`: its card, whose branches of this repository the task can be linked to */
export function taskActionsRequest(
  task: TaskMenuTask & { title: string },
  parent: Pick<WorkItemModel, 'id' | 'branches'>
): ActionsRequest | undefined {
  const parentBranches = parent.branches.filter((branch) => !branch.otherRepository).map((branch) => branch.name);
  return withActions(`Task ${task.id} · ${task.title}`, taskMenuSections(task, parent.id, parentBranches));
}

type BranchesOfCard = Pick<WorkItemModel, 'id' | 'branch' | 'branches' | 'worktree' | 'deletableBranches'>;

/** The ... of the Checkout button of a card (its main branch), or of one of its branch rows (`branch`) */
export function workItemActionsRequest(card: BranchesOfCard, branch?: string): ActionsRequest | undefined {
  if (branch === undefined) {
    const name = card.branch ?? `work item ${card.id}`;
    return withActions(name, checkoutMenuSections({ id: card.id, kind: 'workItem', name, worktree: card.worktree }));
  }
  const row = card.branches.find((candidate) => candidate.name === branch);
  if (!row) {
    return undefined;
  }
  const deletable = !!card.deletableBranches?.includes(branch);
  return withActions(branch, branchMenuSections(row, { id: card.id, deletable, checkout: true }));
}

/** The ... of the Checkout button of a PR waiting for review or of one of my PRs */
export function pullRequestActionsRequest(
  kind: Extract<CheckoutKind, 'myPullRequest' | 'review'>,
  pr: { id: number; sourceBranch: string; worktree?: string }
): ActionsRequest | undefined {
  return withActions(
    pr.sourceBranch,
    checkoutMenuSections({ id: pr.id, kind, name: pr.sourceBranch, worktree: pr.worktree })
  );
}
