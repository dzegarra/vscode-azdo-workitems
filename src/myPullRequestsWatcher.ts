import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { resolveContext, SECTION, settings } from './config';
import {
  AuthoredPullRequest,
  AuthoredPullRequestData,
  countUnresolvedThreads,
  MyPullRequestModel,
  PullRequestExtras,
  toMyPullRequestModels,
} from './myPullRequests';
import { latestRuns } from './pipelines';
import { WorkItemsStore } from './workItemsStore';

const MS_PER_SECOND = 1000;
/** Ages are refreshed this often in the view, without checking Azure DevOps */
const TICK_MS = 60 * MS_PER_SECOND;
const MIN_INTERVAL_SECONDS = 30;
export const CHECKOUT_MY_PULL_REQUEST_COMMAND = 'azdoWorkItems.checkoutMyPullRequest';
export const PUBLISH_PULL_REQUEST_COMMAND = 'azdoWorkItems.publishPullRequest';

export function myPullRequestSettings(): {
  showDrafts: boolean;
  intervalSeconds: number;
  minimumRequiredReviewers: number;
} {
  const config = vscode.workspace.getConfiguration(`${SECTION}.myPullRequests`);
  return {
    showDrafts: config.get<boolean>('showDrafts', true),
    minimumRequiredReviewers: Math.max(0, config.get<number>('minimumRequiredReviewers', 2)),
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, config.get<number>('pollIntervalSeconds', 120)),
  };
}

/**
 * Polls the PRs created by the user (the active ones and those completed recently) with what is needed to know
 * what is missing to merge them: branch policies, unresolved comments, linked work items and CI runs.
 * Whatever cannot be fetched for a PR is left out of its card; the rest of the list is not affected
 */
export class MyPullRequestsWatcher implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  status: 'error' | 'loading' | 'ready' = 'loading';
  error?: string;
  private data: AuthoredPullRequestData[] = [];
  private timer?: NodeJS.Timeout;
  private ticker?: NodeJS.Timeout;
  private polling = false;
  private myId?: Promise<string>;
  /** Types of the work items linked to PRs. They do not change: fetched once */
  private readonly workItemTypes = new Map<number, string>();

  constructor(private readonly store: WorkItemsStore) {}

  /** The cards to show, with whether their branch can be checked out, right now */
  models(): { items: MyPullRequestModel[]; hiddenDrafts: number } {
    const local = this.localRepository();
    const { showDrafts, minimumRequiredReviewers } = myPullRequestSettings();
    const data = this.data.map(({ pr, extras }) => ({
      pr,
      // The store follows the PRs linked to the work items and refreshes their runs every few seconds
      extras: { ...extras, runs: this.store.runsOf(pr.pullRequestId) ?? extras.runs },
    }));
    const { items, hiddenDrafts } = toMyPullRequestModels(data, {
      now: new Date(),
      baseBranch: settings().baseBranch,
      showDrafts,
      minimumRequiredReviewers,
    });
    return {
      hiddenDrafts,
      items: items.map((item) => {
        const canCheckout = !!local && item.repository.toLowerCase() === local.name.toLowerCase();
        return { ...item, canCheckout, isCurrentBranch: canCheckout && local.head === item.sourceBranch };
      }),
    };
  }

  /** The PR as it was in the last check, to act on it */
  find(pullRequestId: number): AuthoredPullRequest | undefined {
    return this.data.find(({ pr }) => pr.pullRequestId === pullRequestId)?.pr;
  }

  start(): void {
    this.stop();
    void this.poll();
    this.timer = setInterval(() => void this.poll(), myPullRequestSettings().intervalSeconds * MS_PER_SECOND);
    this.ticker = setInterval(() => this.data.length && this.changed.fire(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.ticker);
    this.timer = undefined;
    this.ticker = undefined;
  }

  dispose(): void {
    this.stop();
    this.changed.dispose();
  }

  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const { client } = resolveContext(this.store.repository());
      this.myId ??= client.getMyId();
      const pullRequests = await client.getMyPullRequests(await this.myId);
      // Only the active PRs need the details: the completed ones are shown faded
      this.data = await Promise.all(
        pullRequests.map(async (pr) => ({
          pr,
          extras: pr.status === 'active' ? await this.fetchExtras(client, pr) : { runs: [] },
        }))
      );
      this.status = 'ready';
      this.error = undefined;
    } catch (error) {
      this.myId = undefined;
      this.status = 'error';
      this.error = (error as Error).message;
    } finally {
      this.polling = false;
      this.changed.fire();
    }
  }

  private async fetchExtras(client: AzdoClient, pr: AuthoredPullRequest): Promise<PullRequestExtras> {
    const { id: repositoryId, project } = pr.repository;
    const id = pr.pullRequestId;
    // Each part fails alone: the card is shown without it
    const [evaluations, unresolvedThreads, workItems, runs] = await Promise.all([
      client.getPolicyEvaluations(project.id, id).catch(() => undefined),
      client
        .getPullRequestThreads(repositoryId, id)
        .then(countUnresolvedThreads)
        .catch(() => undefined),
      this.fetchWorkItems(client, repositoryId, id),
      // The runs of the PRs followed by the store are read from it when the cards are built
      this.store.runsOf(id) ??
        client
          .getPullRequestBuilds(id)
          .then(latestRuns)
          .catch(() => []),
    ]);
    return { evaluations, unresolvedThreads, workItems, runs };
  }

  /** Linked work items with their type. Undefined when they cannot be told: the Bug warning is skipped */
  private async fetchWorkItems(
    client: AzdoClient,
    repositoryId: string,
    pullRequestId: number
  ): Promise<PullRequestExtras['workItems']> {
    try {
      const ids = await client.getPullRequestWorkItemIds(repositoryId, pullRequestId);
      const unknown = ids.filter((id) => !this.workItemTypes.has(id));
      for (const id of unknown) {
        // The store already knows the work items assigned to the user
        const type = this.store.find(id)?.workItem.type;
        if (type) {
          this.workItemTypes.set(id, type);
        }
      }
      const missing = unknown.filter((id) => !this.workItemTypes.has(id));
      if (missing.length) {
        (await client.getWorkItemTypes(missing)).forEach((type, id) => this.workItemTypes.set(id, type));
      }
      return ids.flatMap((id) => {
        const type = this.workItemTypes.get(id);
        return type ? [{ id, type }] : [];
      });
    } catch {
      return undefined;
    }
  }

  /** Name of the repository open in VS Code and its checked out branch */
  private localRepository(): { name: string; head?: string } | undefined {
    const repository = this.store.repository();
    if (!repository) {
      return undefined;
    }
    try {
      return { name: resolveContext(repository).repositoryName, head: repository.state.HEAD?.name };
    } catch {
      return undefined;
    }
  }
}
