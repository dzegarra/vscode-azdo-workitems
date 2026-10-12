/** Rows of the branch list of a work item, shared by the sidebar and the details panel. No "vscode" import */
import { renderActionMenu, actionMenuId } from './actionMenuHtml';
import { branchBadge } from './branchBadge';
import { branchMenuSections } from './branchMenu';
import { checkoutButton } from './checkoutButtons';
import { escapeHtml } from './html';
import { icon } from './icons';
import { isFinishedState } from './states';
import type { BranchModel, WorkItemModel } from './viewModel';
import { mergedBranchHint } from './deletableBranches';
import { branchTooltip } from './workItemBranches';

export interface BranchRowOptions {
  /** Id of the work item */
  id: number;
  /** A small Checkout button (with its ▾ worktree menu) for the branches of this repository that are not checked out */
  showCheckout: boolean;
  /** The PR is merged and the branch still exists: "not deleted" instead of where it is, and a Delete branch button */
  deletable?: boolean;
  /**
   * Sidebar: the ▾ of the Checkout button opens the in-card actions menu (the same as the task pill's) instead of a
   * QuickPick. `openMenu` is the key of the menu that is open (see branchMenuKey)
   */
  popover?: { openMenu?: string };
}

/** Key of the menu of a branch row: the trigger and the open state find each other by it */
export function branchMenuKey(id: number, branch: string): string {
  return `branch-${id}-${branch}`;
}

/**
 * One branch: icon, name, where it is (current / local / remote / linked) and the worktree that has it. The ones of
 * other repositories are dimmed like the PRs of other repositories and cannot be checked out
 */
export function renderBranchRow(branch: BranchModel, options: BranchRowOptions): string {
  const { id, showCheckout, deletable, popover } = options;
  const tooltip = branchTooltip(branch);
  const badge = branchBadge(branch, !!deletable, mergedBranchHint());
  const pill = `<span class="pill tone-${badge.tone}" title="${escapeHtml(badge.title)}">${escapeHtml(
    badge.text
  )}</span>`;
  const key = branchMenuKey(id, branch.name);
  const open = !!popover && popover.openMenu === key;
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
          iconOnly: true,
          menu: popover && { key, open, controls: actionMenuId(key) },
        })
      : '';
  const remove = deletable
    ? `<button class="button small danger icon-button" data-action="deleteBranch" data-id="${id}" data-branch="${escapeHtml(
        branch.name
      )}" title="Delete the branch ${escapeHtml(
        branch.name
      )}: ${mergedBranchHint()}" aria-label="Delete the branch ${escapeHtml(branch.name)}">${icon('trash')}</button>`
    : '';
  return `<div class="row branch${branch.otherRepository ? ' other-repo' : ''}"${
    branch.otherRepository ? ` title="${escapeHtml(tooltip)}"` : ''
  }>${icon('branch')}<code title="${escapeHtml(branch.otherRepository ? tooltip : branch.name)}">${escapeHtml(
    branch.name
  )}</code><span class="branch-meta">${pill}${checkout}${remove}${
    open && checkout
      ? renderActionMenu(
          branchMenuSections(branch, { id, deletable: !!deletable, checkout: showCheckout }),
          key,
          `Actions for branch ${branch.name}`
        )
      : ''
  }</span></div>`;
}

/** Finished work items list the branches to delete and the other local branches: remote refs and links remain after deletion */
function isListedWhenFinished(branch: BranchModel, card: Pick<WorkItemModel, 'deletableBranches'>): boolean {
  return !!card.deletableBranches?.includes(branch.name) || (!branch.otherRepository && branch.location === 'local');
}

/**
 * Every branch of the work item, one row each. The buttons of the card act on its main branch, so the rows only get
 * their own Checkout when there are several branches, and their own Delete when several are deletable. "No branch"
 * when there is none; a finished work item without a branch to show says so
 */
export function renderBranchList(
  card: Pick<WorkItemModel, 'branch' | 'branches' | 'id' | 'deletableBranches' | 'state'>,
  popover?: BranchRowOptions['popover']
): string {
  const finished = isFinishedState(card.state);
  const muted = (text: string) => `<div class="row muted">${icon('branch')}<span>${text}</span></div>`;
  const branches = finished ? card.branches.filter((branch) => isListedWhenFinished(branch, card)) : card.branches;
  const rows = branches.map((branch) =>
    renderBranchRow(branch, {
      id: card.id,
      showCheckout: !finished && card.branches.length > 1,
      deletable: !branch.otherRepository && !!card.deletableBranches?.includes(branch.name),
      popover,
    })
  );
  if (finished && card.branch && !rows.length) {
    // The links of the work item remain after the branch is deleted; whether it still exists is only asked when its PR is merged
    return muted('No branch to delete');
  }
  return (card.branch ? '' : muted('No branch')) + rows.join('');
}
