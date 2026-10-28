import { describe, expect, it } from 'vitest';
import type { BaseBranchRun } from './baseBranchHealth';
import type { MyPullRequestModel } from './myPullRequests';
import type { CompletedPullRequestInfo } from './completedPullRequests';
import type { HistoryView } from './prHistoryCache';
import type { ThreadResponse } from './reviewThreads';
import type { ReviewRequestModel } from './reviewRequests';
import {
  axisPosition,
  buildAxis,
  buildSprintTimeline,
  developSpans,
  historyRefsOf,
  needsYouSince,
  readySince,
  withAsleep,
  type TimelineInput,
  type TimelineRow,
} from './sprintTimelineModel';
import { buildBoard, type BoardInput } from './trackBoardModel';
import type { PullRequestModel, WorkItemModel } from './viewModel';

const WORKING = [1, 2, 3, 4, 5];
/** Local time: the axis is made of local days */
const at = (day: number, hour = 12, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();
const iso = (day: number, hour = 12, minute = 0): string => new Date(at(day, hour, minute)).toISOString();
const NOW = new Date(2026, 9, 22, 14, 0);

describe('axis (TIMELINE-2)', () => {
  const days = buildAxis('2026-10-12', '2026-10-23', WORKING, NOW);

  it('has the working days of the sprint, separators at the weeks and today marked', () => {
    expect(days.map((day) => day.label)).toEqual([
      'Mo 12',
      'Tu 13',
      'We 14',
      'Th 15',
      'Fr 16',
      'Mo 19',
      'Tu 20',
      'We 21',
      'Th 22',
      'Fr 23',
    ]);
    expect(days.filter((day) => day.weekStart).map((day) => day.date)).toEqual(['2026-10-19']);
    expect(days.find((day) => day.today)?.date).toBe('2026-10-22');
    expect(days.at(-1)?.last).toBe(true);
  });

  it('skips the days off of the setting', () => {
    expect(buildAxis('2026-10-12', '2026-10-16', [1, 2, 3], NOW).map((day) => day.label)).toEqual([
      'Mo 12',
      'Tu 13',
      'We 14',
    ]);
  });

  it('puts a moment by day, and one on a day off at the start of the next working day', () => {
    expect(axisPosition(at(12, 0), days)).toBe(0);
    expect(axisPosition(at(13, 12), days)).toBeCloseTo(1.5);
    // Saturday 17th: the start of Monday 19th
    expect(axisPosition(at(17, 10), days)).toBe(5);
    expect(axisPosition(at(1, 10), days)).toBe(0);
    expect(axisPosition(at(30, 10), days)).toBe(days.length);
  });

  it('adds the working days of the margin after the sprint, marked (TIMELINE-31)', () => {
    const wide = buildAxis('2026-10-12', '2026-10-23', WORKING, NOW, 2);
    expect(wide).toHaveLength(12);
    expect(wide.filter((day) => day.after).map((day) => day.label)).toEqual(['Mo 26', 'Tu 27']);
    expect(wide.filter((day) => day.last).map((day) => day.label)).toEqual(['Fr 23']);
  });
});

describe('the moments behind needs you and ready (TIMELINE-16)', () => {
  const stamps = {
    createdAt: iso(16),
    sentBackAt: iso(20, 11),
    lastVoteAt: iso(21, 8),
    lastPushAt: iso(21, 18),
  };
  const runs = [
    { state: 'failed' as const, finishTime: iso(20, 9) },
    { state: 'failed' as const, finishTime: iso(21, 9) },
    { state: 'succeeded' as const, finishTime: iso(21, 12) },
  ];

  it('is the finish of the latest failed run in CI, the vote that sent it back in review', () => {
    expect(needsYouSince('ci', runs, stamps)).toBe(at(21, 9));
    expect(needsYouSince('review', runs, stamps)).toBe(at(20, 11));
  });

  it('falls back to the last push, and to nothing', () => {
    expect(needsYouSince('review', [], { ...stamps, sentBackAt: undefined })).toBe(at(21, 18));
    expect(needsYouSince('ci', [], undefined)).toBeUndefined();
  });

  it('is ready since the latest vote or green run', () => {
    expect(readySince(runs, stamps)).toBe(at(21, 12));
    expect(readySince([], undefined)).toBeUndefined();
  });
});

describe('withAsleep (TIMELINE-8)', () => {
  it('replaces what the period without update covers with the zZ span', () => {
    const spans = [
      { kind: 'branch' as const, start: at(14, 9), end: at(15, 10) },
      { kind: 'pullRequest' as const, start: at(15, 10), end: at(22, 14) },
    ];
    const asleep = withAsleep(spans, at(19, 9), at(22, 14), 'zZ no update for 3 working days');
    expect(asleep.map((span) => [span.kind, span.start, span.end])).toEqual([
      ['branch', at(14, 9), at(15, 10)],
      ['pullRequest', at(15, 10), at(19, 9)],
      ['asleep', at(19, 9), at(22, 14)],
    ]);
  });
});

describe('developSpans (TIMELINE-12)', () => {
  const run = (definitionId: number, red: boolean, day: number, hour: number): BaseBranchRun => ({
    buildId: day * 100 + hour,
    definitionId,
    pipeline: `P${String(definitionId)}`,
    red,
    finishTime: iso(day, hour),
  });

  it('is red while the latest run of any pipeline is red', () => {
    const spans = developSpans(
      [run(1, false, 19, 9), run(2, false, 19, 10), run(1, true, 20, 9), run(1, false, 20, 12), run(2, true, 21, 9)],
      at(22, 9)
    );
    expect(spans.map((span) => [span.red, span.start, span.end])).toEqual([
      [false, at(19, 9), at(20, 9)],
      [true, at(20, 9), at(20, 12)],
      [false, at(20, 12), at(21, 9)],
      [true, at(21, 9), at(22, 9)],
    ]);
  });

  it('has nothing without runs', () => {
    expect(developSpans([], at(22, 9))).toEqual([]);
  });
});

/* ---------- The whole timeline ---------- */

const branch = { name: 'feature/x/1-a', location: 'local' as const, isCurrent: false, otherRepository: false };

function pullRequest(overrides: Partial<PullRequestModel> = {}): PullRequestModel {
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
    time: '1 d',
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
    stamps: { createdAt: iso(16, 10), publishedAt: iso(16, 15) },
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
    publishedAt: iso(21, 10),
    isRequired: true,
    urgency: 'fresh',
    timeLeft: '10 h left',
    waited: '14 h',
    elapsed: 0.5,
    dueText: 'due Fri 10:00',
    barCaption: '14 h of 24 h',
    barValueText: '',
    waitedHours: 14,
    ...overrides,
  };
}

