/**
 * The work of the whole team, shaped for the board (redesign phase 7): the raw answers of Azure DevOps (a
 * `TeamSnapshot`) become one `WorkItemModel` per work item, grouped by person, so the cards are the ones of the user's
 * own board (trackBoardModel.ts). Shared by the Track board and the Sprint timeline. Pure, so no "vscode" import
 */
import type { PullRequestDetails, WorkItem } from './azdoClient';
import { reviewerModels, type ReviewerModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import { toPullRequestModel, isOtherRepository } from './pullRequestModel';
import { parsePriority, PRIORITY_FIELD, SEVERITY_FIELD } from './priority';
import { stateCategory } from './states';
import { toTaskPullRequestModel } from './taskPullRequests';
import { shortPersonName } from './teamView';
import type { CompletedPullRequestInfo } from './completedPullRequests';
import type { MergedPullRequest } from './trackBoardModel';
import type { BranchModel, OtherTaskModel, PullRequestModel, WorkItemModel } from './viewModel';
import { CHANGED_DATE_FIELD, latestChange, notUpdated } from './workItemReminders';

/** A team of the view, with the iteration it works in now */
export interface TeamInfo {
  name: string;
  badge: string;
  iterationPath?: string;
}

export interface TeamIterationInfo {
  name: string;
  path: string;
  startDate?: string;
  finishDate?: string;
  teams: string[];
}

/** What one fetch of the whole-team data brings (src/teamWorkStore.ts); everything else is derived from it */
export interface TeamSnapshot {
  teams: TeamInfo[];
  iterations: TeamIterationInfo[];
  /** Backlog Items and Bugs of the iterations of the teams */
  items: WorkItem[];
  /** The children of these (tasks), with their own PR links */
  children: WorkItem[];
  /** The PRs linked to the items and the tasks (active ones and the closed ones seen so far) */
  pullRequests: PullRequestDetails[];
  /** The last CI run of each pipeline, by PR, for the active published PRs */
  runs: ReadonlyMap<number, RunModel[]>;
  /** When a PR was last published from draft, by PR: only known for the ones that looked overdue (TEAM-6) */
  publishedAt: ReadonlyMap<number, string>;
  /** Identity id of the signed-in user */
  myId?: string;
  fetchedAt: number;
}

/** What the markers of a card need to know about a PR */
export interface TeamPullRequestInfo {
  id: number;
  author?: string;
  /** Rule TEAM-6: when reviewers were asked to review (creation, or the end of the draft) */
  publishedAt: string;
  /** Rule TIMELINE-22: creation of the PR (the Sprint timeline draws the PRs of others from it) */
  createdAt: string;
  /** Rule TIMELINE-22: completion or abandon date, for a closed PR */
  closedAt?: string;
  status: PullRequestDetails['status'];
  reviewers: ReviewerModel[];
  isDraft: boolean;
  conflicts: boolean;
  url: string;
  /** Rule TIMELINE-29: what the history of the PR is read with (its repository) and keyed by (its last commit) */
  repositoryId: string;
  commit?: string;
}

/** A work item of the team, as the board draws it */
export interface TeamItem {
  model: WorkItemModel;
  /** Badge of the team whose sprint it is in */
  team?: string;
  /** The PRs of the item (and of its tasks) the markers read */
  pullRequests: TeamPullRequestInfo[];
  /** Ids of the work items it depends on (the ones that must be done first) */
  predecessorIds: number[];
}

export interface TeamPerson {
  /** Identity id */
  key: string;
  name: string;
  you: boolean;
  items: TeamItem[];
}

export interface TeamShapeOptions {
  /** Ids of the work items the user's own board already has: they are not drawn twice (TEAM-4) */
  ownIds: ReadonlySet<number>;
  repositoryId?: string;
  baseBranch: string;
  staleAfterWorkingDays: number;
  workingDays: readonly number[];
  now: Date;
}

const stringField = (workItem: WorkItem, name: string): string | undefined => {
  const value = workItem.fields[name];
  return typeof value === 'string' ? value : undefined;
};

/** What the timeline and the markers need of a PR, from its details (Rules TIMELINE-17, TIMELINE-22) */
export function pullRequestInfo(
  pr: PullRequestDetails,
  snapshot: Pick<TeamSnapshot, 'myId' | 'publishedAt'>
): TeamPullRequestInfo {
  return {
    id: pr.pullRequestId,
    author: pr.createdBy?.displayName && shortPersonName(pr.createdBy.displayName),
    publishedAt: snapshot.publishedAt.get(pr.pullRequestId) ?? pr.creationDate ?? new Date(0).toISOString(),
    createdAt: pr.creationDate ?? new Date(0).toISOString(),
    closedAt: pr.closedDate,
    status: pr.status,
    reviewers: reviewerModels({ reviewers: pr.reviewers, createdBy: { id: pr.createdBy?.id } }, snapshot.myId),
    isDraft: pr.isDraft,
    conflicts: pr.mergeStatus === 'conflicts',
    url: pr.webUrl,
    repositoryId: pr.repository.id,
    commit: pr.lastMergeSourceCommit?.commitId,
  };
}

/** Badge of the team whose sprint contains the work item; the first selected team of a shared sprint */
export function teamOfIteration(iterationPath: string, snapshot: Pick<TeamSnapshot, 'iterations' | 'teams'>): string {
  const names = snapshot.iterations.find((iteration) => iteration.path === iterationPath)?.teams ?? [];
  const team = snapshot.teams.find((candidate) => names.includes(candidate.name));
  return team?.badge ?? '';
}

// Rule TEAM-5
/**
 * One `WorkItemModel` per Backlog Item or Bug of the snapshot, as the board of the user builds them from their own
 * work items, but with what the whole-team query can know: no alert rules (so no broken-rule marks), no branches
 * beyond the links, no checkout, no dependency details. The tasks are the "other tasks" of the item, so the split
 * of a work item with several open PRs (BOARD-20) is the same for everybody
 */
export function shapeTeamItems(snapshot: TeamSnapshot, options: TeamShapeOptions): TeamItem[] {
  const prById = new Map(snapshot.pullRequests.map((pr) => [pr.pullRequestId, pr]));
  const childById = new Map(snapshot.children.map((child) => [child.id, child]));
  const runsOf = (id: number): RunModel[] => snapshot.runs.get(id) ?? [];
  const prModels = (item: WorkItem): PullRequestModel[] =>
    item.links.pullRequests
      .map((link) => prById.get(link.id))
      .filter((pr): pr is PullRequestDetails => pr !== undefined)
      .map((pr) => toPullRequestModel(pr, runsOf(pr.pullRequestId), options.repositoryId))
      .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.id - a.id);
  return snapshot.items
    .filter((item) => !options.ownIds.has(item.id))
    .map((item): TeamItem => {
      const tasks = item.links.childIds
        .map((id) => childById.get(id))
        .filter((child): child is WorkItem => child?.type === 'Task' && stateCategory(child.state) !== 'removed');
      const taskPullRequests = (task: WorkItem) =>
        task.links.pullRequests
          .map((link) => prById.get(link.id))
          .filter((pr): pr is PullRequestDetails => pr !== undefined)
          .map((pr) =>
            toTaskPullRequestModel(pr, {
              repositoryId: options.repositoryId,
              baseBranch: options.baseBranch,
              runs: runsOf(pr.pullRequestId),
            })
          );
      const otherTasks = tasks.map(
        (task): OtherTaskModel => ({
          id: task.id,
          title: task.title,
          type: task.type,
          state: task.state,
          assignedTo: task.assignedTo,
          activated: stringField(task, 'Microsoft.VSTS.Common.ActivatedDate'),
          created: stringField(task, 'System.CreatedDate'),
          stateChanged: stringField(task, 'Microsoft.VSTS.Common.StateChangeDate'),
          rev: typeof task.fields['System.Rev'] === 'number' ? task.fields['System.Rev'] : undefined,
          taskPullRequests: taskPullRequests(task),
        })
      );
      const branches = item.links.branches.map(
        (branch): BranchModel => ({
          name: branch.name,
          location: 'linked',
          isCurrent: false,
          otherRepository: isOtherRepository(branch.repositoryId, options.repositoryId),
        })
      );
      const lastChanged = latestChange([
        item.fields[CHANGED_DATE_FIELD],
        ...tasks.map((task) => task.fields[CHANGED_DATE_FIELD]),
      ]);
      const model: WorkItemModel = {
        id: item.id,
        title: item.title,
        type: item.type,
        state: item.state,
        displayState: item.state,
        iterationPath: item.iterationPath,
        url: item.url,
        parentId: item.links.parentId,
        alerts: [],
        priority: parsePriority(item.fields[PRIORITY_FIELD]),
        severity: stringField(item, SEVERITY_FIELD) || undefined,
        isCurrentBranch: false,
        branches,
        pullRequests: prModels(item),
        otherTasks,
        notUpdated: notUpdated({ state: item.state, lastChanged }, options.now, {
          staleAfterWorkingDays: options.staleAfterWorkingDays,
          workingDays: options.workingDays,
        }),
        dates: {
          activated: stringField(item, 'Microsoft.VSTS.Common.ActivatedDate'),
          stateChanged: stringField(item, 'Microsoft.VSTS.Common.StateChangeDate'),
          changed: lastChanged,
          created: stringField(item, 'System.CreatedDate'),
        },
        rev: typeof item.fields['System.Rev'] === 'number' ? item.fields['System.Rev'] : undefined,
      };
      const infoIds = new Set([
        ...item.links.pullRequests.map((link) => link.id),
        ...tasks.flatMap((task) => task.links.pullRequests.map((link) => link.id)),
      ]);
      return {
        model,
        team: teamOfIteration(item.iterationPath, snapshot),
        pullRequests: [...infoIds]
          .map((id) => prById.get(id))
          .filter((pr): pr is PullRequestDetails => pr !== undefined)
          .map((pr) => pullRequestInfo(pr, snapshot)),
        predecessorIds: item.links.predecessorIds,
      };
    });
}

