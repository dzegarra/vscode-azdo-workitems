/** Rows of the branch list of a work item, shared by the sidebar and the details panel. No "vscode" import */
import { checkoutButton, worktreePill } from './checkoutButtons';
import { escapeHtml } from './html';
import { icon } from './icons';
import { isFinishedState } from './states';
import type { BranchModel, WorkItemModel } from './viewModel';
import { branchTooltip } from './workItemBranches';

export interface BranchRowOptions {
  /** Id of the work item */
  id: number;
  /** A small Checkout button (with its ▾ worktree menu) for the branches of this repository that are not checked out */
  showCheckout: boolean;
  /** The PR is merged and the branch still exists: "not deleted" instead of where it is */
  leftover?: boolean;
}

/**
 * One branch: icon, name, where it is (current / local / remote / linked) and the worktree that has it. The ones of
 * other repositories are dimmed like the PRs of other repositories and cannot be checked out
 */
export function renderBranchRow(branch: BranchModel, { id, showCheckout, leftover }: BranchRowOptions): string {
  const tooltip = branchTooltip(branch);
  const pill = leftover
    ? '<span class="pill tone-leftover" title="The PR is merged: the branch should be deleted">not deleted</span>'
    : `<span class="pill tone-${branch.location}">${branch.location}</span>`;
  const checkout =
    showCheckout && !branch.otherRepository && !branch.isCurrent
      ? checkoutButton({
          kind: 'workItem',
          id,
          mainAttributes: `data-action="checkout" data-id="${id}" data-branch="${escapeHtml(branch.name)}"`,
          title: `Switch to ${branch.name}`,
          worktree: branch.worktree,
          small: true,
          branch: branch.name,
        })
      : '';
  return `<div class="row branch${branch.otherRepository ? ' other-repo' : ''}"${
    branch.otherRepository ? ` title="${escapeHtml(tooltip)}"` : ''
  }>${icon('branch')}<code title="${escapeHtml(branch.otherRepository ? tooltip : branch.name)}">${escapeHtml(
    branch.name
  )}</code><span class="branch-meta">${pill}${worktreePill(branch.worktree)}${checkout}</span></div>`;
}

/** Finished work items list their leftover branch and the other local branches: remote refs and links remain after deletion */
function isListedWhenFinished(branch: BranchModel, card: Pick<WorkItemModel, 'leftoverBranch'>): boolean {
  return branch.name === card.leftoverBranch?.name || (!branch.otherRepository && branch.location === 'local');
}

/**
 * Every branch of the work item, one row each. The buttons of the card act on its main branch, so the rows only get
 * their own Checkout when there are several branches. "No branch" / "Branch deleted" when the main branch is missing
 */
export function renderBranchList(
  card: Pick<WorkItemModel, 'branch' | 'branches' | 'id' | 'leftoverBranch' | 'state'>
): string {
  const finished = isFinishedState(card.state);
  const muted = (text: string) => `<div class="row muted">${icon('branch')}<span>${text}</span></div>`;
  const branches = finished ? card.branches.filter((branch) => isListedWhenFinished(branch, card)) : card.branches;
  const rows = branches.map((branch) =>
    renderBranchRow(branch, {
      id: card.id,
      showCheckout: !finished && card.branches.length > 1,
      leftover: finished && branch.name === card.leftoverBranch?.name,
    })
  );
  if (finished && card.branch && !card.leftoverBranch) {
    // The links of the work item remain after the branch is deleted
    return muted('Branch deleted') + rows.join('');
  }
  return (card.branch ? '' : muted('No branch')) + rows.join('');
}
