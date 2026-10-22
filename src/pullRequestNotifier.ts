import { withFeature } from './requestContext';
import * as vscode from 'vscode';
import { AzdoClient, PullRequestDetails } from './azdoClient';
import { approvalSpeedNote, mergedCelebration } from './celebrations';
import { funEnabled, recordsScope, resolveContext, SECTION } from './config';
import { FunJournal, recordOpened, recordPullRequestEvents } from './funJournal';
import { FunJournalStore } from './funJournalStore';
import { publishedAt } from './pullRequestTimeline';
import { isInSprint } from './sprintCountdown';
import {
  commentThreadId,
  describeEvent,
  detectEvents,
  PullRequestEvent,
  PullRequestEventKind,
  PullRequestSnapshot,
  StoredSnapshot,
  toStored,
} from './pullRequestEvents';
import { offerCompletedPullRequest } from './commands/pullRequestTask';
import { snapshotThreads } from './pullRequestThreadSnapshots';
import { threadUrl } from './reviewThreads';
import { WorkItemsStore } from './workItemsStore';

const MS_PER_SECOND = 1000;
const MIN_INTERVAL_SECONDS = 30;
/** Above this, a single summary notification is shown instead of one per event */
const MAX_NOTIFICATIONS = 3;

/** The events of the PRs, plus the offer to set the task of a completed PR to Done */
type NotificationKind = PullRequestEventKind | 'taskDone';

function notificationSettings() {
  const config = vscode.workspace.getConfiguration(`${SECTION}.myPullRequests`);
  return {
    events: config.get<NotificationKind[]>('notifications', [
      'comments',
      'vote',
      'merged',
      'reviewers',
      'reopened',
      'taskDone',
    ]),
    intervalSeconds: Math.max(MIN_INTERVAL_SECONDS, config.get<number>('notificationsPollIntervalSeconds', 120)),
  };
}

/** Comment events open their thread; the others (or "Open PR") the PR */
function eventUrl(event: PullRequestEvent, preferComment: boolean): string {
  const threadId = commentThreadId(event);
  return preferComment && threadId !== undefined ? threadUrl(event.pullRequest.url, threadId) : event.pullRequest.url;
}

async function toSnapshot(client: AzdoClient, pr: PullRequestDetails): Promise<PullRequestSnapshot> {
  // Only active PRs get new comments; skipping the others saves requests
  const rawThreads =
    pr.status === 'active' ? await client.getPullRequestThreads(pr.repository.id, pr.pullRequestId) : undefined;
  const threads = rawThreads && snapshotThreads(rawThreads);
  return {
    id: pr.pullRequestId,
    title: pr.title,
    status: pr.status,
    url: pr.webUrl,
    publishedAt: pr.creationDate && publishedAt({ creationDate: pr.creationDate }, rawThreads),
    closedAt: pr.closedDate,
    reviewers: pr.reviewers
      .filter((reviewer) => reviewer.id && !reviewer.isContainer)
      .map((reviewer) => ({
        id: reviewer.id as string,
        name: reviewer.displayName,
        vote: reviewer.vote,
        required: !!reviewer.isRequired,
        declined: !!reviewer.hasDeclined,
      })),
    ...threads,
  };
}

/**
 * Polls the PRs created by the user and notifies new comments, reopened comments, reviewer changes, votes and merges.
 * The last snapshot is kept in the global state: events that happened while VS Code was closed
 * are notified on startup, and windows sharing the state do not notify the same event twice
 */
export class PullRequestNotifier implements vscode.Disposable {
  private timer?: NodeJS.Timeout;
  private polling = false;
  private myId?: Promise<string>;

  constructor(
    private readonly state: vscode.Memento,
    private readonly store: WorkItemsStore,
    private readonly journal: FunJournalStore,
    /** Throws the confetti of a merged PR in the sidebar (when it is open), with its sound when they are on */
    private readonly celebrate: () => void
  ) {}

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
  poll(reportErrors = false): Promise<void> {
    return withFeature('notifications', () => this.runPoll(reportErrors));
  }

