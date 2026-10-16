/**
 * Colour of the two PR boxes ("Waiting for your review", "My Pull Requests"): it tells whether the box needs the
 * user even while it is collapsed. Pure, so no "vscode" import. Completed / reviewed PRs never count
 */
import type { MyPullRequestModel } from './myPullRequests';
import { needsAttention } from './myPullRequestsAttention';
import { countLate } from './reviewRequests';
import type { ReviewRequestModel } from './reviewRequests';

/** alert: red, attention: orange, info: blue, none: neutral (no tint) */
export type PanelTone = 'alert' | 'attention' | 'info' | 'none';

/** Only the waiting requests are passed in: the "Reviewed" list is never involved */
export function reviewsPanelTone(requests: Pick<ReviewRequestModel, 'isRequired' | 'urgency'>[]): PanelTone {
  // Rule PANEL-TONE-1
  if (countLate(requests).overdue > 0) {
    return 'alert';
  }
  return requests.length > 0 ? 'attention' : 'none';
}

export function myPullRequestsPanelTone(items: MyPullRequestModel[]): PanelTone {
  // Rule PANEL-TONE-2
  const active = items.filter((pr) => !pr.isCompleted);
  if (active.some((pr) => needsAttention(pr))) {
    return 'attention';
  }
  return active.length > 0 ? 'info' : 'none';
}
