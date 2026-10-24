import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { takeSetupMarker } from './worktreeGit';
import { detailsToOpen } from './worktrees';

/**
 * A worktree created by the extension carries a marker (in its private git directory) asking for `npm ci`: the
 * window that opens it deletes the marker, so it runs once, and installs the dependencies in a visible terminal.
 * The marker may also name work items whose Work Item Details panel to open (a review): returned, since the
 * panels can only open once the extension is ready. Does nothing in any other folder; never throws
 */
export async function runPendingWorktreeSetup(): Promise<number[]> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder || folder.scheme !== 'file') {
      return [];
    }
    const marker = await takeSetupMarker(folder.fsPath);
    if (marker?.npmCi && existsSync(join(folder.fsPath, 'package-lock.json'))) {
      const terminal = vscode.window.createTerminal({ name: 'Worktree setup', cwd: folder.fsPath });
      terminal.show();
      terminal.sendText('npm ci');
    }
    return detailsToOpen(marker, new Date());
  } catch {
    // The setup is a convenience: the worktree is usable without it
    return [];
  }
}
