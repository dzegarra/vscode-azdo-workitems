import * as vscode from 'vscode';
import { AzdoClient, PullRequestDetails } from './azdoClient';
import { resolveContext, SECTION } from './config';
import {
  describeEvent,
  detectEvents,
  PullRequestEvent,
  PullRequestEventKind,
  PullRequestSnapshot,
  StoredSnapshot,
  toStored,
} from './pullRequestEvents';
import { WorkItemsStore } from './workItemsStore';

const MS_PER_SECOND = 1000;
const MIN_INTERVAL_SECONDS = 30;
/** Above this, a single summary notification is shown instead of one per event */
const MAX_NOTIFICATIONS = 3;

function notificationSettings() {
  const config = vscode.workspace.getConfiguration(`${SECTION}.notifications`);
  return {
    events: config.get<PullRequestEventKind[]>('events', ['comments', 'vote', 'merged']),
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, config.get<number>('pollIntervalSeconds', 120)),
  };
}

async function toSnapshot(client: AzdoClient, pr: PullRequestDetails): Promise<PullRequestSnapshot> {
  // Only active PRs get new comments; skipping the others saves requests
  const comments =
    pr.status === 'active'
      ? (await client.getPullRequestComments(pr.repository.id, pr.pullRequestId)).map((comment) => ({
          key: `${comment.threadId}:${comment.id}`,
          authorId: comment.authorId,
          author: comment.author,
          content: comment.content,
        }))
      : undefined;
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: pr.status,
    url: pr.webUrl,
    reviewers: pr.reviewers
      .filter((reviewer) => reviewer.id && !reviewer.isContainer)
      .map((reviewer) => ({ id: reviewer.id as string, name: reviewer.displayName, vote: reviewer.vote })),
    comments,
  };
}

/**
 * Polls the PRs created by the user and notifies new comments, votes and merges.
 * The last snapshot is kept in the global state: events that happened while VS Code was closed
 * are notified on startup, and windows sharing the state do not notify the same event twice
 */
export class PullRequestNotifier implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private polling = false;
  private myId?: Promise<string>;

  constructor(private readonly state: vscode.Memento, private readonly store: WorkItemsStore) {}

  start(): void {
    this.stop();
    const { events, intervalSeconds } = notificationSettings();
    if (!events.length) {
      return;
    }
    void this.poll();
    this.timer = setInterval(() => void this.poll(), intervalSeconds * MS_PER_SECOND);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  dispose(): void {
    this.stop();
  }

  /** Checks the PRs now. Errors are only reported when the user asked for the check */
  async poll(reportErrors = false): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const { client } = resolveContext(this.store.repository());
      this.myId ??= client.getMyId();
      const myId = await this.myId;
      const key = `pullRequests:${client.organization}/${client.project}`;
      const pullRequests = await client.getPullRequestsCreatedBy(myId);
      const current = await Promise.all(pullRequests.map((pr) => toSnapshot(client, pr)));
      // Read just before comparing: another window may have stored a newer snapshot meanwhile
      const previous = this.state.get<StoredSnapshot>(key);
      await this.state.update(key, toStored(current, previous ?? {}));
      if (previous) {
        this.notify(detectEvents(previous, current, myId));
      }
    } catch (error) {
      this.myId = undefined;
      if (reportErrors) {
        void vscode.window.showErrorMessage(`Unable to check your pull requests: ${(error as Error).message}`);
      }
    } finally {
      this.polling = false;
    }
  }

  private notify(allEvents: PullRequestEvent[]): void {
    const enabled = notificationSettings().events;
    const events = allEvents.filter((event) => enabled.includes(event.kind));
    if (!events.length) {
      return;
    }
    // PR states shown in the work items view may have changed
    void this.store.refresh();
    if (events.length > MAX_NOTIFICATIONS) {
      void this.showSummary(events);
      return;
    }
    for (const event of events) {
      void this.show(event);
    }
  }

  private async show(event: PullRequestEvent): Promise<void> {
    const open = await vscode.window.showInformationMessage(describeEvent(event), 'Open PR');
    if (open) {
      await vscode.env.openExternal(vscode.Uri.parse(event.pullRequest.url));
    }
  }

  private async showSummary(events: PullRequestEvent[]): Promise<void> {
    const pullRequests = new Set(events.map((event) => event.pullRequest.id));
    const show = await vscode.window.showInformationMessage(
      `${events.length} updates on ${pullRequests.size} of your pull requests`,
      'Show'
    );
    if (!show) {
      return;
    }
    const picked = await vscode.window.showQuickPick(
      events.map((event) => ({ label: describeEvent(event), url: event.pullRequest.url })),
      { title: 'Updates on your pull requests', placeHolder: 'Select one to open the PR' }
    );
    if (picked) {
      await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    }
  }
}