  private async runPoll(reportErrors: boolean): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      await this.store.whenRepositoryReady();
      const { client } = resolveContext(this.store.repository());
      this.myId ??= client.getMyId();
      const myId = await this.myId;
      const key = `pullRequests:${client.organization}/${client.project}`;
      const pullRequests = await client.getPullRequestsCreatedBy(myId);
      const current = await Promise.all(pullRequests.map((pr) => toSnapshot(client, pr)));
      // Read just before comparing: another window may have stored a newer snapshot meanwhile
      const previous = this.state.get<StoredSnapshot>(key);
      await this.state.update(key, toStored(current, previous ?? {}));
      const events = previous ? detectEvents(previous, current, myId) : [];
      // The snapshot is stored: a failure of the fun features must not lose these events
      const notes = await this.recordJournal(pullRequests, events).catch(() => new Map<string, string>());
      this.notify(events, notes);
    } catch (error) {
      this.myId = undefined;
      if (reportErrors) {
        void vscode.window.showErrorMessage(`Unable to check your pull requests: ${(error as Error).message}`);
      }
    } finally {
      this.polling = false;
    }
  }

  // Rule FUN-RUN-5
  /**
   * Records the opened PRs, the merges and the first approvals in the fun journal (also while the fun features are
   * off, for the recap). Returns the celebration texts that replace the plain ones, per PR, when the features are on
   */
  private async recordJournal(
    pullRequests: PullRequestDetails[],
    events: PullRequestEvent[]
  ): Promise<Map<string, string>> {
    const notes = new Map<string, string>();
    const scope = recordsScope(this.store.repository());
    if (!scope) {
      return notes;
    }
    let firstApprovals = new Map<number, number | undefined>();
    const { after } = await this.journal.update(scope, (journal) => {
      const opened = recordOpened(
        journal,
        pullRequests.flatMap((pr) => (pr.creationDate ? [{ id: pr.pullRequestId, at: pr.creationDate }] : []))
      );
      const recorded = recordPullRequestEvents(opened, events, new Date());
      firstApprovals = recorded.firstApprovals;
      return recorded.journal;
    });
    if (!funEnabled()) {
      return notes;
    }
    for (const event of events) {
      const { pullRequest } = event;
      if (event.kind === 'merged') {
        notes.set(`merged:${String(pullRequest.id)}`, this.mergedText(after, pullRequest));
      } else if (event.kind === 'vote' && firstApprovals.has(pullRequest.id)) {
        const note = approvalSpeedNote(firstApprovals.get(pullRequest.id));
        if (note) {
          notes.set(`vote:${String(pullRequest.id)}:${event.reviewer.id}`, `${describeEvent(event)} ${note}`);
        }
      }
    }
    return notes;
  }

  /** "🚀 PR 1234 shipped: Title. Your 3rd this sprint!" */
  private mergedText(journal: FunJournal, pullRequest: { id: number; title: string }): string {
    const merge = journal.merged.find((entry) => entry.id === pullRequest.id);
    const sprint = this.store.iterations
      .map(({ iteration }) => iteration.attributes)
      .find((dates) => merge && isInSprint(merge.mergedAt, dates?.startDate, dates?.finishDate));
    const thisSprint = sprint
      ? journal.merged.filter((entry) => isInSprint(entry.mergedAt, sprint.startDate, sprint.finishDate)).length
      : undefined;
    return mergedCelebration(pullRequest, { thisSprint, total: journal.merged.length });
  }

  private notify(allEvents: PullRequestEvent[], notes: Map<string, string>): void {
    const enabled = notificationSettings().events;
    const events = allEvents.filter((event) => enabled.includes(event.kind));
    const announce = enabled.includes('merged');
    // The baseline of detectEvents means PRs completed before the first poll are not offered. A completed PR gets
    // one notification: the offer to set its task Done and to delete its branch, or the plain "merged" when there is
    // nothing to offer
    allEvents
      .filter((event) => event.kind === 'merged' && (announce || enabled.includes('taskDone')))
      .forEach(
        (event) =>
          void this.handleMerged(
            event,
            enabled.includes('taskDone'),
            announce,
            notes.get(`merged:${String(event.pullRequest.id)}`)
          )
      );
    if (!events.length) {
      return;
    }
    // PR states shown in the work items view may have changed
    void this.store.refresh();
    // Completed PRs are shown by handleMerged
    const shown = events.filter((event) => event.kind !== 'merged');
    // Rule MYPR-NOTIF-7
    if (shown.length > MAX_NOTIFICATIONS) {
      void this.showSummary(shown);
      return;
    }
    for (const event of shown) {
      const text =
        event.kind === 'vote' ? notes.get(`vote:${String(event.pullRequest.id)}:${event.reviewer.id}`) : undefined;
      void this.show(event, text);
    }
  }

  /** The offer for a completed PR (tasks to Done, branch to delete); the plain notification when there is none */
  private async handleMerged(
    event: PullRequestEvent,
    offerTasks: boolean,
    announce: boolean,
    celebration: string | undefined
  ): Promise<void> {
    // Rule FUN-MERGE-3
    if (celebration) {
      this.celebrate();
    }
    let offered = false;
    try {
      const { client } = resolveContext(this.store.repository());
      const pr =
        this.store.findPullRequest(event.pullRequest.id) ?? (await client.getPullRequest(event.pullRequest.id));
      offered = await offerCompletedPullRequest(client, pr, {
        tasks: offerTasks,
        branch: await this.store.mergedBranchToDelete(client, pr),
        open: (url) => vscode.env.openExternal(vscode.Uri.parse(url)),
        deleteBranch: (branch) => vscode.commands.executeCommand('totalflowx.deleteBranch', undefined, branch),
      });
    } catch {
      // Only an offer: the task can be changed from the card and the branch deleted from there
    }
    // Rule MYPR-OFFER-3
    if (!offered && announce) {
      await this.show(event, celebration);
    }
  }

  /** The notification of an event; `text` replaces its description (a celebration) */
  private async show(event: PullRequestEvent, text?: string): Promise<void> {
    const threadId = commentThreadId(event);
    const buttons = threadId === undefined ? ['Open PR'] : ['Open Comment', 'Open PR'];
    const picked = await vscode.window.showInformationMessage(text ?? describeEvent(event), ...buttons);
    if (picked) {
      await vscode.env.openExternal(vscode.Uri.parse(eventUrl(event, picked === 'Open Comment')));
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
      events.map((event) => ({ label: describeEvent(event), url: eventUrl(event, true) })),
      { title: 'Updates on your pull requests', placeHolder: 'Select one to open it' }
    );
    if (picked) {
      await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    }
  }
}