// Rule BOARD-27
/**
 * The items grouped by assignee: the user first, the others by name. A work item without assignee is no person's (the
 * query only brings the people chosen, so this does not happen; it is not drawn)
 */
export function groupByPerson(items: TeamItem[], snapshot: TeamSnapshot): TeamPerson[] {
  const assigneeOf = new Map(snapshot.items.map((item) => [item.id, item]));
  const people = new Map<string, TeamPerson>();
  for (const item of items) {
    const source = assigneeOf.get(item.model.id);
    const key = source?.assigneeId ?? (source?.assignedTo ? `name:${source.assignedTo}` : undefined);
    if (!key || !source?.assignedTo) {
      continue;
    }
    const person = people.get(key) ?? {
      key,
      name: shortPersonName(source.assignedTo),
      you: snapshot.myId !== undefined && key === snapshot.myId,
      items: [],
    };
    person.items.push(item);
    people.set(key, person);
  }
  return [...people.values()].sort((a, b) => Number(b.you) - Number(a.you) || a.name.localeCompare(b.name));
}

/** The PRs merged in the sprint, for the merged cards (BOARD-24) of everybody */
export function mergedPullRequests(snapshot: TeamSnapshot): MergedPullRequest[] {
  return snapshot.pullRequests.flatMap((pr) =>
    pr.status === 'completed' && pr.closedDate
      ? [{ id: pr.pullRequestId, title: pr.title, closedDate: pr.closedDate }]
      : []
  );
}

