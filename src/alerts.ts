/** Problems in the work items that the team agreed to avoid. Pure, so no "vscode" import */
import { normalizeState, stateCategory } from './states';
import { teamsMissingIteration, type TeamPlan } from './teamPlans';

export type AlertRule =
  | 'duplicateNotPlannedTogether'
  | 'duplicateStateNotInSync'
  | 'iterationNotInSprintPlan'
  | 'missingField'
  | 'noPullRequestTask'
  | 'noTasks'
  | 'stretchTags'
  | 'pullRequestTaskNotDone'
  | 'pullRequestTaskNotInProgress'
  | 'staleIntegrationBuild'
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
  /** Reference name of the field, for "missingField" (empty) and "staleIntegrationBuild" (filled) alerts */
  field?: string;
  /** Quick fix offered next to the alert */
  action?: 'clearIntegrationBuild' | 'fillIntegrationBuild' | 'linkTaskBranch' | 'linkTaskPullRequest';
  /** Branch the alert is about, for "taskBranchNotLinked" */
  branch?: string;
  /** The original or the duplicate the alert is about, for the duplicate rules (offers to open it) */
  duplicateId?: number;
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

/** Iteration of a work item: its path, and the name to show (undefined: not planned) */
export interface AlertIteration {
  path: string;
  name?: string;
}

/** An original of the work item, or a work item duplicating it */
export interface AlertDuplicate {
  id: number;
  state: string;
  iteration: AlertIteration;
  /** "original": the work item is a duplicate of this one; "duplicate": this one duplicates the work item */
  role: 'duplicate' | 'original';
}

export interface AlertPullRequest {
  id: number;
  status: string;
  isDraft: boolean;
}

export interface AlertInput {
  type: string;
  /** Undefined: the rules about the title are not checked */
  title?: string;
  state: string;
  tags: string[];
  /** Fields by reference name, e.g. "Microsoft.VSTS.Scheduling.Effort" */
  fields: Record<string, unknown>;
  tasks: AlertTask[];
  /** False when some child work items could not be loaded: the rules about having tasks say nothing */
  tasksKnown?: boolean;
  pullRequests: AlertPullRequest[];
  /** Names of the branches of this repository linked to the work item itself (Development section) */
  branches: string[];
  /** Ids of the PRs linked to the work item itself (raw links, whether or not they could be fetched) */
  linkedPullRequestIds: number[];
  /** Ids of the abandoned PRs among the ones of its tasks */
  abandonedPullRequestIds?: number[];
  iteration?: AlertIteration;
  /** Its originals and its duplicates that could be loaded (the unknown ones say nothing) */
  duplicates?: AlertDuplicate[];
  /** Areas and sprints of the project's teams. Undefined: unknown, the sprint plan rule says nothing */
  teamPlans?: TeamPlan[];
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
  /** The "Integrated in Build" field and when it must be set. Undefined: the field does not exist (not checked) */
  integrationBuild?: IntegrationBuildRule;
  /** Stretched items (DEVELOPMENT_APPROACH §13.3-13.4). Undefined or no tags: not checked */
  stretch?: StretchRule;
}

export interface StretchRule {
  /** "[Stretched]": the title of the new item of a stretch starts with it. Empty: the title is not checked */
  titlePrefix: string;
  /** The stretch-* tags; a stretched item has exactly one */
  tags: string[];
}

export interface IntegrationBuildRule {
  /** As named in the settings ("Integrated in Build") */
  name: string;
  referenceName: string;
  workItemTypes: string[];
  /** States in which it must be set (Ready to Test) */
  states: string[];
}

/** States in which the work item is considered finished by its developers */
const FINISHED_STATES = ['Done', 'Ready to Test'];

function isOneOf(state: string, states: string[]): boolean {
  return states.some((candidate) => normalizeState(candidate) === normalizeState(state));
}

function isClosed(state: string): boolean {
  return ['done', 'removed'].includes(stateCategory(state));
}

/** A field without value (undefined, null or blank text). Shared with src/completionIssues.ts */
export function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && !value.trim());
}

/** The tags that are in the blocking list (trimmed, case-insensitive), as the work item writes them */
export function matchBlockingTags(tags: string[], blockingTags: string[]): string[] {
  const normalize = (tag: string) => tag.trim().toLowerCase();
  const blocking = new Set(blockingTags.map(normalize));
  return tags.filter((tag) => blocking.has(normalize(tag)));
}

/** The required fields (with a known reference name) that apply to the type and state */
export function requiredFieldsFor(
  requiredFields: RequiredFieldsRule[],
  type: string,
  state: string
): { name: string; referenceName: string }[] {
  return requiredFields
    .filter((rule) => rule.types.includes(type) && (!rule.states?.length || isOneOf(state, rule.states)))
    .flatMap((rule) => rule.fields)
    .flatMap((field) => (field.referenceName ? [{ name: field.name, referenceName: field.referenceName }] : []));
}

