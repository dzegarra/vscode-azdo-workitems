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
  myPullRequests: { isCompleted: boolean; readyToMerge: boolean; warnings: { severity: string }[] }[];
  /** Latest CI runs of the followed PRs that failed */
  failedRuns: number;
}

export type SummaryRowId = 'alerts' | 'failedRuns' | 'nothing' | 'pullRequestWarnings' | 'readyToMerge' | 'reviews';

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
    label: `${count} pull request${plural(count, '', 's')} waiting for your review`,
    description: late || undefined,
    tooltip: `${count} pull request${plural(count, '', 's')} waiting for your review${late ? ` (${late})` : ''}`,
    icon: overdue ? 'error' : 'git-pull-request',
    color: lateColor(overdue, dueSoon),
  };
}

// Rules SUMMARY-3, SUMMARY-4
function ownPullRequestRows(pullRequests: SummaryInput['myPullRequests']): SummaryRow[] {
  const open = pullRequests.filter((pr) => !pr.isCompleted);
  const withWarnings = open.filter((pr) => pr.warnings.length);
  const withErrors = withWarnings.filter((pr) => pr.warnings.some((warning) => warning.severity === 'error'));
  const ready = open.filter((pr) => pr.readyToMerge).length;
  const rows: SummaryRow[] = [];
  if (withWarnings.length) {
    const count = withWarnings.length;
    const errors = withErrors.length;
    rows.push({
      id: 'pullRequestWarnings',
      label: `${count} of your pull request${plural(count, '', 's')} ${plural(count, 'has', 'have')} warnings`,
      description: errors ? `${errors} with errors` : undefined,
      tooltip: `${count} of your pull requests have warnings to fix before they can be merged${
        errors ? ` (${errors} with errors)` : ''
      }`,
      icon: 'warning',
      color: errors ? 'errorForeground' : 'list.warningForeground',
    });
  }
  if (ready) {
    rows.push({
      id: 'readyToMerge',
      label: `${ready} ready to merge`,
      tooltip: `${ready} of your pull request${plural(ready, '', 's')} ${plural(ready, 'is', 'are')} ready to merge`,
      icon: 'git-merge',
      color: 'testing.iconPassed',
    });
  }
  return rows;
}

// Rules SUMMARY-1, SUMMARY-5, SUMMARY-7
/** What needs the user's attention, one row each, only when the count is above 0 */
export function summaryRows(input: SummaryInput): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const alerts = input.workItemsWithAlerts;
  if (alerts) {
    rows.push({
      id: 'alerts',
      label: `${alerts} work item${plural(alerts, '', 's')} ${plural(alerts, 'needs', 'need')} attention`,
      tooltip: `${alerts} work item${plural(alerts, '', 's')} break${plural(alerts, 's', '')} a team rule`,
      icon: 'warning',
      color: 'errorForeground',
    });
  }
  const reviews = reviewsRow(input.reviews);
  if (reviews) {
    rows.push(reviews);
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

export interface SummaryBadge {
  value: number;
  tooltip: string;
}

// Rule SUMMARY-6
/**
 * Number on the activity bar icon: work items with alerts + PRs waiting for the user's review.
 * Undefined (no badge) when both are 0
 */
export function summaryBadge(input: Pick<SummaryInput, 'reviews' | 'workItemsWithAlerts'>): SummaryBadge | undefined {
  const withAlerts = input.workItemsWithAlerts;
  const toReview = input.reviews.length;
  if (!withAlerts && !toReview) {
    return undefined;
  }
  const reasons = [
    withAlerts && `${withAlerts} work item${withAlerts === 1 ? ' needs' : 's need'} attention`,
    toReview && `${toReview} pull request${toReview === 1 ? ' is' : 's are'} waiting for your review`,
  ].filter(Boolean);
  return { value: withAlerts + toReview, tooltip: reasons.join(', ') };
}
