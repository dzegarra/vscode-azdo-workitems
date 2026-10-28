import { describe, expect, it } from 'vitest';
import {
  AlertInput,
  AlertIteration,
  AlertRules,
  findAlerts,
  parseTags,
  resolveFieldName,
  resolveRequiredFields,
} from './alerts';

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
      { name: 'Integration Build', referenceName: INTEGRATION_BUILD },
    ]
  ),
  integrationBuild: {
    name: 'Integrated in Build',
    referenceName: INTEGRATION_BUILD,
    workItemTypes: ['Bug'],
    states: ['Ready to Test'],
  },
};

/** By default the work item links the PRs it lists (the ones of its tasks only when told so) */
const pbi = (overrides: Partial<AlertInput> = {}): AlertInput => ({
  type: 'Product Backlog Item',
  state: 'Committed',
  tags: [],
  fields: { [EFFORT]: 5, [EFFORT_DAYS]: 2 },
  // A closed task: started work items without tasks have their own alert (ALERT-12)
  tasks: [{ id: 900, title: 'Analysis', state: 'Done', pullRequestIds: [] }],
  pullRequests: [],
  branches: [],
  linkedPullRequestIds: (overrides.pullRequests ?? []).map((pr) => pr.id),
  ...overrides,
});
const task = (id: number, title: string, state: string, pullRequestIds: number[] = [], branches: string[] = []) => ({
  id,
  title,
  state,
  pullRequestIds,
  branches,
});
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

  it('requires a PR task for each published PR', () => {
    const published = { id: 5, status: 'active', isDraft: false };
    const [alert] = findAlerts(pbi({ pullRequests: [published] }), rules);
    expect(alert).toMatchObject({
      rule: 'noPullRequestTask',
      message: 'PR 5 has no PR task',
      pullRequestId: 5,
    });
    expect(rulesOf(pbi({ pullRequests: [{ id: 5, status: 'abandoned', isDraft: false }] }))).toEqual([]);
    expect(rulesOf(pbi({ pullRequests: [published], tasks: [task(9, 'PID update', 'In Progress', [5])] }))).toEqual([]);
  });

  it('does not alert about drafts or completed PRs without a task', () => {
    expect(rulesOf(pbi({ pullRequests: [{ id: 5, status: 'active', isDraft: true }] }))).toEqual([]);
    expect(rulesOf(pbi({ pullRequests: [{ id: 5, status: 'completed', isDraft: false }] }))).toEqual([]);
    const draft = { id: 5, status: 'active', isDraft: true };
    expect(rulesOf(pbi({ pullRequests: [draft], tasks: [task(9, 'PR', 'To Do', [5])] }))).toEqual([]);
  });

  it('expects the task of a published PR in progress', () => {
    const pullRequests = [{ id: 5, status: 'active', isDraft: false }];
    const [alert] = findAlerts(pbi({ pullRequests, tasks: [task(9, 'Anything', 'To Do', [5])] }), rules);
    expect(alert).toMatchObject({ rule: 'pullRequestTaskNotInProgress', relatedId: 9, pullRequestId: 5 });
    expect(alert.message).toBe('PR 5 is published but its task 9 is To Do (should be In Progress)');
  });

  it('expects the task of a completed PR done', () => {
    const pullRequests = [{ id: 5, status: 'completed', isDraft: false }];
    const [alert] = findAlerts(pbi({ pullRequests, tasks: [task(9, 'PR', 'In Progress', [5])] }), rules);
    expect(alert).toMatchObject({ rule: 'pullRequestTaskNotDone', relatedId: 9, pullRequestId: 5 });
    expect(alert.message).toBe('PR 5 is completed but its task 9 is In Progress (should be Done)');
    expect(rulesOf(pbi({ pullRequests, tasks: [task(9, 'PR', 'Done', [5])] }))).toEqual([]);
  });

  it('matches each PR with its own task (work item 66068)', () => {
    const pullRequests = [
      { id: 13770, status: 'completed', isDraft: false },
      { id: 13765, status: 'active', isDraft: false },
    ];
    const tasks = [
      task(60985, 'PR for generic solution', 'Done', [13770]),
      task(60984, 'PID update', 'In Progress', [13765]),
    ];
    expect(findAlerts(pbi({ pullRequests, tasks }), rules)).toEqual([]);
  });

  it('reports the PR that lacks a task when there are several', () => {
    const pullRequests = [
      { id: 1, status: 'active', isDraft: false },
      { id: 2, status: 'active', isDraft: false },
    ];
    const alerts = findAlerts(pbi({ pullRequests, tasks: [task(9, 'Widget', 'In Progress', [1])] }), rules);
    expect(alerts.map((alert) => [alert.rule, alert.pullRequestId])).toEqual([['noPullRequestTask', 2]]);
  });

  it('falls back to an unlinked task titled as the PR task, once', () => {
    const published = (id: number) => ({ id, status: 'active', isDraft: false });
    const tasks = [task(9, 'Create PR', 'To Do', []), task(10, 'Improve prompts', 'In Progress', [])];
    const [alert] = findAlerts(pbi({ pullRequests: [published(1)], tasks }), rules);
    expect(alert).toMatchObject({ rule: 'pullRequestTaskNotInProgress', relatedId: 9 });
    const alerts = findAlerts(pbi({ pullRequests: [published(1), published(2)], tasks }), rules);
    expect(alerts.map((a) => [a.rule, a.pullRequestId])).toEqual([
      ['pullRequestTaskNotInProgress', 1],
      ['noPullRequestTask', 2],
    ]);
  });

  it('does not mistake other tasks for the PR task', () => {
    const pullRequests = [{ id: 5, status: 'active', isDraft: false }];
    expect(rulesOf(pbi({ pullRequests, tasks: [task(9, 'Improve prompts', 'In Progress', [])] }))).toEqual([
      'noPullRequestTask',
    ]);
  });

  it('leaves blocking tags to the completion caution, started or not', () => {
    const tags = ['UX', 'missing rest api', 'Blocked'];
    for (const state of ['New', 'Approved', 'In Progress', 'Done']) {
      expect(rulesOf(pbi({ state, tags }))).toEqual([]);
    }
  });

  it('requires Effort and Effort in days in Backlog Items', () => {
    expect(findAlerts(pbi({ fields: { [EFFORT]: 3, [EFFORT_DAYS]: '' } }), rules)).toEqual([
      { rule: 'missingField', message: '"Effort in days" is empty', field: EFFORT_DAYS },
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

describe('resolveFieldName', () => {
  // As returned by the API of the project: the form shows this field as "Integrated in Build"
  const fields = [
    { name: 'Integration Build', referenceName: 'Microsoft.VSTS.Build.IntegrationBuild' },
    { name: 'Effort in days', referenceName: 'Custom.Effortindays' },
  ];

  it('accepts names, form labels and reference names, ignoring case', () => {
    expect(resolveFieldName('Integrated in Build', fields)).toBe('Microsoft.VSTS.Build.IntegrationBuild');
    expect(resolveFieldName('integration build', fields)).toBe('Microsoft.VSTS.Build.IntegrationBuild');
    expect(resolveFieldName('Effort in days', fields)).toBe('Custom.Effortindays');
    expect(resolveFieldName('Microsoft.VSTS.Build.IntegrationBuild', fields)).toBe(
      'Microsoft.VSTS.Build.IntegrationBuild'
    );
    expect(resolveFieldName('Unknown', fields)).toBeUndefined();
  });
});

describe('task branches not linked to the work item', () => {
  const BRANCH = 'feature/common/1-widget';

  it('alerts about the branch of a task that the work item does not link', () => {
    const tasks = [task(1, 'Widget', 'In Progress', [], [BRANCH])];
    expect(findAlerts(pbi({ tasks }), rules)).toEqual([
      {
        rule: 'taskBranchNotLinked',
        message: `Branch ${BRANCH} of task 1 is not linked to this work item`,
        relatedId: 1,
        action: 'linkTaskBranch',
        branch: BRANCH,
      },
    ]);
  });

  it('does not alert when the work item links the branch', () => {
    const tasks = [task(1, 'Widget', 'In Progress', [], [BRANCH])];
    expect(rulesOf(pbi({ tasks, branches: [BRANCH] }))).toEqual([]);
  });

  it('alerts once per branch, even when two tasks share it', () => {
    const tasks = [task(1, 'A', 'To Do', [], [BRANCH, BRANCH]), task(2, 'B', 'To Do', [], ['other'])];
    expect(findAlerts(pbi({ tasks }), rules).map((alert) => alert.branch)).toEqual([BRANCH, 'other']);
  });

  it('ignores Done and Removed tasks', () => {
    const tasks = [task(1, 'A', 'Done', [], [BRANCH]), task(2, 'B', 'Removed', [], ['other'])];
    expect(rulesOf(pbi({ tasks }))).toEqual([]);
  });

  it('ignores finished work items', () => {
    const tasks = [task(1, 'A', 'To Do', [], [BRANCH])];
    expect(rulesOf(pbi({ state: 'Done', tasks }))).not.toContain('taskBranchNotLinked');
    expect(rulesOf(pbi({ state: 'Removed', tasks }))).not.toContain('taskBranchNotLinked');
  });

  it('ignores the types that are not checked', () => {
    const tasks = [task(1, 'A', 'To Do', [], [BRANCH])];
    expect(findAlerts(pbi({ type: 'Feature', tasks }), rules)).toEqual([]);
  });
});

describe('task PRs not linked to the work item', () => {
  it('alerts about the PR of a task that the work item does not link', () => {
    const tasks = [task(1, 'Widget', 'In Progress', [7])];
    expect(findAlerts(pbi({ tasks }), rules).filter((alert) => alert.rule === 'taskPullRequestNotLinked')).toEqual([
      {
        rule: 'taskPullRequestNotLinked',
        message: 'PR 7 of task 1 is not linked to this work item',
        relatedId: 1,
        pullRequestId: 7,
        action: 'linkTaskPullRequest',
      },
    ]);
  });

  it('does not alert when the work item links the PR', () => {
    const tasks = [task(1, 'Widget', 'In Progress', [7])];
    expect(rulesOf(pbi({ tasks, linkedPullRequestIds: [7] }))).not.toContain('taskPullRequestNotLinked');
  });

  it('alerts once per PR, even when two tasks share it', () => {
    const tasks = [task(1, 'A', 'To Do', [7, 7]), task(2, 'B', 'To Do', [7, 8])];
    const alerts = findAlerts(pbi({ tasks }), rules).filter((alert) => alert.rule === 'taskPullRequestNotLinked');
    expect(alerts.map((alert) => [alert.pullRequestId, alert.relatedId])).toEqual([
      [7, 1],
      [8, 2],
    ]);
  });

  it('ignores Done and Removed tasks', () => {
    const tasks = [task(1, 'A', 'Done', [7]), task(2, 'B', 'Removed', [8])];
    expect(rulesOf(pbi({ tasks }))).not.toContain('taskPullRequestNotLinked');
  });

  it('ignores finished work items', () => {
    const tasks = [task(1, 'A', 'To Do', [7])];
    expect(rulesOf(pbi({ state: 'Done', tasks }))).not.toContain('taskPullRequestNotLinked');
    expect(rulesOf(pbi({ state: 'Ready to Test', tasks }))).not.toContain('taskPullRequestNotLinked');
    expect(rulesOf(pbi({ state: 'Removed', tasks }))).not.toContain('taskPullRequestNotLinked');
  });

  it('ignores abandoned PRs', () => {
    const tasks = [task(1, 'A', 'To Do', [7])];
    expect(rulesOf(pbi({ tasks, abandonedPullRequestIds: [7] }))).not.toContain('taskPullRequestNotLinked');
  });

  it('ignores the types that are not checked', () => {
    const tasks = [task(1, 'A', 'To Do', [7])];
    expect(findAlerts(pbi({ type: 'Feature', tasks }), rules)).toEqual([]);
  });
});

describe('duplicates out of sync', () => {
  const S122 = { path: 'Flow\\R3\\Platform Sprint 122', name: 'Platform Sprint 122' };
  const S123 = { path: 'Flow\\R3\\Platform Sprint 123', name: 'Platform Sprint 123' };
  const original = (state: string, iteration: AlertIteration = S122) => ({
    id: 9,
    state,
    iteration,
    role: 'original' as const,
  });

  it('finds nothing when the duplicate and its original are planned together in the same state', () => {
    expect(findAlerts(pbi({ iteration: S122, duplicates: [original('Committed')] }), rules)).toEqual([]);
  });

  it('expects the duplicate in the iteration of its original', () => {
    expect(findAlerts(pbi({ iteration: S122, duplicates: [original('Committed', S123)] }), rules)).toEqual([
      {
        rule: 'duplicateNotPlannedTogether',
        message: 'Not planned with its original #9: it is in Platform Sprint 123, this one in Platform Sprint 122',
        duplicateId: 9,
      },
    ]);
  });

  it('says when one of them is not planned', () => {
    const [alert] = findAlerts(pbi({ iteration: S122, duplicates: [original('Committed', { path: 'Flow' })] }), rules);
    expect(alert.message).toBe('Not planned with its original #9: it is not planned, this one in Platform Sprint 122');
  });

  it('expects the same state, ignoring spelling differences', () => {
    expect(rulesOf(pbi({ iteration: S122, duplicates: [original('commited')] }))).toEqual([]);
    expect(findAlerts(pbi({ iteration: S122, duplicates: [original('Done')] }), rules)).toEqual([
      {
        rule: 'duplicateStateNotInSync',
        message: 'Is Committed but its original #9 is Done (should be the same state)',
        duplicateId: 9,
      },
    ]);
  });

  it('warns the original about each duplicate out of sync', () => {
    const duplicates = [
      { id: 10, state: 'New', iteration: S122, role: 'duplicate' as const },
      { id: 11, state: 'Committed', iteration: S123, role: 'duplicate' as const },
      { id: 12, state: 'Committed', iteration: S122, role: 'duplicate' as const },
    ];
    expect(findAlerts(pbi({ iteration: S122, duplicates }), rules).map((alert) => alert.message)).toEqual([
      'Is Committed but its duplicate #10 is New (should be the same state)',
      'Not planned with its duplicate #11: it is in Platform Sprint 123, this one in Platform Sprint 122',
    ]);
  });

  it('says nothing when the related work items are unknown', () => {
    expect(findAlerts(pbi({ iteration: S122 }), rules)).toEqual([]);
  });
});

describe('Integrated in Build of a reopened Bug', () => {
  const bug = (state: string, value: unknown = '0.24.63+') =>
    pbi({ type: 'Bug', state, fields: { [INTEGRATION_BUILD]: value } });

  it('alerts when a Bug that is not Ready to Test nor closed has a value', () => {
    expect(findAlerts(bug('Committed'), rules)).toEqual([
      {
        rule: 'staleIntegrationBuild',
        message:
          'Is Committed but "Integrated in Build" is still 0.24.63+ (reopened? a new build is set when it is Ready to Test again)',
        field: INTEGRATION_BUILD,
        action: 'clearIntegrationBuild',
      },
    ]);
    expect(rulesOf(bug('New'))).toEqual(['staleIntegrationBuild']);
    expect(rulesOf(bug('Approved'))).toEqual(['staleIntegrationBuild']);
  });

  it('accepts a value while Ready to Test (any spelling) or closed', () => {
    expect(rulesOf(bug('Ready to Test'))).toEqual([]);
    expect(rulesOf(bug('Ready-to-Test'))).toEqual([]);
    expect(rulesOf(bug('Done'))).toEqual([]);
    expect(rulesOf(bug('Removed'))).toEqual([]);
  });

  it('ignores empty values, other types and a field that does not exist', () => {
    expect(rulesOf(bug('Committed', ''))).toEqual([]);
    expect(rulesOf(bug('Committed', '  '))).toEqual([]);
    expect(rulesOf(bug('Committed', null))).toEqual([]);
    expect(rulesOf(pbi({ fields: { [EFFORT]: 5, [EFFORT_DAYS]: 2, [INTEGRATION_BUILD]: '1.0' } }))).toEqual([]);
    expect(findAlerts(bug('Committed'), { ...rules, integrationBuild: undefined })).toEqual([]);
  });
});

describe('work started without tasks (Rule ALERT-12)', () => {
  it('alerts when a work item in progress has no task, removed ones not counted', () => {
    const alerts = findAlerts(pbi({ tasks: [{ id: 1, title: 'Old', state: 'Removed', pullRequestIds: [] }] }), rules);
    expect(alerts).toEqual([
      { rule: 'noTasks', message: 'Is Committed but has no tasks (team rule: create them when the work starts)' },
    ]);
  });

  it('says nothing before the work starts, once it is finished, or with a task', () => {
    for (const state of ['New', 'Approved', 'Ready to Test', 'Done', 'Removed']) {
      expect(findAlerts(pbi({ state, tasks: [] }), rules).filter((alert) => alert.rule === 'noTasks')).toEqual([]);
    }
    expect(findAlerts(pbi({ tasks: [{ id: 1, title: 'Work', state: 'To Do', pullRequestIds: [] }] }), rules)).toEqual(
      []
    );
  });

  it('says nothing when the children could not be loaded', () => {
    expect(findAlerts(pbi({ tasks: [], tasksKnown: false }), rules)).toEqual([]);
  });
});

describe('stretched items (Rule ALERT-13)', () => {
  const stretch = {
    ...rules,
    stretch: { titlePrefix: '[Stretched]', tags: ['stretch-incomplete', 'stretch-scope-increase'] },
  };
  const messages = (input: Partial<AlertInput>) =>
    findAlerts(pbi(input), stretch)
      .filter((alert) => alert.rule === 'stretchTags')
      .map((alert) => alert.message);

  it('wants exactly one stretch tag with the prefix', () => {
    expect(messages({ title: '[Stretched] Dashboard Persistence', tags: ['Stretch-Incomplete'] })).toEqual([]);
    expect(messages({ title: '[Stretched] Dashboard Persistence', tags: [] })).toEqual([
      'Is [Stretched] but has no stretch tag (one of stretch-incomplete, stretch-scope-increase)',
    ]);
    expect(messages({ title: '[Stretched] x', tags: ['stretch-incomplete', 'stretch-scope-increase'] })).toEqual([
      'Has 2 stretch tags (stretch-incomplete, stretch-scope-increase): keep only the primary reason',
    ]);
  });

  it('wants the prefix when a stretch tag is set', () => {
    expect(messages({ title: 'Dashboard Persistence', tags: ['stretch-incomplete'] })).toEqual([
      'Has the stretch tag stretch-incomplete but the title does not start with "[Stretched]"',
    ]);
  });

  it('only counts the stretch tags when no prefix is set (the default)', () => {
    const noPrefix = { ...rules, stretch: { titlePrefix: '', tags: ['stretch-incomplete', 'stretch-scope-increase'] } };
    const alerts = (input: Partial<AlertInput>) =>
      findAlerts(pbi(input), noPrefix).filter((alert) => alert.rule === 'stretchTags');
    expect(alerts({ title: 'Dashboard Persistence - Stretched', tags: ['stretch-incomplete'] })).toEqual([]);
    expect(alerts({ title: '[Stretched] x', tags: [] })).toEqual([]);
    expect(alerts({ title: 'x', tags: ['stretch-incomplete', 'stretch-scope-increase'] })).toHaveLength(1);
  });

  it('says nothing without stretch tags in the settings, or without the title', () => {
    expect(findAlerts(pbi({ title: '[Stretched] x' }), rules)).toEqual([]);
    expect(messages({ tags: ['stretch-incomplete'] })).toEqual([]);
  });
});

describe('iteration not in the sprint plan (Rule ALERT-14)', () => {
  const area = 'Flow Digital Architecture\\Platform Framework';
  const teamPlans = [
    {
      name: 'Platform Team',
      areas: [{ path: area, includeChildren: false }],
      iterationPaths: ['Flow Digital Architecture\\MVP R3\\Platform Sprint 123'],
    },
  ];
  const planned = (iterationPath: string, name: string) =>
    pbi({
      fields: { [EFFORT]: 5, [EFFORT_DAYS]: 2, 'System.AreaPath': area },
      iteration: { path: iterationPath, name },
      teamPlans,
    });

  it('alerts when no team owning the area planned the sprint', () => {
    const alerts = findAlerts(
      planned('Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123', 'Interface Apps Sprint 123'),
      rules
    );
    expect(alerts).toEqual([
      {
        rule: 'iterationNotInSprintPlan',
        message: `Iteration Interface Apps Sprint 123 is not in the sprint plan of Platform Team: the item will not show on their sprint board (area ${area}). Change the iteration or the area.`,
      },
    ]);
  });

  it('says nothing for a planned sprint or when the plans are unknown', () => {
    expect(
      findAlerts(planned('Flow Digital Architecture\\MVP R3\\Platform Sprint 123', 'Platform Sprint 123'), rules)
    ).toEqual([]);
    const unknown = planned('Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123', 'x');
    expect(findAlerts({ ...unknown, teamPlans: undefined }, rules)).toEqual([]);
  });
});
