/**
 * The note lines under each station of the track in the Work Item Details panel (redesign): where the branch is, the
 * state of the PR, what CI and the reviewers say, how the merge will go. Presentation only: built from data the
 * panel already has (no request), never a rule of its own. Pure, so no "vscode" import
 */
import type { MyPullRequestModel, ReviewerModel } from './myPullRequests';
import { worstRunState } from './compactSignals';
import type { RunModel } from './pipelines';
import { normalizeState, stateCategory } from './states';
import { trackPullRequest, type StationId } from './track';
import type { BranchModel, PullRequestModel, WorkItemModel } from './viewModel';

export type StationNotes = Record<StationId, string[]>;

export type NotesCard = Pick<WorkItemModel, 'branch' | 'branches' | 'pullRequests' | 'state' | 'type'>;

export type NotesPullRequest = Pick<
  MyPullRequestModel,
  'autoComplete' | 'canComplete' | 'id' | 'isCompleted' | 'isDraft' | 'reviewers' | 'runs' | 'time'
>;

export interface StationNotesInput {
  card: NotesCard;
  /** The user's own PR followed by the track, if it is one of theirs */
  mine?: NotesPullRequest;
  /** Value of "Integrated in Build" (Bugs) */
  integrationBuild?: string;
}

const MAX_NAMES = 2;
const WORKTREE_SEPARATOR = /[\\/]/;

const LOCATION_TEXT: Record<BranchModel['location'], string> = {
  current: 'checked out here',
  local: 'local',
  remote: 'only in the remote',
  linked: 'linked only',
};

const isPublished = (pr: PullRequestModel | undefined): pr is PullRequestModel =>
  pr !== undefined && pr.tone !== 'draft' && pr.tone !== 'abandoned';

/** "local · in worktree tree-a": where a branch is */
export function branchLocationText(branch: BranchModel): string {
  const worktree = branch.worktree?.split(WORKTREE_SEPARATOR).filter(Boolean).at(-1);
  return [LOCATION_TEXT[branch.location], worktree ? `in worktree ${worktree}` : ''].filter(Boolean).join(' · ');
}

function branchNotes(card: NotesCard): string[] {
  const name = card.branch ?? card.branches.at(0)?.name;
  if (!name) {
    return ['No branch yet'];
  }
  const branch = card.branches.find((candidate) => candidate.name === name);
  if (!branch) {
    return [name];
  }
  return [name, branchLocationText(branch)];
}

function pullRequestNotes(card: NotesCard, pr: PullRequestModel | undefined, mine?: NotesPullRequest): string[] {
  if (!pr) {
    const hasBranch = !!card.branch || card.branches.length > 0;
    return hasBranch ? ['No PR yet', 'Opens as draft: self-review, then publish'] : ['After the branch'];
  }
  const repository = pr.otherRepository ? ` · ${pr.repository}` : '';
  if (pr.tone === 'draft') {
    return [`PR ${String(pr.id)} · draft${repository}`, 'Self-review, then publish'];
  }
  if (pr.tone === 'abandoned' || !mine) {
    return [`PR ${String(pr.id)} · ${pr.status}${repository}`];
  }
  const age = mine.isCompleted ? mine.time : `published ${mine.time} ago`;
  return [`PR ${String(pr.id)} · ${age}${repository}`];
}

function coverageText(runs: RunModel[]): string {
  const coverage = runs.find((run) => run.coverage)?.coverage;
  if (!coverage) {
    return '';
  }
  const percent = `${String(Math.round(coverage.percent))}%`;
  const delta = coverage.delta ?? 0;
  if (Math.abs(delta) < 0.05) {
    return percent;
  }
  return `${percent} ${delta > 0 ? '▲' : '▼'} ${Math.abs(delta).toFixed(1)}`;
}

