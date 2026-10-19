import { withFeature } from './requestContext';
import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { resolveContext, SECTION } from './config';
import {
  CurrentWorkItemInfo,
  CurrentWorkItemView,
  describeCurrentWorkItem,
  Person,
  statusBarText,
} from './currentWorkItem';
import { GitAPI } from './git';
import { workItemIdFromBranch } from './naming';
import { canHaveTasks } from './html';
import { WorkItemsStore } from './workItemsStore';
import { REVEAL_WORK_ITEM_COMMAND } from './workItemsView';

const DEBOUNCE_MS = 300;
const SHOW_DETAILS_COMMAND = 'totalflowx.openDetails';

interface Resolved {
  branch: string;
  info: CurrentWorkItemInfo;
  view: CurrentWorkItemView;
}

function toPerson(value: unknown): Person | undefined {
  const person = value as Partial<Person> | undefined;
  return person?.displayName
    ? { id: person.id, displayName: person.displayName, uniqueName: person.uniqueName }
    : undefined;
}

/**
 * Work item of the checked out branch in the status bar. It can be a colleague's branch checked out to review it:
 * then the item is shown differently, with the person who created the branch. Nothing is shown when the branch
 * does not refer to a work item
 */
export class CurrentWorkItemStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'totalflowx.currentWorkItem',
    vscode.StatusBarAlignment.Left
  );
  private readonly subscriptions: vscode.Disposable[] = [];
  private debounce?: NodeJS.Timeout;
  /** Only the latest update may change the item: lookups can finish out of order */
  private sequence = 0;
  private lastBranch?: string;
  private myId?: Promise<string>;
  private resolved?: Resolved;

  constructor(private readonly git: GitAPI, private readonly store: WorkItemsStore) {
    this.item.name = 'Work item of the current branch';
    this.item.command = { command: SHOW_DETAILS_COMMAND, title: 'Open Work Item Details Panel', arguments: [] };
    const watch = (repository: GitAPI['repositories'][number]) => repository.state.onDidChange(() => this.schedule());
    this.subscriptions.push(
      ...git.repositories.map(watch),
      git.onDidOpenRepository((repository) => {
        this.subscriptions.push(watch(repository));
        this.schedule(true);
      }),
      // The state or assignee may have changed in Azure DevOps
      store.onDidLoad(() => this.schedule(true)),
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(`${SECTION}.statusBar.currentWorkItem`)) {
          this.schedule(true);
        } else if (event.affectsConfiguration(`${SECTION}.showInReviewState`) && this.resolved) {
          this.show(this.resolved);
        }
      })
    );
    this.schedule(true);
  }

  dispose(): void {
    clearTimeout(this.debounce);
    this.item.dispose();
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** Looks at the branch shortly after the last change: git reports many changes in a row */
  private schedule(force = false): void {
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.update(force), DEBOUNCE_MS);
  }

  private update(force: boolean): Promise<void> {
    return withFeature('statusBar', () => this.runUpdate(force));
  }

  private async runUpdate(force: boolean): Promise<void> {
    const enabled = vscode.workspace.getConfiguration(SECTION).get<boolean>('statusBar.currentWorkItem', true);
    const branch = this.store.repository()?.state.HEAD?.name;
    const id = branch ? workItemIdFromBranch(branch) : undefined;
    if (!enabled || !branch || id === undefined) {
      this.sequence++;
      this.lastBranch = undefined;
      this.resolved = undefined;
      this.item.hide();
      return;
    }
    if (!force && branch === this.lastBranch) {
      return;
    }
    this.lastBranch = branch;
    const sequence = ++this.sequence;
    try {
      const resolved = await this.resolve(branch, id);
      if (sequence !== this.sequence) {
        return;
      }
      this.resolved = resolved;
      this.show(resolved);
    } catch {
      // Not found (e.g. the number in the branch name is not a work item) or no connection: nothing to show
      if (sequence === this.sequence) {
        this.resolved = undefined;
        this.item.hide();
      }
    }
  }

  private async resolve(branch: string, id: number): Promise<Resolved> {
    await this.store.whenRepositoryReady();
    const { client, repositoryName } = resolveContext(this.store.repository());
    this.myId ??= client.getMyId();
    const me: Person = { id: await this.myId, displayName: 'you' };
    // The user's own work items are already loaded; others (a colleague's branch) are fetched
    const workItem = this.store.find(id)?.workItem ?? (await client.getWorkItems([id])).at(0);
    if (!workItem) {
      throw new Error(`Work item ${id} not found`);
    }
    const info: CurrentWorkItemInfo = {
      id,
      title: workItem.title,
      type: workItem.type,
      state: workItem.state,
      assignedTo: toPerson(workItem.fields['System.AssignedTo']),
    };
    const creator = await this.branchCreator(client, repositoryName, branch);
    return { branch, info, view: describeCurrentWorkItem(info, me, creator) };
  }

  /** Who created the branch in Azure DevOps; unknown when it was not pushed yet */
  private async branchCreator(client: AzdoClient, repositoryName: string, branch: string): Promise<Person | undefined> {
    try {
      const { id } = await client.getRepository(repositoryName);
      return toPerson((await client.getBranchInfo(id, branch))?.creator);
    } catch {
      return undefined;
    }
  }

  private show({ branch, info, view }: Resolved): void {
    this.item.text = `${view.isMine ? '$(git-branch)' : '$(eye)'} ${statusBarText(info, view)}`;
    this.item.command = { command: SHOW_DETAILS_COMMAND, title: 'Open Work Item Details Panel', arguments: [info.id] };

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown(
      `**${info.type} ${info.id}** · ${view.isMine ? 'assigned to you' : 'not assigned to you'}\n\n`
    );
    tooltip.appendText(info.title);
    tooltip.appendMarkdown(`\n\nState: **${this.store.displayStateOf(info.id) ?? info.state}**  \nAssigned to: `);
    tooltip.appendText(view.assignee);
    if (view.branchOwner) {
      tooltip.appendMarkdown('  \nBranch owner: ');
      tooltip.appendText(view.branchOwner);
    }
    tooltip.appendMarkdown('  \nBranch: ');
    tooltip.appendText(branch);
    tooltip.appendMarkdown('\n\n_Click to open the Work Item Details panel_');
    // Only the work items listed in the sidebar can be shown there
    const listed = this.store.find(info.id);
    if (listed && canHaveTasks(listed.workItem.type)) {
      const args = encodeURIComponent(JSON.stringify([info.id]));
      tooltip.appendMarkdown(
        `  \n[Show in sidebar](command:${REVEAL_WORK_ITEM_COMMAND}?${args} "Show it in the work items list")`
      );
      // Trusted for this command only
      tooltip.isTrusted = { enabledCommands: [REVEAL_WORK_ITEM_COMMAND] };
    }
    this.item.tooltip = tooltip;
    this.item.show();
  }
}
