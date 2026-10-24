import * as vscode from 'vscode';
import { AzdoClient, WorkItem } from '../azdoClient';
import { resolveFieldName } from '../alerts';
import { settings } from '../config';
import { AuthoredPullRequest } from '../myPullRequests';
import {
  COMPLETION_MERGE_STRATEGY,
  CompletionWorkItem,
  completionPlan,
  completionSummary,
} from '../pullRequestCompletion';
import { WorkItemsStore } from '../workItemsStore';
import { suggestedValue } from './integrationBuild';

const TASK_TYPE = 'Task';

/** PRs linked to work items, with their status; a PR that cannot be read counts as active (the item is kept) */
async function pullRequestStatuses(client: AzdoClient, items: WorkItem[]): Promise<Map<number, string>> {
  const links = new Map(items.flatMap((item) => item.links.pullRequests.map((link) => [link.id, link] as const)));
  const statuses = await Promise.all(
    [...links.values()].map(async (link) => {
      try {
        return [link.id, (await client.getPullRequest(link.id, link.projectId)).status] as const;
      } catch {
        return [link.id, 'active'] as const;
      }
    })
  );
  return new Map(statuses);
}

/** The work items of the PR as they are now, with their tasks and the status of their PRs (fresh: it writes) */
async function loadWorkItems(client: AzdoClient, pr: AuthoredPullRequest): Promise<CompletionWorkItem[]> {
  const ids = await client.getPullRequestWorkItemIds(pr.repository.id, pr.pullRequestId);
  const items = await client.getWorkItems(ids);
  const childIds = items.filter((item) => item.type !== TASK_TYPE).flatMap((item) => item.links.childIds);
  const tasks = (await client.getWorkItems([...new Set(childIds)])).filter((child) => child.type === TASK_TYPE);
  const statuses = await pullRequestStatuses(client, [...items, ...tasks]);
  return items.map((item) => {
    const own = tasks.filter((task) => item.links.childIds.includes(task.id));
    const prIds = new Set(
      [...item.links.pullRequests, ...own.flatMap((task) => task.links.pullRequests)].map(({ id }) => id)
    );
    return {
      id: item.id,
      title: item.title,
      type: item.type,
      state: item.state,
      tasks: own.map((task) => ({
        id: task.id,
        state: task.state,
        pullRequestIds: task.links.pullRequests.map(({ id }) => id),
      })),
      pullRequests: [...prIds].map((id) => ({ id, status: statuses.get(id) ?? 'active' })),
    };
  });
}

/** "Integrated in Build" for the Bugs: the proposal of Fill, confirmed (or typed) by the user. Undefined: cancelled */
async function askIntegrationBuild(
  client: AzdoClient,
  store: WorkItemsStore
): Promise<{ field: string; referenceName: string; value: string } | undefined> {
  const fieldName = settings().integrationBuild.field;
  const [referenceName, suggestion] = await Promise.all([
    client.getFields().then((fields) => resolveFieldName(fieldName, fields)),
    suggestedValue(store),
  ]);
  if (!referenceName) {
    throw new Error(`The field "${fieldName}" does not exist in the project.`);
  }
  const value = (
    await vscode.window.showInputBox({
      title: `"${fieldName}" of the Bugs of the PR`,
      prompt: suggestion.note,
      value: suggestion.value,
      ignoreFocusOut: true,
      validateInput: (input) => (input.trim() ? undefined : 'A value is required'),
    })
  )?.trim();
  return value ? { field: fieldName, referenceName, value } : undefined;
}

// Rules MYPR-ACT-6, COMPLETE-PR-1..4
/**
 * Completes a PR of the user the way the team does it (squash, delete the branch), then moves its work items:
 * Backlog Items to Done, Bugs to Ready to Test with "Integrated in Build" (developers never complete Bugs), the
 * PR tasks to Done. Everything is listed in one confirmation first; a failed work item update only warns
 */
export async function completePullRequest(
  client: AzdoClient,
  store: WorkItemsStore,
  pr: AuthoredPullRequest,
  refresh: () => Promise<void>
): Promise<void> {
  const commit = pr.lastMergeSourceCommit?.commitId;
  if (pr.status !== 'active' || pr.isDraft || !commit) {
    throw new Error(`PR ${pr.pullRequestId} cannot be completed: it is not an active, published PR.`);
  }
  const { integrationBuild, baseBranch } = settings();
  const plan = completionPlan(pr.pullRequestId, await loadWorkItems(client, pr), {
    bugTypes: integrationBuild.workItemTypes,
    bugState: integrationBuild.states.at(0) ?? 'Ready to Test',
  });
  const build = plan.moves.some((moved) => moved.setsIntegrationBuild)
    ? await askIntegrationBuild(client, store)
    : undefined;
  if (plan.moves.some((moved) => moved.setsIntegrationBuild) && !build) {
    return;
  }
  const target = pr.targetRefName.replace(/^refs\/heads\//, '');
  const complete = `Complete PR ${pr.pullRequestId}`;
  const answer = await vscode.window.showWarningMessage(
    `Complete PR ${pr.pullRequestId}?`,
    { modal: true, detail: completionSummary(pr.pullRequestId, target || baseBranch, plan, build) },
    complete
  );
  if (answer !== complete) {
    return;
  }
  await client.completePullRequest(pr.repository.id, pr.pullRequestId, commit, {
    mergeStrategy: COMPLETION_MERGE_STRATEGY,
    deleteSourceBranch: true,
  });
  const failures: string[] = [];
  // The tasks first: a Backlog Item Done (or a Bug Ready to Test) with its PR task still open would be ALERT-1
  const tasksFirst = [...plan.moves].sort((a, b) => Number(b.type === TASK_TYPE) - Number(a.type === TASK_TYPE));
  for (const moved of tasksFirst) {
    try {
      if (moved.setsIntegrationBuild && build) {
        await client.updateWorkItemField(moved.id, build.referenceName, build.value);
      }
      await client.updateWorkItemState(moved.id, moved.to);
    } catch (error) {
      failures.push(`${moved.id} (${(error as Error).message})`);
    }
  }
  if (failures.length) {
    void vscode.window.showWarningMessage(
      `PR ${pr.pullRequestId} was completed, but these work items could not be updated: ${failures.join(', ')}.`
    );
  } else {
    void vscode.window.showInformationMessage(`PR ${pr.pullRequestId} completed.`);
  }
  await Promise.all([refresh(), store.refresh()]);
}
