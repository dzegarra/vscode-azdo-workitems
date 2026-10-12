/** The popover action menu shared by the task pill and the branch rows: its items, as data. No "vscode" import */

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
