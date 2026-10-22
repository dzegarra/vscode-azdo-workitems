import * as vscode from 'vscode';
import { funEnabled, recordsScope } from './config';
import { markRecapOffered } from './funJournal';
import { FunJournalStore } from './funJournalStore';
import { escapeHtml } from './html';
import { TeamIteration } from './iterations';
import { isLastSprintDay } from './sprintCountdown';
import { renderRecapBody, sprintRecap } from './sprintRecap';
import { WorkItemsStore } from './workItemsStore';

export const SHOW_SPRINT_RECAP_COMMAND = 'totalflowx.showSprintRecap';

/**
 * The sprint wrap-up: one editor tab of static HTML (no scripts) built from the fun journal, and the offer to open it
 * on the last day of the sprint
 */
export class SprintRecapPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly store: WorkItemsStore,
    private readonly journal: FunJournalStore
  ) {
    this.subscriptions = [store.onDidLoad(() => void this.offerOnLastDay())];
  }

  dispose(): void {
    this.panel?.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Opens the recap of a current sprint; the user picks one when the teams are in different sprints */
  async show(path?: string): Promise<void> {
    await this.store.ensureLoaded();
    const iterations = this.store.iterations;
    const chosen =
      iterations.find(({ iteration }) => iteration.path === path) ??
      (iterations.length > 1
        ? (
            await vscode.window.showQuickPick(
              iterations.map((entry) => ({ label: entry.iteration.name, description: entry.teams.join(', '), entry })),
              { title: 'Sprint wrap-up of' }
            )
          )?.entry
        : iterations.at(0));
    if (!chosen) {
      if (!iterations.length) {
        void vscode.window.showWarningMessage('None of your teams has a current iteration.');
      }
      return;
    }
    this.render(chosen);
  }

  private render({ iteration }: TeamIteration): void {
    const scope = recordsScope(this.store.repository());
    if (!scope) {
      throw new Error('Unable to tell the Azure DevOps project of this repository.');
    }
    const recap = sprintRecap({
      sprint: {
        name: iteration.name,
        startDate: iteration.attributes?.startDate,
        finishDate: iteration.attributes?.finishDate,
      },
      journal: this.journal.journal(scope),
      workItems: this.store.entries
        .filter(({ workItem }) => workItem.iterationPath === iteration.path)
        .map(({ workItem }) => ({ type: workItem.type, state: workItem.state })),
    });
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel('totalflowx.sprintRecap', recap.title, vscode.ViewColumn.Active, {
        enableScripts: false,
        localResourceRoots: [media],
      });
      this.panel.onDidDispose(() => (this.panel = undefined));
    }
    const { webview } = this.panel;
    this.panel.title = recap.title;
    const style = webview.asWebviewUri(vscode.Uri.joinPath(media, 'recap.css'));
    webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style.toString()}" rel="stylesheet">
  <title>${escapeHtml(recap.title)}</title>
</head>
<body>${renderRecapBody(recap)}</body>
</html>`;
    this.panel.reveal();
  }

  // Rule FUN-RECAP-3
  /** On the last day of a sprint, offers its recap once (whichever window sees it first) */
  private async offerOnLastDay(): Promise<void> {
    const scope = recordsScope(this.store.repository());
    if (!scope || !funEnabled()) {
      return;
    }
    const now = new Date();
    for (const { iteration } of this.store.iterations) {
      if (!isLastSprintDay(iteration.attributes?.finishDate, now)) {
        continue;
      }
      const { before, after } = await this.journal.update(scope, (journal) =>
        markRecapOffered(journal, iteration.path)
      );
      if (before === after) {
        continue;
      }
      void vscode.window
        .showInformationMessage(`🎉 Last day of ${iteration.name}! Your sprint wrap-up is ready.`, 'Show')
        .then((picked) => picked && vscode.commands.executeCommand(SHOW_SPRINT_RECAP_COMMAND, iteration.path));
    }
  }
}
