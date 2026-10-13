import { withFeature } from './requestContext';
import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { resolveContext, SECTION, settings as extensionSettings, workingDaysSetting } from './config';
import { myPullRequestSettings } from './myPullRequestsWatcher';
import type { PullRequestExtras } from './myPullRequests';
import type { PullRequestExtrasLoader } from './pullRequestExtras';
import { FilesChanged, MAX_COUNTED_FILES, toReviewDetails } from './reviewCard';
import {
  describeReviewEvent,
  describeReviews,
  detectReviewEvents,
  lastPublishedFromDraft,
  ReviewerPullRequest,
  ReviewEvent,
  ReviewRequest,
  ReviewRequestModel,
  ReviewRules,
  splitOptional,
  StoredReviewRequests,
  toReviewModels,
  toReviewRequests,
  withPublishedDates,
} from './reviewRequests';
import {
  describeObservationEvent,
  detectObservationEvents,
  hasOpenObservations,
  myObservations,
  ObservationEvent,
  ObservedPullRequest,
  StoredObservations,
  threadUrl,
  ThreadResponse,
  toStoredObservations,
} from './reviewThreads';
import {
  listsClosedReviews,
  ReviewedPeriod,
  reviewedIdsToDrop,
  reviewedIdsToFetch,
  reviewedPeriodSetting,
  ReviewedRef,
  ReviewedRequest,
  toReviewedDetails,
  toReviewedRequests,
} from './reviewedRequests';
import type { Layout } from './viewModel';
import { WorkItemsStore } from './workItemsStore';

/** What is fetched about a PR to review besides the PR itself */
interface ReviewCardData {
  pr: ReviewerPullRequest;
  extras: PullRequestExtras;
  filesChanged?: FilesChanged;
}

const MS_PER_SECOND = 1000;
/** Time left is refreshed this often in the views, without checking Azure DevOps */
const TICK_MS = 60 * MS_PER_SECOND;
const MIN_INTERVAL_SECONDS = 30;
/** Above this, a single summary notification is shown instead of one per event */
const MAX_NOTIFICATIONS = 3;
/** The PRs already completed or abandoned change little: they are fetched again after this long */
const CLOSED_REVIEWS_MAX_AGE_MS = 10 * 60 * MS_PER_SECOND;
/** The sidebar shows the PRs waiting for review above the work items */
const SHOW_LIST_COMMAND = 'totalflowx.myItems.focus';
export const CHECKOUT_REVIEW_COMMAND = 'totalflowx.checkoutPullRequest';

export type ReviewNotification = ObservationEvent['kind'] | ReviewEvent['kind'] | 'digest';

export function reviewSettings(): ReviewRules & {
  includeOptional: boolean;
  reviewedPeriod: ReviewedPeriod;
  layout: Layout;
  notifications: ReviewNotification[];
  intervalSeconds: number;
  showInStatusBar: boolean;
} {
  const config = vscode.workspace.getConfiguration(`${SECTION}.reviews`);
  return {
    includeOptional: config.get<boolean>('includeOptional', false),
    reviewedPeriod: reviewedPeriodSetting(config.get<string>('reviewedPeriod', 'hidden')),
    layout: config.get<Layout>('layout', 'compact') === 'large' ? 'large' : 'compact',
    maxWaitHours: config.get<number>('maxWaitHours', 24),
    workingDays: workingDaysSetting(),
    dueSoonHours: config.get<number>('dueSoonHours', 6),
    remindOverdueEveryHours: config.get<number>('remindOverdueEveryHours', 4),
    notifications: config.get<ReviewNotification[]>('notifications', [
      'requested',
      'dueSoon',
      'overdue',
      'digest',
      'replied',
      'resolved',
    ]),
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, config.get<number>('pollIntervalSeconds', 120)),
    showInStatusBar: config.get<boolean>('showInStatusBar', true),
  };
}

function toObserved(pr: ReviewerPullRequest): ObservedPullRequest {
  return { id: pr.pullRequestId, title: pr.title, url: pr.webUrl, repositoryId: pr.repository.id };
}

