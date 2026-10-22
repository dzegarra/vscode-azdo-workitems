import * as vscode from 'vscode';
import { WorkItem } from '../azdoClient';
import { isEmpty, resolveFieldName } from '../alerts';
import { resolveContext, settings } from '../config';
import { integrationBuildValue, lastPublishedVersion } from '../integrationBuild';
import { normalizeState } from '../states';
import { WorkItemsStore } from '../workItemsStore';

const STATUS_MESSAGE_MS = 5000;

/** Suggested value: version of the last release of the deploy image + "+". Undefined when it cannot be found */
async function suggestedValue(store: WorkItemsStore): Promise<{ value?: string; note: string }> {
  const { feed, packageName, protocolType, suffix } = settings().integrationBuild;
  try {
    const versions = await resolveContext(store.repository()).client.getPackageVersions(
      feed,
      packageName,
      protocolType
    );
    const version = lastPublishedVersion(versions);
    if (!version) {
      return { note: `No version of ${packageName} found in the feed ${feed}. Type the value.` };
    }
    return {
      value: integrationBuildValue(version, suffix),
      note: `Last published ${packageName}: ${version}. "${suffix}": the fix ships in the release after it.`,
    };
  } catch (error) {
    return { note: `Unable to get the last ${packageName} version (${(error as Error).message}). Type the value.` };
  }
}

/** Fills the "Integrated in Build" field of a Bug with the last release of the deploy image + "+" */
export async function fillIntegrationBuild(store: WorkItemsStore, id: number): Promise<void> {
  const { client } = resolveContext(store.repository());
  const fieldName = settings().integrationBuild.field;
  const [field, suggestion] = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'Looking for the last release' },
    async () =>
      Promise.all([client.getFields().then((fields) => resolveFieldName(fieldName, fields)), suggestedValue(store)])
  );
  if (!field) {
    throw new Error(`The field "${fieldName}" does not exist in the project.`);
  }
  const value = (
    await vscode.window.showInputBox({
      title: `"${fieldName}" of ${id}`,
      prompt: suggestion.note,
      value: suggestion.value,
      ignoreFocusOut: true,
      validateInput: (input) => (input.trim() ? undefined : 'A value is required'),
    })
  )?.trim();
  if (!value) {
    return;
  }
  await client.updateWorkItemField(id, field, value);
  void vscode.window.setStatusBarMessage(`$(check) ${id}: "${fieldName}" set to ${value}`, STATUS_MESSAGE_MS);
  await store.refresh();
}

const CLEAR = 'Clear';

// Rule ALERT-FIX-7
/**
 * Empties "Integrated in Build" of a reopened Bug (the quick fix of the alert "Is … but "Integrated in Build" is
 * still …"), after a confirmation. A new value is proposed when it moves to Ready to Test again
 */
export async function clearIntegrationBuild(store: WorkItemsStore, id: number): Promise<void> {
  const { client } = resolveContext(store.repository());
  const { field: fieldName, states } = settings().integrationBuild;
  const field = resolveFieldName(fieldName, await client.getFields());
  if (!field) {
    throw new Error(`The field "${fieldName}" does not exist in the project.`);
  }
  const current = store.find(id)?.workItem.fields[field];
  if (isEmpty(current)) {
    void vscode.window.showInformationMessage(`"${fieldName}" of ${id} is already empty.`);
    return;
  }
  const answer = await vscode.window.showWarningMessage(
    `Clear "${fieldName}" of ${id}?`,
    {
      modal: true,
      detail: `Its value ${String(
        current
      )} is the build of a fix that did not work. A new value is proposed when it moves to ${states.join(
        ' / '
      )} again.`,
    },
    CLEAR
  );
  if (answer !== CLEAR) {
    return;
  }
  await client.clearWorkItemField(id, field);
  void vscode.window.setStatusBarMessage(`$(check) ${id}: "${fieldName}" cleared`, STATUS_MESSAGE_MS);
  await store.refresh();
}

/**
 * After moving a Bug to Ready to Test: offers to fill "Integrated in Build" right away when it is empty.
 * The value is only written if the user confirms it
 */
export async function offerIntegrationBuild(
  store: WorkItemsStore,
  workItem: WorkItem,
  newState: string
): Promise<void> {
  const { workItemTypes, states, field: fieldName } = settings().integrationBuild;
  const isTarget =
    workItemTypes.includes(workItem.type) && states.some((state) => normalizeState(state) === normalizeState(newState));
  if (!isTarget) {
    return;
  }
  const fields = await resolveContext(store.repository()).client.getFields();
  const field = resolveFieldName(fieldName, fields);
  const current = field ? workItem.fields[field] : undefined;
  const isEmpty = typeof current === 'string' ? !current.trim() : current === undefined || current === null;
  if (field && isEmpty) {
    await fillIntegrationBuild(store, workItem.id);
  }
}
