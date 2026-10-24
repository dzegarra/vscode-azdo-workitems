/** Work item of the checked out branch, as shown in the status bar. Pure, so no "vscode" import */

export interface Person {
  id?: string;
  displayName: string;
  uniqueName?: string;
}

export interface CurrentWorkItemInfo {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo?: Person;
}

export function isSamePerson(a: Person | undefined, b: Person | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  if (a.id && b.id) {
    return a.id === b.id;
  }
  return !!a.uniqueName && a.uniqueName.toLowerCase() === b.uniqueName?.toLowerCase();
}

export function shortTitle(title: string, maxLength: number): string {
  const flat = title.replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1).trimEnd()}…` : flat;
}

export interface CurrentWorkItemView {
  /** Assigned to the user. Otherwise, e.g. the branch of a colleague checked out to review it */
  isMine: boolean;
  /** Who the work item is assigned to: "you", a name or "nobody" */
  assignee: string;
  /** Who created the branch: "you", a name, or undefined when it is not known (e.g. not pushed yet) */
  branchOwner?: string;
  /** Who to name next to a work item of someone else: the branch owner, or else the assignee */
  ownerLabel: string;
}

/**
 * How the work item of the current branch is presented. The user is "me" when the work item is assigned to them;
 * the branch owner is the person who created the branch in Azure DevOps
 */
export function describeCurrentWorkItem(
  info: CurrentWorkItemInfo,
  me: Person,
  branchCreator: Person | undefined
): CurrentWorkItemView {
  const name = (person: Person | undefined, fallback?: string) =>
    isSamePerson(person, me) ? 'you' : person?.displayName ?? fallback;
  const isMine = isSamePerson(info.assignedTo, me);
  const assignee = name(info.assignedTo, 'nobody') ?? 'nobody';
  const branchOwner = name(branchCreator);
  return { isMine, assignee, branchOwner, ownerLabel: branchOwner ?? assignee };
}

const MAX_TITLE_LENGTH = 40;

/** What the status bar item shows after the icon: the ID alone (default, it takes little space) or with the title */
export type StatusBarLabel = 'id' | 'idAndTitle';

export function statusBarLabel(value: unknown): StatusBarLabel {
  return value === 'idAndTitle' ? 'idAndTitle' : 'id';
}

/** Codicon of the work item type, like the icons of the sidebar (book, bug, task) */
const TYPE_CODICONS: Partial<Record<string, string>> = {
  Bug: 'bug',
  'Product Backlog Item': 'book',
  'User Story': 'book',
  Task: 'tasklist',
  Feature: 'trophy',
  Epic: 'crown',
};

/** Contributed colours (package.json) of the text by type, like the type colours of the sidebar */
const TYPE_COLORS: Partial<Record<string, string>> = {
  Bug: 'totalflowx.workItemType.bugForeground',
  'Product Backlog Item': 'totalflowx.workItemType.backlogForeground',
  'User Story': 'totalflowx.workItemType.backlogForeground',
  Task: 'totalflowx.workItemType.taskForeground',
  Feature: 'totalflowx.workItemType.featureForeground',
};

export function statusBarTypeIcon(type: string): string {
  return `$(${TYPE_CODICONS[type] ?? 'issues'})`;
}

/** Theme colour id of the item, undefined (default text colour) for other types */
export function statusBarTypeColor(type: string): string | undefined {
  return TYPE_COLORS[type];
}

/**
 * Text of the status bar item: the eye for work items of other people, the icon of the type, the ID, the title
 * when asked, and whose the work item is when it is not the user's
 */
export function statusBarText(info: CurrentWorkItemInfo, view: CurrentWorkItemView, label: StatusBarLabel): string {
  const title = label === 'idAndTitle' ? ` ${shortTitle(info.title, MAX_TITLE_LENGTH)}` : '';
  const base = `${statusBarTypeIcon(info.type)} ${info.id}${title}`;
  return view.isMine ? base : `$(eye) ${base} · ${view.ownerLabel}`;
}
