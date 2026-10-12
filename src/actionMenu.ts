/** The popover action menu shared by the task pill and the branch rows: its items, as data. No "vscode" import */
import type { IconName } from './icons';

/** The message an item of the menu posts: the data attributes of its button */
export interface ActionMenuAction {
  action:
    | 'checkoutHere'
    | 'openWorktree'
    | 'removeWorktree'
    | 'deleteBranch'
    | 'openPullRequest'
    | 'createBranch'
    | 'createPullRequest';
  /** Id sent as `id`: the task or work item, or the parent work item for the create actions */
  id: number;
  kind?: 'task' | 'workItem';
  branch?: string;
  pr?: number;
  task?: number;
}

export interface ActionMenuItem {
  label: string;
  /** Second line, e.g. the state of the PR */
  detail?: string;
  /** Without action: the item only informs (dimmed) */
  act?: ActionMenuAction;
  /** Destructive: shown in the danger colour */
  danger?: boolean;
}

export interface ActionMenuSection {
  title: string;
  items: ActionMenuItem[];
}

/** Colour of an item's icon: one per kind of action, so the user recognises an item before reading it */
export type ActionMenuTone = 'blue' | 'yellow' | 'purple' | 'orange' | 'red' | 'green' | 'grey';

const ACTION_ICONS: Record<ActionMenuAction['action'], { icon: IconName; tone: ActionMenuTone }> = {
  checkoutHere: { icon: 'checkout', tone: 'blue' },
  createBranch: { icon: 'branchAdd', tone: 'yellow' },
  openWorktree: { icon: 'worktree', tone: 'purple' },
  removeWorktree: { icon: 'worktreeRemove', tone: 'orange' },
  deleteBranch: { icon: 'trash', tone: 'red' },
  openPullRequest: { icon: 'pullRequest', tone: 'green' },
  createPullRequest: { icon: 'pullRequestAdd', tone: 'green' },
};

/** Icon and colour of an item: by its action; the items that only inform (a branch's state) get a grey branch */
export function actionMenuIcon(item: Pick<ActionMenuItem, 'act'>): { icon: IconName; tone: ActionMenuTone } {
  return item.act ? ACTION_ICONS[item.act.action] : { icon: 'branch', tone: 'grey' };
}
