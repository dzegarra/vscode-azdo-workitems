/**
 * What the user's own pull requests need from them, for the status bar item. Pure, so no "vscode" import
 */
import type { MyPullRequestModel } from './myPullRequests';

export type AttentionKind = 'ciFailed' | 'conflicts' | 'rejected' | 'unresolved' | 'waiting';
export type AttentionSeverity = 'error' | 'warning';

export interface AttentionReason {
  kind: AttentionKind;
  severity: AttentionSeverity;
  text: string;
}

export interface PullRequestAttention {
  id: number;
  title: string;
  url: string;
  /** Most urgent first. Empty when only "ready to merge" applies */
  reasons: AttentionReason[];
  /** Nothing stops the merge and nothing else needs the author: good news, still an action */
  ready: boolean;
}

export interface AttentionItem {
  text: string;
  /** Undefined: default background (only ready PRs) */
  background?: AttentionSeverity;
  title: string;
  /** PRs that need the user first (the most urgent first), then the ready ones */
  pullRequests: PullRequestAttention[];
}

const READY_ICON = '$(git-merge)';

/** The people who cast the vote; a group only when no person did, since a group votes through its members */
function voters(pr: MyPullRequestModel, vote: 'rejected' | 'waiting'): string {
  const matching = pr.reviewers.filter((reviewer) => reviewer.vote === vote);
  const people = matching.filter((reviewer) => !reviewer.isContainer);
  return (people.length ? people : matching).map((reviewer) => reviewer.name).join(', ');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Whether the PR counts at all: active and published (completed ones and drafts are left out) */
function isFollowed(pr: MyPullRequestModel): boolean {
  // Rule STATUSBAR-MYPR-1
  return !pr.isCompleted && !pr.isDraft;
}

function feedbackReasons(pr: MyPullRequestModel): AttentionReason[] {
  const rejected = voters(pr, 'rejected');
  const waiting = voters(pr, 'waiting');
  return [
    ...(rejected ? [{ kind: 'rejected' as const, severity: 'error' as const, text: `Rejected (${rejected})` }] : []),
    ...(waiting
      ? [{ kind: 'waiting' as const, severity: 'warning' as const, text: `Waiting for author (${waiting})` }]
      : []),
  ];
}

function ciReasons(pr: MyPullRequestModel): AttentionReason[] {
  if (pr.runs.some((run) => run.state === 'failed')) {
    return [{ kind: 'ciFailed', severity: 'error', text: 'CI failed' }];
  }
  return pr.runs.some((run) => run.state === 'partial')
    ? [{ kind: 'ciFailed', severity: 'error', text: 'CI partially succeeded' }]
    : [];
}

/**
 * Why the PR needs the user, most urgent first. Rule STATUSBAR-MYPR-2: rejected, waiting for author, conflicts,
 * failed CI (a failed or partially succeeded run; running ones do not count) and unresolved comments
 */
export function attentionReasons(pr: MyPullRequestModel): AttentionReason[] {
  if (!isFollowed(pr)) {
    return [];
  }
  // Rule STATUSBAR-MYPR-2
  return [
    ...feedbackReasons(pr),
    ...(pr.conflicts ? [{ kind: 'conflicts' as const, severity: 'error' as const, text: 'Conflicts' }] : []),
    ...ciReasons(pr),
    ...(pr.unresolved
      ? [
          {
            kind: 'unresolved' as const,
            severity: 'warning' as const,
            text: plural(pr.unresolved, 'unresolved comment'),
          },
        ]
      : []),
  ];
}

/** Whether the PR is ready to merge by the user. Rule STATUSBAR-MYPR-3: PRs that complete by themselves are not */
function isReady(pr: MyPullRequestModel, reasons: AttentionReason[]): boolean {
  // Rule STATUSBAR-MYPR-3
  return isFollowed(pr) && pr.readyToMerge && !pr.autoComplete && !reasons.length;
}

/**
 * Whether the tile of the PR pulses in the sidebar: an active published PR with a reason that needs the user (the
 * status bar ones) or a team-rule warning (which the status bar ignores). Drafts and completed PRs never do
 */
export function needsAttention(pr: MyPullRequestModel): boolean {
  // Rule MYPR-PULSE-1
  if (!isFollowed(pr)) {
    return false;
  }
  // Rules MYPR-PULSE-2, MYPR-PULSE-3
  return attentionReasons(pr).length > 0 || pr.warnings.length > 0;
}

export function attentionOf(pr: MyPullRequestModel): PullRequestAttention {
  const reasons = attentionReasons(pr);
  return { id: pr.id, title: pr.title, url: pr.url, reasons, ready: isReady(pr, reasons) };
}

const KIND_RANK: Record<AttentionKind, number> = { rejected: 0, waiting: 1, conflicts: 2, ciFailed: 3, unresolved: 4 };

function urgency(pr: PullRequestAttention): number {
  return pr.reasons.length ? KIND_RANK[pr.reasons[0].kind] : Object.keys(KIND_RANK).length;
}

function itemText(needing: number, ready: number): string {
  if (needing && ready) {
    return `$(git-pull-request) ${needing} need you · ${READY_ICON} ${ready} ready`;
  }
  return needing ? `$(git-pull-request) ${needing} need you` : `${READY_ICON} ${ready} ready to merge`;
}

function itemTitle(needing: number, ready: number): string {
  const parts = [
    ...(needing ? [`${plural(needing, 'pull request')} ${needing === 1 ? 'needs' : 'need'} you`] : []),
    ...(ready ? [`${ready} ready to merge`] : []),
  ];
  return parts.join(' · ');
}

/**
 * The status bar item of the user's PRs, from the models of the sidebar. Undefined when nothing needs the user
 * (rule STATUSBAR-MYPR-6: the item is hidden then)
 */
export function myPullRequestsItem(models: MyPullRequestModel[]): AttentionItem | undefined {
  const all = models.map(attentionOf);
  // Stable sort: the order of the sidebar is kept among equally urgent PRs
  const pullRequests = all.filter((pr) => pr.reasons.length || pr.ready).sort((a, b) => urgency(a) - urgency(b));
  // Rule STATUSBAR-MYPR-6
  if (!pullRequests.length) {
    return undefined;
  }
  const needing = pullRequests.filter((pr) => pr.reasons.length);
  const ready = pullRequests.length - needing.length;
  const reasons = needing.flatMap((pr) => pr.reasons);
  // Rule STATUSBAR-MYPR-5
  let background: AttentionSeverity | undefined;
  if (reasons.some((reason) => reason.severity === 'error')) {
    background = 'error';
  } else if (reasons.length) {
    background = 'warning';
  }
  // Rule STATUSBAR-MYPR-4
  return {
    text: itemText(needing.length, ready),
    background,
    title: itemTitle(needing.length, ready),
    pullRequests,
  };
}

/** Icon of a PR line in the tooltip: its worst reason, or the merge icon for a ready one */
export function attentionIcon(pr: PullRequestAttention): string {
  if (!pr.reasons.length) {
    return READY_ICON;
  }
  return pr.reasons.some((reason) => reason.severity === 'error') ? '$(error)' : '$(warning)';
}

/** The text of a tooltip line after the PR link: its reasons, or "Ready to merge" */
export function attentionLine(pr: PullRequestAttention): string {
  // Rule STATUSBAR-MYPR-7
  return pr.reasons.length ? pr.reasons.map((reason) => reason.text).join(' · ') : 'Ready to merge';
}
