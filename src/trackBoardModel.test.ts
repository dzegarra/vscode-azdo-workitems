import { describe, expect, it } from 'vitest';
import type { MyPullRequestModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import type { ReviewRequestModel } from './reviewRequests';
import { buildBoard, columnOf, needsYouVerb, shortDeadline, type BoardInput } from './trackBoardModel';
import { currentStation, workItemTrack } from './track';
import type { BranchModel, PullRequestModel, WorkItemModel } from './viewModel';

const branch: BranchModel = { name: 'feature/x/1-a', location: 'local', isCurrent: false, otherRepository: false };
const run = (state: RunModel['state'], extra: Partial<RunModel> = {}): RunModel => ({
  id: 7,
  pipeline: 'UI-CI',
  state,
  url: 'https://run',
  ...extra,
});

function pr(overrides: Partial<PullRequestModel> = {}): PullRequestModel {
  return {
    id: 10,
    title: 'PR',
    status: 'In review',
    tone: 'review',
    url: 'https://pr/10',
    isActive: true,
    runs: [],
    repository: 'User_Interface',
    otherRepository: false,
    ...overrides,
  };
}

function workItem(overrides: Partial<WorkItemModel> = {}): WorkItemModel {
  return {
    id: 1,
    title: 'Item',
    type: 'Product Backlog Item',
    state: 'Committed',
    displayState: 'Committed',
    iterationPath: 'P\\R\\S',
    url: 'https://wi/1',
    alerts: [],
    isCurrentBranch: false,
    branches: [branch],
    branch: branch.name,
    pullRequests: [],
    ...overrides,
  };
}

function mine(overrides: Partial<MyPullRequestModel> = {}): MyPullRequestModel {
  return {
    id: 10,
    title: 'PR',
    url: 'https://pr/10',
    time: '1 d 2 h',
    isDraft: false,
    isCompleted: false,
    reviewers: [],
    unresolved: 0,
    conflicts: false,
    runs: [],
    autoComplete: false,
    readyToMerge: false,
    canComplete: false,
    warnings: [],
    cautions: [],
    ...overrides,
  } as MyPullRequestModel;
}

function review(overrides: Partial<ReviewRequestModel> = {}): ReviewRequestModel {
  return {
    id: 50,
    title: 'Review me',
    url: 'https://pr/50',
    repository: 'User_Interface',
    repositoryId: 'r',
    author: 'Ana Ruiz',
    targetBranch: 'develop',
    sourceBranch: 'feature/a',
    publishedAt: '2026-10-23T10:00:00Z',
    isRequired: true,
    urgency: 'fresh',
    timeLeft: '10 h left',
    waited: '14 h',
    elapsed: 0.5,
    dueText: 'due Mon 10:00',
    barCaption: '14 h of 24 h',
    barValueText: '',
    waitedHours: 14,
    ...overrides,
  };
}

function details(overrides: Partial<NonNullable<ReviewRequestModel['details']>> = {}) {
  return {
    status: 'In review',
    tone: 'review',
    timeline: { events: [], earlier: 0 },
    workItems: [],
    reviewers: [],
    conflicts: false,
    runs: [],
    autoComplete: false,
    approvalCompletes: false,
    teamRules: [],
    toVerify: [],
    ...overrides,
  } as NonNullable<ReviewRequestModel['details']>;
}

function input(overrides: Partial<BoardInput> = {}): BoardInput {
  return {
    status: 'ready',
    workItems: [],
    myPullRequests: [],
    reviews: [],
    reviewsStatus: 'ready',
    maxWaitHours: 24,
    iterations: [],
    kinds: ['backlog', 'bug'],
    look: 'theme',
    popoverDelay: 500,
    ...overrides,
  };
}

const columnFor = (item: WorkItemModel, mineModel?: MyPullRequestModel) =>
  columnOf(item, workItemTrack(item, mineModel), item.pullRequests.at(0));

describe('boardItems (BOARD-1)', () => {
  it('shows Backlog Items and Bugs, not tasks nor removed work items, in the chosen types', () => {
    const items = [
      workItem({ id: 1 }),
      workItem({ id: 2, type: 'Bug' }),
      workItem({ id: 3, type: 'Task' }),
      workItem({ id: 4, state: 'Removed', displayState: 'Removed' }),
    ];
    expect(buildBoard(input({ workItems: items })).work.map((card) => card.id)).toEqual([1, 2]);
    expect(buildBoard(input({ workItems: items, kinds: ['bug'] })).work.map((card) => card.id)).toEqual([2]);
  });
});

describe('columnOf (BOARD-2..5)', () => {
  it('puts a not started work item without branch in To start', () => {
    // Rule BOARD-3
    expect(columnFor(workItem({ state: 'Approved', branches: [], branch: undefined }))).toBe('toStart');
  });

  it('puts a started work item without branch, and one with a branch but no PR, in Branch · Draft', () => {
    // Rule BOARD-3
    expect(columnFor(workItem({ branches: [], branch: undefined }))).toBe('branch');
    expect(columnFor(workItem())).toBe('branch');
    // Not started but with a branch: coding already
    expect(columnFor(workItem({ state: 'New' }))).toBe('branch');
  });

  it('puts a draft PR in Branch · Draft', () => {
    // Rule BOARD-3
    expect(columnFor(workItem({ pullRequests: [pr({ tone: 'draft' })] }), mine({ isDraft: true }))).toBe('branch');
  });

  it('follows the current station of a published PR', () => {
    // Rule BOARD-2
    const failed = workItem({ pullRequests: [pr({ runs: [run('failed')] })] });
    expect(columnFor(failed)).toBe('ci');
    const reviewing = workItem({ pullRequests: [pr({ runs: [run('succeeded')] })] });
    expect(columnFor(reviewing)).toBe('review');
    const ready = workItem({ pullRequests: [pr({ tone: 'approved', runs: [run('succeeded')] })] });
    expect(columnFor(ready, mine({ readyToMerge: true }))).toBe('ready');
  });

  it('keeps a published PR that breaks a rule of its own out of Branch · Draft', () => {
    // Rule BOARD-4: TRACK-9 points at the Pull request station, the board looks at the next open one
    const item = workItem({ pullRequests: [pr({ runs: [run('running')] })] });
    const broken = mine({ warnings: [{ text: 'No description', severity: 'warning', concern: 'pullRequest' }] });
    expect(currentStation(workItemTrack(item, broken))?.id).toBe('pullRequest');
    expect(columnFor(item, broken)).toBe('ci');
  });

  it('puts finished and fully passed work items in Done', () => {
    // Rule BOARD-5
    expect(columnFor(workItem({ state: 'Done', displayState: 'Done' }))).toBe('done');
    const merged = workItem({ pullRequests: [pr({ tone: 'completed' })] });
    expect(columnFor(merged)).toBe('done');
  });
});

describe('buildBoard', () => {
  it('collapses finished work items without broken rules into one card and keeps the broken ones', () => {
    // Rule BOARD-5
    const board = buildBoard(
      input({
        workItems: [
          workItem({ id: 1, state: 'Done', displayState: 'Done' }),
          workItem({ id: 2, state: 'Done', displayState: 'Done' }),
          workItem({
            id: 3,
            type: 'Bug',
            state: 'Ready to Test',
            displayState: 'Ready to Test',
            alerts: [
              { rule: 'noTasks', message: 'a' },
              { rule: 'noTasks', message: 'b' },
            ],
          }),
        ],
      })
    );
    expect(board.summary.ids).toEqual([1, 2]);
    expect(board.work.map((card) => card.id)).toEqual([3]);
    expect(board.work[0]).toMatchObject({ column: 'done', tone: 'broken', status: { text: '2 rules broken' } });
    expect(board.columns.find((column) => column.id === 'done')?.count).toBe(3);
  });

  it('counts the work items and the reviews of each column, with the real review deadline in the hint', () => {
    // Rule BOARD-6
    const board = buildBoard(
      input({
        maxWaitHours: 16,
        workItems: [workItem({ id: 1 }), workItem({ id: 2, state: 'New', branches: [], branch: undefined })],
        reviews: [review({ id: 50 })],
      })
    );
    const byId = Object.fromEntries(board.columns.map((column) => [column.id, column]));
    expect(byId.toStart).toMatchObject({ count: 1, hint: 'New · Approved · ReOpened' });
    expect(byId.branch.count).toBe(1);
    expect(byId.review).toMatchObject({ count: 0, reviewCount: 1, hint: '16 working hours' });
    expect(board.columns.map((column) => column.title)).toEqual([
      'To start',
      'Branch · Draft',
      'CI',
      'Review',
      'Ready to be merged',
      'Done',
    ]);
  });

  it('colours the card by the state of its station', () => {
    // Rule BOARD-7
    const board = buildBoard(
      input({
        workItems: [
          workItem({ id: 1, pullRequests: [pr({ id: 11, runs: [run('failed')] })] }),
          workItem({ id: 2, pullRequests: [pr({ id: 12, runs: [run('succeeded')] })], workingOn: 'here' }),
          workItem({ id: 3, alerts: [{ rule: 'noTasks', message: 'x' }] }),
          workItem({ id: 4, state: 'New', branches: [], branch: undefined }),
        ],
        myPullRequests: [mine({ id: 11, runs: [run('failed')] }), mine({ id: 12, runs: [run('succeeded')] })],
      })
    );
    const tones = Object.fromEntries(board.work.map((card) => [card.id, card.tone]));
    expect(tones).toEqual({ 1: 'needsYou', 2: 'active', 3: 'broken', 4: 'neutral' });
  });

  it('says what is going on in one line', () => {
    // Rule BOARD-8
    const failed = run('failed', { tests: { total: 188, failed: 2, failedTests: [] } });
    const board = buildBoard(
      input({
        workItems: [
          workItem({ id: 1, pullRequests: [pr({ id: 11, runs: [failed] })] }),
          workItem({ id: 2, pullRequests: [pr({ id: 12, tone: 'draft' })] }),
          workItem({ id: 3 }),
          workItem({ id: 4, pullRequests: [pr({ id: 14, tone: 'waiting', runs: [run('succeeded')] })] }),
          workItem({ id: 5, pullRequests: [pr({ id: 15, runs: [run('succeeded')] })] }),
        ],
        myPullRequests: [
          mine({ id: 11, runs: [failed] }),
          mine({ id: 12, isDraft: true }),
          mine({
            id: 14,
            conflicts: true,
            runs: [run('succeeded')],
            reviewers: [{ name: 'Jonas Berg', vote: 'waiting', isRequired: true, isContainer: false }],
          }),
          mine({
            id: 15,
            runs: [run('succeeded')],
            reviewers: [
              { name: 'A', vote: 'approved', isRequired: true, isContainer: false },
              { name: 'B', vote: 'none', isRequired: true, isContainer: false },
            ],
          }),
        ],
      })
    );
    const text = Object.fromEntries(board.work.map((card) => [card.id, card.status?.text]));
    expect(text).toEqual({
      1: '2 tests failed',
      2: 'Draft PR 12',
      3: 'local branch · no PR',
      4: 'Jonas waits · conflicts',
      5: '1 of 2 approvals',
    });
  });

  it('shortens why a work item needs the user', () => {
    // Rule BOARD-9
    const failed = run('failed', { tests: { total: 10, failed: 1, failedTests: [] } });
    const ciStation = { id: 'ci', label: 'CI', state: 'needsYou' } as const;
    expect(needsYouVerb('ship', undefined, undefined, [])).toBe('complete it');
    expect(needsYouVerb('fix', undefined, undefined, [])).toBe('fix rules');
    expect(needsYouVerb('unblock', ciStation, undefined, [failed])).toBe('fix tests');
    expect(needsYouVerb('unblock', ciStation, undefined, [run('failed')])).toBe('fix CI');
    const sentBack = {
      conflicts: false,
      reviewers: [{ name: 'Jonas Berg', vote: 'waiting' as const, isRequired: true, isContainer: false }],
    };
    expect(needsYouVerb('unblock', { id: 'review', label: 'Review', state: 'needsYou' }, sentBack, [])).toBe(
      'answer Jonas'
    );
    const board = buildBoard(
      input({
        workItems: [workItem({ id: 1, pullRequests: [pr({ runs: [failed] })] })],
        myPullRequests: [mine({ runs: [failed] })],
      })
    );
    expect(board.work[0].verb).toBe('fix tests');
  });

  it('marks the card of the first row of the Now queue as the current one', () => {
    // Rule BOARD-10: a review comes first in the queue; the work items follow in the order of their verbs
    const failed = run('failed');
    const items = [
      workItem({ id: 1, pullRequests: [pr({ id: 11, runs: [failed] })] }),
      workItem({ id: 2, alerts: [{ rule: 'noTasks', message: 'x' }] }),
    ];
    const mineModels = [mine({ id: 11, runs: [failed] })];
    const withoutReview = buildBoard(input({ workItems: items, myPullRequests: mineModels }));
    expect(withoutReview.work.filter((card) => card.current).map((card) => card.id)).toEqual([1]);
    const withReview = buildBoard(input({ workItems: items, myPullRequests: mineModels, reviews: [review()] }));
    expect(withReview.work.some((card) => card.current)).toBe(false);
    expect(withReview.reviews[0].current).toBe(true);
    // A PR whose CI runs is not yours yet: the next row counts
    const running = review({ details: details({ runs: [run('running')] }) });
    const skipped = buildBoard(input({ workItems: items, myPullRequests: mineModels, reviews: [running] }));
    expect(skipped.reviews[0].current).toBeUndefined();
    expect(skipped.work.filter((card) => card.current).map((card) => card.id)).toEqual([1]);
  });

  it('offers only the buttons that exist elsewhere, under the same conditions', () => {
    // Rule BOARD-11
    const board = buildBoard(
      input({
        workItems: [
          workItem({ id: 1, state: 'New', branches: [], branch: undefined }),
          workItem({ id: 2, pullRequests: [pr({ id: 12, tone: 'draft' })] }),
          workItem({ id: 3, pullRequests: [pr({ id: 13, tone: 'approved', runs: [run('succeeded')] })] }),
          workItem({ id: 4, pullRequests: [pr({ id: 14, tone: 'draft' })] }),
        ],
        myPullRequests: [mine({ id: 12, isDraft: true }), mine({ id: 13, readyToMerge: true, canComplete: true })],
      })
    );
    const actions = Object.fromEntries(board.work.map((card) => [card.id, card.action]));
    expect(actions[1]).toEqual({ label: 'Create branch', message: { type: 'createBranch', id: 1 } });
    expect(actions[2]).toEqual({ label: 'Publish', message: { type: 'publishMyPullRequest', pullRequestId: 12 } });
    expect(actions[3]).toEqual({ label: 'Complete…', message: { type: 'completeMyPullRequest', pullRequestId: 13 } });
    // A PR of somebody else is not ours to publish
    expect(actions[4]).toBeUndefined();
  });

  it('places the PRs to review by their CI and gives the deadline', () => {
    // Rules BOARD-12, BOARD-13
    const running = review({ id: 1, details: details({ runs: [run('running')] }) });
    const overdue = review({ id: 2, urgency: 'overdue', timeLeft: 'overdue by 3 h' });
    const approving = review({ id: 3, details: details({ approvalCompletes: true }) });
    const board = buildBoard(input({ reviews: [running, overdue, approving] }));
    expect(board.reviews.map((card) => [card.id, card.column, card.deadline])).toEqual([
      [1, 'ci', '10 h left'],
      [2, 'review', '-3 h'],
      [3, 'review', '10 h left'],
    ]);
    expect(board.reviews[0].ciRunning).toBe(true);
    expect(board.reviews[2].status?.text).toBe('Your approval completes it');
    expect(shortDeadline('overdue by 1 d 2 h')).toBe('-1 d 2 h');
  });

  it('links the work items that are related and on the board, both ways', () => {
    // Rule BOARD-14
    const board = buildBoard(
      input({
        workItems: [
          workItem({
            id: 1,
            openPredecessors: [{ id: 2, title: 'P', type: 'Product Backlog Item', state: 'Committed' }],
          }),
          workItem({ id: 2 }),
          workItem({
            id: 3,
            duplicates: [{ id: 99, title: 'D', type: 'Bug', state: 'New', stateCategory: 'proposed' }],
          }),
        ],
      })
    );
    expect(board.work.map((card) => [card.id, card.related])).toEqual([
      [1, [2]],
      [2, [1]],
      [3, []],
    ]);
  });

  it('names the failed tests and the buttons of the CI box in the drawer', () => {
    // Rule BOARD-15
    const failed = run('failed', {
      tests: {
        total: 188,
        failed: 2,
        failedTests: [
          { title: 'exports holding registers as CSV', file: 'a.spec.ts', error: 'x' },
          { title: 'keeps register order on re-export', file: 'a.spec.ts', error: 'y' },
        ],
      },
    });
    const board = buildBoard(
      input({
        workItems: [workItem({ pullRequests: [pr({ runs: [failed] })] })],
        myPullRequests: [mine({ runs: [failed] })],
      })
    );
    const need = board.work[0].need;
    expect(need).toMatchObject({ title: 'CI FAILED', text: 'PR 10 · UI-CI · 2 of 188 tests failed' });
    expect(need?.tests).toEqual(['exports holding registers as CSV', 'keeps register order on re-export']);
    expect(need?.actions.map((action) => action.label)).toEqual(['Show tests', 'Open run']);
  });

  it('shows the sprint and its days left, hurrying under three days', () => {
    // Rule BOARD-6
    const progress = { total: 10, passed: 8, text: '2 days left', hurry: true, tooltip: 't' };
    const board = buildBoard(input({ iterations: [{ name: 'Sprint 122', progress }] }));
    expect(board.header).toMatchObject({ sprint: 'Sprint 122', left: '2 days left', hurry: true });
  });
});
