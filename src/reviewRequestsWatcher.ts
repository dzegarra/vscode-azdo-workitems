import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { resolveContext, SECTION } from './config';
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
import { WorkItemsStore } from './workItemsStore';

const MS_PER_SECOND = 1000;
/** Time left is refreshed this often in the views, without checking Azure DevOps */
const TICK_MS = 60 * MS_PER_SECOND;
const MIN_INTERVAL_SECONDS = 30;
/** Above this, a single summary notification is shown instead of one per event */
const MAX_NOTIFICATIONS = 3;
/** The sidebar shows the PRs waiting for review above the work items */
const SHOW_LIST_COMMAND = 'azdoWorkItems.myItems.focus';
export const CHECKOUT_REVIEW_COMMAND = 'azdoWorkItems.checkoutPullRequest';

export type ReviewNotification = ObservationEvent['kind'] | ReviewEvent['kind'] | 'digest';

export function reviewSettings(): ReviewRules & {
  includeOptional: boolean;
  notifications: ReviewNotification[];
  intervalSeconds: number;
  showInStatusBar: boolean;
} {
  const config = vscode.workspace.getConfiguration(`${SECTION}.reviews`);
  return {
    includeOptional: config.get<boolean>('includeOptional', false),
    maxWaitHours: config.get<number>('maxWaitHours', 24),
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
  /** Oldest first, so the most urgent first */
  requests: ReviewRequest[] = [];
  status: 'error' | 'loading' | 'ready' = 'loading';
  error?: string;
  private timer?: NodeJS.Timeout;
  private ticker?: NodeJS.Timeout;
  private polling = false;
  private myId?: Promise<string>;

  constructor(private readonly state: vscode.Memento, private readonly store: WorkItemsStore) {}

  /** The requests with their urgency, time left and whether their branch can be checked out, right now */
  models(): ReviewRequestModel[] {
    const local = this.localRepository();
    return toReviewModels(this.requests, new Date(), reviewSettings()).map((model) => {
      const canCheckout = !!local && model.repository.toLowerCase() === local.name.toLowerCase();
      const isCurrentBranch = canCheckout && local.head === model.sourceBranch;
      return {
        ...model,
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

  async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const { client } = resolveContext(this.store.repository());
      this.myId ??= client.getMyId();
      const myId = await this.myId;
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

      const requests = toReviewRequests(pullRequests, myId, settings.includeOptional);
      const publishedDates = new Map(requests.map(({ id }) => [id, lastPublishedFromDraft(threads.get(id) ?? [])]));
      this.requests = withPublishedDates(requests, publishedDates);
      this.status = 'ready';
      this.error = undefined;

      const requestsKey = `reviewRequests.v2:${scope}`;
      // Read just before comparing: another window may have stored a newer state meanwhile
      const { events, digest, stored } = detectReviewEvents(
        this.state.get<StoredReviewRequests>(requestsKey),
        this.requests,
        new Date(),
        settings
      );
      await this.state.update(requestsKey, stored);
      const observationEvents = await this.updateObservations(observationsKey, active, finished, threads, myId);

      if (digest && settings.notifications.includes('digest')) {
        // It lists every PR: the other notifications about review requests are not needed
        void this.showDigest();
      } else {
        this.notify(events.filter((event) => settings.notifications.includes(event.kind)));
      }
      this.notifyObservations(observationEvents.filter((event) => settings.notifications.includes(event.kind)));
    } catch (error) {
      this.myId = undefined;
      this.status = 'error';
      this.error = (error as Error).message;
    } finally {
      this.polling = false;
      this.changed.fire();
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
    const message = describeReviewEvent(event, new Date(), reviewSettings().maxWaitHours);
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
