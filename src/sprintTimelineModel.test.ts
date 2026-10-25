import { describe, expect, it } from 'vitest';
import type { BaseBranchRun } from './baseBranchHealth';
import type { MyPullRequestModel } from './myPullRequests';
import type { CompletedPullRequestInfo } from './timelineGroups';
import type { ReviewRequestModel } from './reviewRequests';
import {
  axisPosition,
  buildAxis,
  buildSprintTimeline,
  developSpans,
  needsYouSince,
  nextIteration,
  readySince,
  withAsleep,
  workSpans,
  type PhaseInput,
  type TimelineInput,
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

  it('extends over the next sprint, whose days are marked', () => {
    const wide = buildAxis('2026-10-12', '2026-10-23', WORKING, NOW, { start: '2026-10-26', finish: '2026-11-06' });
    expect(wide).toHaveLength(20);
    expect(wide.filter((day) => day.next)).toHaveLength(10);
    expect(wide.filter((day) => day.last)).toHaveLength(1);
  });
});

describe('nextIteration (TIMELINE-10)', () => {
  const schedule = [
    {
      path: 'P\\R\\Platform Sprint 122',
      name: 'Platform Sprint 122',
      start: '2026-10-12T00:00:00Z',
      finish: '2026-10-23T00:00:00Z',
    },
    {
      path: 'P\\R\\Platform Sprint 123',
      name: 'Platform Sprint 123',
      start: '2026-10-26T00:00:00Z',
      finish: '2026-11-06T00:00:00Z',
    },
    {
      path: 'P\\R\\Platform Sprint 124',
      name: 'Platform Sprint 124',
      start: '2026-11-09T00:00:00Z',
      finish: '2026-11-20T00:00:00Z',
    },
    { path: 'P\\R\\UX Sprint 50', name: 'UX Sprint 50', start: '2026-10-26T00:00:00Z', finish: '2026-11-06T00:00:00Z' },
  ];

  it('is the next sprint of the same team', () => {
    expect(nextIteration({ name: 'Platform Sprint 122', finishDate: '2026-10-23T00:00:00Z' }, schedule)?.path).toBe(
      'P\\R\\Platform Sprint 123'
    );
  });

  it('is nothing without a schedule or a later sprint of the team', () => {
    expect(nextIteration({ name: 'Platform Sprint 122', finishDate: '2026-10-23' }, undefined)).toBeUndefined();
    expect(nextIteration({ name: 'UX Sprint 50', finishDate: '2026-11-06' }, schedule)).toBeUndefined();
  });
});

