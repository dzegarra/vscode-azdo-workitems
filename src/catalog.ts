import * as vscode from 'vscode';
import { SECTION } from './config';

const ADD_NEW_LABEL = '$(add) Add new…';

interface CatalogPickOptions {
  /** Setting holding the catalog, e.g. "branchModules" */
  setting: 'branchModules' | 'prFeatureNames';
  title: string;
  placeholder: string;
  preselected?: string;
  newItemPrompt: string;
  validate?: (value: string) => string | undefined;
}

/**
 * QuickPick over a catalog stored in the settings. New entries are appended to the workspace settings
 * so they can be committed and shared with the team.
 */
export async function pickFromCatalog(options: CatalogPickOptions): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const catalog = config.get<string[]>(options.setting, []);

  const items: vscode.QuickPickItem[] = catalog.map((label) => ({ label }));
  const preselectedItem = items.find((item) => item.label === options.preselected);
  const ordered = preselectedItem
    ? [{ ...preselectedItem, description: 'suggested' }, ...items.filter((item) => item !== preselectedItem)]
    : items;
  ordered.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: ADD_NEW_LABEL, alwaysShow: true });

  const picked = await vscode.window.showQuickPick(ordered, {
    title: options.title,
    placeHolder: options.placeholder,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }
  if (picked.label !== ADD_NEW_LABEL) {
    return picked.label;
  }

  const value = (
    await vscode.window.showInputBox({
      title: options.title,
      prompt: options.newItemPrompt,
      ignoreFocusOut: true,
      validateInput: (input) => {
        const trimmed = input.trim();
        if (!trimmed) {
          return 'Value is required';
        }
        return catalog.includes(trimmed) ? 'Already in the list' : options.validate?.(trimmed);
      },
    })
  )?.trim();
  if (!value) {
    return undefined;
  }

  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await config.update(options.setting, [...catalog, value], target);
  return value;
}
