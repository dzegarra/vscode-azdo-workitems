/**
 * Fetches what the cards of the PRs need besides the PR itself: branch policies, comment threads, linked work
 * items and CI runs. Shared by "My Pull Requests" and "Waiting for your review", so the caches (work item types,
 * run details) are shared too. No "vscode" import
 */
import type { AzdoClient } from './azdoClient';
import type { ThreadResponse } from './reviewThreads';
import { countUnresolvedThreads, PullRequestExtras } from './myPullRequests';
import { latestRuns, RunModel } from './pipelines';
import { runDetailsLoader } from './runDetailsLoader';

/** What is needed to ask about a PR */
export interface PullRequestRef {
  pullRequestId: number;
  repository: { id: string; project: { id: string } };
}

/** What the loader needs of the work items store */
export interface PullRequestExtrasStore {
  /** Work items assigned to the user are already known */
  find(id: number): { workItem: { type: string } } | undefined;
  /** CI runs of the PRs the store follows; undefined for the others */
  runsOf(pullRequestId: number): RunModel[] | undefined;
}

export class PullRequestExtrasLoader {
  /** Types of the work items linked to PRs. They do not change: fetched once */
  private readonly workItemTypes = new Map<number, string>();

  constructor(private readonly store: PullRequestExtrasStore) {}

  /**
   * Each part fails alone (it is undefined, or empty for the runs): the card is shown without it.
   * The threads are not asked again when the caller already has them
   */
  async fetch(client: AzdoClient, pr: PullRequestRef, knownThreads?: ThreadResponse[]): Promise<PullRequestExtras> {
    const { id: repositoryId, project } = pr.repository;
    const id = pr.pullRequestId;
    const [evaluations, threads, workItems, runs] = await Promise.all([
      // Rule PR-POLICY-3: failed policies stay undefined
      client.getPolicyEvaluations(project.id, id).catch(() => undefined),
      knownThreads ?? client.getPullRequestThreads(repositoryId, id).catch(() => undefined),
      this.fetchWorkItems(client, repositoryId, id),
      // The runs of the PRs followed by the store are read from it when the cards are built
      this.store.runsOf(id) ??
        client
          .getPullRequestBuilds(id)
          .then((builds) => runDetailsLoader.enrich(client, latestRuns(builds)))
          .catch(() => []),
    ]);
    return { evaluations, unresolvedThreads: threads && countUnresolvedThreads(threads), threads, workItems, runs };
  }

  /** Linked work items with their type. Undefined when they cannot be told: the Bug warning is skipped */
  async fetchWorkItems(
    client: AzdoClient,
    repositoryId: string,
    pullRequestId: number
  ): Promise<PullRequestExtras['workItems']> {
    try {
      const ids = await client.getPullRequestWorkItemIds(repositoryId, pullRequestId);
      const unknown = ids.filter((id) => !this.workItemTypes.has(id));
      for (const id of unknown) {
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
}
