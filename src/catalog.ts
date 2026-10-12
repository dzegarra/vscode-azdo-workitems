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
  /** A row shown first, apart from the catalog (e.g. an option that is not a value of it) */
  extraItem?: { label: string; description?: string };
}

/** What a pick can end in: a value of the catalog (or a new one), or the extra row */
export type CatalogPick = { kind: 'value'; value: string } | { kind: 'extra' };

/**
 * QuickPick over a catalog stored in the settings, which tells when the extra row was chosen. New entries are
 * appended to the workspace settings so they can be committed and shared with the team.
 */
export async function pickFromCatalogOrExtra(options: CatalogPickOptions): Promise<CatalogPick | undefined> {
  const config = vscode.workspace.getConfiguration(SECTION);
  const catalog = config.get<string[]>(options.setting, []);

  const items: vscode.QuickPickItem[] = catalog.map((label) => ({ label }));
  const preselectedItem = items.find((item) => item.label === options.preselected);
  const ordered = preselectedItem
    ? [{ ...preselectedItem, description: 'suggested' }, ...items.filter((item) => item !== preselectedItem)]
    : items;
  ordered.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, { label: ADD_NEW_LABEL, alwaysShow: true });
  const extra = options.extraItem && { ...options.extraItem, alwaysShow: true };
  if (extra) {
    ordered.unshift(extra, { label: '', kind: vscode.QuickPickItemKind.Separator });
  }

  const picked = await vscode.window.showQuickPick(ordered, {
    title: options.title,
    placeHolder: options.placeholder,
    ignoreFocusOut: true,
  });
  if (!picked) {
    return undefined;
  }
  if (picked === extra) {
    return { kind: 'extra' };
  }
  if (picked.label !== ADD_NEW_LABEL) {
    return { kind: 'value', value: picked.label };
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
  return { kind: 'value', value };
}

/**
 * QuickPick over a catalog stored in the settings. New entries are appended to the workspace settings
 * so they can be committed and shared with the team.
 */
export async function pickFromCatalog(options: CatalogPickOptions): Promise<string | undefined> {
  const pick = await pickFromCatalogOrExtra(options);
  return pick?.kind === 'value' ? pick.value : undefined;
}
