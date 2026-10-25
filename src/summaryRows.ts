/**
 * Rows of the Summary tree view and the badge of the activity bar icon, from plain counts. No "vscode" import
 */
import type { ReviewUrgency } from './reviewRequests';
import { countLate } from './reviewRequests';

export interface SummaryInput {
  /** Work items with alerts (the same count as the status bar) */
  workItemsWithAlerts: number;
  /** Shown PRs waiting for the user's review */
  reviews: { isRequired: boolean; urgency: ReviewUrgency }[];
  /** The user's own PRs, as the My Pull Requests box shows them */
  myPullRequests: {
    isCompleted: boolean;
    readyToMerge: boolean;
    warnings: { severity: string }[];
    /** The PR needs the user (the "unblock" rule of the Now queue, NOW-2); missing: it has warnings */
    needsYou?: boolean;
    /** Some of what it needs is an error; missing: some warning is */
    hasError?: boolean;
  }[];
  /** Latest CI runs of the followed PRs that failed */
  failedRuns: number;
  /** The CI of the base branch is red (Rules BASE-CI-*): the pipelines broken on it */
  baseBranch?: { branch: string; brokenPipelines: string[] };
  /** totalflowx.fun.enabled with the alerts on and work items listed: a clean board is celebrated */
  celebrateCleanBoard?: boolean;
  /** Worktrees that can be removed (Rules WORKTREE-STALE-*), with why; missing when the row is off */
  staleWorktrees?: { branch: string; reasons: string }[];
}

export type SummaryRowId =
  | 'alerts'
  | 'baseBranch'
  | 'cleanBoard'
  | 'failedRuns'
  | 'nothing'
  | 'pullRequestWarnings'
  | 'readyToMerge'
  | 'reviews'
  | 'staleWorktrees';

export interface SummaryRow {
  id: SummaryRowId;
  label: string;
  description?: string;
  tooltip: string;
  /** Codicon name, without "$(" ")" */
  icon: string;
  /** Theme colour id for the icon */
  color?: string;
}

const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many);

function lateColor(overdue: number, dueSoon: number): string | undefined {
  if (overdue) {
    return 'errorForeground';
  }
  return dueSoon ? 'list.warningForeground' : undefined;
}

// Rule SUMMARY-2
function reviewsRow(reviews: SummaryInput['reviews']): SummaryRow | undefined {
  if (!reviews.length) {
    return undefined;
  }
  const { overdue, dueSoon } = countLate(reviews);
  const late = [overdue && `${overdue} overdue`, dueSoon && `${dueSoon} due soon`].filter(Boolean).join(' · ');
  const count = reviews.length;
  return {
    id: 'reviews',
    label: 'To review',
    description: [String(count), late].filter(Boolean).join(' · '),
    tooltip: `${count} pull request${plural(count, '', 's')} waiting for your review${late ? ` (${late})` : ''}`,
    icon: overdue ? 'error' : 'git-pull-request',
    color: lateColor(overdue, dueSoon),
  };
}

// Rules SUMMARY-3, SUMMARY-4, SUMMARY-5
function ownPullRequestRows(pullRequests: SummaryInput['myPullRequests']): SummaryRow[] {
  const open = pullRequests.filter((pr) => !pr.isCompleted);
  const needing = open.filter((pr) => pr.needsYou ?? pr.warnings.length > 0);
  const errors = needing.filter((pr) => pr.hasError ?? pr.warnings.some((warning) => warning.severity === 'error'));
  const ready = open.filter((pr) => pr.readyToMerge).length;
  const rows: SummaryRow[] = [];
  if (needing.length) {
    const count = needing.length;
    rows.push({
      id: 'pullRequestWarnings',
      label: 'My PRs that need me',
      description: [String(count), errors.length && `${errors.length} with errors`].filter(Boolean).join(' · '),
      tooltip: `${count} of your pull request${plural(count, '', 's')} ${plural(count, 'needs', 'need')} you${
        errors.length ? ` (${errors.length} with errors)` : ''
      }`,
      icon: 'warning',
      color: errors.length ? 'errorForeground' : 'list.warningForeground',
    });
  }
  if (ready) {
    rows.push({
      id: 'readyToMerge',
      label: 'Ready to merge',
      description: String(ready),
      tooltip: `${ready} of your pull request${plural(ready, '', 's')} ${plural(ready, 'is', 'are')} ready to merge`,
      icon: 'git-merge',
      color: 'testing.iconPassed',
    });
  }
  return rows;
}

