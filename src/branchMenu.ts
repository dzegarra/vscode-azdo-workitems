/** The actions menu behind the button of a branch row. Pure, so no "vscode" import: the webview bundles it */
import type { ActionMenuItem, ActionMenuSection } from './actionMenu';
import { checkoutMenuItems } from './checkoutMenu';
import type { BranchModel } from './viewModel';

export interface BranchMenuOptions {
  /** Id of the work item */
  id: number;
  /** The PR is merged and the branch still exists */
  deletable: boolean;
  /** Offer checkout / worktree items (the card-level button already covers a card's only branch) */
  checkout: boolean;
}

// Rules BRANCH-MENU-4, BRANCH-MENU-5
/** Items of a branch of the open repository (none for the branches of other repositories); Delete when it is deletable */
export function branchMenuSections(
  branch: BranchModel,
  { id, deletable, checkout: withCheckout }: BranchMenuOptions
): ActionMenuSection[] {
  const checkout =
    branch.otherRepository || !withCheckout
      ? []
      : checkoutMenuItems({
          id,
          kind: 'workItem',
          branch: branch.name,
          name: branch.name,
          worktree: branch.worktree,
          isCurrent: branch.isCurrent,
        });
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