function timeline(
  items: WorkItemModel[],
  mineModels: MyPullRequestModel[] = [],
  reviews: ReviewRequestModel[] = [],
  overrides: Partial<TimelineInput> = {},
  boardOverrides: Partial<BoardInput> = {}
) {
  const board = buildBoard({
    status: 'ready',
    workItems: items,
    myPullRequests: mineModels,
    reviews,
    reviewsStatus: 'ready',
    maxWaitHours: 24,
    iterations: [],
    kinds: ['backlog', 'bug'],
    showCompleted: true,
    completed: overrides.completedPullRequests,
    now: NOW,
    look: 'theme',
    popoverDelay: 500,
    ...boardOverrides,
  });
  return buildSprintTimeline({
    now: NOW,
    workingDays: WORKING,
    maxWaitHours: 24,
    board,
    workItems: items,
    myPullRequests: mineModels,
    reviews,
    sprint: { name: 'Platform Sprint 122', startDate: '2026-10-12T00:00:00Z', finishDate: '2026-10-23T00:00:00Z' },
    base: { branch: 'develop', enabled: true, runs: [] },
    ...overrides,
  });
}

describe('buildSprintTimeline', () => {
  it('has one row per work item, in the order of the board, whatever the number of its PRs (TIMELINE-1)', () => {
    const items = [
      workItem({ id: 1, pullRequests: [pullRequest({ id: 10 })] }),
      workItem({ id: 2, state: 'New', displayState: 'New', branches: [], branch: undefined }),
      workItem({ id: 3, pullRequests: [pullRequest({ id: 31 }), pullRequest({ id: 32 })] }),
    ];
    const model = timeline(items, [mine({ id: 10 }), mine({ id: 31 }), mine({ id: 32 })]);
    expect(model.work.map((row) => row.id)).toEqual([1, 2, 3]);
    expect(model.work.every((row) => row.expandable)).toBe(true);
    // The row of a work item with several PRs has the key of the card of the PR the track follows
    expect(model.work[2].key).toBe('3:pr:31');
  });

  it('draws a work item not started as a dashed outline with its blockers (TIMELINE-9)', () => {
    const row = timeline([
      workItem({
        id: 43751,
        type: 'Bug',
        state: 'New',
        displayState: 'New',
        branches: [],
        branch: undefined,
        blockingTags: ['Blocked'],
        openPredecessors: [{ id: 63290, title: 'x', state: 'Active' } as never],
      }),
    ]).work[0];
    expect(row.segments).toEqual([]);
    expect(row.outline).toMatchObject({ broken: true });
    expect(row.outline?.text).toContain('not started');
    expect(row.outline?.text).toContain('tag Blocked');
    expect(row.outline?.text).toContain('#63290');
  });

  it('puts the NOW line at the time and has one column per working day (TIMELINE-13)', () => {
    const model = timeline([workItem({ pullRequests: [pullRequest()], dates: { activated: iso(14, 9) } })], [mine()]);
    expect(model.now).toBeCloseTo(8 + 14 / 24);
    expect(model.days).toHaveLength(12);
    expect(model.sprintEnd).toBe(10);
    expect(model.over).toBe(false);
  });

  it('keeps open bars running past the end of the sprint, faded, with the text at the end (TIMELINE-31)', () => {
    const later = new Date(2026, 9, 26, 15);
    const model = timeline(
      [workItem({ pullRequests: [pullRequest()], dates: { activated: iso(14, 9) } })],
      [mine()],
      [],
      {
        now: later,
      }
    );
    expect(model.now).toBeCloseTo(10 + 15 / 24);
    expect(model.over).toBe(true);
    const [row] = model.work;
    const after = row.segments.filter((segment) => segment.after);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((segment) => segment.start >= 10 && segment.text === undefined)).toBe(true);
    expect(row.segments.filter((segment) => !segment.after).every((segment) => segment.end <= 10)).toBe(true);
    expect(row.end).toBe(10);
  });

  it('has no NOW line once the margin is over too (TIMELINE-13)', () => {
    expect(timeline([], [], [], { now: new Date(2026, 9, 29, 10) }).now).toBeUndefined();
  });

  it('makes the zZ span clickable with the ASLEEP popover and its buttons (TIMELINE-8)', () => {
    const model = timeline(
      [
        workItem({
          state: 'Active',
          displayState: 'Active',
          notUpdated: { days: 3, text: 'Not updated for 3 working days' },
          dates: { changed: iso(19, 9) },
          pullRequests: [pullRequest({ tone: 'draft', status: 'Draft' })],
        }),
      ],
      [mine({ isDraft: true, stamps: { createdAt: iso(15, 10) } })]
    );
    const [row] = model.work;
    expect(row.segments.at(-1)).toMatchObject({ kind: 'asleep', text: 'zZ no update for 3 working days' });
    expect(row.popover?.title).toBe('ASLEEP · #1');
    expect(row.popover?.actions.map((action) => action.label)).toEqual([
      'Publish draft',
      'Update tasks',
      'Open on board',
    ]);
    expect(row.popover?.actions[2].message).toEqual({ type: 'openBoard', key: '1' });
  });

  it('draws the reviews owed, overdue in red and due soon with the time left (TIMELINE-11)', () => {
    const model = timeline(
      [],
      [],
      [
        review({ id: 11, publishedAt: iso(20, 10), urgency: 'overdue', timeLeft: 'overdue by 3 h' }),
        review({ id: 12, publishedAt: iso(22, 8), urgency: 'dueSoon', timeLeft: '5 h left', dueText: 'due Fri 08:00' }),
        review({ id: 13, publishedAt: iso(22, 10), urgency: 'fresh' }),
      ]
    );
    const [overdue, soon, fresh] = model.reviews;
    expect(overdue.segments.map((segment) => segment.kind)).toEqual(['wait', 'overdue']);
    expect(overdue.note).toEqual({ text: 'overdue 3 h', tone: 'overdue' });
    expect(soon.segments.at(-1)?.dashed).toBe(true);
    expect(soon.note?.text).toBe('due Fri 08:00 · 5 h left');
    expect(fresh.segments.some((segment) => segment.kind === 'overdue')).toBe(false);
    expect(model.reviewsTitle).toBe('REVIEWS YOU OWE · 24 WORKING HOURS FROM PUBLISH');
  });

  it('draws the base branch and tells how long it has been broken (TIMELINE-12)', () => {
    const runs: BaseBranchRun[] = [
      { buildId: 1, definitionId: 1, pipeline: 'CI', red: false, finishTime: iso(19, 9) },
      { buildId: 2, definitionId: 1, pipeline: 'CI', red: true, finishTime: iso(22, 13, 23), pullRequestId: 13889 },
    ];
    const model = timeline([], [], [], {
      base: {
        branch: 'develop',
        enabled: true,
        runs,
        health: {
          branch: 'develop',
          broken: [
            {
              definitionId: 1,
              pipeline: 'CI',
              run: { id: 2, pipeline: 'CI', state: 'failed', url: '' },
              brokenBy: { buildId: 2, url: '', finishTime: iso(22, 13, 23), pullRequestId: 13889 },
              fixRunning: false,
            },
          ],
        },
      },
    });
    expect(model.develop.spans.map((span) => span.red)).toEqual([false, true]);
    expect(model.develop.label?.text).toBe('broken 37 min · after PR 13889');
  });

  it('says so when the base branch alarm is off', () => {
    const model = timeline([], [], [], { base: { branch: 'develop', enabled: false, runs: [] } });
    expect(model.develop.note).toContain('off');
  });

  it('has no axis without the dates of the sprint', () => {
    const model = timeline([], [], [], { sprint: { name: 'S' } });
    expect(model.days).toEqual([]);
    expect(model.notes[0]).toContain('dates of the sprint');
  });
});

