import * as vscode from 'vscode';
import { pickerEntries, type PickerEntry } from './actionPicker';
import type { WebviewMessage } from './viewModel';

interface ActionPickItem extends vscode.QuickPickItem {
  message?: WebviewMessage;
}

/**
 * Icons are `iconPath` (a ThemeIcon with a ThemeColor), which the @types/vscode 1.95 that the extension builds against
 * declares for QuickPickItem. Whether the colour is drawn depends on the VS Code version and theme (not verified
 * here): the shape of the icon says the kind of action on its own
 */
function toQuickPickItem(entry: PickerEntry): ActionPickItem {
  if (entry.kind === 'separator') {
    return { label: entry.label, kind: vscode.QuickPickItemKind.Separator };
  }
  return {
    label: entry.label,
    description: entry.description,
    iconPath: new vscode.ThemeIcon(entry.iconId, new vscode.ThemeColor(entry.colorId)),
    message: entry.message,
  };
}

/**
 * Shows the actions of a menu in the native QuickPick (it has the room, the keyboard handling and the theme that a
 * sidebar webview cannot have) and resolves with the message of the chosen item: the caller runs it through the same
 * code as the button it stands for. Resolves undefined when nothing is chosen or nothing could be (items that are
 * not an allowed action are left out, see actionToMessage)
 */
export async function showActionPicker(title: string, sections: unknown): Promise<WebviewMessage | undefined> {
  const items = pickerEntries(sections).map(toQuickPickItem);
  if (!items.some((item) => item.message)) {
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { title, ignoreFocusOut: true });
  return picked?.message;
}
