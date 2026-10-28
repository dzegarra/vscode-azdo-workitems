import { getAccessToken } from './auth';
import { recordedFetch } from './requestRecorder';
import { oldestCommitDate, type CommitRef } from './codingStart';
import { CommitsDiff, hasSkipTag, PullRequestLabel } from './buildNotes';
import {
  buildMyWorkItemsQuery,
  buildTeamWorkItemsQuery,
  Iteration,
  mergeTeamIterations,
  TeamIteration,
} from './iterations';
import { PackageVersion } from './integrationBuild';
import type { RawCoverageFiles, RawCoverageSummary } from './coverage';
import { BuildRun, pullRequestBranch } from './pipelines';
import type { RawFailedResult, RawTestRun, RawTimelineRecord, RunFailures } from './runDetails';
import { imageMimeType, isOrganizationUrl } from './richTextImages';
import { AuthoredPullRequest, PolicyEvaluation, RawPolicyEvaluation, toPolicyEvaluation } from './myPullRequests';
import { countChangedFiles } from './reviewCard';
import { ReviewerPullRequest } from './reviewRequests';
import { ThreadResponse } from './reviewThreads';
import { flattenIterations, IterationNode, ScheduledIteration } from './schedule';
import { parseRelations, PullRequestState, WorkItemLinks, WorkItemRelation } from './workItemLinks';
import type { WorkItemUpdate } from './workItemStateHistory';

const API_VERSION = '7.1';
/** Commits of a PR per request, and the pages read at most (Rule TIMELINE-20) */
const COMMIT_PAGE_SIZE = 100;
const COMMIT_PAGES = 5;
/** The policy evaluations API only exists as a preview: 7.1 is refused */
const POLICY_API_VERSION = '7.1-preview.1';
const BASE_URL = 'https://dev.azure.com';
/** The code coverage summary has its own host */
const TEST_RESULTS_URL = 'https://vstmr.dev.azure.com';
/** The code coverage APIs only exist as previews */
const COVERAGE_API_VERSION = '7.1-preview.1';
/** Images bigger than this are not embedded in the details of work items */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Runs fetched per pull request: enough to find the last run of each pipeline */
const MAX_BUILDS = 10;
/** Runs of a PR read for its history on the Sprint timeline (Rule TIMELINE-29): every push queues one per pipeline */
const MAX_BUILD_HISTORY = 100;
/** Manual or push runs of the repository in the time window: the team merges about 10 PRs a day */
const MAX_BRANCH_BUILDS = 50;
/** Azure Artifacts has its own host */
const FEEDS_URL = 'https://feeds.dev.azure.com';
const NOT_FOUND = 404;
/** The work items API accepts up to 200 IDs per request */
const MAX_IDS_PER_REQUEST = 200;
const LISTED_PAGE = 200;
const MAX_LISTED_PULL_REQUESTS = 1000;
/** Members of a team asked in one request (the largest team has about 25) */
const TEAM_MEMBERS_TOP = 1000;
/** A ref update to this object ID (40 zeros) deletes the branch */
const DELETED_OBJECT_ID_LENGTH = 40;

/** Builds of one Azure Repos repository (without it, the pipelines of the other repositories come too) */
function repositoryFilter(repositoryId: string): string {
  return `repositoryId=${repositoryId}&repositoryType=TfsGit`;
}

export interface WorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath: string;
  assignedTo?: string;
  /** Identity id of the assignee (matches `getMyId`) */
  assigneeId?: string;
  url: string;
  links: WorkItemLinks;
  /** Raw fields, e.g. "System.Tags" or "Microsoft.VSTS.Scheduling.Effort" */
  fields: Record<string, unknown>;
}

export type WorkItemDetails = WorkItem;

export interface WorkItemTypeState {
  name: string;
  /** Proposed, InProgress, Resolved, Completed or Removed */
  category: string;
  color: string;
}

const typeStatesCache = new Map<string, Promise<WorkItemTypeState[]>>();

const fieldsCache = new Map<string, Promise<{ name: string; referenceName: string }[]>>();

const SCHEDULE_CACHE_MS = 5 * 60 * 1000;
const scheduleCache = new Map<string, { time: number; schedule: Promise<ScheduledIteration[]> }>();

/** Most recent PRs checked for notifications */
const MAX_PULL_REQUESTS = 30;
/** Active PRs checked for review requests */
const MAX_REVIEW_REQUESTS = 100;
/** Active PRs of the user listed in the sidebar */
const MAX_MY_ACTIVE_PULL_REQUESTS = 100;
/** Changes asked for the diff between two commits; the response says when there are more */
const MAX_DIFF_CHANGES = 2000;
/** Recently completed PRs of the user: the sidebar lists the last 24 hours of them */
const MAX_MY_COMPLETED_PULL_REQUESTS = 50;

export interface GitRepository {
  id: string;
  name: string;
  webUrl: string;
  project: { id: string; name: string };
}

export interface PullRequest {
  pullRequestId: number;
  url: string;
  webUrl: string;
}

export interface PullRequestDetails extends PullRequest, PullRequestState {
  title: string;
  sourceRefName: string;
  /** E.g. "refs/heads/develop" */
  targetRefName?: string;
  createdBy?: { id?: string; displayName?: string };
  repository: { id: string; name: string; project?: { id?: string; name?: string } };
  /** ISO dates, as every PR response has them */
  creationDate?: string;
  closedDate?: string;
  /** Last commit of the source branch: the cache key of the CI runs of the whole-team board */
  lastMergeSourceCommit?: { commitId: string };
}

