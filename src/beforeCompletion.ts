/**
 * The "Before completion" checklist of the Work Item Details panel (redesign): what keeps an open work item from
 * being completed, in one list. Built from the existing rules only (alerts, COMPLETE-*), never re-derived. Pure,
 * so no "vscode" import
 */
import { isClosedState } from './states';
import type { WorkItemModel } from './viewModel';

export interface CompletionCheck {
  /** broken: a team rule (alert); caution: something to agree or fill before completing */
  severity: 'broken' | 'caution';
  text: string;
  /** Work item the check is about, when it is another one (a predecessor) */
  relatedId?: number;
}

export type ChecklistInput = Pick<
  WorkItemModel,
  'alerts' | 'blockingTags' | 'conventions' | 'missingFields' | 'openPredecessors' | 'state'
>;

// Rules BEFORE-1..3
/**
 * The checks of an open work item: its alerts first (they break a team rule), then the completion cautions
 * (open predecessors with who to agree with, blocking tags, empty fields, conventions). Empty for closed items
 */
export function beforeCompletion(item: ChecklistInput): CompletionCheck[] {
  if (isClosedState(item.state)) {
    // Rule BEFORE-3: a closed item has its alerts on the card; there is nothing left to complete
    return [];
  }
  // Rule BEFORE-1
  const alerts = item.alerts.map((alert): CompletionCheck => ({ severity: 'broken', text: alert.message }));
  // Rule BEFORE-2
  const predecessors = (item.openPredecessors ?? []).map(
    (predecessor): CompletionCheck => ({
      severity: 'caution',
      text: `Predecessor #${String(predecessor.id)} is ${predecessor.state}${
        predecessor.assignedTo ? `: agree with ${predecessor.assignedTo}` : ''
      }${predecessor.iterationName ? ` (${predecessor.iterationName})` : ''}`,
      relatedId: predecessor.id,
    })
  );
  const tags = (item.blockingTags ?? []).map(
    (tag): CompletionCheck => ({ severity: 'caution', text: `Tag ${tag} is set: remove it once it no longer applies` })
  );
  const fields = (item.missingFields ?? []).map(
    (field): CompletionCheck => ({ severity: 'caution', text: `${field} is empty` })
  );
  const conventions = (item.conventions ?? []).map((text): CompletionCheck => ({ severity: 'caution', text }));
  return [...alerts, ...predecessors, ...tags, ...fields, ...conventions];
}