/* ---------- Rows by station (TIMELINE-1, TIMELINE-15, TIMELINE-16) ---------- */

const task = (id: number, parentId: number, state: string, overrides: Partial<WorkItemModel> = {}): WorkItemModel =>
  workItem({
    id,
    title: `Task ${String(id)}`,
    type: 'Task',
    state,
    displayState: state,
    parentId,
    branches: [],
    branch: undefined,
    ...overrides,
  });

const merged = (id: number, created: number, closed: number, extra: Partial<CompletedPullRequestInfo> = {}) =>
  ({
    id,
    title: `[67145] Merged ${String(id)}`,
    repository: 'User_Interface',
    repositoryId: 'r',
    creationDate: iso(created, 9),
    closedDate: iso(closed, 16),
    isDraft: false,
    publishedAt: iso(created, 11),
    threadsKnown: true,
    ...extra,
  } satisfies CompletedPullRequestInfo);

const COMPLETED = (id: number, title = `Merged ${String(id)}`): PullRequestModel =>
  pullRequest({ id, title, tone: 'completed', status: 'Completed', isActive: false });

const kinds = (row: Pick<TimelineRow, 'segments'> | undefined) => row?.segments.map((segment) => segment.kind);

describe('the row of a work item (TIMELINE-15, TIMELINE-16)', () => {
  it('starts the first line with the tag, the id and the state, and the second with the work item title', () => {
    const rows = timeline(
      [
        workItem({ id: 1, title: 'Backlog title', pullRequests: [pullRequest({ id: 10, title: 'PR title' })] }),
        workItem({ id: 2, title: 'Bug title', type: 'Bug', pullRequests: [pullRequest({ id: 20, tone: 'draft' })] }),
      ],
      [mine({ id: 10 }), mine({ id: 20, isDraft: true })]
    ).work;
    expect(rows[0].label).toEqual({ tag: { text: 'PBI', tone: 'pbi' }, id: '#1', state: 'Committed' });
    expect(rows[0].title).toBe('Backlog title');
    expect(rows[1].label).toEqual({ tag: { text: 'BUG', tone: 'bug' }, id: '#2', state: 'Committed' });
  });

  it('counts the PRs in the state when there are several', () => {
    const row = timeline(
      [workItem({ id: 3, pullRequests: [pullRequest({ id: 31 }), pullRequest({ id: 32 }), COMPLETED(30)] })],
      [mine({ id: 31 }), mine({ id: 32 })],
      [],
      { completedPullRequests: [merged(30, 13, 15)] }
    ).work[0];
    expect(row.label?.state).toBe('Committed · 3 PRs');
  });

  it('puts the pill on the reviews owed', () => {
    const row = timeline([], [], [review({ id: 50 })]).reviews[0];
    expect(row.label).toEqual({ pr: { text: 'PR 50' }, meta: 'Ana · required' });
  });

  it('goes Branch, Pull request (draft) and Review for a PR with its dates; the last one says how the review is', () => {
    const model = timeline(
      [
        workItem({
          pullRequests: [pullRequest({ runs: [{ id: 1, pipeline: 'CI', state: 'succeeded', url: '' }] })],
          dates: { activated: iso(14, 9) },
        }),
      ],
      [mine({ reviewers: [{ name: 'Ana Ruiz', vote: 'none', isRequired: true, isContainer: false }] })]
    );
    const [row] = model.work;
    expect(kinds(row)).toEqual(['branch', 'pullRequest', 'review']);
    expect(row.segments[2].text).toContain('waiting for Ana');
    expect(row.segments[0]).toMatchObject({ text: 'Branch', start: 2 + 9 / 24 });
    // Without the history of the PR the review is drawn as a guess (CI before now is part of it)
    expect(row.segments[2].approximate).toBe(true);
    expect(row.children?.map((child) => child.kind)).toEqual(['pr']);
  });

  it('turns amber from the moment the station needed the user, with the reason (TIMELINE-16)', () => {
    const failed = { id: 1, pipeline: 'CI', state: 'failed' as const, url: '', finishTime: iso(20, 11) };
    const model = timeline(
      [workItem({ pullRequests: [pullRequest({ runs: [failed] })], dates: { activated: iso(14, 9) } })],
      [mine({ runs: [failed] })]
    );
    const [row] = model.work;
    expect(row.segments.at(-1)).toMatchObject({ kind: 'needsYou' });
    expect(row.segments.at(-1)?.text).toBe('needs you · CI failed');
    expect(row.segments.at(-1)?.start).toBeCloseTo(6 + 11 / 24);
    expect(row.defaultExpanded).toBe(true);
  });

  it('turns green when the PR is ready to be merged, with the button of the board (TIMELINE-16)', () => {
    const model = timeline(
      [workItem({ pullRequests: [pullRequest({ id: 10 })], dates: { activated: iso(14, 9) } })],
      [
        mine({
          id: 10,
          readyToMerge: true,
          canComplete: true,
          stamps: { createdAt: iso(16, 10), publishedAt: iso(16, 15), lastVoteAt: iso(20, 11) },
        }),
      ]
    );
    const [row] = model.work;
    expect(row.segments.at(-1)).toMatchObject({ kind: 'ready', text: 'ready to be merged' });
    expect(row.action).toMatchObject({ label: 'Complete…', primary: true });
    expect(row.defaultExpanded).toBe(true);
  });

  it('draws the Branch of a work item with no PR from the activation of the work item, approximate', () => {
    const row = timeline([workItem({ dates: { activated: iso(15, 9) } })]).work[0];
    expect(row.segments).toHaveLength(1);
    expect(row.segments[0]).toMatchObject({ kind: 'branch', approximate: true });
  });

  it('draws a finished work item faded, ending at its merge, with its mark', () => {
    const rows = timeline(
      [
        workItem({
          id: 8,
          state: 'Done',
          displayState: 'Done',
          dates: { activated: iso(13, 9), stateChanged: iso(16, 17) },
          pullRequests: [COMPLETED(80)],
        }),
      ],
      [],
      [],
      { completedPullRequests: [merged(80, 14, 16)] }
    );
    expect(rows.work).toEqual([]);
    const [row] = rows.finished;
    expect(row).toMatchObject({ faded: true, merged: { text: '✓ done Fr 16' } });
    // The two hours of draft are too short to see (TIMELINE-30): the bar before absorbs them
    expect(kinds(row)).toEqual(['branch', 'review']);
    expect(row.defaultExpanded).toBe(false);
  });

  it('marks a finished Bug "Ready to Test", the station developers finish it at (TRACK-7)', () => {
    const bug = workItem({
      id: 7,
      type: 'Bug',
      state: 'Ready to Test',
      displayState: 'Ready to Test',
      dates: { stateChanged: iso(20, 17) },
    });
    expect(timeline([bug]).finished[0].merged?.text).toBe('✓ Ready to Test Tu 20');
  });

  it('puts the finished work items after the open ones, in their own list, and hides them without Completed', () => {
    const done = workItem({ id: 2, state: 'Done', displayState: 'Done', dates: { stateChanged: iso(16, 17) } });
    const open = workItem({ id: 1, pullRequests: [pullRequest({ id: 10 })] });
    const model = timeline([done, open], [mine({ id: 10 })]);
    expect(model.work.map((row) => row.id)).toEqual([1]);
    expect(model.finished.map((row) => row.id)).toEqual([2]);
  });

  it('goes back to Branch when a PR was merged and a task is still open (TRACK-7)', () => {
    const model = timeline(
      [workItem({ id: 9, dates: { activated: iso(13, 9) }, pullRequests: [COMPLETED(90)] }), task(91, 9, 'To Do')],
      [],
      [],
      { completedPullRequests: [merged(90, 14, 16)] }
    );
    const [row] = model.work;
    expect(kinds(row)).toEqual(['branch', 'review', 'branch']);
    expect(row.segments.at(-1)?.end).toBeGreaterThan(row.segments[2].end - 0.001);
  });
});

