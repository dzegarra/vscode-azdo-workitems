/**
 * What keeps an open work item from being completed, besides its open predecessors (src/predecessors.ts): blocking
 * tags and, for Backlog Items, an empty Acceptance criteria or empty required fields. A caution, never a block.
 * Pure, so no "vscode" import
 */
import { emptyRequiredFields, matchBlockingTags, type AlertRules } from './alerts';
import { isClosedState } from './states';

export const BACKLOG_ITEM_TYPE = 'Product Backlog Item';
export const ACCEPTANCE_CRITERIA_FIELD = 'Microsoft.VSTS.Common.AcceptanceCriteria';
export const ACCEPTANCE_CRITERIA_NAME = 'Acceptance criteria';

export interface CompletionIssues {
  /** Tags of the work item that are in the blocking list, as written on the work item */
  blockingTags: string[];
  /** Display names of the empty fields ("Acceptance criteria", "Effort"…) */
  missingFields: string[];
}

export interface CompletionInput {
  type: string;
  state: string;
  tags: string[];
  /** Fields by reference name */
  fields: Record<string, unknown>;
}

// Rule COMPLETE-3
/** Rich text without content: empty after removing the tags, the `&nbsp;` entities and the whitespace (trim also drops U+00A0) */
export function isEmptyRichText(value: unknown): boolean {
  if (typeof value !== 'string') {
    return value === undefined || value === null;
  }
  return !value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/gi, '')
    .trim();
}

// Rules COMPLETE-3, COMPLETE-4
/** Acceptance criteria and required fields of a Backlog Item that are empty, each name once */
function missingFieldsOf(input: CompletionInput, rules: Pick<AlertRules, 'requiredFields'>): string[] {
  if (input.type !== BACKLOG_ITEM_TYPE) {
    return [];
  }
  const names = emptyRequiredFields(rules.requiredFields, input).map((field) => field.name);
  const missing = isEmptyRichText(input.fields[ACCEPTANCE_CRITERIA_FIELD]) ? [ACCEPTANCE_CRITERIA_NAME] : [];
  return [...new Set([...missing, ...names])];
}

// Rules COMPLETE-1, COMPLETE-2
/** Blocking tags and empty fields of an open work item; nothing for a closed one */
export function completionIssues(
  input: CompletionInput,
  rules: Pick<AlertRules, 'blockingTags' | 'requiredFields'>
): CompletionIssues {
  if (isClosedState(input.state)) {
    return { blockingTags: [], missingFields: [] };
  }
  return {
    blockingTags: matchBlockingTags(input.tags, rules.blockingTags),
    missingFields: missingFieldsOf(input, rules),
  };
}

// Rule COMPLETE-1
/** Everything that keeps the work item from being completed: open predecessors, blocking tags, empty fields */
export function completionIssueCount(item: {
  openPredecessors?: unknown[];
  blockingTags?: string[];
  missingFields?: string[];
}): number {
  return (item.openPredecessors?.length ?? 0) + (item.blockingTags?.length ?? 0) + (item.missingFields?.length ?? 0);
}

/** One line per kind of issue, for the tooltip of the compact signal */
export function completionIssueLines(item: {
  openPredecessors?: unknown[];
  blockingTags?: string[];
  missingFields?: string[];
}): string[] {
  const predecessors = item.openPredecessors?.length ?? 0;
  return [
    predecessors ? `${predecessors} open predecessor${predecessors === 1 ? '' : 's'}` : '',
    item.blockingTags?.length ? `Tagged ${item.blockingTags.join(', ')}` : '',
    item.missingFields?.length ? `Missing ${item.missingFields.join(', ')}` : '',
  ].filter(Boolean);
}
