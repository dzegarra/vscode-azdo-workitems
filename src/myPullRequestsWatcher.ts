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
import { firstCommitsToAsk, type FirstCommitEntry } from './codingStart';
import { completedPullRequestInfos, mergedThreadsToAsk, type CompletedPullRequestInfo } from './timelineGroups';
import type { ThreadResponse } from './reviewThreads';
import type { FilesChanged } from './reviewCard';
import type { PullRequestExtrasLoader } from './pullRequestExtras';
import { REF_TYPE_REMOTE_HEAD } from './git';
import { AttentionEffect, normalizeAttentionEffect } from './attentionEffect';
import type { Layout } from './viewModel';
import { WorkItemsStore } from './workItemsStore';
import type { KnownPullRequest } from './worktreeHygiene';

const HEADS_PREFIX = 'refs/heads/';

const MS_PER_SECOND = 1000;
/** Ages are refreshed this often in the view, without checking Azure DevOps */
const TICK_MS = 60 * MS_PER_SECOND;
const MIN_INTERVAL_SECONDS = 30;
/** The target branch moves without the PR changing: how long a "behind" count is kept */
const BEHIND_TTL_MS = 10 * 60 * MS_PER_SECOND;
/** Files counted per PR; more is only said as "N+" */
const MAX_COUNTED_FILES = 100;
export const CHECKOUT_MY_PULL_REQUEST_COMMAND = 'totalflowx.checkoutMyPullRequest';
export const PUBLISH_PULL_REQUEST_COMMAND = 'totalflowx.publishPullRequest';
export const ADD_BUILD_NOTES_SKIP_TAG_COMMAND = 'totalflowx.addBuildNotesSkipTag';
export const RETARGET_PULL_REQUEST_COMMAND = 'totalflowx.retargetPullRequest';
export const COMPLETE_PULL_REQUEST_COMMAND = 'totalflowx.completePullRequest';
export const RESTART_PULL_REQUEST_MERGE_COMMAND = 'totalflowx.restartPullRequestMerge';

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

