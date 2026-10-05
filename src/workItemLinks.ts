/** Pure helpers to interpret the relations of a work item and the state of its pull requests */

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes?: { name?: string };
}

export interface ArtifactRef {
  projectId: string;
  repositoryId: string;
}

export interface WorkItemLinks {
  parentId?: number;
  childIds: number[];
  branches: (ArtifactRef & { name: string })[];
  pullRequests: (ArtifactRef & { id: number })[];
}

const CHILD_REL = 'System.LinkTypes.Hierarchy-Forward';
const PARENT_REL = 'System.LinkTypes.Hierarchy-Reverse';
const BRANCH_PREFIX = 'vstfs:///Git/Ref/';
const PULL_REQUEST_PREFIX = 'vstfs:///Git/PullRequestId/';
const BRANCH_REF_PREFIX = 'GB';

function workItemIdFromUrl(url: string): number | undefined {
  const id = Number(/\/workItems\/(\d+)$/i.exec(url)?.[1]);
  return Number.isNaN(id) ? undefined : id;
}

/** Splits "<projectId>/<repositoryId>/<rest>" from an encoded artifact URL */
function parseArtifact(url: string, prefix: string): (ArtifactRef & { rest: string }) | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(url.slice(prefix.length));
  } catch {
    return undefined;
  }
  const [projectId, repositoryId, ...rest] = decoded.split('/');
  return projectId && repositoryId && rest.length ? { projectId, repositoryId, rest: rest.join('/') } : undefined;
}

export function parseRelations(relations: WorkItemRelation[] | undefined): WorkItemLinks {
  const links: WorkItemLinks = { childIds: [], branches: [], pullRequests: [] };
  for (const relation of relations ?? []) {
    if (relation.rel === CHILD_REL || relation.rel === PARENT_REL) {
      const id = workItemIdFromUrl(relation.url);
      if (id !== undefined && relation.rel === CHILD_REL) {
        links.childIds.push(id);
      } else if (id !== undefined) {
        links.parentId = id;
      }
    } else if (relation.rel === 'ArtifactLink' && relation.url.startsWith(BRANCH_PREFIX)) {
      const artifact = parseArtifact(relation.url, BRANCH_PREFIX);
      if (artifact?.rest.startsWith(BRANCH_REF_PREFIX)) {
        links.branches.push({
          projectId: artifact.projectId,
          repositoryId: artifact.repositoryId,
          name: artifact.rest.slice(BRANCH_REF_PREFIX.length),
        });
      }
    } else if (relation.rel === 'ArtifactLink' && relation.url.startsWith(PULL_REQUEST_PREFIX)) {
      const artifact = parseArtifact(relation.url, PULL_REQUEST_PREFIX);
      const id = Number(artifact?.rest);
      if (artifact && !Number.isNaN(id)) {
        links.pullRequests.push({ projectId: artifact.projectId, repositoryId: artifact.repositoryId, id });
      }
    }
  }
  return links;
}

export interface PullRequestReviewer {
  displayName: string;
  vote: number;
  isRequired?: boolean;
}

export interface PullRequestState {
  status: 'abandoned' | 'active' | 'completed' | 'notSet';
  isDraft: boolean;
  mergeStatus?: string;
  reviewers: PullRequestReviewer[];
}

export type PullRequestTone = 'abandoned' | 'approved' | 'completed' | 'draft' | 'rejected' | 'review' | 'waiting';

const VOTE_APPROVED = 10;
const VOTE_APPROVED_WITH_SUGGESTIONS = 5;
const VOTE_WAITING_FOR_AUTHOR = -5;
const VOTE_REJECTED = -10;

/** Summary of a PR as shown in Azure DevOps: draft, waiting for review, approved, rejected… */
export function pullRequestStatus(pr: PullRequestState): { label: string; tone: PullRequestTone } {
  if (pr.status === 'completed') {
    return { label: 'Completed', tone: 'completed' };
  }
  if (pr.status === 'abandoned') {
    return { label: 'Abandoned', tone: 'abandoned' };
  }
  if (pr.isDraft) {
    return { label: 'Draft', tone: 'draft' };
  }
  if (pr.mergeStatus === 'conflicts') {
    return { label: 'Conflicts', tone: 'rejected' };
  }
  const votes = pr.reviewers.map((reviewer) => reviewer.vote);
  if (votes.includes(VOTE_REJECTED)) {
    return { label: 'Rejected', tone: 'rejected' };
  }
  if (votes.includes(VOTE_WAITING_FOR_AUTHOR)) {
    return { label: 'Waiting for author', tone: 'waiting' };
  }
  const requiredPending = pr.reviewers.some(
    (reviewer) => reviewer.isRequired && reviewer.vote < VOTE_APPROVED_WITH_SUGGESTIONS
  );
  if (!requiredPending && votes.includes(VOTE_APPROVED)) {
    return { label: 'Approved', tone: 'approved' };
  }
  if (!requiredPending && votes.includes(VOTE_APPROVED_WITH_SUGGESTIONS)) {
    return { label: 'Approved with suggestions', tone: 'approved' };
  }
  return { label: 'Waiting for review', tone: 'review' };
}
