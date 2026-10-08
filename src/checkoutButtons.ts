/** Checkout buttons shared by the sidebar and the details panel. No "vscode" import */
import { escapeHtml } from './html';
import { icon } from './icons';
import type { CheckoutKind } from './viewModel';

export interface CheckoutButtonOptions {
  kind: CheckoutKind;
  /** Work item or PR id, sent with the ▾ and "Open worktree" buttons */
  id: number;
  /** Attributes of the main button: its data-action and the ids it needs */
  mainAttributes: string;
  title: string;
  /** Folder of the worktree that has the branch: the button opens it instead of checking out */
  worktree?: string;
  small?: boolean;
  /** A branch of the card other than its main one (a row of the branch list): sent with the ▾ and "Open worktree" buttons */
  branch?: string;
}

/**
 * "Checkout" with a ▾ part (one button group) that offers "Checkout here" / "Open in a worktree". When another
 * worktree has the branch, git cannot check it out again: "Open worktree ▾" ("Open worktree" / "Remove worktree") replaces it
 */
export function checkoutButton(options: CheckoutButtonOptions): string {
  const size = options.small ? ' small' : '';
  const branch = options.branch === undefined ? '' : ` data-branch="${escapeHtml(options.branch)}"`;
  if (options.worktree) {
    return `<span class="button-group checkout-group"><button class="button${size}" data-action="openWorktree" data-kind="${
      options.kind
    }" data-id="${options.id}"${branch} title="${escapeHtml(
      `The branch is checked out in a worktree: open ${options.worktree}`
    )}">Open worktree</button><button class="button caret${size}" data-action="worktreeMenu" data-kind="${
      options.kind
    }" data-id="${
      options.id
    }"${branch} title="More worktree options" aria-label="More worktree options" aria-haspopup="menu">${icon(
      'caretDown'
    )}</button></span>`;
  }
  return `<span class="button-group checkout-group"><button class="button${size}" ${
    options.mainAttributes
  } title="${escapeHtml(
    options.title
  )}">Checkout</button><button class="button caret${size}" data-action="checkoutMenu" data-kind="${
    options.kind
  }" data-id="${
    options.id
  }"${branch} title="More checkout options" aria-label="More checkout options" aria-haspopup="menu">${icon(
    'caretDown'
  )}</button></span>`;
}

/** Pill of a branch that is checked out in another worktree (the tooltip tells where) */
export function worktreePill(worktree: string | undefined): string {
  return worktree
    ? `<span class="pill tone-worktree" title="${escapeHtml(`Worktree: ${worktree}`)}">worktree</span>`
    : '';
}
