import * as vscode from 'vscode';
import { SECTION } from './config';
import { GitAPI } from './git';
import { listWorktrees } from './worktreeGit';
import { windowWorktree, Worktree, worktreeStatusBarView } from './worktrees';
import { WORKTREES_VIEW_ID } from './worktreesView';
import type { WorktreeTracker } from './worktreeTracker';
import { WorkItemsStore } from './workItemsStore';

/**
 * Tells in the status bar whether this window is the main folder of the repository (the one with the .git directory)
 * or one of its worktrees. Local git only: one `git worktree list` when the repository opens, then the list the store
 * keeps up to date
 */
export class WorktreeStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('totalflowx.worktreeKind', vscode.StatusBarAlignment.Left);
  private readonly subscriptions: vscode.Disposable[];
  private worktrees: Worktree[] = [];

  constructor(git: GitAPI, private readonly store: WorkItemsStore, tracker: WorktreeTracker) {
    this.item.name = 'Main folder or worktree';
    this.subscriptions = [
      git.onDidOpenRepository(() => void this.load()),
      store.onDidChange(() => this.render()),
      tracker.onDidChange(() => this.render()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.worktrees.showInStatusBar`)) {
          this.render();
        }
      }),
    ];
    void this.load();
  }

  dispose(): void {
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Reads the worktrees once: the store only lists them after its first load from Azure DevOps */
  private async load(): Promise<void> {
    await this.store.whenRepositoryReady();
    const root = this.store.repository()?.rootUri.fsPath;
    try {
      this.worktrees = root ? await listWorktrees(root) : [];
    } catch {
      // Old git or not a repository: nothing to show
      this.worktrees = [];
    }
    this.render();
  }

  private render(): void {
    if (this.store.worktrees.length) {
      this.worktrees = this.store.worktrees;
    }
    const enabled = vscode.workspace.getConfiguration(SECTION).get<boolean>('worktrees.showInStatusBar', true);
    const info = enabled ? windowWorktree(this.worktrees, this.store.openFolders()) : undefined;
    if (!info) {
      this.item.hide();
      return;
    }
    const view = worktreeStatusBarView(info);
    this.item.text = view.text;
    this.item.backgroundColor = view.highlight ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.color = view.highlight ? new vscode.ThemeColor('statusBarItem.warningForeground') : undefined;
    this.item.command =
      info.kind === 'main'
        ? { command: `${WORKTREES_VIEW_ID}.focus`, title: 'Show the Worktrees view' }
        : {
            command: 'vscode.openFolder',
            title: 'Open the main folder',
            arguments: [vscode.Uri.file(info.main.path), { forceNewWindow: true }],
          };
    const tooltip = new vscode.MarkdownString();
    tooltip.appendMarkdown('**');
    tooltip.appendText(view.title);
    tooltip.appendMarkdown('**');
    for (const line of view.lines) {
      tooltip.appendMarkdown('  \n');
      tooltip.appendText(line);
    }
    this.item.tooltip = tooltip;
    this.item.show();
  }
}
