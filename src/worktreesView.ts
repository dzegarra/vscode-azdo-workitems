import * as vscode from 'vscode';
import { worktreeGroups, WorktreeGroup, WorktreeRow, worktreesViewDescription } from './worktreeRows';
import type { WorktreeTracker } from './worktreeTracker';

export const WORKTREES_VIEW_ID = 'totalflowx.worktrees';

type Node = { group: WorktreeGroup } | { row: WorktreeRow };

/** Context values of the rows, for the inline actions of package.json (menus "view/item/context") */
function contextValue(row: WorktreeRow): string {
  return ['worktree', row.missing ? 'missing' : 'present', row.owner ? 'owned' : 'unowned'].join('.');
}

function toItem(node: Node): vscode.TreeItem {
  if ('group' in node) {
    const { group } = node;
    const item = new vscode.TreeItem(
      group.label,
      group.status === 'inUse' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded
    );
    item.id = `group:${group.status}`;
    item.description = String(group.rows.length);
    item.contextValue = `worktreeGroup.${group.status}`;
    return item;
  }
  const { row } = node;
  const item = new vscode.TreeItem(row.label, vscode.TreeItemCollapsibleState.None);
  item.id = `worktree:${row.path}`;
  item.description = row.description;
  item.tooltip = new vscode.MarkdownString(row.tooltip, true);
  item.iconPath = new vscode.ThemeIcon(row.icon, row.color ? new vscode.ThemeColor(row.color) : undefined);
  item.contextValue = contextValue(row);
  return item;
}

/**
 * "Worktrees" tree view: every worktree of the repository (except the main one and this window's), grouped by
 * whether it can be removed, with the actions to open, remove it or open what it is for
 */
export class WorktreesView implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly treeView: vscode.TreeView<Node>;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly tracker: WorktreeTracker) {
    this.treeView = vscode.window.createTreeView(WORKTREES_VIEW_ID, { treeDataProvider: this });
    this.subscriptions = [this.treeView, this.changed, tracker.onDidChange(() => this.update())];
    this.update();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private update(): void {
    this.treeView.description = worktreesViewDescription(this.tracker.list());
    this.changed.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    return toItem(node);
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return worktreeGroups(this.tracker.list(), Date.now()).map((group) => ({ group }));
    }
    return 'group' in node ? node.group.rows.map((row) => ({ row })) : [];
  }
}

/** The row a command of the view was run on: the tree passes its node */
export function rowOf(node: unknown): WorktreeRow | undefined {
  return typeof node === 'object' && node !== null && 'row' in node ? (node as { row: WorktreeRow }).row : undefined;
}
