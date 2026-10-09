/** What the compact rows of the PR boxes show under the title. Pure, so no "vscode" import */
import { worstRunState } from './compactSignals';
import type { MyPullRequestModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import { runTooltip } from './runDetails';
import type { ReviewRequestModel } from './reviewRequests';

export type PrSignalKind =
  | 'author'
  | 'autoComplete'
  | 'bar'
  | 'branch'
  | 'ci'
  | 'comments'
  | 'next'
  | 'ready'
  | 'role'
  | 'time'
  | 'warnings';

export interface PrSignal {
  kind: PrSignalKind;
  /** Short text next to the icon. Empty: icon only */
  label: string;
  /** Full information */
  title: string;
  /**
   * Colour: "required" / "optional" (role), the review urgency (bar), the run state (ci), "error" / "warning"
   * (warnings), "ready" / "danger" / "pending" (next), "current" / "worktree" (branch), "neutral" otherwise
   */
  tone: string;
  /** bar: share of the maximum wait already used, from 0 to 1 */
  elapsed?: number;
}

function ciSignal(runs: RunModel[], now: Date): PrSignal | undefined {
  const state = worstRunState(runs);
  return state
    ? { kind: 'ci', label: '', title: runs.map((run) => runTooltip(run, now)).join('\n'), tone: state }
    : undefined;
}

function commentsSignal(unresolved: number | undefined): PrSignal | undefined {
  return unresolved
    ? {
        kind: 'comments',
        label: String(unresolved),
        title: `${unresolved} comment thread${unresolved === 1 ? '' : 's'} still active or pending`,
        tone: 'warning',
      }
    : undefined;
}

function defined(signals: (PrSignal | undefined)[]): PrSignal[] {
  return signals.filter((signal): signal is PrSignal => !!signal);
}

/**
 * Signals of a PR waiting for the user's review, in the order they are shown: required / optional, author, the
 * time waited as a bar, CI, unresolved comments, and whether its branch is the one checked out or is in a worktree.
 * The time left is in the title line, not here
 */
export function reviewCompactSignals(request: ReviewRequestModel, now = new Date()): PrSignal[] {
  const { details } = request;
  let branch: PrSignal | undefined;
  if (request.isCurrentBranch) {
    branch = { kind: 'branch', label: 'current', title: `${request.sourceBranch}: checked out`, tone: 'current' };
  } else if (request.worktree) {
    branch = {
      kind: 'branch',
      label: 'worktree',
      title: `${request.sourceBranch}: checked out in ${request.worktree}`,
      tone: 'worktree',
    };
  }
  return defined([
    {
      kind: 'role',
      label: request.isRequired ? 'Required' : 'Optional',
      title: request.isRequired ? 'You are a required reviewer' : 'You are an optional reviewer',
      tone: request.isRequired ? 'required' : 'optional',
    },
    {
      kind: 'author',
      label: request.author,
      title: `${request.repository}: ${request.author} → ${request.targetBranch}`,
      tone: 'neutral',
    },
    {
      kind: 'bar',
      label: '',
      title: `${request.barCaption}; ${request.dueText}`,
      tone: request.urgency,
      elapsed: request.elapsed,
    },
    details && ciSignal(details.runs, now),
    details && commentsSignal(details.unresolved),
    branch,
  ]);
}

/**
 * Signals of one of the user's PRs, in the order they are shown: next step, CI, unresolved comments, warnings
 * (red when one is an error), auto-complete and ready to merge. Completed PRs only tell when they were completed
 */
export function myPullRequestCompactSignals(pr: MyPullRequestModel, now = new Date()): PrSignal[] {
  if (pr.isCompleted) {
    return [{ kind: 'time', label: pr.time, title: pr.time, tone: 'neutral' }];
  }
  const hasError = pr.warnings.some((warning) => warning.severity === 'error');
  return defined([
    pr.next ? { kind: 'next', label: pr.next, title: `Next: ${pr.next}`, tone: pr.nextTone } : undefined,
    ciSignal(pr.runs, now),
    commentsSignal(pr.unresolved),
    pr.warnings.length
      ? {
          kind: 'warnings',
          label: String(pr.warnings.length),
          title: pr.warnings.map(({ text }) => text).join('\n'),
          tone: hasError ? 'error' : 'warning',
        }
      : undefined,
    pr.autoComplete
      ? {
          kind: 'autoComplete',
          label: 'auto',
          title: 'The PR is completed by itself when its policies pass',
          tone: 'approved',
        }
      : undefined,
    pr.readyToMerge
      ? { kind: 'ready', label: 'ready', title: 'Nothing stops the PR from being merged', tone: 'ready' }
      : undefined,
  ]);
}
