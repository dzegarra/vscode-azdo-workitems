/** Problems in the work items that the team agreed to avoid. Pure, so no "vscode" import */
import { normalizeState, stateCategory } from './states';

export type AlertRule =
  | 'blockingTag'
  | 'missingField'
  | 'noPullRequestTask'
  | 'pullRequestTaskNotDone'
  | 'pullRequestTaskNotInProgress'
  | 'tasksNotDone';

export interface WorkItemAlert {
  rule: AlertRule;
  message: string;
  /** Work item the alert is about, when it is not the work item itself (e.g. its PR task) */
  relatedId?: number;
}

export interface AlertTask {
  id: number;
  title: string;
  state: string;
}

export interface AlertInput {
  type: string;
  state: string;
  tags: string[];
  /** Fields by reference name, e.g. "Microsoft.VSTS.Scheduling.Effort" */
  fields: Record<string, unknown>;
  tasks: AlertTask[];
  pullRequests: { status: string; isDraft: boolean }[];
}

export interface RequiredFieldsRule {
  types: string[];
  /** Only in these states. Empty or missing: always */
  states?: string[];
  fields: { name: string; referenceName?: string }[];
}

export interface AlertRules {
  /** Work item types checked (Backlog Items and Bugs) */
  workItemTypes: string[];
  /** Tags meaning the work item cannot be completed yet */
  blockingTags: string[];
  /** Recognizes the PR task by its title */
  pullRequestTaskPattern: RegExp;
  requiredFields: RequiredFieldsRule[];
}

/** States in which the work item is considered finished by its developers */
const FINISHED_STATES = ['Done', 'Ready to Test'];

function isOneOf(state: string, states: string[]): boolean {
  return states.some((candidate) => normalizeState(candidate) === normalizeState(state));
}

function isClosed(state: string): boolean {
  return ['done', 'removed'].includes(stateCategory(state));
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

function describeTasks(tasks: AlertTask[]): string {
  return tasks.map((task) => `${task.id} ${task.title} (${task.state})`).join(', ');
}

function taskAlerts(input: AlertInput): WorkItemAlert[] {
  const openTasks = input.tasks.filter((task) => !isClosed(task.state));
  if (isOneOf(input.state, FINISHED_STATES) && openTasks.length) {
    return [
      {
        rule: 'tasksNotDone',
        message: `Is ${input.state} but ${
          openTasks.length === 1 ? '1 task is' : `${openTasks.length} tasks are`
        } not done: ${describeTasks(openTasks)}`,
        relatedId: openTasks.length === 1 ? openTasks[0].id : undefined,
      },
    ];
  }
  return [];
}

function pullRequestAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  const pullRequests = input.pullRequests.filter((pr) => pr.status !== 'abandoned');
  if (!pullRequests.length) {
    return [];
  }
  const prTasks = input.tasks.filter((task) => rules.pullRequestTaskPattern.test(task.title));
  if (!prTasks.length) {
    return [{ rule: 'noPullRequestTask', message: 'Has a pull request but no PR task' }];
  }
  const published = pullRequests.some((pr) => pr.status === 'active' && !pr.isDraft);
  const completed =
    !pullRequests.some((pr) => pr.status === 'active') && pullRequests.some((pr) => pr.status === 'completed');
  if (published && !prTasks.some((task) => isOneOf(task.state, ['In Progress']))) {
    const [task] = prTasks;
    return [
      {
        rule: 'pullRequestTaskNotInProgress',
        message: `The PR is published but the PR task ${task.id} is ${task.state} (should be In Progress)`,
        relatedId: task.id,
      },
    ];
  }
  if (completed && !prTasks.some((task) => isClosed(task.state))) {
    const [task] = prTasks;
    return [
      {
        rule: 'pullRequestTaskNotDone',
        message: `The PR is completed but the PR task ${task.id} is ${task.state} (should be Done)`,
        relatedId: task.id,
      },
    ];
  }
  return [];
}

function tagAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  if (stateCategory(input.state) === 'proposed') {
    return [];
  }
  const normalize = (tag: string) => tag.trim().toLowerCase();
  const blocking = new Set(rules.blockingTags.map(normalize));
  const found = input.tags.filter((tag) => blocking.has(normalize(tag)));
  return found.length
    ? [
        {
          rule: 'blockingTag',
          message: `Started while tagged ${found.map((tag) => `"${tag}"`).join(', ')}`,
        },
      ]
    : [];
}

function fieldAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  return rules.requiredFields
    .filter((rule) => rule.types.includes(input.type) && (!rule.states?.length || isOneOf(input.state, rule.states)))
    .flatMap((rule) => rule.fields)
    .filter((field) => field.referenceName && isEmpty(input.fields[field.referenceName]))
    .map((field) => ({ rule: 'missingField' as const, message: `"${field.name}" is empty` }));
}

export function findAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  if (!rules.workItemTypes.includes(input.type)) {
    return [];
  }
  return [
    ...taskAlerts(input),
    ...pullRequestAlerts(input, rules),
    ...tagAlerts(input, rules),
    ...fieldAlerts(input, rules),
  ];
}

/** "Needs refinement; Blocked" → ["Needs refinement", "Blocked"] */
export function parseTags(tags: unknown): string[] {
  return typeof tags === 'string'
    ? tags
        .split(';')
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];
}

/** Resolves the display names of the required fields ("Effort in days") to their reference names */
export function resolveRequiredFields(
  rules: { types: string[]; states?: string[]; fields: string[] }[],
  fields: { name: string; referenceName: string }[]
): RequiredFieldsRule[] {
  const byName = new Map<string, string>();
  for (const field of fields) {
    byName.set(field.name.toLowerCase(), field.referenceName);
    byName.set(field.referenceName.toLowerCase(), field.referenceName);
  }
  return rules.map((rule) => ({
    ...rule,
    fields: rule.fields.map((name) => ({ name, referenceName: byName.get(name.toLowerCase()) })),
  }));
}
