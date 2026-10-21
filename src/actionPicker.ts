/**
 * The native picker of the actions menus (task pill, branch rows, Checkout ... buttons): sections as plain picker
 * entries, and the validation of what a chosen entry may do. Pure, so no "vscode" import: src/actionPickerUi.ts only
 * converts the entries to QuickPickItems
 */
import { actionMenuIcon, type ActionMenuAction, type ActionMenuTone } from './actionMenu';
import type { CheckoutKind, WebviewMessage } from './viewModel';

export type PickerEntry =
  | { kind: 'separator'; label: string }
  | {
      kind: 'item';
      label: string;
      description?: string;
      /** Codicon name, without `$(` `)` */
      iconId: string;
      /** Theme colour of the icon (a `ThemeColor` id) */
      colorId: string;
      danger: boolean;
      /** The message the webview would have posted for this item: already validated */
      message: WebviewMessage;
    };

/** Theme colour of each tone: the chart colours exist in every theme, the grey is the description foreground */
const TONE_COLORS: Record<ActionMenuTone, string> = {
  blue: 'charts.blue',
  yellow: 'charts.yellow',
  orange: 'charts.orange',
  red: 'charts.red',
  green: 'charts.green',
  grey: 'descriptionForeground',
};

const CHECKOUT_KINDS: readonly CheckoutKind[] = ['myPullRequest', 'review', 'task', 'workItem'];

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isOptional(value: unknown, guard: (v: unknown) => boolean): boolean {
  return value === undefined || guard(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalFields(act: Record<string, unknown>): Record<string, unknown> {
  const { branch, task } = act;
  return { ...(isName(branch) ? { branch } : {}), ...(isId(task) ? { taskId: task } : {}) };
}

// Rule BRANCH-MENU-6
/**
 * The message of the button that an `act` stands for, or undefined when it is not one of the actions the menu builders
 * produce or a field has the wrong type: the sections come from the webview, so the extension never runs anything
 * that is not on this list. The result goes through the same code as a click on the button
 */
export function actionToMessage(act: unknown): WebviewMessage | undefined {
  if (!isRecord(act) || !isId(act.id) || !isOptional(act.branch, isName) || !isOptional(act.task, isId)) {
    return undefined;
  }
  const { id, branch, kind, pr } = act;
  const action = act.action as ActionMenuAction['action'];
  switch (action) {
    case 'checkoutHere':
    case 'openWorktree':
    case 'removeWorktree':
      return CHECKOUT_KINDS.includes(kind as CheckoutKind)
        ? { type: action, kind: kind as CheckoutKind, id, ...(isName(branch) ? { branch } : {}) }
        : undefined;
    case 'deleteBranch':
      // Always a named branch: never "the branch of the card"
      return isName(branch) ? { type: 'deleteBranch', id, branch } : undefined;
    case 'openPullRequest':
      return isId(pr) ? { type: 'openPullRequest', id, pullRequestId: pr } : undefined;
    case 'createBranch':
      return { type: 'createBranch', id, ...optionalFields(act) };
    case 'createPullRequest':
      return { type: 'createPullRequest', id, ...optionalFields(act) };
    case 'linkBranch':
      // Always from a task row: the task is the one to link
      return isId(act.task) ? { type: 'linkBranchToTask', id, ...optionalFields(act) } : undefined;
    default:
      return undefined;
  }
}

function sectionEntries(section: unknown): PickerEntry[] {
  if (!isRecord(section) || !Array.isArray(section.items) || typeof section.title !== 'string') {
    return [];
  }
  const items: PickerEntry[] = [];
  for (const item of section.items as unknown[]) {
    if (!isRecord(item) || typeof item.label !== 'string') {
      continue;
    }
    // Items without a (valid) action only inform: a picker cannot show an item that does nothing
    const message = actionToMessage(item.act);
    if (!message) {
      continue;
    }
    const { codicon, tone } = actionMenuIcon({ act: item.act as ActionMenuAction });
    const description = typeof item.detail === 'string' && item.detail ? item.detail : undefined;
    items.push({
      kind: 'item',
      label: item.label,
      ...(description ? { description } : {}),
      iconId: codicon,
      colorId: TONE_COLORS[tone],
      danger: item.danger === true,
      message,
    });
  }
  return items.length ? [{ kind: 'separator', label: section.title }, ...items] : [];
}

/** One separator per section (its title) followed by its actionable items; sections left empty are dropped */
export function pickerEntries(sections: unknown): PickerEntry[] {
  return Array.isArray(sections) ? sections.flatMap(sectionEntries) : [];
}

/** Something can be chosen (an info-only menu is not worth opening a picker, nor a "Click for actions" hint) */
export function hasPickerActions(sections: unknown): boolean {
  return pickerEntries(sections).length > 0;
}