describe('workSpans (TIMELINE-3..7)', () => {
  const base: PhaseInput = {
    now: at(22, 14),
    axisStart: at(12, 0),
    column: 'review',
    started: at(14, 9),
    pullRequest: { created: at(16, 10), published: at(16, 15), isDraft: false },
    reviewText: 'CI ✓ · review',
  };

  it('goes from coding to the draft to CI · review, with the dates of the PR (TIMELINE-3..5)', () => {
    const spans = workSpans(base);
    expect(spans.map((span) => [span.kind, span.start, span.end])).toEqual([
      ['coding', at(14, 9), at(16, 10)],
      ['draft', at(16, 10), at(16, 15)],
      ['review', at(16, 15), at(22, 14)],
    ]);
    expect(spans.some((span) => span.approximate)).toBe(false);
  });

  it('has no draft span for a PR created published', () => {
    const spans = workSpans({ ...base, pullRequest: { created: at(16, 10), isDraft: false } });
    expect(spans.map((span) => span.kind)).toEqual(['coding', 'review']);
    expect(spans[1].start).toBe(at(16, 10));
  });

  it('keeps a draft a draft until now (TIMELINE-4)', () => {
    const spans = workSpans({ ...base, column: 'branch', pullRequest: { created: at(21, 10), isDraft: true } });
    expect(spans.map((span) => span.kind)).toEqual(['coding', 'draft']);
    expect(spans[1].end).toBe(at(22, 14));
  });

  it('starts at the sprint, approximate, when the work item has no activation, or began after the PR', () => {
    const none = workSpans({ ...base, started: undefined });
    expect(none[0]).toMatchObject({ kind: 'coding', start: at(12, 0), approximate: true });
    const late = workSpans({ ...base, started: at(20, 9) });
    expect(late[0]).toMatchObject({ start: at(12, 0), approximate: true });
  });

  it('clips what began before the sprint and says so', () => {
    const [coding] = workSpans({ ...base, started: at(1, 9) });
    expect(coding).toMatchObject({ start: at(12, 0), fromBefore: true });
  });

  it('turns amber from the moment the station needed the user (TIMELINE-6)', () => {
    const spans = workSpans({ ...base, column: 'ci', needsYou: { text: 'CI: 2 tests failed', since: at(20, 11) } });
    expect(spans.slice(-2).map((span) => [span.kind, span.start, span.end, span.text])).toEqual([
      ['review', at(16, 15), at(20, 11), 'CI ✓ · review'],
      ['needsYou', at(20, 11), at(22, 14), 'CI: 2 tests failed'],
    ]);
  });

  it('marks the amber start approximate when it is not known', () => {
    const amber = workSpans({ ...base, needsYou: { text: 'Ana waits' } }).at(-1);
    expect(amber).toMatchObject({ kind: 'needsYou', start: at(16, 15), approximate: true });
  });

  it('turns green when ready to be merged (TIMELINE-7)', () => {
    const spans = workSpans({ ...base, column: 'ready', readySince: at(21, 16) });
    expect(spans.slice(-2).map((span) => [span.kind, span.start])).toEqual([
      ['review', at(16, 15)],
      ['ready', at(21, 16)],
    ]);
  });

  it('stops a completed PR at its completion', () => {
    const spans = workSpans({ ...base, column: 'done', pullRequest: { ...base.pullRequest!, closed: at(21, 9) } });
    expect(spans.at(-1)?.end).toBe(at(21, 9));
  });

  it('draws nothing for a work item not started', () => {
    expect(workSpans({ ...base, column: 'toStart', pullRequest: undefined })).toEqual([]);
  });

  it('draws coding up to now for work without a PR yet', () => {
    expect(
      workSpans({ ...base, column: 'branch', pullRequest: undefined }).map((span) => [span.kind, span.end])
    ).toEqual([['coding', at(22, 14)]]);
  });
});

