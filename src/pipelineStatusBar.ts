import * as vscode from 'vscode';
import {
  BRANCH_SECTION,
  ciRunGroups,
  ciTooltipParts,
  CiRunGroup,
  CURRENT_BRANCH_LABEL,
  currentBranchState,
  MERGE_SECTION,
} from './ciTooltip';
import { SECTION } from './config';
import { GitAPI } from './git';
import { ciItemColors, ciStatusText, countRunStates, STATE_ICONS } from './pipelines';
import { runLabel, testsUrl } from './runDetails';
import { WorkItemsStore } from './workItemsStore';

export const SHOW_RUNS_COMMAND = 'totalflowx.showPipelineRuns';

interface RunPick extends vscode.QuickPickItem {
  url?: string;
}

function groupLabel(group: CiRunGroup): string {
  switch (group.kind) {
    case 'pullRequest':
      return `PR ${String(group.pullRequestId)}${group.current ? ` · ${CURRENT_BRANCH_LABEL}` : ''}`;
    case 'merge':
      return `PR ${String(group.pullRequestId)} merged into ${group.targetBranch}`;
    case 'branch':
      return `${group.branch}${group.current ? ` · ${CURRENT_BRANCH_LABEL}` : ''}`;
  }
}

/** Picker entries: a separator per group (under the title of its section), then its runs */
function pickItems(groups: CiRunGroup[], now: Date): RunPick[] {
  return groups.flatMap((group) => {
    const section = { merge: MERGE_SECTION, branch: BRANCH_SECTION, pullRequest: undefined }[group.kind];
    const title = group.kind === 'branch' ? undefined : group.title;
    return [
      {
        label: section ? `${section} · ${groupLabel(group)}` : groupLabel(group),
        kind: vscode.QuickPickItemKind.Separator,
      },
      ...group.runs.map((run) => {
        const label = runLabel(run, now);
        return {
          label: `${STATE_ICONS[run.state]} ${run.pipeline} · ${label.text}`,
          detail: title,
          url: label.opensTests ? testsUrl(run.url) : run.url,
        };
      }),
    ];
  });
}

/**
 * CI runs of the user's pull requests, of their merges and queued by hand, in the status bar, visible even when the
 * sidebar is closed. Updated with the store (every few seconds while a run is queued or running) and on checkout
 */
export class PipelineStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('totalflowx.pipelines', vscode.StatusBarAlignment.Left);
  private readonly subscriptions: vscode.Disposable[];
  private lastBranch?: string;

  constructor(git: GitAPI, private readonly store: WorkItemsStore) {
    this.item.name = 'CI runs';
    this.item.command = SHOW_RUNS_COMMAND;
    // The PR of the checked out branch is highlighted: render again when it changes
    const watch = (repository: GitAPI['repositories'][number]) =>
      repository.state.onDidChange(() => {
        if (this.currentBranch() !== this.lastBranch) {
          this.update();
        }
      });
    this.subscriptions = [
      ...git.repositories.map(watch),
      git.onDidOpenRepository((repository) => this.subscriptions.push(watch(repository))),
      store.onDidChange(() => this.update()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.pipelines.showInStatusBar`)) {
          this.update();
        }
      }),
      vscode.commands.registerCommand(SHOW_RUNS_COMMAND, () => this.pick()),
    ];
  }

  dispose(): void {
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  private currentBranch(): string | undefined {
    return this.store.repository()?.state.HEAD?.name;
  }

  private groups(): CiRunGroup[] {
    return ciRunGroups({
      pullRequestRuns: this.store.pullRequestRuns,
      mergeRuns: this.store.mergeRuns,
      branchRuns: this.store.branchRuns,
      currentBranch: this.currentBranch(),
    });
  }

  private update(): void {
    this.lastBranch = this.currentBranch();
    const enabled = vscode.workspace.getConfiguration(SECTION).get<boolean>('pipelines.showInStatusBar', true);
    const groups = this.groups();
    if (!enabled || !groups.length) {
      this.item.hide();
      return;
    }
    const counts = countRunStates(groups.flatMap((group) => group.runs.map((run) => run.state)));
    this.item.text = ciStatusText(counts);
    const colors = ciItemColors(currentBranchState(groups));
    this.item.backgroundColor = colors.background && new vscode.ThemeColor(colors.background);
    this.item.color = colors.foreground && new vscode.ThemeColor(colors.foreground);

    const tooltip = new vscode.MarkdownString(undefined, true);
    for (const part of ciTooltipParts(groups, counts, new Date())) {
      if (part.kind === 'md') {
        tooltip.appendMarkdown(part.value);
      } else {
        tooltip.appendText(part.value);
      }
    }
    this.item.tooltip = tooltip;
    this.item.show();
  }

  /** Lists the runs by PR, merge and branch; the selected one opens in Azure DevOps */
  private async pick(): Promise<void> {
    const picked = await vscode.window.showQuickPick(pickItems(this.groups(), new Date()), {
      title: 'CI runs',
      placeHolder: 'Select a run to open it in Azure DevOps',
      matchOnDetail: true,
    });
    if (picked?.url) {
      await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    }
  }
}