describe('the work item with several PRs (TIMELINE-16, TIMELINE-17)', () => {
  const items67145 = (): WorkItemModel[] => [
    workItem({
      id: 67145,
      title: 'App configuration updated by another user',
      dates: { activated: iso(13, 9) },
      pullRequests: [
        pullRequest({
          id: 14021,
          title: '[67145] Measurement update',
          runs: [{ id: 1, pipeline: 'CI', state: 'failed', url: '', finishTime: iso(21, 10) }],
        }),
        pullRequest({ id: 14012, title: '[67145] AL update' }),
        pullRequest({ id: 14008, title: '[67145] Nx config update' }),
        COMPLETED(13801, '[67145] PID update'),
        COMPLETED(13802, '[67145] C&E update'),
        COMPLETED(13803, '[67145] Merged before the sprint'),
      ],
    }),
    task(67150, 67145, 'Done', { taskPullRequests: [{ id: 13801 } as never] }),
    task(67160, 67145, 'In Progress', { taskPullRequests: [{ id: 14008 } as never], dates: { activated: iso(15, 9) } }),
    task(67163, 67145, 'In Progress', { taskPullRequests: [{ id: 14021 } as never], dates: { activated: iso(19, 9) } }),
    task(67166, 67145, 'In Progress', { canCreatePullRequest: true, dates: { activated: iso(21, 9) } }),
    task(67170, 67145, 'To Do'),
    task(67171, 67145, 'To Do'),
  ];
  const created: Record<number, [number, number]> = { 14021: [19, 10], 14012: [14, 9], 14008: [15, 9] };
  const mineOf = Object.entries(created).map(([id, [day, hour]]) =>
    mine({
      id: Number(id),
      stamps: { createdAt: iso(day, hour), publishedAt: iso(day, hour + 2) },
      runs: Number(id) === 14021 ? [{ id: 1, pipeline: 'CI', state: 'failed', url: '', finishTime: iso(21, 10) }] : [],
    })
  );
  const completed = [merged(13801, 13, 16), merged(13802, 18, 21), merged(13803, 1, 5)];
  const build = (overrides: Partial<TimelineInput> = {}) =>
    timeline(items67145(), mineOf, [], { completedPullRequests: completed, ...overrides });

  it('is one row with no button of its own: needs you wins over the PRs that are less advanced', () => {
    const model = build();
    expect(model.work.map((row) => row.id)).toEqual([67145]);
    const [row] = model.work;
    expect(row.segments.at(-1)).toMatchObject({ kind: 'needsYou', text: 'needs you · CI failed in PR 14021' });
    expect(row.action).toBeUndefined();
    expect(row.defaultExpanded).toBe(true);
  });

  it('puts the PRs under it, oldest first, the merged ones within the axis among them, then the tasks (TIMELINE-18)', () => {
    const [row] = build().work;
    expect(row.children?.map((child) => child.key)).toEqual([
      'pr:67145:13801',
      'pr:67145:14012',
      'pr:67145:14008',
      'pr:67145:13802',
      'pr:67145:14021',
      'task:67145:67166',
      'tasks:67145',
    ]);
  });

  it('does not draw the PR merged before the sprint, but counts it', () => {
    const [row] = build().work;
    expect(row.children?.some((child) => child.key === 'pr:67145:13803')).toBe(false);
    expect(row.label?.state).toBe('Committed · 6 PRs');
  });

  it('gives each PR its pill, its title without the [id] prefix and its linked task (TIMELINE-17)', () => {
    const children = build().work[0].children ?? [];
    const pr = (id: number) => children.find((child) => child.kind === 'pr' && child.prId === id);
    expect(pr(14021)).toMatchObject({ pill: { text: 'PR 14021' }, title: 'Measurement update' });
    expect(pr(14021)).toMatchObject({ sub: 'Task 67163 · Task 67163 · In Progress' });
    expect(pr(14012)).toMatchObject({ sub: 'no linked task' });
    expect(pr(13801)).toMatchObject({ pill: { text: 'PR 13801', merged: true }, merged: { text: '✓ merged Fr 16' } });
  });

  it('draws each PR with its own phases: implementation, draft, review; merged ones have no button (TIMELINE-17)', () => {
    const children = build().work[0].children ?? [];
    const pr = (id: number) => {
      const child = children.find((candidate) => candidate.kind === 'pr' && candidate.prId === id);
      return child?.kind === 'pr' ? child : undefined;
    };
    expect(pr(14021)?.segments.map((segment) => segment.kind)).toEqual(['implementation', 'review']);
    expect(pr(13801)?.action).toBeUndefined();
    // Several PRs: the buttons are on their rows (Show tests on the one whose CI failed)
    expect(pr(14021)?.action).toMatchObject({ label: 'Show tests' });
    expect(pr(14012)?.action).toBeUndefined();
  });

  it('has a row for the task in progress without PR, with Create PR only when the sidebar offers it', () => {
    const row = (model: ReturnType<typeof build>) => model.work[0].children?.find((child) => child.kind === 'task');
    expect(row(build())).toMatchObject({
      title: 'Task 67166',
      sub: 'In Progress since We 21 · no PR',
      action: { label: 'Create PR', message: { type: 'createPullRequest', id: 67145, taskId: 67166 } },
    });
    const without = items67145().map((item) => (item.id === 67166 ? { ...item, canCreatePullRequest: false } : item));
    const model = timeline(without, mineOf, [], { completedPullRequests: completed });
    expect(row(model)).toMatchObject({ title: 'Task 67166' });
    expect(row(model)).not.toHaveProperty('action');
  });

  it('has one compact row for the tasks still to do', () => {
    const tasks = build().work[0].children?.find((child) => child.kind === 'tasks');
    expect(tasks).toMatchObject({ title: '2 tasks to do', sub: 'Task 67170 · Task 67171' });
  });
});

