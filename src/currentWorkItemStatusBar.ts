import { withFeature } from './requestContext';
import * as vscode from 'vscode';
import { STATUS_BAR_PRIORITY } from './statusBarOrder';
import { AzdoClient, WorkItem } from './azdoClient';
import { resolveContext, SECTION } from './config';
import {
  BranchWorkItem,
  branchPickItems,
  branchStatusBarText,
  branchWorkItemIds,
  dropTasksOfLinkedParents,
  iterationDescription,
  normalizeMaxItems,
  orderBranchWorkItems,
} from './branchWorkItems';
import {
  describeCurrentWorkItem,
  Person,
  statusBarLabel,
  statusBarTypeColor,
  statusBarTypeIcon,
} from './currentWorkItem';
import { GitAPI } from './git';
import { workItemIdFromBranch } from './naming';
import { canHaveTasks } from './html';
import { WorkItemsStore } from './workItemsStore';
import { REVEAL_WORK_ITEM_COMMAND } from './workItemsView';

const DEBOUNCE_MS = 300;
const SHOW_DETAILS_COMMAND = 'totalflowx.openDetails';
/** Click on the item: opens the work item, or a picker when the branch has several */
export const PICK_BRANCH_WORK_ITEM_COMMAND = 'totalflowx.openBranchWorkItems';
/** Work items of a colleague's branch (fetched) are kept this long before asking again */
const REMOTE_CACHE_MS = 5 * 60_000;

interface Resolved {
  branch: string;
  /** The work item named in the branch, if any */
  namedId?: number;
  /** In no particular order: show() orders them with the schedule at that moment */
  items: BranchWorkItem[];
}

interface RemoteItems {
  at: number;
  workItems: WorkItem[];
}

function toPerson(value: unknown): Person | undefined {
  const person = value as Partial<Person> | undefined;
  return person?.displayName
    ? { id: person.id, displayName: person.displayName, uniqueName: person.uniqueName }
    : undefined;
}

/**
 * Work items of the checked out branch in the status bar (Rules STATUSBAR-WI-*), closest iteration first. The branch can
 * be a colleague's, checked out to review it: then the items are shown differently, with the person who created the
 * branch. Nothing is shown when the branch has no work item
 */