/**
 * Polls the PRs the user reviews. Notifies new review requests, PRs getting close to the maximum wait and
 * overdue ones (plus a digest on the first check of the day), and replies to and resolutions of the comment
 * threads the user started.
 * What was notified is kept in the global state: what happened while VS Code was closed is notified on startup,
 * and windows sharing the state do not notify the same thing twice
 */
export class ReviewRequestsWatcher implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  /**
   * Required requests first, then the optional ones, the most urgent first in each group. All of them, shown or
   * not: whether the optional ones are shown is a setting of the view, applied by shown()
   */
  requests: ReviewRequest[] = [];
  /**
   * PRs where the user is a reviewer, active ones (from the poll) and closed ones (fetched only while the period
   * of "Reviewed" has a window). Kept apart from `requests`: they never count in the badge, the urgency, the
   * Summary view, the digest or the notifications
   */
  private activeReviewed: ReviewerPullRequest[] = [];
  private closedReviewed: ReviewerPullRequest[] = [];
  private closedReviewedAt = 0;
  status: 'error' | 'loading' | 'ready' = 'loading';
  error?: string;
  private timer?: NodeJS.Timeout;
  private ticker?: NodeJS.Timeout;
  private polling = false;
  private myId?: Promise<string>;
  /** The user, once known */
  private userId?: string;
  /** What each card shows besides its urgency; a part is missing when it could not be fetched */
  private details = new Map<number, ReviewCardData>();
  /** Reviewed PRs the user has unfolded in the sidebar (sent by the webview): the only ones whose details are fetched */
  private reviewedExpanded = new Set<number>();
  /**
   * Details of the unfolded reviewed PRs. Those of closed PRs stay for the session (they do not change); those of
   * active ones are refreshed at each check while unfolded, and forgotten when folded
   */
  private readonly reviewedDetails = new Map<number, ReviewCardData>();
  private readonly reviewedLoading = new Set<number>();
  /** Files changed per PR in its latest iteration: a new push is the only thing that changes them */
  private readonly filesChanged = new Map<number, { iteration: number; files: FilesChanged }>();
  /** The last answer of Azure DevOps, to fetch the details of the optional PRs when the user shows them */
  private last?: { client: AzdoClient; pullRequests: ReviewerPullRequest[]; threads: Map<number, ThreadResponse[]> };

  constructor(
    private readonly state: vscode.Memento,
    private readonly store: WorkItemsStore,
    private readonly extras: PullRequestExtrasLoader
  ) {}

  /** Requests that count: the required ones, and the optional ones when `includeOptional` is on */
  private shown(): { requests: ReviewRequest[]; hiddenOptional: number } {
    const { shown, hiddenOptional } = splitOptional(this.requests, reviewSettings().includeOptional);
    return { requests: shown, hiddenOptional };
  }

  /**
   * The PRs already reviewed by the user, for the box's "Reviewed" section only. Nothing else may use them: see
   * `activeReviewed`
   */
  reviewed(): ReviewedRequest[] {
    const { baseBranch } = extensionSettings();
    const { minimumRequiredReviewers } = myPullRequestSettings();
    return this.listedReviewed().map((request) => {
      const data = this.reviewedDetails.get(request.id);
      return {
        ...request,
        details:
          data && this.userId
            ? toReviewedDetails(
                {
                  ...data,
                  myId: this.userId,
                  extras: { ...data.extras, runs: this.store.runsOf(request.id) ?? data.extras.runs },
                },
                { baseBranch, minimumRequiredReviewers }
              )
            : undefined,
      };
    });
  }

  /** The reviewed PRs of the period, without details */
  private listedReviewed(): ReviewedRequest[] {
    return this.userId
      ? toReviewedRequests(
          [...this.activeReviewed, ...this.closedReviewed],
          this.userId,
          new Date(),
          reviewSettings().reviewedPeriod
        )
      : [];
  }

  /**
   * The webview tells which reviewed PRs are unfolded. Their details are fetched now when missing (closed PRs
   * only the first time); folded active ones lose theirs, so they stop being refreshed
   */
  setReviewedExpanded(ids: number[]): Promise<void> {
    return withFeature('reviews', async () => {
      this.reviewedExpanded = new Set(ids);
      const dropped = this.dropReviewedDetails();
      let loaded = 0;
      try {
        loaded = await this.loadReviewedDetails(false);
      } finally {
        if (loaded || dropped) {
          this.changed.fire();
        }
      }
    });
  }

  private dropReviewedDetails(): number {
    const known: ReviewedRef[] = [...this.reviewedDetails].map(([id, { pr }]) => ({
      id,
      status: pr.status === 'completed' || pr.status === 'abandoned' ? pr.status : 'active',
    }));
    const dropped = reviewedIdsToDrop(known, this.listedReviewed(), this.reviewedExpanded);
    dropped.forEach((id) => this.reviewedDetails.delete(id));
    return dropped.length;
  }

  /**
   * Fetches the details of the unfolded reviewed PRs that need them (see reviewedIdsToFetch); `refreshActive` is
   * set by the check, which has just read the threads of the active PRs. A PR whose details fail stays "loading"
   * and is tried again at the next check. Returns how many were fetched
   */
  private async loadReviewedDetails(refreshActive: boolean): Promise<number> {
    const ids = reviewedIdsToFetch(
      this.listedReviewed(),
      this.reviewedExpanded,
      (id) => this.reviewedDetails.has(id),
      refreshActive
    ).filter((id) => !this.reviewedLoading.has(id));
    const all = [...this.activeReviewed, ...this.closedReviewed];
    const prs = ids.flatMap((id) => all.filter((pr) => pr.pullRequestId === id).slice(0, 1));
    if (!prs.length) {
      return 0;
    }
    try {
      const { client } = resolveContext(this.store.repository());
      prs.forEach(({ pullRequestId }) => this.reviewedLoading.add(pullRequestId));
      await Promise.all(prs.map((pr) => this.loadReviewedDetailsOf(client, pr, refreshActive)));
      return prs.length;
    } catch {
      return 0;
    } finally {
      prs.forEach(({ pullRequestId }) => this.reviewedLoading.delete(pullRequestId));
    }
  }

  private async loadReviewedDetailsOf(client: AzdoClient, pr: ReviewerPullRequest, refreshed: boolean): Promise<void> {
    // The check has just read the threads of the active PRs
    const known = refreshed && pr.status === 'active' ? this.last?.threads.get(pr.pullRequestId) : undefined;
    const [extras, filesChanged] = await Promise.all([
      this.extras.fetch(client, pr, known),
      this.fetchFilesChanged(client, pr),
    ]);
    this.reviewedDetails.set(pr.pullRequestId, { pr, extras, filesChanged });
  }

  /** Optional requests not listed because of `includeOptional` */
  hiddenOptional(): number {
    return this.shown().hiddenOptional;
  }

  /**
   * The shown requests with their urgency, time left and whether their branch can be checked out, right now.
   * Notifications, the digest, the status bar and the badge use these: the optional PRs only count when the user
   * chose to see them
   */
  models(): ReviewRequestModel[] {
    const local = this.localRepository();
    const { baseBranch } = extensionSettings();
    const { minimumRequiredReviewers } = myPullRequestSettings();
    return toReviewModels(this.shown().requests, new Date(), reviewSettings()).map((model) => {
      const canCheckout = !!local && model.repository.toLowerCase() === local.name.toLowerCase();
      const isCurrentBranch = canCheckout && local.head === model.sourceBranch;
      const data = this.details.get(model.id);
      return {
        ...model,
        details:
          data && this.userId
            ? toReviewDetails(
                {
                  ...data,
                  myId: this.userId,
                  // The store follows the PRs linked to the work items and refreshes their runs every few seconds
                  extras: { ...data.extras, runs: this.store.runsOf(model.id) ?? data.extras.runs },
                },
                { baseBranch, minimumRequiredReviewers }
              )
            : undefined,
        canCheckout,
        isCurrentBranch,
        worktree: canCheckout && !isCurrentBranch ? this.store.worktreeFor(model.sourceBranch)?.path : undefined,
      };
    });
  }

  start(): void {
    this.stop();
    void this.poll();
    this.timer = setInterval(() => void this.poll(), reviewSettings().intervalSeconds * MS_PER_SECOND);
    this.ticker = setInterval(() => this.requests.length && this.changed.fire(), TICK_MS);
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.ticker);
    this.timer = undefined;
  }

  dispose(): void {
    this.stop();
    this.changed.dispose();
  }

  /** `manual`: the user asked to check now, so the closed PRs of "Reviewed" are fetched again too */
  poll(manual = false): Promise<void> {
    return withFeature('reviews', async () => {
      await this.runPoll(manual);
    });
  }

  /**
   * The user chose a period with a window for "Reviewed": fetches the closed PRs when not known yet. The active
   * ones are already known from the poll
   */
  refreshReviewed(): Promise<void> {
    return withFeature('reviews', async () => {
      if (this.userId && !this.polling) {
        try {
          await this.loadClosedReviewed(false);
          await this.loadReviewedDetails(false);
        } finally {
          this.changed.fire();
        }
      }
    });
  }

  /**
   * One request for the PRs completed or abandoned where the user is a reviewer, only while the period lists
   * them and no more often than CLOSED_REVIEWS_MAX_AGE_MS. A failure keeps the previous list: the rest of the
   * box does not depend on it
   */
  private async loadClosedReviewed(force: boolean): Promise<void> {
    if (!this.userId || !listsClosedReviews(reviewSettings().reviewedPeriod)) {
      return;
    }
    if (!force && Date.now() - this.closedReviewedAt < CLOSED_REVIEWS_MAX_AGE_MS) {
      return;
    }
    try {
      const { client } = resolveContext(this.store.repository());
      this.closedReviewed = (await client.getReviewedPullRequests(this.userId)).filter((pr) => pr.status !== 'active');
      this.closedReviewedAt = Date.now();
    } catch {
      // Not essential: tried again at the next check
    }
  }

  private async runPoll(manual: boolean): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      this.myId ??= client.getMyId();
      const myId = await this.myId;
      this.userId = myId;
      const settings = reviewSettings();
      const scope = `${client.organization}/${client.project}`;
      const pullRequests = (await client.getPullRequestsToReview(myId)).filter((pr) => pr.createdBy.id !== myId);
      const observationsKey = `reviewObservations:${scope}`;
      // PRs completed (or abandoned) with observations still open are checked one last time: authors often
      // resolve the threads right before completing the PR
      const finished = Object.values(this.state.get<StoredObservations>(observationsKey) ?? {}).filter(
        (stored) =>
          !!stored && !pullRequests.some((pr) => pr.pullRequestId === stored.id) && hasOpenObservations(stored)
      ) as ObservedPullRequest[];
      const active = pullRequests.map(toObserved);
      const threads = await this.readThreads(client, [...active, ...finished]);

      const requests = toReviewRequests(pullRequests, myId);
      const publishedDates = new Map(requests.map(({ id }) => [id, lastPublishedFromDraft(threads.get(id) ?? [])]));
      this.requests = withPublishedDates(requests, publishedDates);
      this.activeReviewed = pullRequests;
      this.status = 'ready';
      this.error = undefined;
      // The cards are shown right away; their details come as they are fetched
      this.changed.fire();

      const requestsKey = `reviewRequests.v2:${scope}`;
      // Read just before comparing: another window may have stored a newer state meanwhile
      // The stored state tracks every request, optional ones included: switching "include optional" on later
      // then finds them known, and the user is not flooded with "new request" notifications. Only the events of
      // the shown requests are notified, and the digest needs one of them
      const detected = detectReviewEvents(
        this.state.get<StoredReviewRequests>(requestsKey),
        this.requests,
        new Date(),
        settings
      );
      const shownIds = new Set(this.shown().requests.map(({ id }) => id));
      const events = detected.events.filter((event) => shownIds.has(event.request.id));
      const digest = detected.digest && shownIds.size > 0;
      await this.state.update(requestsKey, detected.stored);
      const observationEvents = await this.updateObservations(observationsKey, active, finished, threads, myId);

      if (digest && settings.notifications.includes('digest')) {
        // It lists every PR: the other notifications about review requests are not needed
        void this.showDigest();
      } else {
        this.notify(events.filter((event) => settings.notifications.includes(event.kind)));
      }
      this.notifyObservations(observationEvents.filter((event) => settings.notifications.includes(event.kind)));
      this.last = { client, pullRequests, threads };
      await this.loadDetails(client, pullRequests, threads);
      await this.loadClosedReviewed(manual);
      // Only the unfolded reviewed PRs: closed ones are fetched once, active ones at every check
      this.dropReviewedDetails();
      await this.loadReviewedDetails(true);
    } catch (error) {
      this.myId = undefined;
      this.status = 'error';
      this.error = (error as Error).message;
    } finally {
      this.polling = false;
      this.changed.fire();
    }
  }

  /**
   * Fetches the details of the optional PRs the user has just chosen to show, from the last check: no need to
   * list the PRs again
   */
  refreshDetails(): Promise<void> {
    return withFeature('reviews', () => this.runRefreshDetails());
  }

  private async runRefreshDetails(): Promise<void> {
    if (this.polling || !this.last) {
      return;
    }
    const { client, pullRequests, threads } = this.last;
    try {
      await this.loadDetails(client, pullRequests, threads);
    } finally {
      this.changed.fire();
    }
  }

  /**
   * Details of the PRs shown. What cannot be fetched is left out of the card, not of the others. The hidden
   * optional PRs are not fetched
   */
  private async loadDetails(
    client: AzdoClient,
    pullRequests: ReviewerPullRequest[],
    threads: Map<number, ThreadResponse[]>
  ): Promise<void> {
    const shown = this.shown().requests;
    const waiting = pullRequests.filter(({ pullRequestId }) => shown.some(({ id }) => id === pullRequestId));
    const entries = await Promise.all(
      waiting.map(async (pr): Promise<[number, ReviewCardData]> => {
        const [extras, filesChanged] = await Promise.all([
          this.extras.fetch(client, pr, threads.get(pr.pullRequestId)),
          this.fetchFilesChanged(client, pr),
        ]);
        return [pr.pullRequestId, { pr, extras, filesChanged }];
      })
    );
    this.details = new Map(entries);
    for (const id of [...this.filesChanged.keys()]) {
      if (!this.details.has(id) && !this.reviewedDetails.has(id)) {
        this.filesChanged.delete(id);
      }
    }
  }

  /** Files changed in the latest iteration; asked again only when a new iteration appears */
  private async fetchFilesChanged(client: AzdoClient, pr: ReviewerPullRequest): Promise<FilesChanged | undefined> {
    try {
      const iteration = await client.getLastIterationId(pr.repository.id, pr.pullRequestId);
      if (iteration === undefined) {
        return undefined;
      }
      const known = this.filesChanged.get(pr.pullRequestId);
      if (known?.iteration === iteration) {
        return known.files;
      }
      const { count, more } = await client.getIterationChangeCount(
        pr.repository.id,
        pr.pullRequestId,
        iteration,
        MAX_COUNTED_FILES
      );
      const files = { count, capped: more };
      this.filesChanged.set(pr.pullRequestId, { iteration, files });
      return files;
    } catch {
      return undefined;
    }
  }

  /** Threads of each PR. Those that cannot be read are left out: the PR is checked again next time */
  private async readThreads(
    client: AzdoClient,
    pullRequests: ObservedPullRequest[]
  ): Promise<Map<number, ThreadResponse[]>> {
    const threads = new Map<number, ThreadResponse[]>();
    await Promise.all(
      pullRequests.map(async ({ id, repositoryId }) => {
        try {
          threads.set(id, await client.getPullRequestThreads(repositoryId, id));
        } catch {
          // E.g. a PR whose repository was deleted, or a network error
        }
      })
    );
    return threads;
  }

  /** Replies and resolutions of the user's observations; finished PRs are forgotten after their last check */
  private async updateObservations(
    key: string,
    active: ObservedPullRequest[],
    finished: ObservedPullRequest[],
    threads: Map<number, ThreadResponse[]>,
    myId: string
  ): Promise<ObservationEvent[]> {
    const previous = this.state.get<StoredObservations>(key);
    const next: StoredObservations = {};
    const events: ObservationEvent[] = [];
    for (const pullRequest of [...active, ...finished]) {
      const known = previous?.[pullRequest.id];
      if (!threads.has(pullRequest.id)) {
        // Not read this time: keep what is known, or every comment would look new next time
        if (known) {
          next[pullRequest.id] = known;
        }
        continue;
      }
      const observations = myObservations(threads.get(pullRequest.id) ?? [], myId);
      events.push(...detectObservationEvents(known, pullRequest, observations, myId));
      if (active.includes(pullRequest)) {
        next[pullRequest.id] = toStoredObservations(pullRequest, observations);
      }
    }
    await this.state.update(key, next);
    return events;
  }

  private notify(events: ReviewEvent[]): void {
    if (events.length > MAX_NOTIFICATIONS) {
      void this.showDigest();
      return;
    }
    for (const event of events) {
      void this.show(event);
    }
  }

  /** "Open PR", and "Checkout" when the PR belongs to the repository open in VS Code */
  private async show(event: ReviewEvent): Promise<void> {
    const message = describeReviewEvent(event, new Date(), reviewSettings());
    const model = this.models().find((request) => request.id === event.request.id);
    const actions = ['Open PR', ...(model?.canCheckout && !model.isCurrentBranch ? ['Checkout'] : [])];
    const picked =
      event.kind === 'requested'
        ? await vscode.window.showInformationMessage(message, ...actions)
        : await vscode.window.showWarningMessage(message, ...actions);
    if (picked === 'Open PR') {
      await vscode.env.openExternal(vscode.Uri.parse(event.request.url));
    } else if (picked === 'Checkout') {
      await vscode.commands.executeCommand(CHECKOUT_REVIEW_COMMAND, event.request.id);
    }
  }

  /** One notification for all the PRs waiting for review; "Show" opens the list in the sidebar */
  private async showDigest(): Promise<void> {
    const models = this.models();
    const message = describeReviews(models);
    const show = models.some((model) => model.urgency !== 'fresh')
      ? await vscode.window.showWarningMessage(message, 'Show')
      : await vscode.window.showInformationMessage(message, 'Show');
    if (show) {
      await vscode.commands.executeCommand(SHOW_LIST_COMMAND);
    }
  }

  private notifyObservations(events: ObservationEvent[]): void {
    if (events.length > MAX_NOTIFICATIONS) {
      void this.showObservationsSummary(events);
      return;
    }
    for (const event of events) {
      void this.showObservation(event);
    }
  }

  private async showObservation(event: ObservationEvent): Promise<void> {
    const open = await vscode.window.showInformationMessage(describeObservationEvent(event), 'Open Comment');
    if (open) {
      await vscode.env.openExternal(vscode.Uri.parse(threadUrl(event.pullRequest.url, event.observation.threadId)));
    }
  }

  private async showObservationsSummary(events: ObservationEvent[]): Promise<void> {
    const show = await vscode.window.showInformationMessage(
      `${events.length} of your review comments were answered or resolved`,
      'Show'
    );
    if (!show) {
      return;
    }
    const picked = await vscode.window.showQuickPick(
      events.map((event) => ({
        label: describeObservationEvent(event),
        url: threadUrl(event.pullRequest.url, event.observation.threadId),
      })),
      { title: 'Your review comments', placeHolder: 'Select one to open it in the PR' }
    );
    if (picked) {
      await vscode.env.openExternal(vscode.Uri.parse(picked.url));
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