describe('a work item with nothing under it (TIMELINE-18)', () => {
  it('says so with a placeholder', () => {
    const [row] = timeline([
      workItem({ id: 5, state: 'New', displayState: 'New', branches: [], branch: undefined }),
    ]).work;
    expect(row.children).toEqual([expect.objectContaining({ kind: 'placeholder', text: 'No PRs or tasks yet' })]);
    expect(row.defaultExpanded).toBe(false);
  });

  it('has a row for its tasks when it has some but no PR', () => {
    const [row] = timeline([workItem({ id: 5, dates: { activated: iso(15, 9) } }), task(51, 5, 'To Do')]).work;
    expect(row.children?.map((child) => child.kind)).toEqual(['tasks']);
  });

  it('does not start expanded when it needs the user but has nothing under it but the placeholder', () => {
    const [row] = timeline([
      workItem({
        id: 43751,
        type: 'Bug',
        state: 'New',
        displayState: 'New',
        branches: [],
        branch: undefined,
        blockingTags: ['Blocked'],
      }),
    ]).work;
    expect(row.defaultExpanded).toBe(false);
  });

  it('is not expanded by default when it does not need the user', () => {
    const [row] = timeline([workItem({ pullRequests: [pullRequest()] })], [mine()]).work;
    expect(row.defaultExpanded).toBe(false);
  });

  it('keeps the rows of other people collapsed by default, with the same children (TEAM-8)', () => {
    // The default expansion is the user's own rows: it is set only when the row has no `team` context
    const [row] = timeline([workItem({ pullRequests: [pullRequest()] })], [mine()]).work;
    expect(row.readOnly).toBeUndefined();
  });
});

