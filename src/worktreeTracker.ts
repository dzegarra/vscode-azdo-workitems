import * as vscode from 'vscode';
import { SECTION, worktreeSettings } from './config';
import type { MyPullRequestsWatcher } from './myPullRequestsWatcher';
import type { ReviewRequestsWatcher } from './reviewRequestsWatcher';
import type { WorkItemsStore } from './workItemsStore';
import { readBranchFacts, worktreeHasChangesInBackground } from './worktreeGit';
import {
  ActiveReview,
  BranchFacts,
  ClassifiedWorktree,
  classifyWorktrees,
  hygieneReasonsText,
  KnownPullRequest,
  KnownWorkItem,
  newlyStale,
  pruneOrigins,
  recordOrigin,
  worktreesToNotify,
  WorktreeOrigin,
} from './worktreeHygiene';
import { removableWorktrees, samePath, Worktree, worktreeLabel } from './worktrees';

/** Origins of the worktrees created by the extension (all repositories: the paths are absolute) */
const ORIGINS_KEY = 'totalflowx.worktreeOrigins';
/** Stale worktrees already notified, per main working tree */
const NOTIFIED_KEY_PREFIX = 'totalflowx.worktreeStaleNotified:';
/** The upstream tracking, the last commits and the uncommitted changes are read again after this long */
const GIT_MAX_AGE_MS = 5 * 60 * 1000;

export const CLEAN_UP_WORKTREES_COMMAND = 'totalflowx.cleanUpWorktrees';
export const REMOVE_WORKTREE_AT_COMMAND = 'totalflowx.removeWorktreeAt';
const SHOW_WORKTREES_COMMAND = 'totalflowx.worktrees.focus';

function isOrigin(value: unknown): value is WorktreeOrigin {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { path, branch, kind, id, createdAt } = value as Record<string, unknown>;
  return (
    typeof path === 'string' &&
    typeof branch === 'string' &&
    typeof kind === 'string' &&
    typeof id === 'number' &&
    typeof createdAt === 'string'
  );
}

function worktreesSignature(worktrees: readonly Worktree[]): string {
  return worktrees
    .map((worktree) => `${worktree.path}|${worktree.branch ?? ''}|${String(worktree.prunable)}`)
    .join('\n');
}

/** The parts of the extension the tracker reads */
export interface WorktreeTrackerSources {
  store: WorkItemsStore;
  reviews: ReviewRequestsWatcher;
  myPullRequests: MyPullRequestsWatcher;
}

/**
 * Tracks the worktrees of the repository: where each one came from (recorded when the extension creates it) and
 * whether it is still needed (src/worktreeHygiene.ts). Reads only what the store and the PR watchers already fetched,
 * plus local git: no request to Azure DevOps. Notifies once when a worktree becomes stale
 */
