import { describe, expect, it } from 'vitest';
import type { MyPullRequestModel } from './myPullRequests';
import type { RunModel } from './pipelines';
import type { ReviewRequestModel } from './reviewRequests';
import { buildBoard, columnOf, needsYouVerb, placementOf, shortDeadline, type BoardInput } from './trackBoardModel';
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
    showCompleted: true,
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

describe('a merged PR with work left (BOARD-3, BOARD-5)', () => {
  const merged = pr({ tone: 'completed', isActive: false });

  it('goes back to To start / Branch · Draft with the Done detail as status', () => {
    // Rule BOARD-3
    const board = buildBoard(
      input({
        workItems: [
          workItem({ id: 1, state: 'Approved', displayState: 'Approved', pullRequests: [merged] }),
          workItem({ id: 2, pullRequests: [merged] }),
          workItem({ id: 3, type: 'Task', parentId: 2, state: 'To Do' }),
        ],
      })
    );
    const cards = Object.fromEntries(board.work.map((card) => [card.id, card]));
    expect(cards[1]).toMatchObject({ column: 'toStart', status: { text: 'PR merged · Approved' } });
    expect(cards[2]).toMatchObject({ column: 'branch', status: { text: 'PR merged · 1 task open' } });
  });

  it('keeps a merged PR with the work done in Done', () => {
    // Rule BOARD-5
    expect(columnFor(workItem({ pullRequests: [merged] }))).toBe('done');
  });

  it('says Blocked once', () => {
    // Rule BOARD-8
    const board = buildBoard(
      input({
        workItems: [
          workItem({
            id: 1,
            type: 'Bug',
            state: 'Approved',
            branches: [],
            branch: undefined,
            blockingTags: ['blocked'],
          }),
        ],
      })
    );
    expect(board.work.at(0)?.status?.text).toBe('Blocked');
  });
});

