import { describe, expect, it } from 'vitest';
import { CompletionWorkItem, completionPlan, completionSummary } from './pullRequestCompletion';

const PR = 13900;
const OPTIONS = { bugTypes: ['Bug'], bugState: 'Ready to Test' };

function item(overrides: Partial<CompletionWorkItem>): CompletionWorkItem {
  return {
    id: 1,
    title: 'Title',
    type: 'Product Backlog Item',
    state: 'Committed',
    tasks: [],
    pullRequests: [{ id: PR, status: 'active' }],
    ...overrides,
  };
}

describe('completionPlan', () => {
  it('moves a Backlog Item to Done and its PR task to Done when nothing else is left', () => {
    const plan = completionPlan(
      PR,
      [
        item({
          id: 10,
          tasks: [
            { id: 11, state: 'In Progress', pullRequestIds: [PR] },
            { id: 12, state: 'Done', pullRequestIds: [] },
          ],
        }),
        item({ id: 11, type: 'Task', state: 'In Progress', pullRequests: [] }),
      ],
      OPTIONS
    );
    expect(plan.moves.map(({ id, to }) => [id, to])).toEqual([
      [10, 'Done'],
      [11, 'Done'],
    ]);
    expect(plan.kept).toEqual([]);
  });

  it('never completes a Bug: Ready to Test with "Integrated in Build"', () => {
    const plan = completionPlan(PR, [item({ id: 20, type: 'Bug', state: 'Committed' })], OPTIONS);
    expect(plan.moves).toEqual([
      { id: 20, title: 'Title', type: 'Bug', from: 'Committed', to: 'Ready to Test', setsIntegrationBuild: true },
    ]);
  });

  it('keeps a work item whose other tasks are open or that has another active PR', () => {
    const plan = completionPlan(
      PR,
      [
        item({ id: 30, tasks: [{ id: 31, state: 'To Do', pullRequestIds: [] }] }),
        item({
          id: 40,
          type: 'Bug',
          pullRequests: [
            { id: PR, status: 'active' },
            { id: 41, status: 'active' },
            { id: 42, status: 'completed' },
          ],
        }),
      ],
      OPTIONS
    );
    expect(plan.moves).toEqual([]);
    expect(plan.kept.map(({ id, reason }) => [id, reason])).toEqual([
      [30, '1 other task is not done'],
      [40, 'PR 41 still active'],
    ]);
  });

  it('leaves closed items, Bugs already Ready to Test, done tasks and other types alone', () => {
    const plan = completionPlan(
      PR,
      [
        item({ id: 50, state: 'Done' }),
        item({ id: 51, type: 'Bug', state: 'Ready-to-test' }),
        item({ id: 52, type: 'Task', state: 'Done' }),
        item({ id: 53, type: 'Feature' }),
      ],
      OPTIONS
    );
    expect(plan.moves).toEqual([]);
    expect(plan.kept.map(({ id, reason }) => [id, reason])).toEqual([
      [50, 'already Done'],
      [51, 'already Ready-to-test'],
      [53, 'a Feature is not changed'],
    ]);
  });
});

describe('completionSummary', () => {
  it('lists the merge, each move and each work item kept', () => {
    const plan = completionPlan(
      PR,
      [item({ id: 20, type: 'Bug' }), item({ id: 30, tasks: [{ id: 31, state: 'To Do', pullRequestIds: [] }] })],
      OPTIONS
    );
    expect(completionSummary(PR, 'develop', plan, { field: 'Integrated in Build', value: '1.2.3+' })).toBe(
      [
        'Squash merge into develop, then delete the branch.',
        '• Bug 20: Committed → Ready to Test, "Integrated in Build" = 1.2.3+',
        '• 30 stays as it is: 1 other task is not done',
      ].join('\n')
    );
    expect(completionSummary(PR, 'develop', { moves: [], kept: [] })).toContain('No work item linked to PR 13900');
  });
});