export class WorktreeTracker implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private classified: ClassifiedWorktree[] = [];
  private signature = '';
  private branchFacts = new Map<string, BranchFacts>();
  private dirtyFolders: string[] = [];
  /** When git was read, and for which worktrees */
  private gitReadAt = 0;
  /** A read of the repository completed: the git facts are not a guess any more */
  private gitRead = false;
  /**
   * The last answer of each source: a reload (the store is "loading" while it fetches) or a failed check keeps it,
   * so the rows do not flip to "in use" and back
   */
  private lastListed?: { pullRequests: KnownPullRequest[]; workItems: KnownWorkItem[] };
  private lastReviewed?: { active: ActiveReview[]; closed: KnownPullRequest[] };
  private gitWorktrees?: string;
  private reading?: Promise<void>;
  private nudges: Promise<void> = Promise.resolve();
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly state: vscode.Memento, private readonly sources: WorktreeTrackerSources) {
    this.subscriptions = [
      this.changed,
      sources.store.onDidChange(() => this.update()),
      sources.reviews.onDidChange(() => this.update()),
      sources.myPullRequests.onDidChange(() => this.update()),
      sources.store.onDidCreateWorktree(
        ({ path, branch, origin }) => void (origin && this.recordOrigin({ path, branch, ...origin }))
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('totalflowx.worktrees')) {
          this.classify();
        }
      }),
    ];
    this.update();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) {
      subscription.dispose();
    }
  }

  /** The worktrees that could be removed, classified */
  list(): ClassifiedWorktree[] {
    return this.classified;
  }

  stale(): ClassifiedWorktree[] {
    return this.classified.filter((item) => item.status === 'stale');
  }

  find(folder: string): ClassifiedWorktree | undefined {
    return this.classified.find((item) => samePath(item.worktree.path, folder));
  }

  // Rule WORKTREE-ORIGIN-1
  /** Remembers what a worktree the extension has just created is for */
  async recordOrigin(origin: Omit<WorktreeOrigin, 'createdAt'>): Promise<void> {
    await this.state.update(
      ORIGINS_KEY,
      recordOrigin(this.origins(), { ...origin, createdAt: new Date().toISOString() })
    );
    this.classify();
  }

  /** Lists the worktrees and reads git again (the Refresh of the view, the pickers) */
  async refresh(): Promise<void> {
    if (await this.sources.store.refreshWorktrees()) {
      this.sources.store.notify();
    }
    await this.readGit(true);
  }

  private origins(): WorktreeOrigin[] {
    const stored = this.state.get<unknown>(ORIGINS_KEY);
    return Array.isArray(stored) ? stored.filter(isOrigin) : [];
  }

  private update(): void {
    const signature = worktreesSignature(this.sources.store.worktrees);
    if (signature !== this.gitWorktrees || Date.now() - this.gitReadAt > GIT_MAX_AGE_MS) {
      void this.readGit(false);
    }
    this.classify();
  }

  /** The upstream tracking and last commit of the branches, and which worktrees have uncommitted changes */
  private async readGit(force: boolean): Promise<void> {
    if (this.reading) {
      await this.reading;
      if (!force) {
        return;
      }
    }
    this.reading = this.runReadGit().finally(() => {
      this.reading = undefined;
    });
    await this.reading;
  }

  private async runReadGit(): Promise<void> {
    const { store } = this.sources;
    const root = store.repository()?.rootUri.fsPath;
    const worktrees = store.worktrees;
    this.gitWorktrees = worktreesSignature(worktrees);
    this.gitReadAt = Date.now();
    if (!root) {
      return;
    }
    try {
      this.branchFacts = await readBranchFacts(root);
    } catch {
      // Old git or not a repository: no facts, nothing is stale for them
    }
    const candidates = removableWorktrees(worktrees, store.openFolders()).filter((worktree) => !worktree.prunable);
    const dirty = await Promise.all(
      candidates.map(async (worktree) =>
        (await worktreeHasChangesInBackground(worktree.path).catch(() => false)) ? worktree.path : undefined
      )
    );
    this.dirtyFolders = dirty.filter((folder): folder is string => !!folder);
    this.gitRead = true;
    this.classify();
  }

  private classify(): void {
    const { store, reviews, myPullRequests } = this.sources;
    const worktrees = store.worktrees;
    const known = this.origins();
    const origins = pruneOrigins(known, worktrees);
    if (origins.length !== known.length) {
      void this.state.update(ORIGINS_KEY, origins);
    }
    const listed = store.worktreeSources() ?? this.lastListed;
    const reviewed = reviews.pullRequestsForWorktrees() ?? this.lastReviewed;
    this.lastListed = listed;
    this.lastReviewed = reviewed;
    const own = myPullRequests.pullRequestsForWorktrees();
    this.classified = classifyWorktrees({
      worktrees,
      openFolders: store.openFolders(),
      origins,
      branchFacts: this.branchFacts,
      dirtyFolders: this.dirtyFolders,
      pullRequests: [...(listed?.pullRequests ?? []), ...own, ...(reviewed?.closed ?? [])],
      activeReviews: reviewed?.active,
      activeOwnPullRequests:
        myPullRequests.status === 'ready' ? own.filter((pr) => pr.status === 'active').map((pr) => pr.id) : undefined,
      workItems: listed?.workItems,
      now: Date.now(),
      idleDays: worktreeSettings().idleDays,
    });
    const signature = JSON.stringify(
      this.classified.map(({ worktree, status, reasons, owner, dirty, lastCommitAt }) => [
        worktree.path,
        worktree.branch,
        status,
        reasons,
        owner,
        dirty,
        lastCommitAt,
      ])
    );
    if (signature !== this.signature) {
      this.signature = signature;
      this.changed.fire();
    }
    // Every source has answered once (successfully or not) and git was read: what is stale now is not a guess
    const ready = !!listed && myPullRequests.status !== 'loading' && reviews.status !== 'loading' && this.gitRead;
    const main = worktrees.at(0);
    if (ready && main) {
      const ownIds = new Set(own.map((pr) => pr.id));
      this.nudges = this.nudges.then(() => this.nudge(main.path, ownIds)).catch(() => undefined);
    }
  }

  // Rules WORKTREE-NUDGE-1, WORKTREE-NUDGE-2
  /** One notification for the worktrees that have just become stale (one summary when there are several) */
  private async nudge(mainPath: string, ownPullRequestIds: ReadonlySet<number>): Promise<void> {
    const key = `${NOTIFIED_KEY_PREFIX}${mainPath}`;
    const previous = this.state.get<string[]>(key);
    const { notify: newly, baseline } = newlyStale(previous, this.classified);
    if (JSON.stringify(previous) !== JSON.stringify(baseline)) {
      await this.state.update(key, baseline);
    }
    // The notifier offers "Delete branch" for the merge of the user's PRs, which removes the worktree as well
    const notifierEvents = vscode.workspace
      .getConfiguration(`${SECTION}.myPullRequests`)
      .get<string[]>('notifications', ['merged', 'taskDone']);
    const mergeOffered = notifierEvents.includes('merged') || notifierEvents.includes('taskDone');
    const notify = worktreesToNotify(newly, (id) => mergeOffered && ownPullRequestIds.has(id));
    if (!notify.length || !worktreeSettings().notifyWhenStale) {
      return;
    }
    const first = notify.at(0);
    if (notify.length === 1 && first) {
      void this.showOne(first);
      return;
    }
    void this.showMany(notify);
  }

  private async showMany(notify: ClassifiedWorktree[]): Promise<void> {
    const picked = await vscode.window.showInformationMessage(
      `${String(notify.length)} worktrees can be removed: ${notify
        .map((item) => worktreeLabel(item.worktree))
        .join(', ')}`,
      'Clean Up…'
    );
    if (picked) {
      await vscode.commands.executeCommand(CLEAN_UP_WORKTREES_COMMAND);
    }
  }

  private async showOne(item: ClassifiedWorktree): Promise<void> {
    const changes = item.dirty ? ' It has uncommitted changes.' : '';
    const picked = await vscode.window.showInformationMessage(
      `The worktree of ${worktreeLabel(item.worktree)} can be removed: ${hygieneReasonsText(item.reasons)}.${changes}`,
      'Remove Worktree',
      'Show Worktrees'
    );
    if (picked === 'Remove Worktree') {
      await vscode.commands.executeCommand(REMOVE_WORKTREE_AT_COMMAND, item.worktree.path);
    } else if (picked === 'Show Worktrees') {
      await vscode.commands.executeCommand(SHOW_WORKTREES_COMMAND);
    }
  }
}