/** The required fields of the type and state that have no value */
export function emptyRequiredFields(
  requiredFields: RequiredFieldsRule[],
  input: { type: string; state: string; fields: Record<string, unknown> }
): { name: string; referenceName: string }[] {
  return requiredFieldsFor(requiredFields, input.type, input.state).filter((field) =>
    isEmpty(input.fields[field.referenceName])
  );
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

// Rule ALERT-7
function fieldAlerts(input: AlertInput, rules: AlertRules): WorkItemAlert[] {
  return emptyRequiredFields(rules.requiredFields, input).map((field) => ({
    rule: 'missingField' as const,
    message: `"${field.name}" is empty`,
    field: field.referenceName,
  }));
}

// Rule ALERT-12
/**
 * Work started but no task: the team creates the tasks when the work on a backlog item starts (DEVELOPMENT_APPROACH
 * §9.5, §10). Removed tasks do not count
 */
function noTaskAlerts(input: AlertInput): WorkItemAlert[] {
  const tasks = input.tasks.filter((task) => stateCategory(task.state) !== 'removed');
  if (input.tasksKnown === false || stateCategory(input.state) !== 'in-progress' || tasks.length) {
    return [];
  }
  return [
    { rule: 'noTasks', message: `Is ${input.state} but has no tasks (team rule: create them when the work starts)` },
  ];
}

// Rule ALERT-14
/**
 * The iteration is not in the sprint plan of any team owning the area: the item never shows on a sprint board.
 * Unknown data says nothing (see teamsMissingIteration)
 */
function sprintPlanAlerts(input: AlertInput): WorkItemAlert[] {
  const area = input.fields['System.AreaPath'];
  const areaPath = typeof area === 'string' ? area : undefined;
  const teams = teamsMissingIteration(input.teamPlans, areaPath, input.iteration?.path);
  if (!teams.length || !input.iteration || !areaPath) {
    return [];
  }
  const sprint = input.iteration.name ?? input.iteration.path.split('\\').pop() ?? input.iteration.path;
  return [
    {
      rule: 'iterationNotInSprintPlan',
      message: `Iteration ${sprint} is not in the sprint plan of ${teams.join(
        ', '
      )}: the item will not show on their sprint board (area ${areaPath}). Change the iteration or the area.`,
    },
  ];
}

const lower = (text: string) => text.trim().toLowerCase();

// Rule ALERT-13
/**
 * A stretched item has exactly one stretch tag, the primary reason (DEVELOPMENT_APPROACH §13.4). With a title
 * prefix set, the prefix and the tag go together: one without the other means something was forgotten. The prefix is
 * optional (empty by default): the team was not told about it and suffixes "Stretched" instead (asked to the architect)
 */
function stretchMessage(input: AlertInput, rule: StretchRule, tags: string[]): string | undefined {
  if (tags.length > 1) {
    return `Has ${tags.length} stretch tags (${tags.join(', ')}): keep only the primary reason`;
  }
  const prefix = rule.titlePrefix.trim();
  if (!prefix || input.title === undefined) {
    return undefined;
  }
  const prefixed = lower(input.title).startsWith(lower(prefix));
  if (prefixed && !tags.length) {
    return `Is ${prefix} but has no stretch tag (one of ${rule.tags.join(', ')})`;
  }
  return !prefixed && tags.length
    ? `Has the stretch tag ${tags.join('')} but the title does not start with "${prefix}"`
    : undefined;
}

function stretchAlerts(input: AlertInput, rule: StretchRule | undefined): WorkItemAlert[] {
  if (!rule?.tags.length) {
    return [];
  }
  const known = new Set(rule.tags.map(lower));
  const message = stretchMessage(
    input,
    rule,
    input.tags.filter((tag) => known.has(lower(tag)))
  );
  return message ? [{ rule: 'stretchTags', message }] : [];
}

// Rule ALERT-11
/**
 * "Integrated in Build" is set but the Bug is no longer Ready to Test nor closed: it was reopened (the fix did not
 * work), so the value names a build without the fix. A new one is set when it is Ready to Test again
 */
function staleIntegrationBuildAlerts(input: AlertInput, rule: IntegrationBuildRule | undefined): WorkItemAlert[] {
  if (
    !rule?.workItemTypes.includes(input.type) ||
    isOneOf(input.state, rule.states) ||
    isClosed(input.state) ||
    isEmpty(input.fields[rule.referenceName])
  ) {
    return [];
  }
  const value = input.fields[rule.referenceName];
  return [
    {
      rule: 'staleIntegrationBuild',
      message: `Is ${input.state} but "${rule.name}" is still ${
        typeof value === 'string' ? value.trim() : JSON.stringify(value)
      } (reopened? a new build is set when it is ${rule.states.join(' / ')} again)`,
      field: rule.referenceName,
      action: 'clearIntegrationBuild',
    },
  ];
}

function whereIs(iteration: AlertIteration): string {
  return iteration.name ? `in ${iteration.name}` : 'not planned';
}

// Rules ALERT-9, ALERT-10
/**
 * A duplicate and its original are planned in the same iteration and are in the same state (compared like STATE-1,
 * the real state, not the "In review" shown one). Each side of the pair gets the alert
 */
function duplicateAlerts(input: AlertInput): WorkItemAlert[] {
  const { iteration } = input;
  return (input.duplicates ?? []).flatMap((other) => {
    const label = `its ${other.role} #${other.id}`;
    const alerts: WorkItemAlert[] = [];
    if (iteration && other.iteration.path !== iteration.path) {
      alerts.push({
        rule: 'duplicateNotPlannedTogether',
        message: `Not planned with ${label}: it is ${whereIs(other.iteration)}, this one ${whereIs(iteration)}`,
        duplicateId: other.id,
      });
    }
    if (normalizeState(other.state) !== normalizeState(input.state)) {
      alerts.push({
        rule: 'duplicateStateNotInSync',
        message: `Is ${input.state} but ${label} is ${other.state} (should be the same state)`,
        duplicateId: other.id,
      });
    }
    return alerts;
  });
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
    ...fieldAlerts(input, rules),
    ...staleIntegrationBuildAlerts(input, rules.integrationBuild),
    ...duplicateAlerts(input),
    ...noTaskAlerts(input),
    ...sprintPlanAlerts(input),
    ...stretchAlerts(input, rules.stretch),
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