export interface Team {
  id: string;
  name: string;
}

interface WorkItemResponse {
  id: number;
  fields: Record<string, string>;
  relations?: WorkItemRelation[];
}

export class AzdoClient {
  constructor(readonly organization: string, readonly project: string) {}

  private url(path: string, team?: string, apiVersion = API_VERSION): string {
    const segments = [this.organization, this.project, team]
      .filter(Boolean)
      .map((s) => encodeURIComponent(s as string));
    const separator = path.includes('?') ? '&' : '?';
    return `${BASE_URL}/${segments.join('/')}/_apis/${path}${separator}api-version=${apiVersion}`;
  }

  private async request<T>(
    url: string,
    init: { method?: string; body?: string; contentType?: string } = {}
  ): Promise<T> {
    return (await this.send(url, init)).json as T;
  }

  /** Like `request`, with the continuation token of the page (header `x-ms-continuationtoken`) */
  private async send(
    url: string,
    init: { method?: string; body?: string; contentType?: string } = {}
  ): Promise<{ json: unknown; continuation?: string }> {
    const token = await getAccessToken();
    const response = await recordedFetch(url, {
      method: init.method,
      body: init.body,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': init.contentType ?? 'application/json',
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      const body = await response.text();
      let message = body;
      try {
        message = (JSON.parse(body) as { message?: string }).message ?? body;
      } catch {
        // Body is not JSON
      }
      throw new Error(`Azure DevOps ${response.status}: ${message || response.statusText}`);
    }
    return {
      json: (await response.json()) as unknown,
      continuation: response.headers.get('x-ms-continuationtoken') ?? undefined,
    };
  }

  /**
   * Downloads an image hosted by the organization (e.g. an attachment of a work item) as a data URI,
   * so a webview can show it without authenticating. URLs of other hosts never get the token
   */
  async getImageAsDataUri(url: string): Promise<string> {
    if (!isOrganizationUrl(url, this.organization)) {
      throw new Error(`Not an image of the organization ${this.organization}: ${url}`);
    }
    const token = await getAccessToken();
    const response = await recordedFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'image/*' } });
    const mime = imageMimeType(response.headers.get('content-type'));
    if (!response.ok || !mime) {
      throw new Error(`Unable to load the image ${url} (${response.status})`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`The image ${url} is too big to be shown`);
    }
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }

  /** Current iteration of the team. Undefined when the team has no iteration covering today */
  async getCurrentIteration(team: string): Promise<Iteration | undefined> {
    try {
      const result = await this.request<{ value: Iteration[] }>(
        this.url('work/teamsettings/iterations?$timeframe=current', team)
      );
      return result.value.at(0);
    } catch (error) {
      if ((error as Error).message.startsWith(`Azure DevOps ${NOT_FOUND}`)) {
        return undefined;
      }
      throw error;
    }
  }

  /** Teams to list: the configured ones or, when none is configured, all the teams the user belongs to */
  async resolveTeams(configuredTeams: string[]): Promise<string[]> {
    return configuredTeams.length ? configuredTeams : (await this.getTeams()).map((team) => team.name);
  }

  async getCurrentIterations(teams: string[]): Promise<TeamIteration[]> {
    const iterations = await Promise.all(
      teams.map(async (team) => ({ team, iteration: await this.getCurrentIteration(team) }))
    );
    return mergeTeamIterations(iterations);
  }

  async getTeams(): Promise<Team[]> {
    const result = await this.request<{ value: Team[] }>(
      `${BASE_URL}/${encodeURIComponent(this.organization)}/_apis/projects/${encodeURIComponent(
        this.project
      )}/teams?$mine=true&$top=1000&api-version=${API_VERSION}`
    );
    return result.value;
  }

  /** Work items assigned to the signed-in user in any of the given iterations */
  async getMyWorkItems(iterationPaths: string[], asOf?: string): Promise<WorkItem[]> {
    if (!iterationPaths.length) {
      return [];
    }
    const query = buildMyWorkItemsQuery(iterationPaths, asOf);
    const result = await this.request<{ workItems: { id: number }[] }>(this.url('wit/wiql'), {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    return this.getWorkItems(
      result.workItems.map((wi) => wi.id),
      asOf
    );
  }

  // Rule TEAM-2
  /**
   * Backlog Items and Bugs of the given iterations assigned to the given people (sign-in names): one query, then
   * batches with relations. Without iterations or people nothing is asked
   */
  async getTeamWorkItems(iterationPaths: string[], people: string[]): Promise<WorkItem[]> {
    if (!iterationPaths.length || !people.length) {
      return [];
    }
    const result = await this.request<{ workItems: { id: number }[] }>(this.url('wit/wiql'), {
      method: 'POST',
      body: JSON.stringify({ query: buildTeamWorkItemsQuery(iterationPaths, people) }),
    });
    return this.getWorkItems(result.workItems.map((wi) => wi.id));
  }

  // Rule TEAM-1
  /** The members of a team (identity id, display name, sign-in name) */
  async getTeamMembers(teamId: string): Promise<{ id: string; name: string; uniqueName?: string }[]> {
    const result = await this.request<{
      value: { identity: { id: string; displayName: string; uniqueName?: string } }[];
    }>(
      `${BASE_URL}/${encodeURIComponent(this.organization)}/_apis/projects/${encodeURIComponent(
        this.project
      )}/teams/${encodeURIComponent(teamId)}/members?$top=${TEAM_MEMBERS_TOP}&api-version=${API_VERSION}`
    );
    return result.value.map(({ identity }) => ({
      id: identity.id,
      name: identity.displayName,
      uniqueName: identity.uniqueName,
    }));
  }

  /** Pages of a listing of the PRs of the project, 200 per request, until a short page or the cap */
  private async listPullRequests(filter: string): Promise<PullRequestDetails[]> {
    const all: PullRequestDetails[] = [];
    for (let skip = 0; skip < MAX_LISTED_PULL_REQUESTS; skip += LISTED_PAGE) {
      const result = await this.request<{
        value: (Omit<PullRequestDetails, 'reviewers' | 'webUrl'> & Partial<PullRequestDetails>)[];
      }>(this.url(`git/pullrequests?${filter}&$top=${LISTED_PAGE}&$skip=${skip}`));
      all.push(
        ...result.value.map((pr) => ({
          ...pr,
          reviewers: pr.reviewers ?? [],
          webUrl: this.pullRequestWebUrlByName(pr.repository.name, pr.pullRequestId),
        }))
      );
      if (result.value.length < LISTED_PAGE) {
        break;
      }
    }
    return all;
  }

  // Rule TEAM-3
  /** All the active PRs of the project, with their reviewers and last commit: one request per 200 PRs */
  getActivePullRequests(): Promise<PullRequestDetails[]> {
    return this.listPullRequests('searchCriteria.status=active');
  }

  // Rule TEAM-3
  /** The PRs of the project completed since the given ISO date (by closing date): one request per 200 PRs */
  getCompletedPullRequests(minTime: string): Promise<PullRequestDetails[]> {
    return this.listPullRequests(
      `searchCriteria.status=completed&searchCriteria.queryTimeRangeType=closed&searchCriteria.minTime=${encodeURIComponent(
        minTime
      )}`
    );
  }

  /** The work items with their relations; `asOf`: as they were at that moment (Rule TIMELINE-41) */
  async getWorkItems(ids: number[], asOf?: string): Promise<WorkItem[]> {
    if (!ids.length) {
      return [];
    }
    const items: WorkItem[] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      // "fields" cannot be combined with "$expand"; relations give parent / children / branches / PRs.
      // Deleted or inaccessible work items come back as null instead of failing the whole request
      const result = await this.request<{ value: (WorkItemResponse | null)[] }>(
        this.url(
          `wit/workitems?ids=${chunk.join(',')}&$expand=relations&errorPolicy=Omit${
            asOf ? `&asOf=${encodeURIComponent(asOf)}` : ''
          }`
        )
      );
      items.push(...result.value.filter((wi): wi is WorkItemResponse => !!wi).map((wi) => this.toWorkItem(wi)));
    }
    // Keep the order returned by the query
    return ids.map((id) => items.find((wi) => wi.id === id)).filter((wi): wi is WorkItem => !!wi);
  }

  /**
   * The updates of a work item, oldest first (Rule TIMELINE-35): each with the fields it changed (`System.State`,
   * `System.ChangedDate`…). One request per work item; 200 updates are more than a work item of a sprint has
   */
  async getWorkItemUpdates(id: number): Promise<WorkItemUpdate[]> {
    const result = await this.request<{ value: WorkItemUpdate[] }>(this.url(`wit/workItems/${id}/updates?$top=200`));
    return result.value;
  }

  private toWorkItem(wi: WorkItemResponse): WorkItem {
    return {
      id: wi.id,
      title: wi.fields['System.Title'],
      type: wi.fields['System.WorkItemType'],
      state: wi.fields['System.State'],
      iterationPath: wi.fields['System.IterationPath'],
      assignedTo: (wi.fields['System.AssignedTo'] as unknown as { displayName?: string } | undefined)?.displayName,
      assigneeId: (wi.fields['System.AssignedTo'] as unknown as { id?: string } | undefined)?.id,
      links: parseRelations(wi.relations),
      fields: wi.fields,
      url: this.workItemWebUrl(wi.id),
    };
  }

  workItemWebUrl(id: number): string {
    return `${BASE_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
      this.project
    )}/_workitems/edit/${id}`;
  }

  iterationBoardWebUrl(team: string, iteration?: Iteration): string {
    const base = `${BASE_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
      this.project
    )}/_sprints/taskboard/${encodeURIComponent(team)}`;
    // Iteration path is "Project\Area\Sprint"; the board URL expects it with "/" separators
    return iteration ? `${base}/${iteration.path.split('\\').map(encodeURIComponent).join('/')}` : base;
  }

  async getRepository(name: string): Promise<GitRepository> {
    return this.request<GitRepository>(this.url(`git/repositories/${encodeURIComponent(name)}`));
  }

  /** Fields of the organization: display name and reference name. Cached: they rarely change */
  async getFields(): Promise<{ name: string; referenceName: string }[]> {
    const key = `${this.organization}/${this.project}`;
    let fields = fieldsCache.get(key);
    if (!fields) {
      fields = this.request<{ value: { name: string; referenceName: string }[] }>(this.url('wit/fields')).then(
        (result) => result.value
      );
      fieldsCache.set(key, fields);
      fields.catch(() => fieldsCache.delete(key));
    }
    return fields;
  }

  /** Iterations of the project with their dates. Cached for a few minutes */
  async getIterationSchedule(): Promise<ScheduledIteration[]> {
    const key = `${this.organization}/${this.project}`;
    const cached = scheduleCache.get(key);
    if (cached && Date.now() - cached.time < SCHEDULE_CACHE_MS) {
      return cached.schedule;
    }
    const schedule = this.request<IterationNode>(this.url('wit/classificationnodes/Iterations?$depth=20')).then(
      flattenIterations
    );
    scheduleCache.set(key, { time: Date.now(), schedule });
    schedule.catch(() => scheduleCache.delete(key));
    return schedule;
  }

  /** States of a work item type, in workflow order. Cached: they rarely change */
  async getWorkItemTypeStates(type: string): Promise<WorkItemTypeState[]> {
    const key = `${this.organization}/${this.project}/${type}`;
    let states = typeStatesCache.get(key);
    if (!states) {
      states = this.request<{ value: WorkItemTypeState[] }>(
        this.url(`wit/workitemtypes/${encodeURIComponent(type)}/states`)
      ).then((result) => result.value);
      typeStatesCache.set(key, states);
      // Do not cache failures
      states.catch(() => typeStatesCache.delete(key));
    }
    return states;
  }

  /** Creates a Task under the parent, in the same iteration and area, assigned to the same person */
  async createTask(
    parent: { id: number; fields: Record<string, unknown> },
    title: string,
    taskType = 'Task'
  ): Promise<WorkItem> {
    const assignedTo = parent.fields['System.AssignedTo'] as { uniqueName?: string } | undefined;
    const operations = [
      { op: 'add', path: '/fields/System.Title', value: title },
      { op: 'add', path: '/fields/System.IterationPath', value: parent.fields['System.IterationPath'] },
      { op: 'add', path: '/fields/System.AreaPath', value: parent.fields['System.AreaPath'] },
      ...(assignedTo?.uniqueName
        ? [{ op: 'add', path: '/fields/System.AssignedTo', value: assignedTo.uniqueName }]
        : []),
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${BASE_URL}/${encodeURIComponent(this.organization)}/_apis/wit/workItems/${parent.id}`,
        },
      },
    ];
    const created = await this.request<WorkItemResponse>(this.url(`wit/workitems/$${encodeURIComponent(taskType)}`), {
      method: 'POST',
      contentType: 'application/json-patch+json',
      body: JSON.stringify(operations),
    });
    return this.toWorkItem(created);
  }

  private async getBuilds(query: string): Promise<BuildRun[]> {
    const result = await this.request<{
      value: (Omit<BuildRun, 'webUrl'> & { _links: { web: { href: string } } })[];
    }>(this.url(`build/builds?${query}&queryOrder=queueTimeDescending`));
    return result.value.map(({ _links: links, ...build }) => ({ ...build, webUrl: links.web.href }));
  }

  /** CI runs validating a pull request, newest first */
  getPullRequestBuilds(pullRequestId: number): Promise<BuildRun[]> {
    const branch = encodeURIComponent(pullRequestBranch(pullRequestId));
    return this.getBuilds(`branchName=${branch}&$top=${MAX_BUILDS}`);
  }

  /** Every CI run validating a pull request (its history, Rule TIMELINE-29), newest first */
  getPullRequestBuildHistory(pullRequestId: number): Promise<BuildRun[]> {
    const branch = encodeURIComponent(pullRequestBranch(pullRequestId));
    return this.getBuilds(`branchName=${branch}&$top=${MAX_BUILD_HISTORY}`);
  }

  /** Runs of the repository queued by hand by the user since the given time, newest first */
  getManualBuilds(userId: string, repositoryId: string, since: Date): Promise<BuildRun[]> {
    return this.getBuilds(
      `requestedFor=${userId}&${repositoryFilter(
        repositoryId
      )}&reasonFilter=manual&minTime=${since.toISOString()}&$top=${MAX_BRANCH_BUILDS}`
    );
  }

  /** Runs of the repository queued by pushes (the merges of the PRs among them) since the given time, newest first */
  getPushBuilds(repositoryId: string, since: Date): Promise<BuildRun[]> {
    return this.getBuilds(
      `${repositoryFilter(
        repositoryId
      )}&reasonFilter=individualCI,batchedCI&minTime=${since.toISOString()}&$top=${MAX_BRANCH_BUILDS}`
    );
  }

  /**
   * The latest runs of the repository on a branch (any reason: merges, pushes, schedules, manual runs), newest first.
   * No time window: a branch broken days ago must still show
   */
  getBranchBuilds(repositoryId: string, branch: string): Promise<BuildRun[]> {
    return this.getBuilds(
      `branchName=${encodeURIComponent(`refs/heads/${branch}`)}&${repositoryFilter(
        repositoryId
      )}&$top=${MAX_BRANCH_BUILDS}`
    );
  }

  /** Test runs published by a build (one per results file) */
  async getBuildTestRuns(buildId: number): Promise<RawTestRun[]> {
    const buildUri = encodeURIComponent(`vstfs:///Build/Build/${buildId}`);
    const result = await this.request<{ value: RawTestRun[] }>(this.url(`test/runs?buildUri=${buildUri}`));
    return result.value;
  }

  /** How many tests of a test run failed, and the first few of them */
  async getTestRunFailures(runId: number, top: number): Promise<RunFailures> {
    const [statistics, results] = await Promise.all([
      this.request<{ runStatistics?: { outcome: string; count: number }[] }>(
        this.url(`test/runs/${runId}/statistics`)
      ).catch(() => undefined),
      this.request<{ value: RawFailedResult[] }>(this.url(`test/runs/${runId}/results?outcomes=Failed&$top=${top}`)),
    ]);
    const failed = statistics?.runStatistics?.find((entry) => entry.outcome === 'Failed')?.count ?? 0;
    return { failed: Math.max(failed, results.value.length), results: results.value };
  }

  /** Stages, jobs and tasks of a build with their results */
  async getBuildTimeline(buildId: number): Promise<RawTimelineRecord[]> {
    const result = await this.request<{ records?: RawTimelineRecord[] }>(this.url(`build/builds/${buildId}/timeline`));
    return result.records ?? [];
  }

  /** Lines coverage of a build */
  getBuildCoverageSummary(buildId: number): Promise<RawCoverageSummary> {
    return this.request<RawCoverageSummary>(
      `${TEST_RESULTS_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
        this.project
      )}/_apis/testresults/codecoverage?buildId=${buildId}&api-version=${COVERAGE_API_VERSION}`
    );
  }

  /** Coverage of each file of a build */
  getBuildCoverageFiles(buildId: number): Promise<RawCoverageFiles> {
    return this.request<RawCoverageFiles>(
      this.url(`test/codecoverage?buildId=${buildId}&flags=7`, undefined, COVERAGE_API_VERSION)
    );
  }

  /** All the versions of a package of an Azure Artifacts feed of the project */
  async getPackageVersions(feed: string, packageName: string, protocolType: string): Promise<PackageVersion[]> {
    const query = [
      `protocolType=${encodeURIComponent(protocolType)}`,
      `packageNameQuery=${encodeURIComponent(packageName)}`,
      'includeAllVersions=true',
      `api-version=${API_VERSION}`,
    ].join('&');
    const result = await this.request<{ value: { name: string; versions?: PackageVersion[] }[] }>(
      `${FEEDS_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
        this.project
      )}/_apis/packaging/Feeds/${encodeURIComponent(feed)}/packages?${query}`
    );
    // The name query also matches packages containing the name
    const found = result.value.find((pkg) => pkg.name.toLowerCase() === packageName.toLowerCase());
    if (!found) {
      throw new Error(`Package "${packageName}" not found in the feed "${feed}".`);
    }
    return found.versions ?? [];
  }

  async updateWorkItemField(workItemId: number, referenceName: string, value: string): Promise<void> {
    await this.request(this.url(`wit/workitems/${workItemId}`), {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: JSON.stringify([{ op: 'add', path: `/fields/${referenceName}`, value }]),
    });
  }

  /** Empties a field ("remove" operation of the JSON patch) */
  async clearWorkItemField(workItemId: number, referenceName: string): Promise<void> {
    await this.request(this.url(`wit/workitems/${workItemId}`), {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: JSON.stringify([{ op: 'remove', path: `/fields/${referenceName}` }]),
    });
  }

  async updateWorkItemState(workItemId: number, state: string): Promise<void> {
    await this.request(this.url(`wit/workitems/${workItemId}`), {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: JSON.stringify([{ op: 'add', path: '/fields/System.State', value: state }]),
    });
  }

  /** Work item with all its fields (description, acceptance criteria…) and relations */
  async getWorkItemDetails(id: number): Promise<WorkItemDetails> {
    const result = await this.request<WorkItemResponse & { fields: Record<string, unknown> }>(
      this.url(`wit/workitems/${id}?$expand=all`)
    );
    return { ...this.toWorkItem(result as WorkItemResponse), fields: result.fields };
  }

  /**
   * Commit the branch points to in Azure DevOps, or undefined when the branch does not exist.
   * Unlike the local "origin/…" refs and the links of the work items, this is never stale
   */
  async getBranchObjectId(repositoryId: string, branch: string): Promise<string | undefined> {
    return (await this.getBranchInfo(repositoryId, branch))?.objectId;
  }

  /** The branch in Azure DevOps with the person who created it; undefined when it does not exist there */
  async getBranchInfo(
    repositoryId: string,
    branch: string
  ): Promise<{ objectId: string; creator?: { id?: string; displayName: string; uniqueName?: string } } | undefined> {
    const name = `refs/heads/${branch}`;
    // "filter" matches the refs starting with it, e.g. "heads/feature/a" also matches "heads/feature/ab"
    const result = await this.request<{
      value: {
        name: string;
        objectId: string;
        creator?: { id?: string; displayName: string; uniqueName?: string };
      }[];
    }>(this.url(`git/repositories/${repositoryId}/refs?filter=${encodeURIComponent(`heads/${branch}`)}`));
    const ref = result.value.find((candidate) => candidate.name === name);
    return ref && { objectId: ref.objectId, creator: ref.creator };
  }

  /** Deletes the branch in Azure DevOps, only if it still points to the given commit */
  async deleteRemoteBranch(repositoryId: string, branch: string, objectId: string): Promise<void> {
    const result = await this.request<{ value: { success: boolean; updateStatus: string; customMessage?: string }[] }>(
      this.url(`git/repositories/${repositoryId}/refs`),
      {
        method: 'POST',
        body: JSON.stringify([
          { name: `refs/heads/${branch}`, oldObjectId: objectId, newObjectId: '0'.repeat(DELETED_OBJECT_ID_LENGTH) },
        ]),
      }
    );
    const update = result.value.at(0);
    if (!update?.success) {
      throw new Error(
        `Unable to delete the branch ${branch} in Azure DevOps: ${
          update?.customMessage ?? update?.updateStatus ?? 'unknown error'
        }`
      );
    }
  }

  /** Adds the branch to the "Development" section of the work item */
  async linkBranchToWorkItem(workItemId: number, repository: GitRepository, branch: string): Promise<void> {
    const artifactId = encodeURIComponent(`${repository.project.id}/${repository.id}/GB${branch}`);
    await this.request(this.url(`wit/workitems/${workItemId}`), {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: JSON.stringify([
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'ArtifactLink',
            url: `vstfs:///Git/Ref/${artifactId}`,
            attributes: { name: 'Branch' },
          },
        },
      ]),
    });
  }

  /** Adds the PR to the "Development" section of the work item */
  async linkPullRequestToWorkItem(
    workItemId: number,
    link: { id: number; projectId: string; repositoryId: string }
  ): Promise<void> {
    const artifactId = encodeURIComponent(`${link.projectId}/${link.repositoryId}/${link.id}`);
    await this.request(this.url(`wit/workitems/${workItemId}`), {
      method: 'PATCH',
      contentType: 'application/json-patch+json',
      body: JSON.stringify([
        {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'ArtifactLink',
            url: `vstfs:///Git/PullRequestId/${artifactId}`,
            attributes: { name: 'Pull Request' },
          },
        },
      ]),
    });
  }

  pullRequestWebUrlByName(repositoryName: string, id: number): string {
    return `${BASE_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
      this.project
    )}/_git/${encodeURIComponent(repositoryName)}/pullrequest/${id}`;
  }

  /** ID of the signed-in user */
  async getMyId(): Promise<string> {
    const data = await this.request<{ authenticatedUser: { id: string } }>(
      `${BASE_URL}/${encodeURIComponent(this.organization)}/_apis/connectionData`
    );
    return data.authenticatedUser.id;
  }

  // Rule MYPR-NOTIF-1
  /** PRs created by the user in the project: the active ones and the most recently closed */
  async getPullRequestsCreatedBy(creatorId: string, top = MAX_PULL_REQUESTS): Promise<PullRequestDetails[]> {
    const result = await this.request<{
      value: (Omit<PullRequestDetails, 'reviewers' | 'webUrl'> & Partial<PullRequestDetails>)[];
    }>(this.url(`git/pullrequests?searchCriteria.creatorId=${creatorId}&searchCriteria.status=all&$top=${top}`));
    return result.value.map((pr) => ({
      ...pr,
      reviewers: pr.reviewers ?? [],
      webUrl: this.pullRequestWebUrlByName(pr.repository.name, pr.pullRequestId),
    }));
  }

  // Rule MYPR-LIST-1
  /**
   * PRs created by the user in the project: the active ones and the latest completed (newest first).
   * Abandoned PRs are not requested
   */
  async getMyPullRequests(creatorId: string): Promise<AuthoredPullRequest[]> {
    const fetchPage = async (status: 'active' | 'completed', top: number) => {
      const result = await this.request<{
        value: (Omit<AuthoredPullRequest, 'reviewers' | 'webUrl'> & Partial<AuthoredPullRequest>)[];
      }>(
        this.url(`git/pullrequests?searchCriteria.creatorId=${creatorId}&searchCriteria.status=${status}&$top=${top}`)
      );
      return result.value.map((pr) => ({
        ...pr,
        reviewers: pr.reviewers ?? [],
        webUrl: this.pullRequestWebUrlByName(pr.repository.name, pr.pullRequestId),
      }));
    };
    const [active, completed] = await Promise.all([
      fetchPage('active', MAX_MY_ACTIVE_PULL_REQUESTS),
      fetchPage('completed', MAX_MY_COMPLETED_PULL_REQUESTS),
    ]);
    return [...active, ...completed];
  }

  /** Branch policies of the PR with their state (the checks listed in the "Policies" of the PR page) */
  async getPolicyEvaluations(projectId: string, pullRequestId: number): Promise<PolicyEvaluation[]> {
    const artifactId = encodeURIComponent(`vstfs:///CodeReview/CodeReviewId/${projectId}/${pullRequestId}`);
    const result = await this.request<{ value: RawPolicyEvaluation[] }>(
      this.url(`policy/evaluations?artifactId=${artifactId}`, undefined, POLICY_API_VERSION)
    );
    return result.value.flatMap((raw) => toPolicyEvaluation(raw) ?? []);
  }

  /** IDs of the work items linked to the PR */
  async getPullRequestWorkItemIds(repositoryId: string, pullRequestId: number): Promise<number[]> {
    const result = await this.request<{ value: { id: string }[] }>(
      this.url(`git/repositories/${repositoryId}/pullRequests/${pullRequestId}/workitems`)
    );
    return result.value.map((ref) => Number(ref.id));
  }

  /** Type of each work item ("Bug", "Task"…); the ones that cannot be read are left out */
  async getWorkItemTypes(ids: number[]): Promise<Map<number, string>> {
    const types = new Map<number, string>();
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      const result = await this.request<{ value: { id: number; fields: Record<string, string> }[] }>(
        this.url(`wit/workitems?ids=${chunk.join(',')}&fields=System.WorkItemType`)
      );
      result.value.forEach((item) => types.set(item.id, item.fields['System.WorkItemType']));
    }
    return types;
  }

  /**
   * Changes between the target and the source commit of a PR: one request. The list is cut at `$top`;
   * `allChangesIncluded` tells whether it is complete
   */
  async getCommitsDiff(repositoryId: string, baseCommit: string, targetCommit: string): Promise<CommitsDiff> {
    return this.request<CommitsDiff>(
      this.url(
        `git/repositories/${repositoryId}/diffs/commits?baseVersion=${encodeURIComponent(
          baseCommit
        )}&baseVersionType=commit&targetVersion=${encodeURIComponent(
          targetCommit
        )}&targetVersionType=commit&diffCommonCommit=true&$top=${MAX_DIFF_CHANGES}`
      )
    );
  }

  /** Adds a tag (label) to the PR; it is created when the repository does not have it yet */
  async addPullRequestLabel(repositoryId: string, pullRequestId: number, name: string): Promise<void> {
    await this.request(this.url(`git/repositories/${repositoryId}/pullRequests/${pullRequestId}/labels`), {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  }

  /** Takes the PR out of draft: the reviewers are notified */
  async publishPullRequest(repositoryId: string, pullRequestId: number): Promise<void> {
    await this.request(this.url(`git/repositories/${repositoryId}/pullrequests/${pullRequestId}`), {
      method: 'PATCH',
      body: JSON.stringify({ isDraft: false }),
    });
  }

  /**
   * Commits of `base` the branch does not have (and the other way round), computed by Azure DevOps. Branch names
   * without "refs/heads/"
   */
  async getBranchAheadBehind(
    repositoryId: string,
    branch: string,
    base: string
  ): Promise<{ ahead: number; behind: number }> {
    const result = await this.request<{ aheadCount: number; behindCount: number }>(
      this.url(
        `git/repositories/${repositoryId}/stats/branches?name=${encodeURIComponent(
          branch
        )}&baseVersionDescriptor.version=${encodeURIComponent(base)}&baseVersionDescriptor.versionType=branch`
      )
    );
    return { ahead: result.aheadCount, behind: result.behindCount };
  }

  /** "Restart merge" of the web UI: Azure DevOps merges the PR again with the current target, so conflicts show */
  async restartPullRequestMerge(repositoryId: string, pullRequestId: number): Promise<void> {
    await this.request(this.url(`git/repositories/${repositoryId}/pullrequests/${pullRequestId}`), {
      method: 'PATCH',
      body: JSON.stringify({ mergeStatus: 'queued' }),
    });
  }

  /**
   * Completes the PR at the commit the user saw (refused when somebody pushed since). The work items are not
   * transitioned by Azure DevOps: the extension moves them itself (Bugs never go to Done)
   */
  async completePullRequest(
    repositoryId: string,
    pullRequestId: number,
    lastMergeSourceCommit: string,
    options: { mergeStrategy: string; deleteSourceBranch: boolean }
  ): Promise<void> {
    await this.request(this.url(`git/repositories/${repositoryId}/pullrequests/${pullRequestId}`), {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
        lastMergeSourceCommit: { commitId: lastMergeSourceCommit },
        completionOptions: { ...options, transitionWorkItems: false },
      }),
    });
  }

  /** Changes the branch the PR merges into (e.g. "refs/heads/develop") */
  async updatePullRequestTarget(repositoryId: string, pullRequestId: number, targetRefName: string): Promise<void> {
    await this.request(this.url(`git/repositories/${repositoryId}/pullrequests/${pullRequestId}`), {
      method: 'PATCH',
      body: JSON.stringify({ targetRefName }),
    });
  }

  /** Active PRs of the project where the user is a reviewer (directly, not through a group) */
  getPullRequestsToReview(reviewerId: string): Promise<ReviewerPullRequest[]> {
    return this.listReviewerPullRequests(reviewerId, 'active');
  }

  /**
   * The latest PRs of the project where the user is a reviewer, whatever their status (the user's own PRs
   * included), newest first: the ones already completed or abandoned are what "Reviewed" lists
   */
  getReviewedPullRequests(reviewerId: string): Promise<ReviewerPullRequest[]> {
    return this.listReviewerPullRequests(reviewerId, 'all');
  }

  private async listReviewerPullRequests(reviewerId: string, status: 'active' | 'all'): Promise<ReviewerPullRequest[]> {
    const result = await this.request<{
      value: (Omit<ReviewerPullRequest, 'reviewers' | 'webUrl'> & Partial<ReviewerPullRequest>)[];
    }>(
      this.url(
        `git/pullrequests?searchCriteria.reviewerId=${reviewerId}&searchCriteria.status=${status}&$top=${MAX_REVIEW_REQUESTS}`
      )
    );
    return result.value.map((pr) => ({
      ...pr,
      reviewers: pr.reviewers ?? [],
      webUrl: this.pullRequestWebUrlByName(pr.repository.name, pr.pullRequestId),
    }));
  }

  /** All the threads of the PR: comments, and system threads (publication from draft, votes…) */
  async getPullRequestThreads(repositoryId: string, pullRequestId: number): Promise<ThreadResponse[]> {
    const result = await this.request<{ value: ThreadResponse[] }>(
      this.url(`git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads`)
    );
    return result.value;
  }

  /**
   * Author date (ISO) of the oldest commit of the PR (Rule TIMELINE-20). The API lists the commits newest first, 100 a
   * page (`$top`; `$skip` is ignored) and gives a continuation token in a header: the pages are read (at most
   * COMMIT_PAGES) and the oldest date of all is kept, whatever the order. Undefined: the PR has no commit
   */
  async getPullRequestFirstCommitDate(repositoryId: string, pullRequestId: number): Promise<string | undefined> {
    return oldestCommitDate(await this.getPullRequestCommits(repositoryId, pullRequestId));
  }

  /** The commits of the PR, at most COMMIT_PAGES pages of COMMIT_PAGE_SIZE (Rules TIMELINE-20, TIMELINE-39) */
  async getPullRequestCommits(repositoryId: string, pullRequestId: number): Promise<CommitRef[]> {
    const commits: CommitRef[] = [];
    let continuation: string | undefined;
    for (let page = 0; page < COMMIT_PAGES; page++) {
      const token = continuation ? `&continuationToken=${encodeURIComponent(continuation)}` : '';
      const result = await this.send(
        this.url(
          `git/repositories/${repositoryId}/pullRequests/${pullRequestId}/commits?$top=${COMMIT_PAGE_SIZE}${token}`
        )
      );
      commits.push(...((result.json as { value?: CommitRef[] }).value ?? []));
      continuation = result.continuation;
      if (!continuation) {
        break;
      }
    }
    return commits;
  }

  /** ID of the latest iteration (push) of the PR; undefined when it has none */
  async getLastIterationId(repositoryId: string, pullRequestId: number): Promise<number | undefined> {
    const result = await this.request<{ value: { id: number }[] }>(
      this.url(`git/repositories/${repositoryId}/pullRequests/${pullRequestId}/iterations`)
    );
    return result.value.reduce<number | undefined>((last, { id }) => Math.max(last ?? id, id), undefined);
  }

  /**
   * Files changed in an iteration, counted up to `limit`. The API has no total: it pages the changes, so the
   * first `limit + 1` are asked and `more` tells there were others
   */
  async getIterationChangeCount(
    repositoryId: string,
    pullRequestId: number,
    iterationId: number,
    limit: number
  ): Promise<{ count: number; more: boolean }> {
    const result = await this.request<{ changeEntries?: unknown[]; nextSkip?: number }>(
      this.url(
        `git/repositories/${repositoryId}/pullRequests/${pullRequestId}/iterations/${iterationId}/changes?$top=${
          limit + 1
        }`
      )
    );
    const { count, capped } = countChangedFiles(result.changeEntries?.length ?? 0, !!result.nextSkip, limit);
    return { count, more: capped };
  }

  /**
   * A PR of the project, whatever its repository. A PR of another project is fetched with that project
   * (its id or name) in the URL
   */
  async getPullRequest(id: number, project = this.project): Promise<PullRequestDetails> {
    // "reviewers" is missing when the PR has none
    const pr = await this.request<Omit<PullRequestDetails, 'reviewers' | 'webUrl'> & Partial<PullRequestDetails>>(
      `${BASE_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
        project
      )}/_apis/git/pullrequests/${id}?api-version=${API_VERSION}`
    );
    const webUrl = `${BASE_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
      pr.repository.project?.name ?? this.project
    )}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${id}`;
    return { ...pr, reviewers: pr.reviewers ?? [], webUrl };
  }

  async findActivePullRequest(repository: GitRepository, branch: string): Promise<PullRequest | undefined> {
    const source = encodeURIComponent(`refs/heads/${branch}`);
    const result = await this.request<{ value: PullRequest[] }>(
      this.url(
        `git/repositories/${repository.id}/pullrequests?searchCriteria.sourceRefName=${source}&searchCriteria.status=active`
      )
    );
    const pr = result.value.at(0);
    return pr && { ...pr, webUrl: this.pullRequestWebUrl(repository, pr.pullRequestId) };
  }

  /** Id of an active PR whose source is the branch; undefined when there is none */
  async findActivePullRequestId(repositoryId: string, branch: string): Promise<number | undefined> {
    const source = encodeURIComponent(`refs/heads/${branch}`);
    const result = await this.request<{ value: { pullRequestId: number }[] }>(
      this.url(
        `git/repositories/${repositoryId}/pullrequests?searchCriteria.sourceRefName=${source}&searchCriteria.status=active&$top=1`
      )
    );
    return result.value.at(0)?.pullRequestId;
  }

  /** The branch has a completed PR (its changes are in the target of that PR) */
  async hasCompletedPullRequestFrom(repository: GitRepository, branch: string): Promise<boolean> {
    const source = encodeURIComponent(`refs/heads/${branch}`);
    const result = await this.request<{ value: unknown[] }>(
      this.url(
        `git/repositories/${repository.id}/pullrequests?searchCriteria.sourceRefName=${source}&searchCriteria.status=completed&$top=1`
      )
    );
    return result.value.length > 0;
  }

  async createPullRequest(
    repository: GitRepository,
    pr: {
      source: string;
      target: string;
      title: string;
      description: string;
      isDraft: boolean;
      /** Work items of the PR title */
      workItemIds: number[];
      /** PR tasks: linked to the PR, but not part of its title */
      taskIds?: number[];
      /** Tags to put on the PR */
      labels?: string[];
    }
  ): Promise<PullRequest> {
    const created = await this.request<PullRequest & { labels?: PullRequestLabel[] }>(
      this.url(`git/repositories/${repository.id}/pullrequests`),
      {
        method: 'POST',
        body: JSON.stringify({
          sourceRefName: `refs/heads/${pr.source}`,
          targetRefName: `refs/heads/${pr.target}`,
          title: pr.title,
          description: pr.description,
          isDraft: pr.isDraft,
          workItemRefs: [...pr.workItemIds, ...(pr.taskIds ?? [])].map((id) => ({ id: String(id) })),
          ...(pr.labels?.length ? { labels: pr.labels.map((name) => ({ name })) } : {}),
        }),
      }
    );
    // The tags go in the create body; when the response does not show them, they are added one by one
    for (const name of pr.labels ?? []) {
      if (!hasSkipTag(created.labels, name)) {
        await this.addPullRequestLabel(repository.id, created.pullRequestId, name);
      }
    }
    return { ...created, webUrl: this.pullRequestWebUrl(repository, created.pullRequestId) };
  }

  private pullRequestWebUrl(repository: GitRepository, id: number): string {
    return `${repository.webUrl}/pullrequest/${id}`;
  }
}
