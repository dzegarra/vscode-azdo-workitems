/** Problems in the work items that the team agreed to avoid. Pure, so no "vscode" import */
import { normalizeState, stateCategory } from './states';

export type AlertRule =
  | 'blockingTag'
  | 'missingField'
  | 'noPullRequestTask'
  | 'pullRequestTaskNotDone'
  | 'pullRequestTaskNotInProgress'
  | 'taskBranchNotLinked'
  | 'taskPullRequestNotLinked'
  | 'tasksNotDone';

export interface WorkItemAlert {
  rule: AlertRule;
  message: string;
  /** Work item the alert is about, when it is not the work item itself (e.g. its PR task) */
  relatedId?: number;
  /** PR the alert is about, for the PR task rules and "taskPullRequestNotLinked" */
  pullRequestId?: number;
  /** Reference name of the empty field, for "missingField" alerts */
  field?: string;
  /** Quick fix offered next to the alert */
  action?: 'fillIntegrationBuild' | 'linkTaskBranch' | 'linkTaskPullRequest';
  /** Branch the alert is about, for "taskBranchNotLinked" */
  branch?: string;
}

export interface AlertTask {
  id: number;
  title: string;
  state: string;
  /** PRs the task is linked to */
  pullRequestIds: number[];
  /** Names of the branches of this repository linked to the task */
  branches?: string[];
}

export interface AlertPullRequest {
  id: number;
  status: string;
  isDraft: boolean;
}

export interface AlertInput {
  type: string;
  state: string;
  tags: string[];
  /** Fields by reference name, e.g. "Microsoft.VSTS.Scheduling.Effort" */
  fields: Record<string, unknown>;
  tasks: AlertTask[];
  pullRequests: AlertPullRequest[];
  /** Names of the branches of this repository linked to the work item itself (Development section) */
  branches: string[];
  /** Ids of the PRs linked to the work item itself (raw links, whether or not they could be fetched) */
  linkedPullRequestIds: number[];
  /** Ids of the abandoned PRs among the ones of its tasks */
  abandonedPullRequestIds?: number[];
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

// Rule ALERT-1
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

// Rule ALERT-2
/** The branch of a task (this repository) that the work item does not link: the developer forgot to link it */
function taskBranchAlerts(input: AlertInput): WorkItemAlert[] {
  if (isOneOf(input.state, FINISHED_STATES) || isClosed(input.state)) {
    return [];
  }
  const linked = new Set(input.branches);
  return input.tasks
    .filter((task) => !isClosed(task.state))
    .flatMap((task) =>
      [...new Set(task.branches ?? [])]
        .filter((branch) => !linked.has(branch))
        .map((branch) => ({
          rule: 'taskBranchNotLinked' as const,
          message: `Branch ${branch} of task ${task.id} is not linked to this work item`,
          relatedId: task.id,
          action: 'linkTaskBranch' as const,
          branch,
        }))
    );
}

// Rule ALERT-8
/** The PR of a task (any repository) that the work item does not link: the developer forgot to link it */
function taskPullRequestAlerts(input: AlertInput): WorkItemAlert[] {
  if (isOneOf(input.state, FINISHED_STATES) || isClosed(input.state)) {
    return [];
  }
  const skipped = new Set([...input.linkedPullRequestIds, ...(input.abandonedPullRequestIds ?? [])]);
  // First task of each PR, so a PR shared by two tasks is reported once
  const taskOf = new Map<number, number>();
  for (const task of input.tasks.filter((candidate) => !isClosed(candidate.state))) {
    task.pullRequestIds.filter((id) => !skipped.has(id) && !taskOf.has(id)).forEach((id) => taskOf.set(id, task.id));
  }
  return [...taskOf].map(([id, taskId]) => ({
    rule: 'taskPullRequestNotLinked' as const,
    message: `PR ${id} of task ${taskId} is not linked to this work item`,
    relatedId: taskId,
    pullRequestId: id,
    action: 'linkTaskPullRequest' as const,
  }));
}

interface PullRequestWithTasks {
  pullRequest: AlertPullRequest;
  tasks: AlertTask[];
}

// Rules ALERT-PRTASK-1, ALERT-PRTASK-2
/**
 * The PR task of each PR: the child tasks linked to it (any title). PRs without a linked task get, once, an unlinked
 * task whose title says it is the PR task (work items from before the tasks were linked). Active PRs go first
 */
function tasksOfPullRequests(input: AlertInput, rules: AlertRules): PullRequestWithTasks[] {
  const pullRequests = input.pullRequests
    .filter((pr) => pr.status !== 'abandoned')
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active'));
  const entries = pullRequests.map((pullRequest) => ({
    pullRequest,
    tasks: input.tasks.filter((task) => task.pullRequestIds.includes(pullRequest.id)),
  }));
  const legacy = input.tasks.filter(
    (task) => !task.pullRequestIds.length && rules.pullRequestTaskPattern.test(task.title)
  );
  const bare = entries.find((entry) => !entry.tasks.length);
  if (bare && legacy.length) {
    bare.tasks = legacy;
  }
  return entries;
}

// Rules ALERT-3, ALERT-4, ALERT-5
function pullRequestAlert({ pullRequest, tasks }: PullRequestWithTasks): WorkItemAlert | undefined {
  const label = `PR ${pullRequest.id}`;
  if (pullRequest.status === 'active' && !pullRequest.isDraft) {
    if (!tasks.length) {
      return { rule: 'noPullRequestTask', message: `${label} has no PR task`, pullRequestId: pullRequest.id };
    }
    const [task] = tasks;
    return tasks.some((candidate) => isOneOf(candidate.state, ['In Progress']))
      ? undefined
      : {
          rule: 'pullRequestTaskNotInProgress',
          message: `${label} is published but its task ${task.id} is ${task.state} (should be In Progress)`,
          relatedId: task.id,
          pullRequestId: pullRequest.id,
        };
  }
  if (pullRequest.status === 'completed' && tasks.length && !tasks.some((task) => isClosed(task.state))) {
    const [task] = tasks;
    return {
      rule: 'pullRequestTaskNotDone',
      message: `${label} is completed but its task ${task.id} is ${task.state} (should be Done)`,
      relatedId: task.id,
      pullRequestId: pullRequest.id,
    };
  }
  return undefined;
}

function pullRequestAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  return tasksOfPullRequests(input, rules)
    .map(pullRequestAlert)
    .filter((alert): alert is WorkItemAlert => !!alert);
}

