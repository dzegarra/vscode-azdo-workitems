/** The actions menu behind the button of a branch row. Pure, so no "vscode" import: the webview bundles it */
import type { ActionMenuItem, ActionMenuSection } from './actionMenu';
import type { BranchModel } from './viewModel';

export interface BranchMenuOptions {
  /** Id of the work item */
  id: number;
  /** The PR is merged and the branch still exists */
  deletable: boolean;
  /** Offer checkout / worktree items (the card-level button already covers a card's only branch) */
  checkout: boolean;
}

// Rules BRANCH-MENU-1..3
function checkoutItems(branch: BranchModel, id: number): ActionMenuItem[] {
  const base = { id, kind: 'workItem' as const, branch: branch.name };
  if (branch.isCurrent) {
    return [{ label: 'Checked out', detail: 'This is the branch open in this window' }];
  }
  if (branch.worktree) {
    return [
      { label: 'Open worktree', detail: branch.worktree, act: { action: 'openWorktree', ...base } },
      { label: 'Remove worktree', detail: 'Keeps the branch', act: { action: 'removeWorktree', ...base } },
    ];
  }
  return [
    { label: 'Checkout here', detail: branch.name, act: { action: 'checkoutHere', ...base } },
    { label: 'Open in a worktree', detail: branch.name, act: { action: 'openWorktree', ...base } },
  ];
}

// Rules BRANCH-MENU-4, BRANCH-MENU-5
/** Items of a branch of the open repository (none for the branches of other repositories); Delete when it is deletable */
export function branchMenuSections(
  branch: BranchModel,
  { id, deletable, checkout: withCheckout }: BranchMenuOptions
): ActionMenuSection[] {
  const checkout = branch.otherRepository || !withCheckout ? [] : checkoutItems(branch, id);
  const remove: ActionMenuItem[] = deletable
    ? [
        {
          label: `Delete branch ${branch.name}`,
          detail: 'The PR is merged',
          danger: true,
          act: { action: 'deleteBranch', id, kind: 'workItem', branch: branch.name },
        },
      ]
    : [];
  return [
    { title: 'Branch', items: checkout },
    { title: 'Cleanup', items: remove },
  ].filter((section) => section.items.length);
}

/** The row only gets a button when something can be done (an info-only menu is not worth the space) */
export function hasBranchActions(sections: ActionMenuSection[]): boolean {
  return sections.some((section) => section.items.some((item) => item.act));
}
