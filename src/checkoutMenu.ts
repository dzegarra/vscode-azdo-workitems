/** Items of the picker behind the … of a Checkout button. Pure, so no "vscode" import: the webview bundles it */
import type { ActionMenuItem, ActionMenuSection } from './actionMenu';
import type { CheckoutKind } from './viewModel';

export interface CheckoutMenuTarget {
  /** Id sent with the actions: the work item, task or PR, as the Checkout button sends it */
  id: number;
  kind: CheckoutKind;
  /** The branch of a row of the list; without it the extension takes the main branch of the card or the PR */
  branch?: string;
  /** Name shown in the items and in the header of the menu */
  name: string;
  /** Folder of the worktree that has the branch */
  worktree?: string;
  /** The branch is the one open in this window */
  isCurrent?: boolean;
}

// Rules BRANCH-MENU-1..3, CARD-BTN-2
/**
 * "Checkout here" / "Open in a worktree"; "Open worktree" / "Remove worktree" when a worktree has the branch (git cannot
 * check it out twice). Shown by the native picker, from the sidebar and from the details panel, and sent as the same messages
 */
export function checkoutMenuItems(target: CheckoutMenuTarget): ActionMenuItem[] {
  if (target.isCurrent) {
    return [{ label: 'Checked out', detail: 'This is the branch open in this window' }];
  }
  const base = { id: target.id, kind: target.kind, ...(target.branch === undefined ? {} : { branch: target.branch }) };
  if (target.worktree) {
    return [
      { label: 'Open worktree', detail: target.worktree, act: { action: 'openWorktree', ...base } },
      { label: 'Remove worktree', detail: 'Keeps the branch', act: { action: 'removeWorktree', ...base } },
    ];
  }
  return [
    { label: 'Checkout here', detail: target.name, act: { action: 'checkoutHere', ...base } },
    { label: 'Open in a worktree', detail: target.name, act: { action: 'openWorktree', ...base } },
  ];
}

/** The picker of a Checkout …: one section */
export function checkoutMenuSections(target: CheckoutMenuTarget): ActionMenuSection[] {
  return [{ title: 'Branch', items: checkoutMenuItems(target) }];
}