export class CurrentWorkItemStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(
    'totalflowx.currentWorkItem',
    vscode.StatusBarAlignment.Left,
    STATUS_BAR_PRIORITY.workItem
  );
  private readonly subscriptions: vscode.Disposable[] = [];
  private debounce?: NodeJS.Timeout;
  /** Only the latest update may change the item: lookups can finish out of order */
  private sequence = 0;
  private lastBranch?: string;
  private myId?: Promise<string>;
  private resolved?: Resolved;
  /** Work items that are not in the store, by branch: a git event must not fetch them again */
  private readonly remote = new Map<string, RemoteItems>();

  constructor(private readonly git: GitAPI, private readonly store: WorkItemsStore) {
    this.item.name = 'Work items of the current branch';
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
        if (event.affectsConfiguration(`${SECTION}.workingOn.showInStatusBar`)) {
          this.schedule(true);
        } else if (
          (event.affectsConfiguration(`${SECTION}.workItems.showInReviewState`) ||
            event.affectsConfiguration(`${SECTION}.workingOn.statusBarLabel`) ||
            event.affectsConfiguration(`${SECTION}.workingOn.statusBarMaxItems`)) &&
          this.resolved
        ) {
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

  /** Rule STATUSBAR-WI-5: click with several work items, a picker in the order of the item; opens the picked one */
  async pick(): Promise<void> {
    const resolved = this.resolved;
    if (!resolved) {
      return;
    }
    const { items, schedule, today } = this.ordered(resolved);
    const picked = await vscode.window.showQuickPick(branchPickItems(items, schedule, today), {
      title: `Work items of ${resolved.branch}`,
      placeHolder: 'Open the Work Item Details panel of…',
    });
    if (picked) {
      await vscode.commands.executeCommand(SHOW_DETAILS_COMMAND, picked.id);
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
    const enabled = vscode.workspace.getConfiguration(SECTION).get<boolean>('workingOn.showInStatusBar', true);
    const branch = this.store.repository()?.state.HEAD?.name;
    if (!enabled || !branch) {
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
      const resolved = await this.resolve(branch);
      if (sequence !== this.sequence) {
        return;
      }
      this.resolved = resolved;
      this.show(resolved);
    } catch {
      // Not found (e.g. the number in the branch name is not a work item), no work item linked or no connection
      if (sequence === this.sequence) {
        this.resolved = undefined;
        this.item.hide();
      }
    }
  }

  private async resolve(branch: string): Promise<Resolved> {
    await this.store.whenRepositoryReady();
    const { client, repositoryName } = resolveContext(this.store.repository());
    const namedId = workItemIdFromBranch(branch);
    // Rule STATUSBAR-WI-1: the work items of the list come from the store, the others (a colleague's branch) are fetched
    const ids = branchWorkItemIds(branch, this.store.entries, namedId);
    if (!ids.length) {
      throw new Error(`No work item for ${branch}`);
    }
    const workItems = new Map<number, WorkItem>();
    for (const id of ids) {
      const listed = this.store.find(id)?.workItem;
      if (listed) {
        workItems.set(id, listed);
      }
    }
    if (namedId !== undefined && !workItems.has(namedId)) {
      for (const workItem of await this.remoteWorkItems(client, repositoryName, branch, namedId)) {
        if (!workItems.has(workItem.id)) {
          workItems.set(workItem.id, workItem);
        }
      }
    }
    if (!workItems.size) {
      throw new Error(`Work items of ${branch} not found`);
    }
    this.myId ??= client.getMyId();
    const me: Person = { id: await this.myId, displayName: 'you' };
    const creator = await this.branchCreator(client, repositoryName, branch);
    const items = [...workItems.values()].map((workItem): BranchWorkItem => {
      const info = {
        id: workItem.id,
        title: workItem.title,
        type: workItem.type,
        state: workItem.state,
        assignedTo: toPerson(workItem.fields['System.AssignedTo']),
      };
      return {
        ...info,
        iterationPath: workItem.iterationPath,
        parentId: workItem.links.parentId,
        view: describeCurrentWorkItem(info, me, creator),
      };
    });
    return { branch, namedId, items };
  }

  /**
   * The named work item and the ones linked to the active PR from the branch, none of them in the list (a colleague's
   * branch). Kept per branch for a few minutes: 1 request for the work item, plus 3 for the PR's, once
   */
  private async remoteWorkItems(
    client: AzdoClient,
    repositoryName: string,
    branch: string,
    namedId: number
  ): Promise<WorkItem[]> {
    const cached = this.remote.get(branch);
    if (cached && Date.now() - cached.at < REMOTE_CACHE_MS) {
      return cached.workItems;
    }
    const workItems = await client.getWorkItems([namedId]);
    if (!workItems.length) {
      throw new Error(`Work item ${namedId} not found`);
    }
    try {
      const { id: repositoryId } = await client.getRepository(repositoryName);
      const pullRequestId = await client.findActivePullRequestId(repositoryId, branch);
      const linked =
        pullRequestId === undefined ? [] : await client.getPullRequestWorkItemIds(repositoryId, pullRequestId);
      const missing = linked.filter((id) => id !== namedId && !this.store.find(id));
      workItems.push(...(await client.getWorkItems(missing)));
    } catch {
      // The PR is a bonus: the named work item is enough
    }
    this.remote.set(branch, { at: Date.now(), workItems });
    return workItems;
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

  private ordered({ items, namedId }: Resolved) {
    const schedule = this.store.iterationSchedule;
    const today = new Date();
    return { items: orderBranchWorkItems(dropTasksOfLinkedParents(items), namedId, schedule, today), schedule, today };
  }

  private show(resolved: Resolved): void {
    const { branch } = resolved;
    const { items, schedule, today } = this.ordered(resolved);
    const [first] = items;
    const configuration = vscode.workspace.getConfiguration(SECTION);
    const label = statusBarLabel(configuration.get('workingOn.statusBarLabel'));
    const max = normalizeMaxItems(configuration.get('workingOn.statusBarMaxItems'));
    this.item.text = branchStatusBarText(items, label, max);
    // One colour only for the whole item: the one of the type of the first work item
    const color = statusBarTypeColor(first.type);
    this.item.color = color && new vscode.ThemeColor(color);
    this.item.command =
      items.length === 1
        ? { command: SHOW_DETAILS_COMMAND, title: 'Open Work Item Details Panel', arguments: [first.id] }
        : { command: PICK_BRANCH_WORK_ITEM_COMMAND, title: 'Open a Work Item Details Panel', arguments: [] };

    const tooltip = new vscode.MarkdownString(undefined, true);
    tooltip.appendMarkdown('**Branch** ');
    tooltip.appendText(branch);
    tooltip.appendMarkdown(` · ${items.length} work item${items.length === 1 ? '' : 's'}`);
    const branchOwner = items.at(0)?.view.branchOwner;
    if (branchOwner) {
      tooltip.appendMarkdown('  \nBranch owner: ');
      tooltip.appendText(branchOwner);
    }
    for (const info of items) {
      const { view } = info;
      tooltip.appendMarkdown('\n\n---\n\n');
      tooltip.appendMarkdown(
        `${statusBarTypeIcon(info.type)} **${info.type} ${info.id}** · ${
          view.isMine ? 'assigned to you' : 'not assigned to you'
        }\n\n`
      );
      tooltip.appendText(info.title);
      tooltip.appendMarkdown(`\n\nState: **${this.store.displayStateOf(info.id) ?? info.state}**`);
      const iteration = iterationDescription(info.iterationPath, schedule, today);
      if (iteration) {
        tooltip.appendMarkdown('  \nIteration: ');
        tooltip.appendText(iteration);
      }
      if (!view.isMine) {
        tooltip.appendMarkdown('  \nAssigned to: ');
        tooltip.appendText(view.assignee);
      }
    }
    tooltip.appendMarkdown(
      `\n\n_Click to ${items.length === 1 ? 'open the Work Item Details panel' : 'pick a work item to open'}_`
    );
    // Only the work items listed in the sidebar can be shown there: the first one that is
    const shown = items.find((info) => {
      const listed = this.store.find(info.id);
      return listed && canHaveTasks(listed.workItem.type);
    });
    if (shown) {
      const args = encodeURIComponent(JSON.stringify([shown.id]));
      tooltip.appendMarkdown(
        `  \n[Show ${shown.id} in sidebar](command:${REVEAL_WORK_ITEM_COMMAND}?${args} "Show it in the work items list")`
      );
      // Trusted for this command only
      tooltip.isTrusted = { enabledCommands: [REVEAL_WORK_ITEM_COMMAND] };
    }
    this.item.tooltip = tooltip;
    this.item.show();
  }
}
