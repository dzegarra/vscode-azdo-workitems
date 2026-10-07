import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { takeSetupMarker } from './worktreeGit';

/**
 * A worktree created by the extension carries a marker (in its private git directory) asking for `npm ci`: the
 * window that opens it deletes the marker, so it runs once, and installs the dependencies in a visible terminal.
 * Does nothing in any other folder; never throws
 */
export async function runPendingWorktreeSetup(): Promise<void> {
  try {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!folder || folder.scheme !== 'file') {
      return;
    }
    const marker = await takeSetupMarker(folder.fsPath);
    if (!marker?.npmCi || !existsSync(join(folder.fsPath, 'package-lock.json'))) {
      return;
    }
    const terminal = vscode.window.createTerminal({ name: 'Worktree setup', cwd: folder.fsPath });
    terminal.show();
    terminal.sendText('npm ci');
  } catch {
    // The setup is a convenience: the worktree is usable without it
  }
}
