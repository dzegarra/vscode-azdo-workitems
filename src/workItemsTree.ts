import * as vscode from 'vscode';
import { WorkItem } from './azdoClient';
import { resolveContext, settings } from './config';
import { GitAPI, pickRepository, REF_TYPE_HEAD } from './git';
import { TeamIteration } from './iterations';
import { branchBelongsToWorkItem } from './naming';

export interface WorkItemNode {
  kind: 'workItem';
  workItem: WorkItem;
  branch?: string;
}

interface GroupNode {
  kind: 'group';
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  items: WorkItemNode[];
}

type Node = GroupNode | WorkItemNode;

const TYPE_ICONS: Partial<Record<string, vscode.ThemeIcon>> = {
  Bug: new vscode.ThemeIcon('bug', new vscode.ThemeColor('charts.red')),
  'Product Backlog Item': new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.blue')),
  'User Story': new vscode.ThemeIcon('book', new vscode.ThemeColor('charts.blue')),
  Task: new vscode.ThemeIcon('tasklist', new vscode.ThemeColor('charts.yellow')),
  Feature: new vscode.ThemeIcon('trophy', new vscode.ThemeColor('charts.purple')),
};

function groupBy(nodes: WorkItemNode[], key: (node: WorkItemNode) => string): Map<string, WorkItemNode[]> {
  const groups = new Map<string, WorkItemNode[]>();
  for (const node of nodes) {
    groups.set(key(node), [...(groups.get(key(node)) ?? []), node]);
  }
  return groups;
}

export class WorkItemsTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private nodes: WorkItemNode[] = [];
  private loading?: Promise<void>;
  /** Current iterations of the listed teams */
  iterations: TeamIteration[] = [];

  constructor(private readonly git: GitAPI) {}

  get workItems(): WorkItemNode[] {
    return this.nodes;
  }

  refresh(): void {
    this.loading = undefined;
    this.changeEmitter.fire();
  }

  private async load(): Promise<void> {
    const repository = this.git.repositories.length ? pickRepository(this.git) : undefined;
    const { client } = resolveContext(repository);
    const s = settings();
    const loadWorkItems = async () => {
      const teams = await client.resolveTeams(s.teams);
      this.iterations = await client.getCurrentIterations(teams);
      return client.getMyWorkItems(
        this.iterations.map(({ iteration }) => iteration.path),
        s.excludedStates
      );
    };
    const [workItems, localBranches] = await Promise.all([
      loadWorkItems(),
      repository?.getBranches({ remote: false }) ?? Promise.resolve([]),
    ]);
    const branchNames = localBranches
      .filter((ref) => ref.type === REF_TYPE_HEAD && ref.name)
      .map((ref) => ref.name as string);
    this.nodes = workItems.map((workItem) => ({
      kind: 'workItem',
      workItem,
      branch: branchNames.find((name) => branchBelongsToWorkItem(name, workItem.id)),
    }));
  }

  /** One group per iteration when the teams are in different sprints, otherwise one group per state */
  private groups(): GroupNode[] {
    if (this.iterations.length > 1) {
      const byIteration = groupBy(this.nodes, (node) => node.workItem.iterationPath);
      return this.iterations
        .filter(({ iteration }) => byIteration.has(iteration.path))
        .map(({ iteration, teams }) => ({
          kind: 'group',
          id: `iteration:${iteration.path}`,
          label: iteration.name,
          description: teams.join(', '),
          tooltip: `${iteration.path}\n\nTeams: ${teams.join(', ')}`,
          items: byIteration.get(iteration.path) ?? [],
        }));
    }
    return [...groupBy(this.nodes, (node) => node.workItem.state)].map(([state, items]) => ({
      kind: 'group',
      id: `state:${state}`,
      label: state,
      items,
    }));
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (element?.kind === 'group') {
      return element.items;
    }
    if (element) {
      return [];
    }
    try {
      this.loading ??= this.load();
      await this.loading;
    } catch (error) {
      this.loading = undefined;
      this.nodes = [];
      void vscode.window.showErrorMessage(`Unable to load work items: ${(error as Error).message}`);
      return [];
    }
    return this.groups();
  }

  getTreeItem(element: Node): vscode.TreeItem {
    if (element.kind === 'group') {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = element.id;
      item.description = [String(element.items.length), element.description].filter(Boolean).join(' · ');
      item.tooltip = element.tooltip;
      item.contextValue = 'group';
      return item;
    }
    const { workItem, branch } = element;
    const item = new vscode.TreeItem(`${workItem.id} ${workItem.title}`, vscode.TreeItemCollapsibleState.None);
    item.id = String(workItem.id);
    item.iconPath = TYPE_ICONS[workItem.type] ?? new vscode.ThemeIcon('note');
    // Grouped by iteration, the state is no longer visible in the group
    item.description = branch ?? (this.iterations.length > 1 ? workItem.state : workItem.type);
    item.contextValue = branch ? 'workItem.withBranch' : 'workItem';
    item.tooltip = new vscode.MarkdownString(
      [
        `**${workItem.type} ${workItem.id}**: ${workItem.title}`,
        `State: ${workItem.state}`,
        `Iteration: ${workItem.iterationPath}`,
        ...(branch ? [`Branch: \`${branch}\``] : []),
        `[Open in Azure DevOps](${workItem.url})`,
      ].join('\n\n'),
      true
    );
    return item;
  }
}
