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
  reviewers: ReviewerModel[];
  isDraft: boolean;
  conflicts: boolean;
  url: string;
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
  /** Identity id, or "unassigned" */
  key: string;
  name: string;
  you: boolean;
  unassigned: boolean;
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

const UNASSIGNED = 'unassigned';

const stringField = (workItem: WorkItem, name: string): string | undefined => {
  const value = workItem.fields[name];
  return typeof value === 'string' ? value : undefined;
};

function pullRequestInfo(pr: PullRequestDetails, snapshot: TeamSnapshot): TeamPullRequestInfo {
  return {
    id: pr.pullRequestId,
    author: pr.createdBy?.displayName && shortPersonName(pr.createdBy.displayName),
    publishedAt: snapshot.publishedAt.get(pr.pullRequestId) ?? pr.creationDate ?? new Date(0).toISOString(),
    reviewers: reviewerModels({ reviewers: pr.reviewers, createdBy: { id: pr.createdBy?.id } }, snapshot.myId),
    isDraft: pr.isDraft,
    conflicts: pr.mergeStatus === 'conflicts',
    url: pr.webUrl,
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
        },
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
/** Everybody's items grouped by assignee: the user first, the others by name, the unassigned ones last */
export function groupByPerson(items: TeamItem[], snapshot: TeamSnapshot): TeamPerson[] {
  const assigneeOf = new Map(snapshot.items.map((item) => [item.id, item]));
  const people = new Map<string, TeamPerson>();
  for (const item of items) {
    const source = assigneeOf.get(item.model.id);
    const key = source?.assigneeId ?? (source?.assignedTo ? `name:${source.assignedTo}` : UNASSIGNED);
    const person = people.get(key) ?? {
      key,
      name: source?.assignedTo ? shortPersonName(source.assignedTo) : 'Unassigned',
      you: snapshot.myId !== undefined && key === snapshot.myId,
      unassigned: key === UNASSIGNED,
      items: [],
    };
    person.items.push(item);
    people.set(key, person);
  }
  const rank = (person: TeamPerson): number => {
    if (person.you) {
      return 0;
    }
    return person.unassigned ? 2 : 1;
  };
  return [...people.values()].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The PRs merged in the sprint, for the merged cards (BOARD-24) of everybody */
export function mergedPullRequests(snapshot: TeamSnapshot): MergedPullRequest[] {
  return snapshot.pullRequests.flatMap((pr) =>
    pr.status === 'completed' && pr.closedDate
      ? [{ id: pr.pullRequestId, title: pr.title, closedDate: pr.closedDate }]
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

// Rule TEAM-8
/**
 * The data is loaded again only when something it depends on changed since the last attempt: the store loaded
 * again, the teams shown changed, or the user asked (a new attempt key). A failed attempt is not repeated alone
 */
export const attemptKey = (storeLoads: number, selection: readonly string[], forced: number): string =>
  `${String(storeLoads)}|${selection.join(',')}|${String(forced)}`;
