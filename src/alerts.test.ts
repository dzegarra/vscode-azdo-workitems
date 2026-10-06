import { describe, expect, it } from 'vitest';
import { AlertInput, AlertRules, findAlerts, parseTags, resolveRequiredFields } from './alerts';

const EFFORT = 'Microsoft.VSTS.Scheduling.Effort';
const EFFORT_DAYS = 'Custom.EffortInDays';
const INTEGRATION_BUILD = 'Microsoft.VSTS.Build.IntegrationBuild';

const rules: AlertRules = {
  workItemTypes: ['Product Backlog Item', 'Bug'],
  blockingTags: [
    'Needs refinement',
    'Requirements',
    'UX feedback required',
    'Missing REST API',
    'Blocked',
    'PT Feedback Required',
  ],
  pullRequestTaskPattern: /\b(PR|pull request)\b/i,
  requiredFields: resolveRequiredFields(
    [
      { types: ['Product Backlog Item'], fields: ['Effort', 'Effort in days'] },
      { types: ['Bug'], states: ['Ready to Test'], fields: ['Integrated in Build'] },
    ],
    [
      { name: 'Effort', referenceName: EFFORT },
      { name: 'Effort in days', referenceName: EFFORT_DAYS },
      { name: 'Integrated in Build', referenceName: INTEGRATION_BUILD },
    ]
  ),
};

const pbi = (overrides: Partial<AlertInput> = {}): AlertInput => ({
  type: 'Product Backlog Item',
  state: 'Committed',
  tags: [],
  fields: { [EFFORT]: 5, [EFFORT_DAYS]: 2 },
  tasks: [],
  pullRequests: [],
  ...overrides,
});
const task = (id: number, title: string, state: string) => ({ id, title, state });
const rulesOf = (input: AlertInput) => findAlerts(input, rules).map((alert) => alert.rule);

describe('findAlerts', () => {
  it('finds nothing in a correct work item', () => {
    expect(findAlerts(pbi(), rules)).toEqual([]);
  });

  it('only checks Backlog Items and Bugs', () => {
    expect(findAlerts(pbi({ type: 'Task', state: 'Done', tags: ['Blocked'] }), rules)).toEqual([]);
  });

  it('detects finished work items with open tasks', () => {
    const tasks = [task(1, 'Widget', 'Done'), task(2, 'Tests', 'In Progress'), task(3, 'Old', 'Removed')];
    const [alert] = findAlerts(pbi({ state: 'Ready to Test', tasks }), rules);
    expect(alert).toEqual({
      rule: 'tasksNotDone',
      message: 'Is Ready to Test but 1 task is not done: 2 Tests (In Progress)',
      relatedId: 2,
    });
    expect(rulesOf(pbi({ state: 'Done', tasks }))).toEqual(['tasksNotDone']);
    expect(rulesOf(pbi({ state: 'Committed', tasks }))).toEqual([]);
  });

  it('requires a PR task when there is a pull request', () => {
    const pullRequests = [{ status: 'active', isDraft: true }];
    expect(rulesOf(pbi({ pullRequests }))).toEqual(['noPullRequestTask']);
    expect(rulesOf(pbi({ pullRequests: [{ status: 'abandoned', isDraft: false }] }))).toEqual([]);
    expect(rulesOf(pbi({ pullRequests, tasks: [task(9, 'PR', 'To Do')] }))).toEqual([]);
  });

  it('expects the PR task in progress while the PR is published', () => {
    const pullRequests = [{ status: 'active', isDraft: false }];
    const [alert] = findAlerts(pbi({ pullRequests, tasks: [task(9, 'Create PR', 'To Do')] }), rules);
    expect(alert).toMatchObject({ rule: 'pullRequestTaskNotInProgress', relatedId: 9 });
    expect(alert.message).toBe('The PR is published but the PR task 9 is To Do (should be In Progress)');
    expect(rulesOf(pbi({ pullRequests, tasks: [task(9, 'Pull Request', 'In Progress')] }))).toEqual([]);
  });

  it('expects the PR task done once the PR is completed', () => {
    const pullRequests = [{ status: 'completed', isDraft: false }];
    expect(rulesOf(pbi({ pullRequests, tasks: [task(9, 'PR', 'In Progress')] }))).toEqual(['pullRequestTaskNotDone']);
    expect(rulesOf(pbi({ pullRequests, tasks: [task(9, 'PR', 'Done')] }))).toEqual([]);
  });

  it('does not mistake other tasks for the PR task', () => {
    const pullRequests = [{ status: 'active', isDraft: false }];
    expect(rulesOf(pbi({ pullRequests, tasks: [task(9, 'Improve prompts', 'In Progress')] }))).toEqual([
      'noPullRequestTask',
    ]);
  });

  it('detects started work items with blocking tags', () => {
    const tags = ['UX', 'missing rest api', 'Blocked'];
    const [alert] = findAlerts(pbi({ state: 'In Progress', tags }), rules);
    expect(alert.message).toBe('Started while tagged "missing rest api", "Blocked"');
    expect(rulesOf(pbi({ state: 'New', tags }))).toEqual([]);
    expect(rulesOf(pbi({ state: 'Approved', tags }))).toEqual([]);
  });

  it('requires Effort and Effort in days in Backlog Items', () => {
    expect(findAlerts(pbi({ fields: { [EFFORT]: 3, [EFFORT_DAYS]: '' } }), rules)).toEqual([
      { rule: 'missingField', message: '"Effort in days" is empty' },
    ]);
    expect(rulesOf(pbi({ fields: {} }))).toEqual(['missingField', 'missingField']);
  });

  it('requires Integrated in Build in Bugs ready to test', () => {
    const bug = pbi({ type: 'Bug', fields: {} });
    expect(rulesOf({ ...bug, state: 'Committed' })).toEqual([]);
    expect(rulesOf({ ...bug, state: 'Ready-to-Test' })).toEqual(['missingField']);
    expect(rulesOf({ ...bug, state: 'Ready to Test', fields: { [INTEGRATION_BUILD]: '2026.10.1' } })).toEqual([]);
  });

  it('ignores required fields that do not exist in the project', () => {
    const [rule] = resolveRequiredFields([{ types: ['Product Backlog Item'], fields: ['Unknown field'] }], []);
    expect(findAlerts(pbi(), { ...rules, requiredFields: [rule] })).toEqual([]);
  });
});

describe('parseTags', () => {
  it('splits the tags field', () => {
    expect(parseTags('Needs refinement; UX ;')).toEqual(['Needs refinement', 'UX']);
    expect(parseTags(undefined)).toEqual([]);
  });
});
