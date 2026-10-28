import * as vscode from 'vscode';

export const CHANNEL_NAME = 'Totalflow X';

let channel: vscode.OutputChannel | undefined;

/** The "Totalflow X" output channel, shared by the request log and the error log. Created on first use */
export function outputChannel(): vscode.OutputChannel {
  return (channel ??= vscode.window.createOutputChannel(CHANNEL_NAME));
}

export function disposeOutputChannel(): void {
  channel?.dispose();
  channel = undefined;
}

/**
 * Writes the full error (message and stack) to the output channel, always, and shows its message in a notification
 * with a button that opens the channel: a long git output is cut in the notification
 */
export function reportError(error: unknown, context?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const log = outputChannel();
  log.appendLine(`[${new Date().toISOString()}] ERROR${context ? ` (${context})` : ''}: ${err.message}`);
  if (err.stack) {
    log.appendLine(err.stack);
  }
  void vscode.window.showErrorMessage(err.message, 'Show Output').then((choice) => {
    if (choice) {
      log.show(true);
    }
  });
}
