import { getAccessToken } from './auth';
import { buildMyWorkItemsQuery, Iteration, mergeTeamIterations, TeamIteration } from './iterations';
import { parseRelations, PullRequestState, WorkItemLinks, WorkItemRelation } from './workItemLinks';

const API_VERSION = '7.1';
const BASE_URL = 'https://dev.azure.com';
const NOT_FOUND = 404;
/** The work items API accepts up to 200 IDs per request */
const MAX_IDS_PER_REQUEST = 200;

export interface WorkItem {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath: string;
  url: string;
  links: WorkItemLinks;
}

export interface WorkItemDetails extends WorkItem {
  /** Raw fields, e.g. "System.Description" or "System.AssignedTo" */
  fields: Record<string, unknown>;
}

export interface WorkItemTypeState {
  name: string;
  /** Proposed, InProgress, Resolved, Completed or Removed */
  category: string;
  color: string;
}

const typeStatesCache = new Map<string, Promise<WorkItemTypeState[]>>();

/** Most recent PRs checked for notifications */
const MAX_PULL_REQUESTS = 30;

export interface PullRequestComment {
  threadId: number;
  id: number;
  authorId: string;
  author: string;
  content: string;
}

interface PullRequestThreadResponse {
  id: number;
  comments?: {
    id: number;
    author: { id: string; displayName: string };
    content?: string;
    commentType: string;
    isDeleted?: boolean;
  }[];
}

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
  repository: { id: string; name: string };
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

  private url(path: string, team?: string): string {
    const segments = [this.organization, this.project, team]
      .filter(Boolean)
      .map((s) => encodeURIComponent(s as string));
    const separator = path.includes('?') ? '&' : '?';
    return `${BASE_URL}/${segments.join('/')}/_apis/${path}${separator}api-version=${API_VERSION}`;
  }

  private async request<T>(
    url: string,
    init: { method?: string; body?: string; contentType?: string } = {}
  ): Promise<T> {
    const token = await getAccessToken();
    const response = await fetch(url, {
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
    return (await response.json()) as T;
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
  async getMyWorkItems(iterationPaths: string[]): Promise<WorkItem[]> {
    if (!iterationPaths.length) {
      return [];
    }
    const query = buildMyWorkItemsQuery(iterationPaths);
    const result = await this.request<{ workItems: { id: number }[] }>(this.url('wit/wiql'), {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
    return this.getWorkItems(result.workItems.map((wi) => wi.id));
  }

  async getWorkItems(ids: number[]): Promise<WorkItem[]> {
    if (!ids.length) {
      return [];
    }
    const items: WorkItem[] = [];
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      // "fields" cannot be combined with "$expand"; relations give parent / children / branches / PRs
      const result = await this.request<{ value: WorkItemResponse[] }>(
        this.url(`wit/workitems?ids=${chunk.join(',')}&$expand=relations`)
      );
      items.push(...result.value.map((wi) => this.toWorkItem(wi)));
    }
    // Keep the order returned by the query
    return ids.map((id) => items.find((wi) => wi.id === id)).filter((wi): wi is WorkItem => !!wi);
  }

  private toWorkItem(wi: WorkItemResponse): WorkItem {
    return {
      id: wi.id,
      title: wi.fields['System.Title'],
      type: wi.fields['System.WorkItemType'],
      state: wi.fields['System.State'],
      iterationPath: wi.fields['System.IterationPath'],
      links: parseRelations(wi.relations),
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

  private pullRequestWebUrlByName(repositoryName: string, id: number): string {
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

  /** Text comments of the PR (system messages and deleted comments are left out) */
  async getPullRequestComments(repositoryId: string, pullRequestId: number): Promise<PullRequestComment[]> {
    const result = await this.request<{ value: PullRequestThreadResponse[] }>(
      this.url(`git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads`)
    );
    return result.value.flatMap((thread) =>
      (thread.comments ?? [])
        .filter((comment) => comment.commentType === 'text' && !comment.isDeleted)
        .map((comment) => ({
          threadId: thread.id,
          id: comment.id,
          authorId: comment.author.id,
          author: comment.author.displayName,
          content: comment.content ?? '',
        }))
    );
  }

  /** PR by ID, in any repository of the project */
  async getPullRequest(id: number): Promise<PullRequestDetails> {
    // "reviewers" is missing when the PR has none
    const pr = await this.request<Omit<PullRequestDetails, 'reviewers' | 'webUrl'> & Partial<PullRequestDetails>>(
      this.url(`git/pullrequests/${id}`)
    );
    const webUrl = `${BASE_URL}/${encodeURIComponent(this.organization)}/${encodeURIComponent(
      this.project
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

  async createPullRequest(
    repository: GitRepository,
    pr: { source: string; target: string; title: string; description: string; isDraft: boolean; workItemIds: number[] }
  ): Promise<PullRequest> {
    const created = await this.request<PullRequest>(this.url(`git/repositories/${repository.id}/pullrequests`), {
      method: 'POST',
      body: JSON.stringify({
        sourceRefName: `refs/heads/${pr.source}`,
        targetRefName: `refs/heads/${pr.target}`,
        title: pr.title,
        description: pr.description,
        isDraft: pr.isDraft,
        workItemRefs: pr.workItemIds.map((id) => ({ id: String(id) })),
      }),
    });
    return { ...created, webUrl: this.pullRequestWebUrl(repository, created.pullRequestId) };
  }

  private pullRequestWebUrl(repository: GitRepository, id: number): string {
    return `${repository.webUrl}/pullrequest/${id}`;
  }
}
