import { withFeature } from './requestContext';
import * as vscode from 'vscode';
import { access } from 'node:fs/promises';
import * as path from 'node:path';
import { AzdoClient } from './azdoClient';
import { BuildNotesDiffCache, BuildNotesStatus, checkPullRequestNotes } from './buildNotes';
import { buildNotesSettings, resolveContext, SECTION, settings, workingDaysSetting } from './config';
import {
  AuthoredPullRequest,
  AuthoredPullRequestData,
  CompletedPeriod,
  completedWindowMs,
  isCompletedWithin,
  MyPullRequestList,
  PullRequestExtras,
  toMyPullRequestModels,
} from './myPullRequests';
import { RunModel } from './pipelines';
import type { PullRequestExtrasLoader } from './pullRequestExtras';
import { REF_TYPE_REMOTE_HEAD } from './git';
import { AttentionEffect, normalizeAttentionEffect } from './attentionEffect';
import type { Layout } from './viewModel';
import { WorkItemsStore } from './workItemsStore';

const MS_PER_SECOND = 1000;
/** Ages are refreshed this often in the view, without checking Azure DevOps */
const TICK_MS = 60 * MS_PER_SECOND;
const MIN_INTERVAL_SECONDS = 30;
export const CHECKOUT_MY_PULL_REQUEST_COMMAND = 'totalflowx.checkoutMyPullRequest';
export const PUBLISH_PULL_REQUEST_COMMAND = 'totalflowx.publishPullRequest';
export const ADD_BUILD_NOTES_SKIP_TAG_COMMAND = 'totalflowx.addBuildNotesSkipTag';
export const RETARGET_PULL_REQUEST_COMMAND = 'totalflowx.retargetPullRequest';

interface NotesContext {
  options: ReturnType<typeof buildNotesSettings>;
  /** Folder of the repository open in VS Code */
  root?: string;
  repositoryName?: string;
}