// Rule TIMELINE-22
/**
 * The PRs of the snapshot that were completed, in the shape the Sprint timeline draws a merged PR. Their threads are not
 * read for everybody (no request per PR), so `threadsKnown` is false: the phases after the coding are approximate
 */
export function teamCompletedPullRequests(snapshot: Pick<TeamSnapshot, 'pullRequests'>): CompletedPullRequestInfo[] {
  return snapshot.pullRequests.flatMap((pr) =>
    pr.status === 'completed' && pr.closedDate && pr.creationDate
      ? [
          {
            id: pr.pullRequestId,
            title: pr.title,
            repository: pr.repository.name,
            repositoryId: pr.repository.id,
            creationDate: pr.creationDate,
            closedDate: pr.closedDate,
            isDraft: false,
            threadsKnown: false,
          },
        ]
      : []
  );
}

/** Per work item of the user: the ids of the work items it waits for, so the board can mark "your #N waits on it" */
export function waitedOnBy(
  own: readonly { id: number; predecessorIds: readonly number[] }[]
): ReadonlyMap<number, number[]> {
  const map = new Map<number, number[]>();
  for (const item of own) {
    for (const predecessor of item.predecessorIds) {
      map.set(predecessor, [...(map.get(predecessor) ?? []), item.id]);
    }
  }
  return map;
}

// Rule TEAM-7
/** Cache key of the CI runs of an active PR: the runs of a commit never change once they are all finished */
export const runsCacheKey = (pr: Pick<PullRequestDetails, 'lastMergeSourceCommit' | 'pullRequestId'>): string =>
  `${String(pr.pullRequestId)}:${pr.lastMergeSourceCommit?.commitId ?? ''}`;

/** The runs can be kept for their commit: there are some and none is queued or running */
export const runsAreFinal = (runs: readonly RunModel[]): boolean =>
  runs.length > 0 && runs.every((run) => run.state !== 'queued' && run.state !== 'running');

// Rule TEAM-7
/** The linked PRs that are neither in the listing of the active ones nor in the memory of the closed ones */
export function pullRequestsToFetch(
  linked: readonly number[],
  active: ReadonlyMap<number, unknown>,
  closed: ReadonlyMap<number, unknown>
): number[] {
  return [...new Set(linked)].filter((id) => !active.has(id) && !closed.has(id));
}

// Rule TEAM-3
/**
 * From the listing of the PRs completed since the start of the sprint (the whole project's), the ones linked to the
 * work items shown and really closed on or after that date. The rest of the project's PRs are not kept
 */
export function completedLinked<T extends { pullRequestId: number; closedDate?: string; status: string }>(
  listing: readonly T[],
  linked: ReadonlySet<number>,
  since: string
): T[] {
  const from = Date.parse(since);
  return listing.filter(
    (pr) =>
      pr.status === 'completed' &&
      linked.has(pr.pullRequestId) &&
      (pr.closedDate === undefined || Number.isNaN(from) || Date.parse(pr.closedDate) >= from)
  );
}

/** The earliest start of the sprints shown, ISO; undefined when no sprint has dates */
export function earliestStart(iterations: readonly { startDate?: string }[]): string | undefined {
  const starts = iterations
    .map((iteration) => iteration.startDate)
    .filter((date): date is string => date !== undefined && !Number.isNaN(Date.parse(date)))
    .sort();
  return starts.at(0);
}

// Rule TEAM-8
/**
 * The data is loaded again only when something it depends on changed since the last attempt: the store loaded
 * again, the people chosen changed, or the user asked (a new attempt key). A failed attempt is not repeated alone
 */
export const attemptKey = (storeLoads: number, personIds: readonly string[], forced: number): string =>
  `${String(storeLoads)}|${personIds.join(',')}|${String(forced)}`;
