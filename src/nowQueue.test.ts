import { describe, expect, it } from 'vitest';
import type { MyPullRequestModel } from './myPullRequests';
import { nowQueue, type NowInput } from './nowQueue';
import type { RunModel } from './pipelines';
import { summaryBadge } from './summaryRows';

const run = (state: RunModel['state']): RunModel => ({ id: 1, pipeline: 'PR', state, url: 'https://run' });

function myPr(overrides: Partial<MyPullRequestModel> = {}): MyPullRequestModel {
  return {
    id: 1,
    title: 'Mine',
    url: 'https://pr/1',
    isDraft: false,
    isCompleted: false,
    reviewers: [],
    unresolved: 0,
    conflicts: false,
    runs: [],
    autoComplete: false,
    readyToMerge: false,
    warnings: [],
    ...overrides,
  } as MyPullRequestModel;
}

function input(overrides: Partial<NowInput> = {}): NowInput {
  return { reviews: [], myPullRequests: [], workItems: [], deletableBranches: 0, staleWorktrees: 0, ...overrides };
}

describe('nowQueue', () => {
  it('lists reviews first, in the order of the Reviews box', () => {
    // Rule NOW-1: the order of REVIEW-REQ-4 (required first, oldest first) is kept
    const queue = nowQueue(
      input({
        reviews: [
          { id: 3, title: 'Required, oldest', isRequired: true, urgency: 'overdue', timeLeft: 'overdue by 3 h' },
          { id: 1, title: 'Required', isRequired: true, urgency: 'fresh', timeLeft: '18 h left' },
          { id: 2, title: 'Optional', isRequired: false, urgency: 'overdue', timeLeft: 'overdue by 1 h' },
        ],
      })
    );
    expect(queue.items.map((item) => item.id)).toEqual([3, 1, 2]);
  });

  it('puts the verbs in order: review, unblock, fix, ship, clean', () => {
    // Rules NOW-2..5
    const queue = nowQueue(
      input({
        reviews: [{ id: 5, title: 'R', isRequired: true, urgency: 'fresh', timeLeft: '20 h left' }],
        myPullRequests: [myPr({ id: 6, readyToMerge: true }), myPr({ id: 7, conflicts: true })],
        workItems: [{ id: 8, title: 'W', alerts: [{ rule: 'noTasks', message: 'No tasks' }] }],
        deletableBranches: 1,
        staleWorktrees: 2,
      })
    );
    expect(queue.items.map((item) => [item.verb, item.id])).toEqual([
      ['review', 5],
      ['unblock', 7],
      ['fix', 8],
      ['ship', 6],
      ['clean', 0],
    ]);
    expect(queue.items.at(-1)?.title).toBe('2 worktrees and 1 branch can go');
  });

  it('asks to unblock the PRs that need the author, with their team-rule warnings', () => {
    // Rule NOW-2
    const queue = nowQueue(
      input({
        myPullRequests: [
          myPr({ id: 1, runs: [run('failed')], warnings: [{ text: 'No description', severity: 'warning' }] }),
          myPr({ id: 2, isDraft: true, conflicts: true }),
          myPr({ id: 3, isCompleted: true, conflicts: true }),
        ],
      })
    );
    expect(queue.items).toEqual([{ verb: 'unblock', id: 1, title: 'Mine', detail: 'CI failed · No description' }]);
  });

  it('ships only what the user completes: auto-complete and blocked PRs are not', () => {
    // Rule NOW-4
    const queue = nowQueue(
      input({
        myPullRequests: [
          myPr({ id: 1, readyToMerge: true }),
          myPr({ id: 2, readyToMerge: true, autoComplete: true }),
          myPr({ id: 3, readyToMerge: true, unresolved: 2 }),
        ],
      })
    );
    expect(queue.items.filter((item) => item.verb === 'ship').map((item) => item.id)).toEqual([1]);
  });

  it('counts a broken base branch once, like the badge', () => {
    // Rule NOW-7
    expect(nowQueue(input({ baseBranchBroken: true }))).toEqual({ items: [], count: 1 });
  });

  it('does not count the cleanup row', () => {
    // Rule NOW-6
    expect(nowQueue(input({ staleWorktrees: 1 }))).toMatchObject({ count: 0, items: [{ verb: 'clean' }] });
  });

  it('agrees with the activity bar badge on reviews and work items to fix', () => {
    // Rule NOW-3: the same work items as the badge (SUMMARY-6)
    const reviews = [{ id: 1, title: 'R', isRequired: true, urgency: 'overdue' as const, timeLeft: 'overdue by 1 h' }];
    const workItems = [
      { id: 2, title: 'A', alerts: [{ rule: 'noTasks' as const, message: 'No tasks' }] },
      { id: 3, title: 'B', alerts: [] },
    ];
    const queue = nowQueue(input({ reviews, workItems, myPullRequests: [myPr({ conflicts: true })] }));
    const counted = queue.items.filter((item) => item.verb === 'review' || item.verb === 'fix').length;
    expect(counted).toBe(summaryBadge({ reviews, workItemsWithAlerts: 1 })?.value);
  });
});
