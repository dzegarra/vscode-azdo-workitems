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

/** Text of the status bar item, without the icon. Work items of other people say whose they are */
export function statusBarText(info: CurrentWorkItemInfo, view: CurrentWorkItemView): string {
  const base = `${info.id} ${shortTitle(info.title, MAX_TITLE_LENGTH)}`;
  return view.isMine ? base : `${base} · ${view.ownerLabel}`;
}
