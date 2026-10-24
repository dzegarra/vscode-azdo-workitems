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
export const EFFORT_FIELD = 'Microsoft.VSTS.Scheduling.Effort';
/** Prefixes listed in the text of the title convention */
const SHOWN_PREFIXES = 3;

export interface CompletionIssues {
  /** Tags of the work item that are in the blocking list, as written on the work item */
  blockingTags: string[];
  /** Display names of the empty fields ("Acceptance criteria", "Effort"…) */
  missingFields: string[];
  /** Team conventions of Backlog Items it does not follow (title prefix, story points), as texts */
  conventions: string[];
}

/** Conventions of the Backlog Items (DEVELOPMENT_APPROACH §7.1); an empty list leaves a convention unchecked */
export interface ConventionRules {
  /** Allowed values of Effort (story points) */
  effortScale: number[];
  /** "[Platform]", "[Platform UI]"…: one of them starts the title */
  titlePrefixes: string[];
}

export interface CompletionInput {
  type: string;
  /** Undefined: the title convention is not checked */
  title?: string;
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

// Rules COMPLETE-5, COMPLETE-6
/** The conventions of a Backlog Item it does not follow: story points off the scale, title without a team prefix */
export function conventionIssues(input: CompletionInput, rules: Partial<ConventionRules>): string[] {
  if (input.type !== BACKLOG_ITEM_TYPE) {
    return [];
  }
  const issues: string[] = [];
  const effort = input.fields[EFFORT_FIELD];
  const scale = rules.effortScale ?? [];
  if (scale.length && typeof effort === 'number' && !scale.includes(effort)) {
    issues.push(`Effort ${effort} is not on the scale ${scale.join(', ')}`);
  }
  const prefixes = (rules.titlePrefixes ?? []).map((prefix) => prefix.trim()).filter(Boolean);
  const title = input.title?.trim();
  if (prefixes.length && title !== undefined && !prefixes.some((prefix) => title.startsWith(prefix))) {
    const shown = prefixes.slice(0, SHOWN_PREFIXES).join(', ');
    issues.push(`Title without a team prefix (${shown}${prefixes.length > SHOWN_PREFIXES ? '…' : ''})`);
  }
  return issues;
}

// Rules COMPLETE-1, COMPLETE-2
/** Blocking tags, empty fields and conventions of an open work item; nothing for a closed one */
export function completionIssues(
  input: CompletionInput,
  rules: Pick<AlertRules, 'blockingTags' | 'requiredFields'> & Partial<ConventionRules>
): CompletionIssues {
  if (isClosedState(input.state)) {
    return { blockingTags: [], missingFields: [], conventions: [] };
  }
  return {
    blockingTags: matchBlockingTags(input.tags, rules.blockingTags),
    missingFields: missingFieldsOf(input, rules),
    conventions: conventionIssues(input, rules),
  };
}

/** What the caution counts and lists */
export interface CompletionCounted {
  openPredecessors?: unknown[];
  blockingTags?: string[];
  missingFields?: string[];
  conventions?: string[];
}

// Rule COMPLETE-1
/** Everything in the caution: open predecessors, blocking tags, empty fields and conventions */
export function completionIssueCount(item: CompletionCounted): number {
  return (
    (item.openPredecessors?.length ?? 0) +
    (item.blockingTags?.length ?? 0) +
    (item.missingFields?.length ?? 0) +
    (item.conventions?.length ?? 0)
  );
}

/**
 * Whether something really keeps the item from being completed (predecessors, tags, empty fields), or the caution
 * only holds conventions: its wording must not say "cannot be completed" then
 */
export function blocksCompletion(item: CompletionCounted): boolean {
  return !!(item.openPredecessors?.length || item.blockingTags?.length || item.missingFields?.length);
}

/** One line per kind of issue, for the tooltip of the compact signal */
export function completionIssueLines(item: CompletionCounted): string[] {
  const predecessors = item.openPredecessors?.length ?? 0;
  return [
    predecessors ? `${predecessors} open predecessor${predecessors === 1 ? '' : 's'}` : '',
    item.blockingTags?.length ? `Tagged ${item.blockingTags.join(', ')}` : '',
    item.missingFields?.length ? `Missing ${item.missingFields.join(', ')}` : '',
    ...(item.conventions ?? []),
  ].filter(Boolean);
}

/** Title of the caution: "Cannot be completed yet: …" or, without blockers, "Before completion: …" */
export function completionTitle(item: CompletionCounted): string {
  return `${blocksCompletion(item) ? 'Cannot be completed yet' : 'Before completion'}: ${completionIssueLines(
    item
  ).join(' · ')}`;
}
