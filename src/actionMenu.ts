/** The actions behind the task pill, the branch rows and the Checkout ... buttons: items as data, shown by the native picker. No "vscode" import */
import type { CheckoutKind } from './viewModel';

/** What an item does: the extension turns it into the message of the matching button (see actionToMessage) */
export interface ActionMenuAction {
  action:
    | 'checkoutHere'
    | 'openWorktree'
    | 'removeWorktree'
    | 'deleteBranch'
    | 'openPullRequest'
    | 'createBranch'
    | 'createPullRequest'
    | 'linkBranch';
  /** Id sent as `id`: the task or work item, or the parent work item for the create actions */
  id: number;
  /** What the extension resolves the branch from: a task or work item, or the PR of a Checkout button */
  kind?: CheckoutKind;
  branch?: string;
  pr?: number;
  task?: number;
}

export interface ActionMenuItem {
  label: string;
  /** Second line, e.g. the state of the PR */
  detail?: string;
  /** Without action: the item only informs. The picker cannot show an inert item, so it leaves it out */
  act?: ActionMenuAction;
  /** Destructive: shown with the red trash icon (the delete flow asks for confirmation anyway) */
  danger?: boolean;
}

export interface ActionMenuSection {
  title: string;
  items: ActionMenuItem[];
}

/** Colour of an item's icon: one per kind of action, so the user recognises an item before reading it */
export type ActionMenuTone = 'blue' | 'yellow' | 'orange' | 'red' | 'green' | 'grey';

/** Codicon names (https://microsoft.github.io/vscode-codicons/dist/codicon.html) */
const ACTION_ICONS: Record<ActionMenuAction['action'], { codicon: string; tone: ActionMenuTone }> = {
  checkoutHere: { codicon: 'git-branch', tone: 'blue' },
  createBranch: { codicon: 'git-branch-create', tone: 'yellow' },
  openWorktree: { codicon: 'folder-opened', tone: 'blue' },
  removeWorktree: { codicon: 'close', tone: 'orange' },
  deleteBranch: { codicon: 'trash', tone: 'red' },
  openPullRequest: { codicon: 'git-pull-request', tone: 'green' },
  createPullRequest: { codicon: 'git-pull-request-create', tone: 'green' },
  linkBranch: { codicon: 'link', tone: 'yellow' },
};

/** Codicon and colour of an item: by its action; the items that only inform get a grey branch */
export function actionMenuIcon(item: Pick<ActionMenuItem, 'act'>): { codicon: string; tone: ActionMenuTone } {
  return item.act ? ACTION_ICONS[item.act.action] : { codicon: 'git-branch', tone: 'grey' };
}