function testsText(runs: RunModel[]): string {
  const summaries = runs.flatMap((run) => (run.tests ? [run.tests] : []));
  const total = summaries.reduce((sum, tests) => sum + tests.total, 0);
  const failed = summaries.reduce((sum, tests) => sum + tests.failed, 0);
  if (!summaries.length) {
    return '';
  }
  return failed ? `${String(failed)} of ${String(total)} tests failed` : `${String(total)} tests`;
}

function ciNotes(pr: PullRequestModel | undefined, mine?: NotesPullRequest): string[] {
  if (!isPublished(pr)) {
    return ['Starts when the draft is published'];
  }
  const runs = mine?.runs ?? pr.runs;
  const state = worstRunState(runs);
  if (state === undefined) {
    return ['No run yet'];
  }
  const progress = state === 'running' || state === 'queued' ? state : '';
  const summary = [progress, testsText(runs), coverageText(runs)].filter(Boolean).join(' · ');
  const failedStep = runs.find((run) => run.failedStep && !run.tests?.failed)?.failedStep;
  return [summary, failedStep ? `${failedStep} failed` : ''].filter(Boolean);
}

const isApproval = (reviewer: ReviewerModel): boolean =>
  reviewer.vote === 'approved' || reviewer.vote === 'suggestions';

function namesText(names: string[]): string {
  const shown = names.slice(0, MAX_NAMES).join(', ');
  return names.length > MAX_NAMES ? `${shown} +${String(names.length - MAX_NAMES)}` : shown;
}

function reviewNotes(pr: PullRequestModel | undefined, mine?: NotesPullRequest): string[] {
  if (!isPublished(pr)) {
    return ['Starts when the draft is published'];
  }
  if (!mine) {
    return [pr.status];
  }
  const required = mine.reviewers.filter((reviewer) => reviewer.isRequired && !reviewer.isContainer);
  const approved = required.filter(isApproval);
  const missing = required.filter((reviewer) => !isApproval(reviewer)).map((reviewer) => reviewer.name);
  const feedback = mine.reviewers.flatMap((reviewer) => {
    if (reviewer.vote === 'rejected') {
      return [`${reviewer.name} rejected`];
    }
    return reviewer.vote === 'waiting' ? [`${reviewer.name} is waiting for you`] : [];
  });
  if (!required.length) {
    return [mine.reviewers.length ? `${String(mine.reviewers.length)} reviewers` : '', ...feedback].filter(Boolean);
  }
  const count = `${String(approved.length)} of ${String(required.length)} required approved`;
  return [count, missing.length ? `approval of ${namesText(missing)} missing` : '', ...feedback].filter(Boolean);
}

function readyNotes(pr: PullRequestModel | undefined, mine?: NotesPullRequest): string[] {
  if (pr?.tone === 'completed') {
    return ['merged'];
  }
  if (mine?.autoComplete) {
    return ['auto-complete set'];
  }
  return [mine?.canComplete ? 'Complete… from My Pull Requests: squash, delete branch' : 'squash · delete branch'];
}

function doneNotes(card: NotesCard, integrationBuild?: string): string[] {
  if (normalizeState(card.type) === normalizeState('Bug')) {
    return [
      integrationBuild
        ? `Integrated in Build ${integrationBuild}`
        : 'Integrated in Build is set when it moves to Ready to Test',
    ];
  }
  return ['When no other task or PR is open'];
}

/** The lines under each station of the track of a Backlog Item or a Bug */
export function stationNotes({ card, mine, integrationBuild }: StationNotesInput): StationNotes {
  if (stateCategory(card.state) === 'removed') {
    return { branch: [], pullRequest: [], ci: [], review: [], ready: [], done: ['removed'] };
  }
  const pr = trackPullRequest(card);
  const own = mine && pr && mine.id === pr.id ? mine : undefined;
  return {
    branch: branchNotes(card),
    pullRequest: pullRequestNotes(card, pr, own),
    ci: ciNotes(pr, own),
    review: reviewNotes(pr, own),
    ready: readyNotes(pr, own),
    done: doneNotes(card, integrationBuild),
  };
}