describe('the moments behind needs you and ready (TIMELINE-6, TIMELINE-7)', () => {
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
    const spans = workSpans({
      now: at(22, 14),
      axisStart: at(12, 0),
      column: 'branch',
      started: at(14, 9),
      pullRequest: { created: at(15, 10), isDraft: true },
      reviewText: '',
    });
    const asleep = withAsleep(spans, at(19, 9), at(22, 14), 'zZ no update for 3 working days');
    expect(asleep.map((span) => [span.kind, span.start, span.end])).toEqual([
      ['coding', at(14, 9), at(15, 10)],
      ['draft', at(15, 10), at(19, 9)],
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
    range: 'sprint',
    planned: { status: 'off', items: [] },
    base: { branch: 'develop', enabled: true, runs: [] },
    ...overrides,
  });
}

describe('buildSprintTimeline', () => {
  it('has one row per card of the board, in the same order (TIMELINE-1)', () => {
    const items = [
      workItem({ id: 1, pullRequests: [pullRequest({ id: 10 })] }),
      workItem({ id: 2, state: 'New', displayState: 'New', branches: [], branch: undefined }),
      workItem({ id: 3, pullRequests: [pullRequest({ id: 31 }), pullRequest({ id: 32 })] }),
    ];
    const model = timeline(items, [mine({ id: 10 }), mine({ id: 31 }), mine({ id: 32 })]);
    expect(model.work.map((row) => row.key)).toEqual(['1', '2', 'group:3', '3:pr:31', '3:pr:32']);
    expect(model.work.map((row) => row.id).sort()).toEqual([1, 2, 3, 3, 3]);
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

  it('draws the phases of a published PR and puts the NOW line at the time (TIMELINE-3..5, TIMELINE-13)', () => {
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
    expect(row.segments.map((segment) => segment.kind)).toEqual(['coding', 'draft', 'review']);
    expect(row.segments[2].text).toContain('waiting for Ana');
    expect(model.now).toBeCloseTo(8 + 14 / 24);
    expect(model.days).toHaveLength(10);
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

  it('adds the next sprint, the planned work and the spill over with "This + next sprint" (TIMELINE-10)', () => {
    const schedule = [
      {
        path: 'P\\R\\Platform Sprint 123',
        name: 'Platform Sprint 123',
        start: '2026-10-26T00:00:00Z',
        finish: '2026-11-06T00:00:00Z',
      },
    ];
    const model = timeline([workItem({ pullRequests: [pullRequest()] })], [mine()], [], {
      range: 'sprintAndNext',
      schedule,
      planned: {
        status: 'ready',
        items: [{ id: 99, title: 'Later', type: 'Product Backlog Item', state: 'Approved' }],
      },
    });
    expect(model.days).toHaveLength(20);
    expect(model.planned.rows.map((row) => row.id)).toEqual([99]);
    expect(model.planned.rows[0].segments[0]).toMatchObject({ kind: 'planned', start: 10, end: 20, dashed: true });
    expect(model.work[0].segments.at(-1)).toMatchObject({ text: 'spills over', dashed: true, start: 10 });
  });

  it('says why the planned work is missing instead of inventing it (TIMELINE-14)', () => {
    const wide = { range: 'sprintAndNext' as const };
    expect(timeline([], [], [], wide).planned.note).toContain('not in the iteration schedule');
    const schedule = [
      { path: 'P\\R\\Platform Sprint 123', name: 'Platform Sprint 123', start: '2026-10-26', finish: '2026-11-06' },
    ];
    expect(timeline([], [], [], { ...wide, schedule, planned: { status: 'error', items: [] } }).planned.note).toContain(
      'could not be read'
    );
    expect(timeline([], [], [], { ...wide, schedule, planned: { status: 'ready', items: [] } }).planned.note).toContain(
      'Nothing of yours'
    );
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

/* ---------- Labels, groups and merged PRs (TIMELINE-15..18) ---------- */

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

describe('labels (TIMELINE-15)', () => {
  it('starts the first line with the tag, the id and the PR pill, and the second with the work item title', () => {
    const rows = timeline(
      [
        workItem({ id: 1, title: 'Backlog title', pullRequests: [pullRequest({ id: 10, title: 'PR title' })] }),
        workItem({ id: 2, title: 'Bug title', type: 'Bug', pullRequests: [pullRequest({ id: 20, tone: 'draft' })] }),
      ],
      [mine({ id: 10 }), mine({ id: 20, isDraft: true })]
    ).work;
    expect(rows[0].label).toEqual({ tag: { text: 'PBI', tone: 'pbi' }, id: '#1', pr: { text: 'PR 10' } });
    expect(rows[0].title).toBe('Backlog title');
    expect(rows[1].label).toEqual({ tag: { text: 'BUG', tone: 'bug' }, id: '#2', pr: { text: 'draft PR 20' } });
  });

  it('puts the PR pill and the PR title on the rows of a group, without the [id] prefix', () => {
    const rows = timeline(
      [workItem({ id: 3, pullRequests: [pullRequest({ id: 31, title: '[3] Mine' }), pullRequest({ id: 32 })] })],
      [mine({ id: 31 }), mine({ id: 32 })]
    ).work;
    expect(rows[1].label).toEqual({ pr: { text: 'PR 31' } });
    expect(rows[1].title).toBe('Mine');
  });

  it('puts the pill on the reviews owed', () => {
    const row = timeline([], [], [review({ id: 50 })]).reviews[0];
    expect(row.label).toEqual({ pr: { text: 'PR 50' }, meta: 'Ana · required' });
  });
});

describe('groups (TIMELINE-16)', () => {
  const COMPLETED = (id: number): PullRequestModel =>
    pullRequest({ id, title: `Merged ${String(id)}`, tone: 'completed', status: 'Completed', isActive: false });
  const items67145 = (canCreate: boolean): WorkItemModel[] => [
    workItem({
      id: 67145,
      title: 'App configuration updated by another user',
      dates: { activated: iso(13, 9) },
      pullRequests: [
        pullRequest({ id: 14021, title: '[67145] Measurement update' }),
        pullRequest({ id: 14012, title: '[67145] AL update' }),
        pullRequest({ id: 14008, title: '[67145] Nx config update' }),
        pullRequest({ id: 14015, title: '[67145] NumericField' }),
        pullRequest({ id: 14030, title: '[67145] run_all.sh' }),
        COMPLETED(13801),
        COMPLETED(13802),
        COMPLETED(13803),
      ],
    }),
    ...[1, 2, 3, 4, 5].map((n) => task(67200 + n, 67145, 'To Do')),
    task(67206, 67145, 'In Progress', { canCreatePullRequest: canCreate, dates: { activated: iso(20, 9) } }),
    task(67207, 67145, 'In Progress', { taskPullRequests: [{ id: 14021 } as never] }),
    ...Array.from({ length: 8 }, (_, n) => task(67300 + n, 67145, 'Done')),
  ];
  const created: Record<number, [number, number]> = {
    14021: [19, 10],
    14012: [14, 9],
    14008: [15, 9],
    14015: [20, 9],
    14030: [21, 9],
  };
  const mineOf = Object.entries(created).map(([id, [day, hour]]) =>
    mine({ id: Number(id), stamps: { createdAt: iso(day, hour), publishedAt: iso(day, hour + 2) } })
  );
  const completed = [merged(13801, 13, 16), merged(13802, 18, 21), merged(13803, 1, 5)];
  const build = (canCreate = true) =>
    timeline(items67145(canCreate), mineOf, [], { completedPullRequests: completed }).work;

  it('puts the work item first and its PRs, tasks and tasks to do under it, in order', () => {
    const rows = build();
    expect(rows.map((row) => row.key)).toEqual([
      'group:67145',
      'merged:67145:13801',
      '67145:pr:14012',
      '67145:pr:14008',
      'merged:67145:13802',
      '67145:pr:14021',
      '67145:pr:14015',
      '67145:pr:14030',
      '67145:task:67206',
      '67145:tasks',
    ]);
    expect(rows.slice(1).every((row) => row.groupId === 67145)).toBe(true);
    expect(rows.at(-1)?.lastChild).toBe(true);
  });

  it('says what the work item is in its row and its bracket', () => {
    const [group] = build();
    expect(group.label).toEqual({
      tag: { text: 'PBI', tone: 'pbi' },
      id: '#67145',
      state: 'Committed · 5 open PRs',
    });
    expect(group.title).toBe('App configuration updated by another user');
    // 3 PRs merged (one of them before the sprint: only counted), 15 tasks
    expect(group.group?.bracket.text).toBe('active since Tu 13 · 3 PRs merged · done when all 15 tasks are');
    expect(group.group?.bracket.approximate).toBe(false);
    expect(group.group?.tasks).toMatchObject({ done: 8, inProgress: 2, toDo: 5, total: 15, text: '8 of 15 tasks' });
    expect(group.boardKey).toBe('67145:pr:14021');
  });

  it('tags the tasks and says whose title each row has', () => {
    const rows = build();
    const noPr = rows.find((row) => row.key === '67145:task:67206');
    expect(noPr?.label).toEqual({ tag: { text: 'Task', tone: 'task' } });
    expect(noPr?.title).toBe('Task 67206');
    expect(noPr?.segments[0]).toMatchObject({ kind: 'coding', text: 'coding · no PR yet' });
    // Rule TIMELINE-20: a task row without PR keeps the activation of its task (Tu 20), not the work item's (Tu 13)
    expect(noPr?.segments[0].tip).toContain('Tue 20 Oct, 09:00');
    expect(rows.at(-1)?.label).toEqual({ tag: { text: '5 tasks', tone: 'task' } });
    expect(rows.at(-1)?.outline?.text).toContain('5 tasks to do');
  });

  it('offers Create PR on a task without PR only when the task row of the sidebar does', () => {
    const find = (rows: ReturnType<typeof build>) => rows.find((row) => row.key === '67145:task:67206');
    expect(find(build(true))?.action).toMatchObject({
      label: 'Create PR',
      message: { type: 'createPullRequest', id: 67145, taskId: 67206 },
    });
    expect(find(build(false))?.action).toBeUndefined();
  });

  it('keeps one thin line per PR for the collapsed group, and counts what needs the user and what is ready', () => {
    const rows = timeline(
      [
        workItem({
          id: 7,
          pullRequests: [
            pullRequest({
              id: 71,
              runs: [{ id: 1, pipeline: 'CI', state: 'failed', url: '', finishTime: iso(21, 10) }],
            }),
            pullRequest({
              id: 72,
              runs: [{ id: 2, pipeline: 'CI', state: 'succeeded', url: '', finishTime: iso(20, 10) }],
            }),
            COMPLETED(70),
          ],
        }),
      ],
      [mine({ id: 71 }), mine({ id: 72, readyToMerge: true, canComplete: true })],
      [],
      { completedPullRequests: [merged(70, 13, 15)] }
    ).work;
    const group = rows[0].group;
    expect(group?.lines).toHaveLength(3);
    expect(group?.lines.filter((line) => line.faded)).toHaveLength(1);
    expect(group?.lines.every((line) => line.segments.length > 0)).toBe(true);
    expect(group?.needsYou).toBe(1);
    expect(group?.ready).toBe(1);
  });

  it('is a group when a PR was merged and the work item is not finished, with its own card as a row', () => {
    const rows = timeline([workItem({ id: 9, pullRequests: [COMPLETED(90)] }), task(91, 9, 'To Do')], [], [], {
      completedPullRequests: [merged(90, 14, 16)],
    }).work;
    expect(rows.map((row) => row.key)).toEqual(['group:9', 'merged:9:90', '9']);
    expect(rows[0].label?.state).toBe('Committed');
    expect(rows[2].label).toEqual({ tag: { text: 'PBI', tone: 'pbi' } });
    expect(rows[2].title).toBe('Item');
    expect(rows[0].group?.bracket.text).toContain('1 PR merged');
  });

  it('keeps one row for a finished work item with one merged PR, drawn with the dates of the merge', () => {
    const rows = timeline(
      [
        workItem({
          id: 8,
          state: 'Done',
          displayState: 'Done',
          alerts: [{ rule: 'noTasks', message: 'a' } as never],
          dates: { activated: iso(13, 9), stateChanged: iso(16, 17) },
          pullRequests: [COMPLETED(80)],
        }),
      ],
      [],
      [],
      { completedPullRequests: [merged(80, 14, 16)] }
    );
    expect(rows.work).toEqual([]);
    expect(rows.finished.map((row) => row.key)).toEqual(['8']);
    const [row] = rows.finished;
    expect(row.group).toBeUndefined();
    expect(row.faded).toBe(true);
    expect(row.label?.pr).toEqual({ text: 'PR 80', merged: true });
    expect(row.merged?.text).toBe('✓ done Fr 16');
    expect(row.segments.map((segment) => segment.kind)).toEqual(['coding', 'draft', 'review']);
    expect(row.segments.some((segment) => segment.approximate && segment.kind !== 'coding')).toBe(false);
    expect(rows.mergedWithoutThreads).toEqual([]);
  });

  it('is not a group for one open PR and one merged before the sprint', () => {
    const rows = timeline(
      [workItem({ id: 5, pullRequests: [pullRequest({ id: 50 }), COMPLETED(51)] })],
      [mine({ id: 50 })],
      [],
      { completedPullRequests: [merged(51, 1, 5)] }
    ).work;
    expect(rows.map((row) => row.key)).toEqual(['5']);
  });
});

describe('merged PRs (TIMELINE-17)', () => {
  const COMPLETED = pullRequest({
    id: 90,
    title: '[9] Merged',
    tone: 'completed',
    status: 'Completed',
    isActive: false,
  });
  const group = (info: CompletedPullRequestInfo) =>
    timeline([workItem({ id: 9, dates: { activated: iso(13, 9) }, pullRequests: [COMPLETED] })], [], [], {
      completedPullRequests: [info],
    });

  it('draws a faded row: coding, draft, CI · review up to the merge, and a merged mark', () => {
    const rows = group(merged(90, 14, 16)).work;
    const row = rows.find((candidate) => candidate.key === 'merged:9:90');
    expect(row?.faded).toBe(true);
    expect(row?.label).toEqual({ pr: { text: 'PR 90', merged: true } });
    expect(row?.title).toBe('Merged 90');
    expect(row?.segments.map((segment) => segment.kind)).toEqual(['coding', 'draft', 'review']);
    expect(row?.segments[0]).toMatchObject({ start: 1 + 9 / 24, end: 2 + 9 / 24 });
    expect(row?.merged?.text).toBe('✓ merged Fr 16');
    expect(row?.merged?.at).toBeCloseTo(4 + 16 / 24, 5);
    expect(row?.action).toBeUndefined();
    expect(row?.boardKey).toBeUndefined();
  });

  it('draws one approximate span from the creation to the merge until its threads are read, and asks for them', () => {
    const model = group(merged(90, 14, 16, { threadsKnown: false, publishedAt: undefined }));
    const row = model.work.find((candidate) => candidate.key === 'merged:9:90');
    expect(row?.segments.map((segment) => segment.kind)).toEqual(['coding', 'review']);
    expect(row?.segments[1].approximate).toBe(true);
    expect(model.mergedWithoutThreads).toEqual([90]);
  });

  it('does not draw a PR merged before the axis, nor ask for its threads', () => {
    const model = group(merged(90, 1, 5, { threadsKnown: false }));
    expect(model.work.map((row) => row.key)).toEqual(['9']);
    expect(model.mergedWithoutThreads).toEqual([]);
  });

  it('starts coding with the linked task when it is in the list', () => {
    const rows = timeline(
      [
        workItem({ id: 9, dates: { activated: iso(13, 9) }, pullRequests: [COMPLETED] }),
        task(91, 9, 'Done', { dates: { activated: iso(14, 9) }, taskPullRequests: [{ id: 90 } as never] }),
      ],
      [],
      [],
      { completedPullRequests: [merged(90, 15, 16)] }
    ).work;
    const row = rows.find((candidate) => candidate.key === 'merged:9:90');
    expect(row?.segments[0].start).toBeCloseTo(2 + 9 / 24);
  });
});

describe('completed work items and merged PRs (TIMELINE-19)', () => {
  const done = (id: number, prs: PullRequestModel[], extra: Partial<WorkItemModel> = {}) =>
    workItem({
      id,
      state: 'Done',
      displayState: 'Done',
      dates: { activated: iso(13, 9), stateChanged: iso(16, 17) },
      pullRequests: prs,
      ...extra,
    });
  const closedPr = (id: number) =>
    pullRequest({ id, title: `[1] PR ${String(id)}`, tone: 'completed', status: 'Completed' });
  const open = workItem({ id: 1, pullRequests: [pullRequest({ id: 10 })] });

  it('puts the finished work items after the open ones, in their own list', () => {
    const model = timeline([done(2, []), open], [mine({ id: 10 })]);
    expect(model.work.map((row) => row.key)).toEqual(['1']);
    expect(model.finished.map((row) => row.key)).toEqual(['2']);
    expect(model.finished[0]).toMatchObject({ faded: true, merged: { text: '✓ done Fr 16' } });
    expect(model.finished[0].action).toBeUndefined();
    expect(model.showCompleted).toBe(true);
  });

  it('makes a group of a finished work item with two merged PRs in range, whose children are the merged PRs', () => {
    const model = timeline([done(3, [closedPr(31), closedPr(32)])], [], [], {
      completedPullRequests: [merged(31, 13, 14), merged(32, 14, 16)],
    });
    expect(model.work).toEqual([]);
    expect(model.finished.map((row) => row.key)).toEqual(['group:3', 'merged:3:31', 'merged:3:32']);
    expect(model.finished[0].faded).toBe(true);
    expect(model.finished[0].group?.bracket.text).toContain('2 PRs merged');
    expect(model.finished[0].group?.bracket.text).toContain('✓ done Fr 16');
    expect(model.finished[0].boardKey).toBe('3');
  });

  it('hidden: no finished row, no merged row, and a group that only the merged PRs made is one row again', () => {
    const items = [
      done(3, [closedPr(31), closedPr(32)], { alerts: [{ rule: 'noTasks', message: 'a' } as never] }),
      workItem({ id: 5, pullRequests: [pullRequest({ id: 50 }), closedPr(51)] }),
      done(6, []),
    ];
    const info = { completedPullRequests: [merged(31, 13, 14), merged(32, 14, 16), merged(51, 14, 15)] };
    const model = timeline(items, [mine({ id: 50 })], [], info, { showCompleted: false });
    // The finished work item that breaks a rule stays visible, as one row
    expect(model.finished.map((row) => row.key)).toEqual(['3']);
    expect(model.finished[0].group).toBeUndefined();
    expect(model.work.map((row) => row.key)).toEqual(['5']);
    expect(model.showCompleted).toBe(false);
    expect(model.mergedWithoutThreads).toEqual([]);
  });

  it('shown, a work item with an open PR and a merged one is a group with the merged row', () => {
    const items = [workItem({ id: 5, pullRequests: [pullRequest({ id: 50 }), closedPr(51)] })];
    const model = timeline(items, [mine({ id: 50 })], [], { completedPullRequests: [merged(51, 14, 15)] });
    expect(model.work.map((row) => row.key)).toEqual(['group:5', 'merged:5:51', '5']);
  });
});

describe('ready to be merged on open PRs (TIMELINE-7)', () => {
  const approved = { createdAt: iso(16, 10), publishedAt: iso(16, 15), lastVoteAt: iso(20, 11) };
  const readyPr = (id: number) => mine({ id, readyToMerge: true, canComplete: true, stamps: approved });
  const kinds = (row: { segments: { kind: string }[] } | undefined) => row?.segments.map((segment) => segment.kind);

  it('draws the green span on the single row of a PR in the Ready column', () => {
    const rows = timeline([workItem({ id: 1, pullRequests: [pullRequest({ id: 10 })] })], [readyPr(10)]).work;
    expect(rows).toHaveLength(1);
    expect(kinds(rows[0])).toContain('ready');
  });

  it('draws the green span on the PR rows of a work item with several PRs', () => {
    const rows = timeline(
      [workItem({ id: 3, pullRequests: [pullRequest({ id: 31 }), pullRequest({ id: 32 })] })],
      [readyPr(31), mine({ id: 32, stamps: approved })]
    ).work;
    expect(kinds(rows.find((row) => row.key === '3:pr:31'))).toContain('ready');
    expect(kinds(rows.find((row) => row.key === '3:pr:32'))).not.toContain('ready');
  });
});

const COMPLETED_PR = (id: number): PullRequestModel => {
  return pullRequest({ id, title: `Merged ${String(id)}`, tone: 'completed', status: 'Completed', isActive: false });
};

describe('ready to be merged on merged PRs (TIMELINE-7)', () => {
  const pullRequest = { created: at(16, 10), published: at(16, 15), closed: at(21, 16), isDraft: false };
  const input: PhaseInput = {
    now: at(22, 14),
    axisStart: at(12, 0),
    column: 'review',
    started: at(14, 9),
    pullRequest,
    reviewText: 'CI ✓ · review',
  };
  const shape = (spans: ReturnType<typeof workSpans>) => spans.map((span) => [span.kind, span.start, span.end]);

  it('draws CI · review up to the last vote and green from then to the merge', () => {
    const spans = workSpans({ ...input, readySince: at(20, 11) });
    expect(shape(spans).slice(-2)).toEqual([
      ['review', at(16, 15), at(20, 11)],
      ['ready', at(20, 11), at(21, 16)],
    ]);
    expect(spans.at(-1)?.approximate).toBe(false);
  });

  it('draws no green span when the moment is not known', () => {
    expect(workSpans(input).map((span) => span.kind)).toEqual(['coding', 'draft', 'review']);
    expect(shape(workSpans(input)).at(-1)).toEqual(['review', at(16, 15), at(21, 16)]);
  });

  it('draws no green span for a vote after the merge', () => {
    expect(workSpans({ ...input, readySince: at(21, 18) }).map((span) => span.kind)).not.toContain('ready');
  });

  const kinds = (rows: { key: string; segments: { kind: string }[] }[], key: string) =>
    rows.find((row) => row.key === key)?.segments.map((segment) => segment.kind);
  const item = (state = 'Committed') =>
    workItem({ id: 9, state, displayState: state, dates: { activated: iso(13, 9), stateChanged: iso(21, 17) } });

  it('turns the merged row green from its last vote, and not without one', () => {
    const voted = timeline([workItem({ id: 9, pullRequests: [COMPLETED_PR(90)] }), task(91, 9, 'To Do')], [], [], {
      completedPullRequests: [merged(90, 14, 16, { lastVoteAt: iso(15, 18) })],
    }).work;
    expect(kinds(voted, 'merged:9:90')).toContain('ready');
    const unknown = timeline([workItem({ id: 9, pullRequests: [COMPLETED_PR(90)] }), task(91, 9, 'To Do')], [], [], {
      completedPullRequests: [merged(90, 14, 16)],
    }).work;
    expect(kinds(unknown, 'merged:9:90')).not.toContain('ready');
  });

  it('turns the single row of a finished work item green from its last vote', () => {
    const rows = timeline([{ ...item('Done'), pullRequests: [COMPLETED_PR(80)] }], [], [], {
      completedPullRequests: [merged(80, 14, 16, { lastVoteAt: iso(15, 18) })],
    }).finished;
    expect(kinds(rows, '9')).toEqual(['coding', 'draft', 'review', 'ready']);
  });
});

describe('when coding starts (TIMELINE-20)', () => {
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
  const coding = (model: ReturnType<typeof build>, key: string) => {
    const row = model.work.find((candidate) => candidate.key === key);
    return row?.segments.find((segment) => segment.kind === 'coding');
  };
  const day = (model: ReturnType<typeof build>, key: string) => coding(model, key)?.start;

  it('draws the coding of each PR of a work item from its own source (earliest)', () => {
    const model = build('earliest');
    // PR 71: the first commit (Tu 13) is earlier than the task (We 14); PR 72: no task, the commit (Th 19... Mo 19)
    expect(coding(model, '7:pr:71')?.tip).toContain('coding since the first commit, Tu 13');
    expect(coding(model, '7:pr:72')?.tip).toContain('coding since the first commit, Mo 19');
    expect(day(model, '7:pr:72')).toBeGreaterThan(day(model, '7:pr:71') ?? 0);
  });

  it('takes the task when it is earlier than the first commit', () => {
    const model = build('earliest', [[71, iso(15, 9)]]);
    expect(coding(model, '7:pr:71')?.tip).toContain('coding since task 701 was activated, We 14');
  });

  it('firstCommit prefers the commit and falls back to the task; taskActivated the reverse and reads no commits', () => {
    expect(coding(build('firstCommit', [[71, iso(15, 9)]]), '7:pr:71')?.tip).toContain('the first commit, Th 15');
    expect(coding(build('firstCommit', []), '7:pr:71')?.tip).toContain('task 701');
    const task_ = build('taskActivated');
    expect(coding(task_, '7:pr:71')?.tip).toContain('task 701 was activated');
    expect(task_.firstCommitsWanted).toEqual([]);
    expect(coding(task_, '7:pr:72')?.tip).toContain('since the work item was activated, approximate');
    expect(coding(task_, '7:pr:72')?.approximate).toBe(true);
  });

  it('asks the first commit of the PRs drawn that are not known, only when the setting reads commits', () => {
    expect(build('earliest', []).firstCommitsWanted.sort()).toEqual([71, 72]);
    expect(build('firstCommit', [[71, iso(13, 15)]]).firstCommitsWanted).toEqual([72]);
    expect(build('taskActivated', []).firstCommitsWanted).toEqual([]);
  });

  it('ignores a first commit after the creation of the PR', () => {
    const model = build('firstCommit', [[72, iso(21, 9)]]);
    expect(coding(model, '7:pr:72')?.tip).toContain('since the work item was activated, approximate');
  });

  it('draws the coding of a merged PR from its first commit or its task', () => {
    const model = timeline(
      [workItem({ id: 9, dates: { activated: iso(12, 9) }, pullRequests: [COMPLETED_PR(90)] }), task(91, 9, 'To Do')],
      [],
      [],
      { completedPullRequests: [merged(90, 14, 16)], firstCommits: new Map([[90, iso(13, 9)]]) }
    );
    const tip = model.work.find((row) => row.key === 'merged:9:90')?.segments.at(0)?.tip;
    expect(tip).toContain('coding since the first commit, Tu 13');
    expect(model.firstCommitsWanted).toEqual([]);
  });
});
