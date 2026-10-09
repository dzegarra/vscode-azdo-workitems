import * as vscode from 'vscode';
import { SECTION } from './config';
import { requestStats, setRequestLogWriter } from './requestRecorder';
import { buildUsageReport } from './usageReport';

const LOG_SETTING = 'diagnostics.logRequests';
const CHANNEL_NAME = 'Totalflow X';
const USAGE_SCHEME = 'totalflowx-usage';
const USAGE_URI = vscode.Uri.from({ scheme: USAGE_SCHEME, path: '/Azure DevOps usage.md' });

function logEnabled(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>(LOG_SETTING, false);
}

/** Request log (output channel) and usage report. Nothing is created or written while the log is off */
export function registerDiagnostics(): vscode.Disposable[] {
  let channel: vscode.OutputChannel | undefined;
  const getChannel = () => (channel ??= vscode.window.createOutputChannel(CHANNEL_NAME));
  const applySetting = () => setRequestLogWriter(logEnabled() ? (line) => getChannel().appendLine(line) : undefined);
  applySetting();

  const changed = new vscode.EventEmitter<vscode.Uri>();
  const provider = vscode.workspace.registerTextDocumentContentProvider(USAGE_SCHEME, {
    onDidChange: changed.event,
    provideTextDocumentContent: () => buildUsageReport(requestStats.snapshot()),
  });

  return [
    changed,
    provider,
    { dispose: () => channel?.dispose() },
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.${LOG_SETTING}`)) {
        applySetting();
      }
    }),
    vscode.commands.registerCommand('totalflowx.showRequestLog', () => {
      getChannel().show(true);
      if (!logEnabled()) {
        void vscode.window
          .showInformationMessage(
            `Requests are not being logged. Turn on the setting ${SECTION}.${LOG_SETTING} to log them.`,
            'Open Setting'
          )
          .then((choice) => {
            if (choice) {
              void vscode.commands.executeCommand('workbench.action.openSettings', `${SECTION}.${LOG_SETTING}`);
            }
          });
      }
    }),
    vscode.commands.registerCommand('totalflowx.showUsage', async () => {
      // The preview follows the document: firing the change refreshes it when it is already open
      changed.fire(USAGE_URI);
      await vscode.commands.executeCommand('markdown.showPreview', USAGE_URI);
    }),
  ];
}
