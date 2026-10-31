/**
 * What stops an open PR in review from being merged, in a few words (Rule TIMELINE-52), for the note after its bar in
 * the Sprint timeline. The user's PRs already have the sidebar's "Next" line; the others only have their reviewers,
 * conflicts and CI, so the note is built from those. Pure, so no "vscode" import
 */
import {
  COMPLETES_BY_ITSELF,
  NO_APPROVALS_YET,
  READY_TO_MERGE,
  type MyPullRequestModel,
  type ReviewerModel,
} from './myPullRequests';
import type { RunModel } from './pipelines';

export interface BlockerInput {
  /** The PR is one of the user's: its "Next" line says it */
  mine?: Pick<MyPullRequestModel, 'next' | 'readyToMerge'>;
  reviewers: readonly ReviewerModel[];
  conflicts: boolean;
  runs: readonly Pick<RunModel, 'finishTime' | 'id' | 'pipeline' | 'startTime' | 'state'>[];
}

const names = (reviewers: readonly ReviewerModel[]): string => reviewers.map((reviewer) => reviewer.name).join(', ');

/** The latest run of some pipeline, failed or partially succeeded (a running or queued one says nothing yet) */
function ciFailed(runs: BlockerInput['runs']): boolean {
  const latest = new Map<string, BlockerInput['runs'][number]>();
  for (const run of runs) {
    if (run.state === 'canceled') {
      continue;
    }
    const seen = latest.get(run.pipeline);
    if (!seen || run.id > seen.id) {
      latest.set(run.pipeline, run);
    }
  }
  return [...latest.values()].some((run) => run.state === 'failed' || run.state === 'partial');
}

/** The steps, separated by " · ", in the order the author should take them; undefined when nothing is known */
export function whatStopsTheMerge(input: BlockerInput): string | undefined {
  const { mine, reviewers } = input;
  if (mine) {
    const { next } = mine;
    return mine.readyToMerge || !next || next === READY_TO_MERGE || next === COMPLETES_BY_ITSELF ? undefined : next;
  }
  const people = reviewers.filter((reviewer) => !reviewer.isContainer);
  const rejected = people.filter((reviewer) => reviewer.vote === 'rejected');
  const waiting = people.filter((reviewer) => reviewer.vote === 'waiting');
  const pendingPeople = people.filter((reviewer) => reviewer.isRequired && reviewer.vote === 'none');
  const anyApproval = people.some((reviewer) => reviewer.vote === 'approved' || reviewer.vote === 'suggestions');
  // A required group votes through its members: it only counts when no person is pending and nobody approved yet
  const pendingGroups = reviewers.filter(
    (reviewer) => reviewer.isContainer && reviewer.isRequired && reviewer.vote === 'none'
  );
  const groups = anyApproval ? [] : pendingGroups;
  const pending = pendingPeople.length ? pendingPeople : groups;
  const steps = [
    input.conflicts ? 'Resolve the conflicts' : '',
    rejected.length ? `Rejected by ${names(rejected)}` : '',
    waiting.length ? `Feedback of ${names(waiting)} to address` : '',
    ciFailed(input.runs) ? 'CI failed' : '',
    pending.length ? `Approval of ${names(pending)} missing` : '',
  ].filter(Boolean);
  if (!steps.length && !anyApproval) {
    steps.push(NO_APPROVALS_YET);
  }
  return steps.length ? [...new Set(steps)].join(' · ') : undefined;
}