async function pathExistsIn(root: string, relativePath: string): Promise<boolean> {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

const COMPLETED_PERIODS: CompletedPeriod[] = ['hidden', 'day', 'week', 'month'];

function completedPeriodSetting(value: string): CompletedPeriod {
  return COMPLETED_PERIODS.find((period) => period === value) ?? 'day';
}

export function myPullRequestSettings(): {
  showDrafts: boolean;
  completedPeriod: CompletedPeriod;
  layout: Layout;
  intervalSeconds: number;
  minimumRequiredReviewers: number;
  showInStatusBar: boolean;
  attentionEffect: AttentionEffect;
} {
  const config = vscode.workspace.getConfiguration(`${SECTION}.myPullRequests`);
  return {
    showDrafts: config.get<boolean>('showDrafts', true),
    showInStatusBar: config.get<boolean>('showInStatusBar', true),
    attentionEffect: normalizeAttentionEffect(config.get<string>('attentionEffect', 'pulse')),
    completedPeriod: completedPeriodSetting(config.get<string>('completedPeriod', 'day')),
    layout: config.get<Layout>('layout', 'compact') === 'large' ? 'large' : 'compact',
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
  /** Whether each PR changes the build notes file, by head commit: asked again only after a push */
  private readonly buildNotesCache = new BuildNotesDiffCache();
  /** Threads and linked work items of the completed PRs by id: they barely change, so they are fetched once */
  private readonly completedExtras = new Map<number, Pick<PullRequestExtras, 'threads' | 'workItems'>>();

  constructor(private readonly store: WorkItemsStore, private readonly extras: PullRequestExtrasLoader) {}

  /** The cards to show, with whether their branch can be checked out, right now */
  models(): MyPullRequestList {
    const local = this.localRepository();
    const { showDrafts, completedPeriod, minimumRequiredReviewers } = myPullRequestSettings();
    const data = this.data.map(({ pr, extras }) => ({
      pr,
      // The store follows the active PRs of the user and refreshes their runs; the own fetch is the fallback
      extras: { ...extras, runs: this.store.runsOf(pr.pullRequestId) ?? extras.runs },
    }));
    const { items, hiddenDrafts, hiddenCompleted, completedSummary } = toMyPullRequestModels(data, {
      now: new Date(),
      remoteBranches: this.knownRemoteBranches(),
      baseBranch: settings().baseBranch,
      showDrafts,
      completedPeriod,
      minimumRequiredReviewers,
      workingDays: workingDaysSetting(),
      buildNotes: buildNotesSettings(),
    });
    return {
      hiddenDrafts,
      hiddenCompleted,
      completedSummary,
      items: items.map((item) => {
        // Rule MYPR-CARD-3
        const canCheckout = !!local && item.repository.toLowerCase() === local.name.toLowerCase();
        const isCurrentBranch = canCheckout && local.head === item.sourceBranch;
        return {
          ...item,
          canCheckout,
          isCurrentBranch,
          worktree: canCheckout && !isCurrentBranch ? this.store.worktreeFor(item.sourceBranch)?.path : undefined,
        };
      }),
    };
  }

  /** Whether the user created the PR. False while the list is not loaded */
  isMine(pullRequestId: number): boolean {
    return this.data.some(({ pr }) => pr.pullRequestId === pullRequestId);
  }

  /** CI runs of the active PRs created by the user, whether the store follows them or not */
  ownRuns(): { pullRequestId: number; runs: RunModel[] }[] {
    return this.data
      .filter(({ pr }) => pr.status === 'active')
      .map(({ pr, extras }) => ({
        pullRequestId: pr.pullRequestId,
        runs: this.store.runsOf(pr.pullRequestId) ?? extras.runs,
      }));
  }

  /** Work items linked to one of the user's PRs; undefined when the PR or its links are not known */
  workItemIdsOf(pullRequestId: number): number[] | undefined {
    return this.data
      .find(({ pr }) => pr.pullRequestId === pullRequestId)
      ?.extras.workItems?.map(({ id }) => id)
      .sort((a, b) => a - b);
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

  poll(): Promise<void> {
    return withFeature('myPullRequests', () => this.runPoll());
  }

  private async runPoll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      this.myId ??= client.getMyId();
      const pullRequests = await client.getMyPullRequests(await this.myId);
      // Only the active PRs need the details: the completed ones of the period are shown faded, with their timeline (threads cached)
      const now = new Date();
      const notes = this.buildNotesContext();
      this.buildNotesCache.keepOnly(pullRequests.map((pr) => pr.pullRequestId));
      const listedIds = new Set(pullRequests.map((pr) => pr.pullRequestId));
      [...this.completedExtras.keys()]
        .filter((id) => !listedIds.has(id))
        .forEach((id) => this.completedExtras.delete(id));
      this.data = await Promise.all(
        pullRequests.map(async (pr) => ({
          pr,
          extras: await this.fetchPollExtras(client, pr, now, notes),
        }))
      );
      this.status = 'ready';
      this.error = undefined;
      // The store keeps the runs of these PRs fresh (every few seconds while one is running), and the runs
      // queued by the merge of the completed ones
      const followed = (status: string) =>
        this.data
          .filter(({ pr }) => pr.status === status)
          .map(({ pr }) => ({
            id: pr.pullRequestId,
            title: pr.title,
            sourceRefName: pr.sourceRefName,
            webUrl: pr.webUrl,
          }));
      this.store.followPullRequests(followed('active'), followed('completed'));
    } catch (error) {
      this.myId = undefined;
      this.status = 'error';
      this.error = (error as Error).message;
    } finally {
      this.polling = false;
      this.changed.fire();
    }
  }

  // Rules MYPR-LIST-6, MYPR-LIST-7
  private async fetchPollExtras(
    client: AzdoClient,
    pr: AuthoredPullRequest,
    now: Date,
    notes: NotesContext
  ): Promise<PullRequestExtras> {
    if (pr.status === 'active') {
      const [extras, buildNotes] = await Promise.all([
        this.extras.fetch(client, pr),
        this.fetchBuildNotes(client, pr, notes),
      ]);
      return { ...extras, buildNotes };
    }
    const { completedPeriod } = myPullRequestSettings();
    if (!isCompletedWithin(pr, now, completedWindowMs(completedPeriod))) {
      return { runs: [] };
    }
    // Only the parts not fetched yet (or that failed) are asked
    const cached = this.completedExtras.get(pr.pullRequestId) ?? {};
    const [threads, workItems] = await Promise.all([
      cached.threads ?? client.getPullRequestThreads(pr.repository.id, pr.pullRequestId).catch(() => undefined),
      cached.workItems ?? this.extras.fetchWorkItems(client, pr.repository.id, pr.pullRequestId),
    ]);
    this.completedExtras.set(pr.pullRequestId, { threads, workItems });
    return { threads, workItems, runs: [] };
  }

  /** Where the PR stands about the build notes rule: the tag costs nothing, the diff one request per push */
  private async fetchBuildNotes(
    client: AzdoClient,
    pr: AuthoredPullRequest,
    { options, root, repositoryName }: NotesContext
  ): Promise<BuildNotesStatus> {
    const localRepo = !!root && pr.repository.name.toLowerCase() === repositoryName?.toLowerCase();
    const folderExists = localRepo && !!root && (await pathExistsIn(root, options.directory));
    const status = { localRepo, folderExists };
    const changed = await checkPullRequestNotes(pr, status, options, this.buildNotesCache, (base, target) =>
      client.getCommitsDiff(pr.repository.id, base, target)
    );
    return { ...status, changed };
  }

  private buildNotesContext(): NotesContext {
    const repository = this.store.repository();
    try {
      return {
        options: buildNotesSettings(),
        root: repository?.rootUri.fsPath,
        repositoryName: repository && resolveContext(repository).repositoryName,
      };
    } catch {
      return { options: buildNotesSettings() };
    }
  }

  /** Name of the repository open in VS Code and its checked out branch */
  /** Remote branches the git extension already knows, by lowercase repository name; nothing is requested */
  private knownRemoteBranches(): Map<string, Set<string>> | undefined {
    const repository = this.store.repository();
    const { remote, baseBranch } = settings();
    const refs = repository?.state.refs;
    const name = this.localRepository()?.name;
    if (!refs || !name) {
      return undefined;
    }
    const names = new Set(
      refs
        .filter((ref) => ref.type === REF_TYPE_REMOTE_HEAD && ref.remote === remote && ref.name)
        .map((ref) => (ref.name ?? '').slice(remote.length + 1))
    );
    // Without the base branch the refs are not loaded yet: do not flag every target as missing
    return names.has(baseBranch) ? new Map([[name.toLowerCase(), names]]) : undefined;
  }

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
