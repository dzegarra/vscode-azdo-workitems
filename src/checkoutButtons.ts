/** Checkout buttons shared by the sidebar and the details panel. No "vscode" import */
import { escapeHtml } from './html';
import { icon } from './icons';
import type { CheckoutKind } from './viewModel';

export interface CheckoutButtonOptions {
  kind: CheckoutKind;
  /** Work item or PR id, sent with the ... and "Open worktree" buttons */
  id: number;
  /** Attributes of the main button: its data-action and the ids it needs */
  mainAttributes: string;
  title: string;
  /** Folder of the worktree that has the branch: the button opens it instead of checking out */
  worktree?: string;
  small?: boolean;
  /** A branch of the card other than its main one (a row of the branch list): sent with the ... and "Open worktree" buttons */
  branch?: string;
  /** Icon instead of the text (the rows of the branch list, where the name needs the width): needs `branch` for its labels */
  iconOnly?: boolean;
}

/**
 * The "more actions" button: an ellipsis, not a chevron, because what it opens (the native picker, at the top of the
 * window) is not below the button. It posts `checkoutMenu` / `worktreeMenu`: the sidebar builds the picker from its
 * model, the details panel asks the extension for it. No aria-haspopup / aria-expanded: a picker is not a popup of
 * the button
 */
function caretButton(
  options: CheckoutButtonOptions,
  action: 'checkoutMenu' | 'worktreeMenu',
  label: string,
  branch: string
): string {
  const size = options.small ? ' small' : '';
  const title = action === 'worktreeMenu' ? 'More worktree options' : 'More checkout options';
  return `<button class="button caret${size}" data-action="${action}" data-kind="${options.kind}" data-id="${
    options.id
  }"${branch} title="${title}" aria-label="${escapeHtml(label)}">${icon('ellipsis')}</button>`;
}

/** Branch rows: the same buttons as icons, with the labels in `title` / `aria-label` */
function iconCheckoutButton(options: CheckoutButtonOptions): string {
  const name = options.branch ?? '';
  const branch = options.branch === undefined ? '' : ` data-branch="${escapeHtml(options.branch)}"`;
  const worktree = !!options.worktree;
  const label = worktree ? `Open the worktree of ${name}` : `Checkout ${name}`;
  const title = worktree ? `${label} (${options.worktree})` : options.title;
  const main = worktree
    ? `data-action="openWorktree" data-kind="${options.kind}" data-id="${options.id}"${branch}`
    : options.mainAttributes;
  const more = worktree ? 'More worktree options' : 'More checkout options';
  const caret = caretButton(
    { ...options, small: true },
    worktree ? 'worktreeMenu' : 'checkoutMenu',
    `${more} of ${name}`,
    branch
  );
  return `<span class="button-group checkout-group"><button class="button icon-button small" ${main} title="${escapeHtml(
    title
  )}" aria-label="${escapeHtml(label)}">${icon(worktree ? 'worktree' : 'checkout')}</button>${caret}</span>`;
}

// Rule CARD-BTN-2
/**
 * "Checkout" with a ... part (one button group) that offers "Checkout here" / "Open in a worktree". When another
 * worktree has the branch, git cannot check it out again: "Open worktree ..." ("Open worktree" / "Remove worktree") replaces it
 */
export function checkoutButton(options: CheckoutButtonOptions): string {
  if (options.iconOnly) {
    return iconCheckoutButton(options);
  }
  const size = options.small ? ' small' : '';
  const branch = options.branch === undefined ? '' : ` data-branch="${escapeHtml(options.branch)}"`;
  if (options.worktree) {
    return `<span class="button-group checkout-group"><button class="button${size}" data-action="openWorktree" data-kind="${
      options.kind
    }" data-id="${options.id}"${branch} title="${escapeHtml(
      `The branch is checked out in a worktree: open ${options.worktree}`
    )}">Open worktree</button>${caretButton(options, 'worktreeMenu', 'More worktree options', branch)}</span>`;
  }
  return `<span class="button-group checkout-group"><button class="button${size}" ${
    options.mainAttributes
  } title="${escapeHtml(options.title)}">Checkout</button>${caretButton(
    options,
    'checkoutMenu',
    'More checkout options',
    branch
  )}</span>`;
}

/** Pill of a branch that is checked out in another worktree (the tooltip tells where) */
export function worktreePill(worktree: string | undefined): string {
  return worktree
    ? `<span class="pill tone-worktree" title="${escapeHtml(`Worktree: ${worktree}`)}">⧉ worktree</span>`
    : '';
}