describe('buildBoard', () => {
  it('shows finished work items as full cards, the most recently finished first, and keeps the broken ones red', () => {
    // Rules BOARD-5, BOARD-25
    const board = buildBoard(
      input({
        workItems: [
          workItem({ id: 1, state: 'Done', displayState: 'Done', dates: { stateChanged: '2026-10-14T10:00:00Z' } }),
          workItem({ id: 2, state: 'Done', displayState: 'Done', dates: { stateChanged: '2026-10-16T10:00:00Z' } }),
          workItem({
            id: 3,
            type: 'Bug',
            state: 'Ready to Test',
            displayState: 'Ready to Test',
            dates: { stateChanged: '2026-10-15T10:00:00Z' },
            alerts: [
              { rule: 'noTasks', message: 'a' },
              { rule: 'noTasks', message: 'b' },
            ],
          }),
        ],
      })
    );
    expect(board.work.map((card) => card.id)).toEqual([2, 3, 1]);
    expect(board.work.map((card) => card.tone)).toEqual(['done', 'broken', 'done']);
    expect(board.work[0]).toMatchObject({ column: 'done', action: undefined, status: { tone: 'passed' } });
    expect(board.work[0].status?.text).toMatch(/^Done /);
    expect(board.work[1]).toMatchObject({ status: { text: '2 rules broken' } });
    expect(board.columns.find((column) => column.id === 'done')?.count).toBe(3);
    expect(board.showCompleted).toBe(true);
  });

  it('folds the finished work items into one card when the setting is off, except the ones that break a rule', () => {
    // Rule BOARD-25
    const board = buildBoard(
      input({
        showCompleted: false,
        workItems: [
          workItem({ id: 1, state: 'Done', displayState: 'Done' }),
          workItem({ id: 2, state: 'Done', displayState: 'Done', alerts: [{ rule: 'noTasks', message: 'a' }] }),
          workItem({ id: 4, state: 'Active', displayState: 'Active' }),
        ],
      })
    );
    expect(board.work.map((card) => card.id).sort()).toEqual([2, 4]);
    expect(board.work.find((card) => card.id === 2)).toMatchObject({ tone: 'broken', column: 'done' });
    expect(board.summary.ids).toEqual([1]);
    expect(board.columns.find((column) => column.id === 'done')?.count).toBe(2);
    expect(board.showCompleted).toBe(false);
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

describe('why a work item is in its column (BOARD-16)', () => {
  const merged = pr({ id: 13912, tone: 'completed', isActive: false, status: 'Completed' });
  const placeOf = (item: WorkItemModel, mineModel?: MyPullRequestModel) =>
    placementOf(item, workItemTrack(item, mineModel), item.pullRequests.at(0));

  it('always agrees with the column', () => {
    const items = [
      workItem({ state: 'Approved', branches: [], branch: undefined }),
      workItem({ branches: [], branch: undefined }),
      workItem(),
      workItem({ pullRequests: [pr({ tone: 'draft' })] }),
      workItem({ pullRequests: [pr({ runs: [run('failed')] })] }),
      workItem({ pullRequests: [pr({ runs: [run('succeeded')] })] }),
      workItem({ pullRequests: [merged] }),
      workItem({ state: 'Done', displayState: 'Done' }),
    ];
    for (const item of items) {
      expect(placeOf(item).column).toBe(columnFor(item));
    }
  });

  it('says what the not started and the coding work items lack', () => {
    expect(placeOf(workItem({ state: 'Approved', branches: [], branch: undefined })).reason).toBe(
      'Not started (Approved), no branch'
    );
    expect(placeOf(workItem({ branches: [], branch: undefined })).reason).toBe('Started (Committed), no branch yet');
    expect(placeOf(workItem()).reason).toBe('Branch ready, no PR yet');
    expect(
      placeOf(workItem({ pullRequests: [pr({ id: 7, tone: 'draft' })] }), mine({ id: 7, isDraft: true })).reason
    ).toBe('Draft PR 7: self-review, then publish');
  });

  it('names the current station and its detail', () => {
    const failed = workItem({
      pullRequests: [pr({ runs: [run('failed', { tests: { total: 10, failed: 2, failedTests: [] } })] })],
    });
    expect(placeOf(failed).reason).toMatch(/^Current station: CI — /);
    expect(placeOf(workItem({ pullRequests: [pr({ runs: [run('succeeded')] })] })).reason).toMatch(
      /^Current station: Review/
    );
  });

  it('explains a published PR that breaks a rule of its own', () => {
    const item = workItem({ pullRequests: [pr({ runs: [run('running')] })] });
    const broken = mine({ warnings: [{ text: 'No description', severity: 'warning', concern: 'pullRequest' }] });
    expect(placeOf(item, broken)).toMatchObject({ column: 'ci' });
    expect(placeOf(item, broken).reason).toMatch(/^PR 10 is published but .*— the rest of its track is at CI$/);
  });

  it('says a merged PR with an open task sent the work back to coding', () => {
    const item = workItem({ pullRequests: [merged] });
    const tasks = [{ state: 'To Do' }];
    const reason = placementOf(item, workItemTrack(item, undefined, tasks), merged);
    expect(reason).toEqual({ column: 'branch', reason: 'PR 13912 merged · 1 task open: back to coding' });
    const notStarted = workItem({ state: 'Approved', pullRequests: [merged] });
    expect(placementOf(notStarted, workItemTrack(notStarted), merged).reason).toBe(
      'PR 13912 merged · Approved: back to the start'
    );
  });

  it('says finished and fully passed', () => {
    expect(placeOf(workItem({ state: 'Done', displayState: 'Done' })).reason).toBe('Finished (Done)');
    expect(placeOf(workItem({ type: 'Bug', state: 'Ready to Test', displayState: 'Ready to Test' })).reason).toBe(
      'Finished (Ready to Test)'
    );
    expect(placeOf(workItem({ pullRequests: [merged] })).reason).toBe(
      'Current station: Done — PR merged, move it to Done'
    );
    const item = workItem();
    const passed = workItemTrack(item).map((station) => ({ ...station, state: 'done' as const }));
    expect(placementOf(item, passed, undefined)).toEqual({ column: 'done', reason: 'Every station passed' });
  });

  it('titles the drawer line with the column and gives the review cards their own reason', () => {
    const board = buildBoard(
      input({
        workItems: [workItem({ id: 1, pullRequests: [pr({ runs: [run('failed')] })] })],
        reviews: [
          review({ id: 50, timeLeft: '5 h left' }),
          review({ id: 51, details: details({ runs: [run('running')] }) }),
        ],
      })
    );
    expect(board.work.at(0)?.why.title).toBe('Why CI');
    expect(board.reviews.map((card) => card.why)).toEqual([
      { title: 'Why Review', text: 'In review, 5 h left' },
      { title: 'Why CI', text: 'CI running: the review clock has started' },
    ]);
  });
});

describe('the drawer detail (BOARD-17..19)', () => {
  const other = pr({
    id: 11,
    title: 'Second',
    repository: 'Common_Translations',
    otherRepository: true,
    tone: 'draft',
  });
  const followed = pr({
    id: 10,
    title: 'First',
    runs: [run('failed', { tests: { total: 188, failed: 2, failedTests: [] } })],
  });

  it('lists every PR and marks the one the track follows', () => {
    // Rule BOARD-17
    const own = mine({
      id: 10,
      readyToMerge: true,
      reviewers: [{ name: 'Ana Ruiz', vote: 'approved', isRequired: true, isContainer: false }],
      warnings: [{ text: 'No description', severity: 'warning', concern: 'pullRequest' }],
    });
    const board = buildBoard(
      input({ workItems: [workItem({ pullRequests: [followed, other] })], myPullRequests: [own] })
    );
    const prs = board.work.at(0)?.detail.pullRequests ?? [];
    expect(prs.map((item) => [item.id, item.followed])).toEqual([
      [10, true],
      [11, false],
    ]);
    expect(prs.at(0)).toMatchObject({
      ci: { text: expect.stringContaining('2 of 188 tests failed') },
      reviewers: 'Ana Ruiz ✓',
      warnings: ['No description'],
      flags: ['ready to merge'],
      open: { message: { type: 'openPullRequest', id: 1, pullRequestId: 10 } },
    });
    expect(prs.at(1)).toMatchObject({ repository: 'Common_Translations', reviewers: undefined, warnings: [] });
  });

  it('lists every task, marks the open ones and what keeps a merged PR out of Done', () => {
    // Rule BOARD-18
    const merged = pr({ id: 12, tone: 'completed', isActive: false });
    const board = buildBoard(
      input({
        workItems: [
          workItem({
            id: 2,
            pullRequests: [merged],
            otherTasks: [
              { id: 5, title: 'Docs', type: 'Task', state: 'Active', assignedTo: 'Jonas Berg', taskPullRequests: [] },
            ],
          }),
          workItem({ id: 3, type: 'Task', parentId: 2, title: 'Code', state: 'Done' }),
          workItem({ id: 4, type: 'Task', parentId: 2, title: 'Test', state: 'To Do' }),
          workItem({ id: 6, type: 'Task', parentId: 2, title: 'Gone', state: 'Removed' }),
        ],
      })
    );
    const tasks = board.work.at(0)?.detail.tasks;
    expect(tasks?.summary).toBe('1 to do, 1 in progress, 1 done');
    expect(tasks?.items.map((task) => [task.id, task.open, task.keepsOutOfDone, task.assignee])).toEqual([
      [3, false, false, undefined],
      [4, true, true, undefined],
      [5, true, true, 'Jonas Berg'],
    ]);
    expect(board.work.at(0)?.detail.tasks?.items.at(1)?.openDetails.message).toEqual({ type: 'openDetails', id: 4 });
  });

  it('lists the stations with their state and notes, the facts and the checks', () => {
    // Rule BOARD-19
    const item = workItem({
      state: 'Committed',
      displayState: 'In review',
      pullRequests: [followed],
      blockingTags: ['Blocked'],
      alerts: [{ rule: 'tasksNotDone', message: 'Tasks are not done' } as WorkItemModel['alerts'][number]],
      notUpdated: { days: 3, text: 'Not updated for 3 working days' },
    });
    const detail = buildBoard(input({ workItems: [item] })).work.at(0)?.detail;
    expect(detail?.stations).toHaveLength(6);
    expect(detail?.stations.filter((station) => station.current).map((station) => station.label)).toEqual(['CI']);
    expect(detail?.stations.at(2)).toMatchObject({ stateText: 'needs you', notes: expect.arrayContaining([]) });
    expect(detail?.facts).toEqual(
      expect.arrayContaining([
        { label: 'State', value: 'In review (Committed)' },
        { label: 'Not updated', value: 'Not updated for 3 working days', tone: 'needsYou' },
      ])
    );
    expect(detail?.checksTitle).toBe('Before completion');
    expect(detail?.checks.map((check) => check.text)).toEqual([
      'Tasks are not done',
      'Tag Blocked is set: remove it once it no longer applies',
    ]);
  });

  it('lists the broken rules of a finished work item and skips empty sections', () => {
    // Rule BOARD-19
    const done = workItem({
      state: 'Done',
      displayState: 'Done',
      alerts: [{ rule: 'tasksNotDone', message: 'Tasks are not done' } as WorkItemModel['alerts'][number]],
    });
    const detail = buildBoard(input({ workItems: [done] })).work.at(0)?.detail;
    expect(detail).toMatchObject({ checksTitle: 'Broken rules', pullRequests: [], tasks: undefined });
    expect(detail?.checks).toEqual([{ severity: 'broken', text: 'Tasks are not done' }]);
  });
});

describe('a work item with several open PRs (BOARD-20..23)', () => {
  const failed = run('failed', { tests: { total: 5, failed: 1, failedTests: [] } });
  const task = (id: number, state: string, extra: Partial<WorkItemModel> = {}): WorkItemModel =>
    workItem({
      id,
      title: `T${String(id)}`,
      type: 'Task',
      state,
      displayState: state,
      parentId: 1,
      branches: [],
      branch: undefined,
      ...extra,
    });
  const split = (): BoardInput =>
    input({
      workItems: [
        workItem({
          id: 1,
          pullRequests: [
            pr({ id: 11, title: '[1] Draft one', tone: 'draft', status: 'Draft' }),
            pr({ id: 12, title: 'Failing', runs: [failed] }),
            pr({ id: 13, title: 'Merged one', tone: 'completed', status: 'Completed', isActive: false }),
          ],
        }),
        task(21, 'To Do'),
        task(22, 'To Do'),
        task(23, 'In Progress'),
        task(24, 'In Progress', { taskBranches: [{ name: 'feature/t' } as never] }),
        task(25, 'Done'),
        workItem({ id: 2, pullRequests: [pr({ id: 30 })] }),
      ],
      myPullRequests: [mine({ id: 11, isDraft: true }), mine({ id: 12, runs: [failed] })],
    });

  it('keeps one card, as before, for 0 or 1 open PR (a merged one does not count)', () => {
    const board = buildBoard(
      input({
        workItems: [
          workItem({ id: 1 }),
          workItem({ id: 2, pullRequests: [pr({ id: 30 })] }),
          workItem({
            id: 3,
            pullRequests: [pr({ id: 31 }), pr({ id: 32, tone: 'completed', status: 'Completed', isActive: false })],
          }),
        ],
      })
    );
    expect(board.work.map((card) => [card.key, card.part, card.siblings])).toEqual([
      ['1', undefined, []],
      ['2', undefined, []],
      ['3', undefined, []],
    ]);
    expect(board.work[1].detail.pullRequestsTitle).toBeUndefined();
  });

  it('gives one card per open PR, the tasks to do and each task without a PR', () => {
    const board = buildBoard(split());
    const cards = board.work.filter((card) => card.id === 1);
    expect(cards.map((card) => [card.key, card.column, card.header, card.title])).toEqual([
      ['1:pr:11', 'branch', '#1 · PR 11', 'Draft one'],
      ['1:pr:12', 'ci', '#1 · PR 12', 'Failing'],
      ['1:task:23', 'branch', '#1', 'T23'],
      ['1:task:24', 'branch', '#1', 'T24'],
      ['1:tasks', 'toStart', '#1', 'Item'],
    ]);
    expect(cards[0].status?.text).toBe('Draft PR 11');
    expect(cards[0].action?.label).toBe('Publish');
    expect(cards[1].status?.text).toBe('1 test failed');
    expect(cards[2].status?.text).toBe('task In Progress · no branch');
    expect(cards[2].tag).toBe('no PR yet');
    expect(cards[3].status?.text).toBe('task In Progress · branch feature/t');
    expect(cards[4].tag).toBe('tasks');
    expect(cards[4].status?.text).toBe('2 tasks to do');
    expect(cards[4].note).toBe('T21 · T22');
    expect(cards.some((card) => card.column === 'done')).toBe(false);
  });

  it('counts cards, links siblings and explains the split in the drawer', () => {
    const board = buildBoard(split());
    const cards = board.work.filter((card) => card.id === 1);
    expect(board.columns.find((column) => column.id === 'branch')?.count).toBe(3);
    expect(cards[0].siblings).toEqual(['1:pr:12', '1:task:23', '1:task:24', '1:tasks']);
    expect(cards[0].split).toEqual({
      title: 'Why on 5 cards',
      text: '2 PRs open, 2 tasks in progress without a PR, 2 tasks to do. Done when all 5 tasks are.',
    });
    expect(cards[0].detail.pullRequestsTitle).toBe('Pull requests · 2 open · 1 merged');
    expect(cards[0].detail.pullRequests.map((row) => [row.id, row.followed])).toEqual([
      [11, true],
      [12, false],
    ]);
    expect(cards[0].detail.closedPullRequests).toEqual({ label: '1 merged', titles: 'Merged one' });
    expect(cards[1].detail.pullRequests.map((row) => row.followed)).toEqual([false, true]);
    // The single-PR work item has no split box
    expect(board.work.find((card) => card.id === 2)?.split).toBeUndefined();
  });

  it('points the current card at the PR of the Now queue row, else at the primary card', () => {
    const board = buildBoard(split());
    expect(board.work.filter((card) => card.current).map((card) => card.key)).toEqual(['1:pr:12']);
  });
});

describe('merged PR cards and the Completed setting (BOARD-24, BOARD-25)', () => {
  const NOW = new Date(2026, 9, 21, 12, 0);
  const sprint = [
    {
      name: 'Sprint 122',
      startDate: new Date(2026, 9, 12).toISOString(),
      finishDate: new Date(2026, 9, 23).toISOString(),
      progress: { text: '2 days left', hurry: false, tooltip: '' } as never,
    },
  ];
  const day = (d: number) => new Date(2026, 9, d, 12, 0).toISOString();
  const mergedPr = (id: number, title = `[7] Merged ${String(id)}`) =>
    pr({ id, title, tone: 'completed', status: 'Completed', isActive: false });
  const completed = [
    { id: 71, title: '[7] Merged 71', closedDate: day(14) },
    { id: 72, title: '[7] Merged 72', closedDate: day(16) },
    { id: 73, title: '[7] Before the sprint', closedDate: day(5) },
  ];
  const withMerged = (overrides: Partial<BoardInput> = {}): BoardInput =>
    input({
      iterations: sprint,
      now: NOW,
      completed,
      workItems: [
        workItem({
          id: 7,
          state: 'Active',
          displayState: 'Active',
          pullRequests: [
            mergedPr(71),
            mergedPr(72),
            mergedPr(73),
            pr({ id: 74, tone: 'abandoned', status: 'Abandoned' }),
          ],
        }),
      ],
      ...overrides,
    });

  it('draws a faded Done card for each PR merged in the sprint, most recent first, never abandoned ones', () => {
    const board = buildBoard(withMerged());
    const cards = board.work.filter((card) => card.merged);
    expect(cards.map((card) => card.merged?.prId)).toEqual([72, 71]);
    expect(cards[0]).toMatchObject({
      key: '7:merged:72',
      header: '#7 · ✓ PR 72',
      title: 'Merged 72',
      column: 'done',
      tone: 'done',
      primary: false,
      action: undefined,
      status: { text: expect.stringMatching(/^merged /) as string, tone: 'passed' },
    });
    // The drawer shows this PR: it passed every station
    expect(cards[0].track.every((station) => station.state === 'done')).toBe(true);
    // They are part of the family of the work item (BOARD-14) and count in the column
    const main = board.work.find((card) => card.id === 7 && !card.merged);
    expect(main?.siblings).toEqual(['7:merged:72', '7:merged:71']);
    expect(board.columns.find((column) => column.id === 'done')?.count).toBe(3);
  });

  it('uses the last 14 days when the dates of the sprint are not known', () => {
    const board = buildBoard(
      withMerged({ iterations: [], completed: [...completed, { id: 73, title: 'x', closedDate: day(5) }] })
    );
    expect(board.work.filter((card) => card.merged).map((card) => card.merged?.prId)).toEqual([72, 71]);
    const older = buildBoard(withMerged({ iterations: [], now: new Date(2026, 10, 10) }));
    expect(older.work.some((card) => card.merged)).toBe(false);
  });

  it('has no merged card for a finished work item (its card is in Done) nor when hidden', () => {
    const finished = buildBoard(
      withMerged({
        workItems: [workItem({ id: 7, state: 'Done', displayState: 'Done', pullRequests: [mergedPr(71)] })],
      })
    );
    expect(finished.work.map((card) => card.key)).toEqual(['7']);
    const hidden = buildBoard(withMerged({ showCompleted: false }));
    expect(hidden.work.map((card) => card.key)).toEqual(['7']);
    expect(hidden.work.some((card) => card.merged)).toBe(false);
    const folded = buildBoard(
      withMerged({
        showCompleted: false,
        workItems: [workItem({ id: 7, state: 'Done', displayState: 'Done', pullRequests: [mergedPr(71)] })],
      })
    );
    expect(folded.work).toEqual([]);
    expect(folded.summary.ids).toEqual([7]);
  });

  it('adds the merged cards to the count of cards of a split work item', () => {
    const board = buildBoard(
      withMerged({
        workItems: [
          workItem({
            id: 7,
            state: 'Active',
            displayState: 'Active',
            pullRequests: [pr({ id: 75 }), pr({ id: 76 }), mergedPr(71)],
          }),
        ],
      })
    );
    expect(board.work.filter((card) => card.id === 7)).toHaveLength(3);
    expect(board.work.find((card) => card.part === 'pr')?.split?.title).toBe('Why on 3 cards');
  });
});