describe('the history of the PRs of a row (TIMELINE-28, TIMELINE-29)', () => {
  const published = (when: string): ThreadResponse => ({
    id: 1,
    publishedDate: when,
    properties: { CodeReviewThreadType: { $value: 'IsDraftUpdate' }, CodeReviewIsDraftNowSet: { $value: '0' } },
    comments: [{ id: 1, author: { id: 'x', displayName: 'X' }, content: 'p', commentType: 'system' }],
  });
  const vote = (when: string, voter: string, result: string): ThreadResponse => ({
    id: 2,
    publishedDate: when,
    properties: {
      CodeReviewThreadType: { $value: 'VoteUpdate' },
      CodeReviewVoteResult: { $value: result },
      CodeReviewVotedByIdentity: { $value: '1' },
    },
    identities: { '1': { id: voter, displayName: voter } },
    comments: [
      { id: 1, author: { id: 'x', displayName: 'X' }, content: `${voter} voted ${result}`, commentType: 'system' },
    ],
  });
  const green = { id: 1, pipeline: 'CI', state: 'succeeded' as const, url: '' };
  const items = [
    workItem({ id: 1, dates: { activated: iso(14, 9) }, pullRequests: [pullRequest({ id: 10, runs: [green] })] }),
  ];
  const prs = [
    mine({
      id: 10,
      repositoryId: 'repo',
      commit: 'c1',
      runs: [green],
      readyToMerge: true,
      canComplete: true,
      stamps: { createdAt: iso(16, 10), publishedAt: iso(16, 15) },
      reviewers: [{ name: 'Ana Ruiz', vote: 'approved', isRequired: true, isContainer: false }],
    }),
  ];
  const withHistory = (view: HistoryView) => timeline(items, prs, [], { history: new Map([[10, view]]) });
  const child = (model: ReturnType<typeof timeline>) => {
    const found = model.work[0].children?.find((candidate) => candidate.kind === 'pr');
    return found?.kind === 'pr' ? found : undefined;
  };

  it('is idle for a collapsed row and says what the panel needs to read it', () => {
    const model = timeline(items, prs);
    expect(child(model)?.history).toBe('idle');
    expect(child(model)?.historyRef).toEqual({
      id: 10,
      repositoryId: 'repo',
      closed: false,
      commit: 'c1',
      state: 'Ana Ruiz:approved',
    });
  });

  it('only asks for the PRs of the rows that are expanded, once each', () => {
    const model = timeline(items, prs);
    expect(historyRefsOf(model, new Set())).toEqual([]);
    expect(historyRefsOf(model, new Set([1])).map((ref) => ref.id)).toEqual([10]);
    expect(historyRefsOf(model, new Set([2]))).toEqual([]);
  });

  it('shows the loading state of a PR whose history is being read', () => {
    expect(child(withHistory({ state: 'loading' }))?.history).toBe('loading');
    expect(child(withHistory({ state: 'error' }))?.history).toBe('error');
  });

  it('refines the row once the history arrives: the CI and the votes are no longer a guess (TIMELINE-28)', () => {
    const before = timeline(items, prs).work[0];
    expect(before.segments.at(-1)?.approximate).toBe(true);
    const after = withHistory({
      state: 'ready',
      threads: [published(iso(16, 15)), vote(iso(19, 10), 'Ana Ruiz', '10')],
      runs: [
        { id: 1, pipeline: 'CI', state: 'succeeded', url: '', startTime: iso(16, 15, 1), finishTime: iso(16, 16) },
      ],
    }).work[0];
    // The hour of CI is too short to see (TIMELINE-30): the draft bar absorbs it, its time stays in the tooltip
    expect(kinds(after)).toEqual(['branch', 'pullRequest', 'review', 'ready']);
    expect(after.segments[1].tip).toContain('CI');
    // What is left of a guess is the start of the work, which comes from the work item
    expect(after.segments.filter((segment) => segment.approximate).map((segment) => segment.kind)).toEqual(['branch']);
    const pr = after.children?.find((candidate) => candidate.kind === 'pr');
    expect(pr?.kind === 'pr' && pr.markers.map((marker) => marker.kind)).toEqual(['ci', 'approve']);
  });

  it('has the events of the threads along the row of the PR with a tooltip (TIMELINE-27)', () => {
    const view: HistoryView = {
      state: 'ready',
      threads: [published(iso(16, 15)), vote(iso(19, 10), 'Ana Ruiz', '-5')],
      runs: [],
    };
    const pr = child(withHistory(view));
    const wait = pr?.markers.find((marker) => marker.kind === 'wait');
    expect(wait?.text).toBe('AR');
    expect(wait?.tip.title).toBe('WAITS FOR THE AUTHOR · PR 10');
    expect(wait?.at).toBeCloseTo(5 + 10 / 24);
  });

  it('draws a conflicts mark at now for an open PR that has them', () => {
    const conflicted = timeline(items, [{ ...prs[0], conflicts: true }]);
    const marker = child(conflicted)?.markers.find((candidate) => candidate.kind === 'conflicts');
    expect(marker?.at).toBeCloseTo(8 + 14 / 24);
  });
});

