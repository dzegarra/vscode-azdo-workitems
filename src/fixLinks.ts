/**
 * "Fixed by" links: a Bug that is really a missing feature is fixed by a Backlog Item, modelled in Azure DevOps as
 * the Backlog Item being a predecessor of the Bug. Pure, so no "vscode" import
 */
import { stateCategory, type StateCategory } from './states';

/** Types that fix bugs (fixed list, like the alert rules) */
export const FIXING_TYPES = ['Product Backlog Item', 'User Story'];
export const BUG_TYPE = 'Bug';

export interface FixLink {
  id: number;
  title: string;
  state: string;
  stateCategory: StateCategory;
}

interface LinkedItem {
  id: number;
  title: string;
  type: string;
  state: string;
}

export interface FixLinks {
  /** Backlog Items / User Stories only: the bugs they fix (their successors of type Bug) */
  fixesBugs?: FixLink[];
  /** Bugs only: the Backlog Items that fix them (their predecessors of type Product Backlog Item / User Story) */
  fixedBy?: FixLink[];
}

function toFixLink({ id, title, state }: LinkedItem): FixLink {
  return { id, title, state, stateCategory: stateCategory(state) };
}

/**
 * Fix links of a work item. Undefined fields: not applicable to the type, or the related work items could not
 * be loaded (undefined lists), so the cards say nothing
 */
export function fixLinks(
  item: { type: string },
  predecessors: LinkedItem[] | undefined,
  successors: LinkedItem[] | undefined
): FixLinks {
  if (FIXING_TYPES.includes(item.type)) {
    return { fixesBugs: successors?.filter(({ type }) => type === BUG_TYPE).map(toFixLink) };
  }
  if (item.type === BUG_TYPE) {
    return { fixedBy: predecessors?.filter(({ type }) => FIXING_TYPES.includes(type)).map(toFixLink) };
  }
  return {};
}

/** "Fixes 2 bugs" / "Fixes 1 bug" */
export function fixesBugsText(count: number): string {
  return `Fixes ${count} ${count === 1 ? 'bug' : 'bugs'}`;
}

/** Tooltip lines: "#66301 New · title" */
export function fixLinksTooltip(heading: string, links: FixLink[]): string {
  return [heading, ...links.map((link) => `#${link.id} ${link.state} · ${link.title}`)].join('\n');
}

/**
 * Label of a predecessor / successor in the details of a work item when the pair is a bug and the Backlog Item that
 * fixes it; undefined for any other pair
 */
export function fixRelationLabel(
  item: { type: string },
  related: { type: string },
  direction: 'predecessor' | 'successor'
): { text: string; tone: 'backlog' | 'bug' } | undefined {
  if (direction === 'predecessor' && item.type === BUG_TYPE && FIXING_TYPES.includes(related.type)) {
    return { text: 'fixes this bug', tone: 'backlog' };
  }
  if (direction === 'successor' && FIXING_TYPES.includes(item.type) && related.type === BUG_TYPE) {
    return { text: 'fixed by this backlog item', tone: 'bug' };
  }
  return undefined;
}
