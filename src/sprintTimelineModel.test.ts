import { describe, expect, it } from 'vitest';
import type { BaseBranchRun } from './baseBranchHealth';
import type { MyPullRequestModel } from './myPullRequests';
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
import { buildBoard } from './trackBoardModel';
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
  overrides: Partial<TimelineInput> = {}
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
    look: 'theme',
    popoverDelay: 500,
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
    expect(model.work.map((row) => row.key)).toEqual(['1', '2', '3:pr:31', '3:pr:32']);
    expect(model.work.map((row) => row.id).sort()).toEqual([1, 2, 3, 3]);
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