describe('when the implementation starts, on the row of a PR (TIMELINE-20)', () => {
  const prs = [pullRequest({ id: 71 }), pullRequest({ id: 72 })];
  const created = (id: number, day: number) =>
    mine({ id, stamps: { createdAt: iso(day, 10), publishedAt: iso(day, 11) } });
  const items = [
    workItem({ id: 7, dates: { activated: iso(12, 9) }, pullRequests: prs }),
    task(701, 7, 'In Progress', { dates: { activated: iso(14, 9) }, taskPullRequests: [{ id: 71 } as never] }),
  ];
  const build = (
    codingStart: 'earliest' | 'firstCommit' | 'taskActivated',
    firstCommits: [number, string][] = [
      [71, iso(13, 15)],
      [72, iso(19, 9)],
    ]
  ) => timeline(items, [created(71, 16), created(72, 20)], [], { codingStart, firstCommits: new Map(firstCommits) });
  const implementation = (model: ReturnType<typeof build>, prId: number) => {
    const child = model.work[0].children?.find((candidate) => candidate.kind === 'pr' && candidate.prId === prId);
    return child?.kind === 'pr' ? child.segments.find((segment) => segment.kind === 'implementation') : undefined;
  };

  it('draws the implementation of each PR from its own source (earliest)', () => {
    const model = build('earliest');
    // PR 71: the first commit (Tu 13) is earlier than the task (We 14); PR 72: no task, the commit (Mo 19)
    expect(implementation(model, 71)?.tip).toContain('implementation since the first commit, Tu 13');
    expect(implementation(model, 72)?.tip).toContain('implementation since the first commit, Mo 19');
  });

  it('takes the task when it is earlier than the first commit', () => {
    const model = build('earliest', [[71, iso(15, 9)]]);
    expect(implementation(model, 71)?.tip).toContain('implementation since task 701 was activated, We 14');
  });

  it('firstCommit prefers the commit and falls back to the task; taskActivated the reverse and reads no commits', () => {
    expect(implementation(build('firstCommit', [[71, iso(15, 9)]]), 71)?.tip).toContain('the first commit, Th 15');
    expect(implementation(build('firstCommit', []), 71)?.tip).toContain('task 701');
    const byTask = build('taskActivated');
    expect(implementation(byTask, 71)?.tip).toContain('task 701 was activated');
    expect(byTask.firstCommitsWanted).toEqual([]);
    expect(implementation(byTask, 72)?.tip).toContain('since the work item was activated, approximate');
    expect(implementation(byTask, 72)?.approximate).toBe(true);
  });

  it('asks the first commit of the PRs drawn that are not known, only when the setting reads commits', () => {
    expect(build('earliest', []).firstCommitsWanted.sort()).toEqual([71, 72]);
    expect(build('firstCommit', [[71, iso(13, 15)]]).firstCommitsWanted).toEqual([72]);
    expect(build('taskActivated', []).firstCommitsWanted).toEqual([]);
  });

  it('ignores a first commit after the creation of the PR', () => {
    const model = build('firstCommit', [[72, iso(21, 9)]]);
    expect(implementation(model, 72)?.tip).toContain('since the work item was activated, approximate');
  });

  it('starts the work item at the earliest implementation of its PRs', () => {
    const model = build('earliest');
    expect(model.work[0].segments[0]).toMatchObject({ kind: 'branch', start: 1 + 15 / 24 });
  });
});