// Rule ALERT-6
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

// Rule ALERT-7
function fieldAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  return rules.requiredFields
    .filter((rule) => rule.types.includes(input.type) && (!rule.states?.length || isOneOf(input.state, rule.states)))
    .flatMap((rule) => rule.fields)
    .filter((field) => field.referenceName && isEmpty(input.fields[field.referenceName]))
    .map((field) => ({
      rule: 'missingField' as const,
      message: `"${field.name}" is empty`,
      field: field.referenceName,
    }));
}

// Rule ALERT-GATE-2
export function findAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  if (!rules.workItemTypes.includes(input.type)) {
    return [];
  }
  return [
    ...taskAlerts(input),
    ...taskBranchAlerts(input),
    ...taskPullRequestAlerts(input),
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
/**
 * Labels shown in the work item forms that differ from the field names returned by the API.
 * E.g. the form shows "Integrated in Build" for the field the API calls "Integration Build"
 */
const FORM_LABELS: Partial<Record<string, string>> = {
  'integrated in build': 'Microsoft.VSTS.Build.IntegrationBuild',
};

/** Reference name of a field given its name, its form label ("Integrated in Build") or its reference name */
export function resolveFieldName(name: string, fields: { name: string; referenceName: string }[]): string | undefined {
  const lower = name.trim().toLowerCase();
  const byLabel = FORM_LABELS[lower]?.toLowerCase();
  return fields.find((field) =>
    [field.name.toLowerCase(), field.referenceName.toLowerCase()].some((candidate) =>
      [lower, byLabel].includes(candidate)
    )
  )?.referenceName;
}

/** Resolves the names of the required fields ("Effort in days") to their reference names */
export function resolveRequiredFields(
  rules: { types: string[]; states?: string[]; fields: string[] }[],
  fields: { name: string; referenceName: string }[]
): RequiredFieldsRule[] {
  return rules.map((rule) => ({
    ...rule,
    fields: rule.fields.map((name) => ({ name, referenceName: resolveFieldName(name, fields) })),
  }));
}