/** A merged PR whose threads could not be read is asked again after this long */
const MERGED_THREADS_RETRY_MS = 10 * 60 * MS_PER_SECOND;

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
  maxOpenDays: number;
  maxFilesChanged: number;
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
    maxOpenDays: Math.max(0, config.get<number>('maxOpenDays', 5)),
    maxFilesChanged: Math.max(0, config.get<number>('maxFilesChanged', 30)),
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
  /** Files changed by each active PR, by its last merge source commit: asked again only after a push */
  private readonly filesChanged = new Map<number, { commit: string; files: FilesChanged }>();
  /** Commits behind the target, by PR: asked again after a push or BEHIND_TTL_MS (the target moves on its own) */
  private readonly behind = new Map<number, { commit: string; time: number; behind: number }>();
  /** Threads and linked work items of the completed PRs by id: they barely change, so they are fetched once */
  private readonly completedExtras = new Map<number, Pick<PullRequestExtras, 'threads' | 'workItems'>>();

  /** Threads of the merged PRs the Sprint timeline draws, by id: fetched once, kept for the session (Rule TIMELINE-17) */
  private readonly mergedThreads = new Map<number, ThreadResponse[]>();
  /** When the threads of a merged PR could not be read (retried after MERGED_THREADS_RETRY_MS) */
  private readonly mergedThreadsFailed = new Map<number, number>();
  /** Being read now: a second draw of the timeline does not ask them again */
  private readonly mergedThreadsLoading = new Set<number>();
  /** First commit of the PRs the Sprint timeline draws, by id (Rule TIMELINE-20): a merged PR forever, an open one until its last push changes */
  private readonly firstCommits = new Map<number, FirstCommitEntry>();
  /** When the commits of a PR could not be read (retried after MERGED_THREADS_RETRY_MS) */
  private readonly firstCommitsFailed = new Map<number, number>();
  /** Being read now: a second draw of the timeline does not ask them again */
  private readonly firstCommitsLoading = new Set<number>();

  constructor(private readonly store: WorkItemsStore, private readonly extras: PullRequestExtrasLoader) {}

  // Rule TIMELINE-17
  /** The PRs of the user that were merged (the latest 50 of the list, no request), with the threads that are known */
  completedPullRequests(): CompletedPullRequestInfo[] {
    return completedPullRequestInfos(
      this.data.map(({ pr, extras }) => ({
        pr,
        threads:
          extras.threads ??
          this.completedExtras.get(pr.pullRequestId)?.threads ??
          this.mergedThreads.get(pr.pullRequestId),
      }))
    );
  }

  // Rule TIMELINE-17
  /**
   * Reads the threads of the merged PRs the timeline draws without them: one request per PR, once (a completed PR does
   * not change); a failure is retried after 10 minutes. True when something was read: the timeline draws again
   */
  loadMergedThreads(ids: readonly number[]): Promise<boolean> {
    return withFeature('sprintTimeline', async () => {
      const wanted = mergedThreadsToAsk(
        ids.filter((id) => !this.mergedThreadsLoading.has(id)),
        this.completedPullRequests(),
        this.mergedThreadsFailed,
        Date.now(),
        MERGED_THREADS_RETRY_MS
      );
      if (!wanted.length) {
        return false;
      }
      wanted.forEach((pr) => this.mergedThreadsLoading.add(pr.id));
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      const loaded = await Promise.all(
        wanted.map(async (pr) => {
          try {
            this.mergedThreads.set(pr.id, await client.getPullRequestThreads(pr.repositoryId, pr.id));
            return true;
          } catch {
            this.mergedThreadsFailed.set(pr.id, Date.now());
            return false;
          } finally {
            this.mergedThreadsLoading.delete(pr.id);
          }
        })
      );
      return loaded.some(Boolean);
    });
  }

  // Rule TIMELINE-20
  /** The first commit (ISO author date) of the PRs read so far, by PR id; no request */
  firstCommitDates(): ReadonlyMap<number, string> {
    return new Map([...this.firstCommits].map(([id, entry]) => [id, entry.date]));
  }

  // Rule TIMELINE-20
  /**
   * Reads the first commit of the PRs the timeline draws (`pullRequests/{id}/commits`): one request per PR, de-duplicated
   * while in flight; a merged PR once, an open one again after a push; a failure is retried after 10 minutes. True when
   * something was read: the timeline draws again
   */
  loadFirstCommits(ids: readonly number[]): Promise<boolean> {
    return withFeature('sprintTimeline', async () => {
      const known = this.data.map(({ pr }) => ({
        id: pr.pullRequestId,
        completed: pr.status === 'completed',
        commit: pr.lastMergeSourceCommit?.commitId,
      }));
      const wanted = firstCommitsToAsk(
        ids.filter((id) => !this.firstCommitsLoading.has(id)),
        known,
        this.firstCommits,
        this.firstCommitsFailed,
        Date.now(),
        MERGED_THREADS_RETRY_MS
      );
      if (!wanted.length) {
        return false;
      }
      const repositories = new Map(this.data.map(({ pr }) => [pr.pullRequestId, pr.repository.id]));
      wanted.forEach((pr) => this.firstCommitsLoading.add(pr.id));
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      const loaded = await Promise.all(
        wanted.map(async (pr) => {
          try {
            const date = await client.getPullRequestFirstCommitDate(repositories.get(pr.id) ?? '', pr.id);
            if (!date) {
              // No commit to read: asked again only after the retry delay, not at every redraw
              this.firstCommitsFailed.set(pr.id, Date.now());
              return false;
            }
            this.firstCommits.set(pr.id, { commit: pr.commit, date });
            return true;
          } catch {
            this.firstCommitsFailed.set(pr.id, Date.now());
            return false;
          } finally {
            this.firstCommitsLoading.delete(pr.id);
          }
        })
      );
      return loaded.some(Boolean);
    });
  }

  /** The cards to show, with whether their branch can be checked out, right now */
  models(): MyPullRequestList {
    const local = this.localRepository();
    const { showDrafts, completedPeriod, minimumRequiredReviewers, maxOpenDays, maxFilesChanged } =
      myPullRequestSettings();
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
      maxOpenDays,
      maxFilesChanged,
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

  /**
   * The user's PRs of the open repository (active and recently completed), for the cleanup of the worktrees
   * (src/worktreeHygiene.ts): what the last check fetched, no request
   */
  pullRequestsForWorktrees(): KnownPullRequest[] {
    const local = this.localRepository();
    if (!local) {
      return [];
    }
    return this.data
      .filter(({ pr }) => pr.repository.name.toLowerCase() === local.name.toLowerCase())
      .map(({ pr }) => ({
        id: pr.pullRequestId,
        title: pr.title,
        sourceBranch: pr.sourceRefName.replace(HEADS_PREFIX, ''),
        status: pr.status,
        mine: true,
      }));
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
      for (const cache of [this.completedExtras, this.filesChanged, this.behind]) {
        [...cache.keys()].filter((id) => !listedIds.has(id)).forEach((id) => cache.delete(id));
      }
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
      const [extras, buildNotes, filesChanged, behind] = await Promise.all([
        this.extras.fetch(client, pr),
        this.fetchBuildNotes(client, pr, notes),
        this.fetchFilesChanged(client, pr),
        this.fetchBehind(client, pr, now),
      ]);
      return { ...extras, buildNotes, filesChanged, behind };
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

  // Rule MYPR-CAUTION-2
  /** Files changed by a published PR: 2 requests per push (the last iteration, its changes), none otherwise */
  private async fetchFilesChanged(client: AzdoClient, pr: AuthoredPullRequest): Promise<FilesChanged | undefined> {
    const commit = pr.lastMergeSourceCommit?.commitId;
    if (pr.isDraft || !commit || !myPullRequestSettings().maxFilesChanged) {
      return undefined;
    }
    const known = this.filesChanged.get(pr.pullRequestId);
    if (known?.commit === commit) {
      return known.files;
    }
    try {
      const iteration = await client.getLastIterationId(pr.repository.id, pr.pullRequestId);
      if (iteration === undefined) {
        return undefined;
      }
      const { count, more } = await client.getIterationChangeCount(
        pr.repository.id,
        pr.pullRequestId,
        iteration,
        MAX_COUNTED_FILES
      );
      const files = { count, capped: more };
      this.filesChanged.set(pr.pullRequestId, { commit, files });
      return files;
    } catch {
      return undefined;
    }
  }

  // Rule MYPR-BEHIND-1
  /** Commits of the target the branch lacks: 1 request per PR after a push, else at most every BEHIND_TTL_MS */
  private async fetchBehind(client: AzdoClient, pr: AuthoredPullRequest, now: Date): Promise<number | undefined> {
    const commit = pr.lastMergeSourceCommit?.commitId ?? '';
    const known = this.behind.get(pr.pullRequestId);
    if (known?.commit === commit && now.getTime() - known.time < BEHIND_TTL_MS) {
      return known.behind;
    }
    try {
      const { behind } = await client.getBranchAheadBehind(
        pr.repository.id,
        pr.sourceRefName.replace(HEADS_PREFIX, ''),
        pr.targetRefName.replace(HEADS_PREFIX, '')
      );
      this.behind.set(pr.pullRequestId, { commit, time: now.getTime(), behind });
      return behind;
    } catch {
      return known?.behind;
    }
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