// Rule SUMMARY-8
/** The work items of the list all follow the team rules: a row to be proud of, under the others */
function cleanBoardRow(input: SummaryInput): SummaryRow[] {
  return input.celebrateCleanBoard && !input.workItemsWithAlerts
    ? [
        {
          id: 'cleanBoard',
          label: 'Clean board ✨',
          description: 'every work item follows the team rules',
          tooltip: 'None of your work items breaks a team rule. Keep it up!',
          icon: 'sparkle',
          color: 'testing.iconPassed',
        },
      ]
    : [];
}

// Rule SUMMARY-10
/** Worktrees to clean up: housekeeping, under the attention rows; never in the badge */
function staleWorktreesRow(input: SummaryInput): SummaryRow[] {
  const stale = input.staleWorktrees ?? [];
  if (!stale.length) {
    return [];
  }
  const count = stale.length;
  return [
    {
      id: 'staleWorktrees',
      label: 'Worktrees to clean up',
      description: String(count),
      tooltip: [
        `${count} worktree${plural(count, ' is', 's are')} no longer needed:`,
        ...stale.map(({ branch, reasons }) => `• ${branch}: ${reasons}`),
      ].join('\n'),
      icon: 'trash',
      // Housekeeping, never urgent: muted
      color: 'disabledForeground',
    },
  ];
}

// Rule SUMMARY-9
/** The base branch is broken: the first row, it needs everyone */
function baseBranchRow(input: SummaryInput): SummaryRow[] {
  const pipelines = input.baseBranch?.brokenPipelines ?? [];
  if (!input.baseBranch || !pipelines.length) {
    return [];
  }
  const { branch } = input.baseBranch;
  return [
    {
      id: 'baseBranch',
      label: `${branch} is broken`,
      description: pipelines.join(', '),
      tooltip: `The CI of ${branch} failed (${pipelines.join(', ')}). It must be fixed as soon as possible.`,
      icon: 'flame',
      color: 'errorForeground',
    },
  ];
}

// Rules SUMMARY-1, SUMMARY-5, SUMMARY-7
/** What needs the user's attention, one row each, only when the count is above 0 */
function attentionRows(input: SummaryInput): SummaryRow[] {
  const rows: SummaryRow[] = baseBranchRow(input);
  const reviews = reviewsRow(input.reviews);
  if (reviews) {
    rows.push(reviews);
  }
  const alerts = input.workItemsWithAlerts;
  if (alerts) {
    rows.push({
      id: 'alerts',
      label: 'Work items to fix',
      description: String(alerts),
      tooltip: `${alerts} work item${plural(alerts, '', 's')} break${plural(alerts, 's', '')} a team rule`,
      icon: 'warning',
      color: 'errorForeground',
    });
  }
  rows.push(...ownPullRequestRows(input.myPullRequests));
  if (input.failedRuns) {
    const count = input.failedRuns;
    rows.push({
      id: 'failedRuns',
      label: `${count} failed CI run${plural(count, '', 's')}`,
      tooltip: `${count} CI run${plural(count, '', 's')} of your followed pull requests ${plural(
        count,
        'has',
        'have'
      )} failed`,
      icon: 'error',
      color: 'errorForeground',
    });
  }
  return rows.length
    ? rows
    : [
        {
          id: 'nothing',
          label: 'Nothing needs your attention',
          tooltip: 'Nothing needs your attention',
          icon: 'check',
        },
      ];
}

/**
 * The rows of the Summary view, in the order of the design (Rule SUMMARY-11): develop broken, To review, Work items
 * to fix, My PRs that need me, Ready to merge, (failed CI runs), then the muted worktrees to clean up, then the clean board
 */
export function summaryRows(input: SummaryInput): SummaryRow[] {
  return [...attentionRows(input), ...staleWorktreesRow(input), ...cleanBoardRow(input)];
}

export interface SummaryBadge {
  value: number;
  tooltip: string;
}

// Rule SUMMARY-6
/**
 * Number on the activity bar icon: work items with alerts + PRs waiting for the user's review + 1 when the base
 * branch is broken. Undefined (no badge) when all are 0
 */
export function summaryBadge(
  input: Pick<SummaryInput, 'baseBranch' | 'reviews' | 'workItemsWithAlerts'>
): SummaryBadge | undefined {
  const withAlerts = input.workItemsWithAlerts;
  const toReview = input.reviews.length;
  const broken = input.baseBranch?.brokenPipelines.length ? 1 : 0;
  if (!withAlerts && !toReview && !broken) {
    return undefined;
  }
  const reasons = [
    broken && `${input.baseBranch?.branch ?? ''} is broken`,
    withAlerts && `${withAlerts} work item${withAlerts === 1 ? ' needs' : 's need'} attention`,
    toReview && `${toReview} pull request${toReview === 1 ? ' is' : 's are'} waiting for your review`,
  ].filter(Boolean);
  return { value: broken + withAlerts + toReview, tooltip: reasons.join(', ') };
}
