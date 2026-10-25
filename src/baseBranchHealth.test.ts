import { describe, expect, it } from 'vitest';
import {
  baseBranchBanner,
  baseBranchHealth,
  baseBranchModal,
  baseBranchStatusText,
  baseBranchTarget,
  breakingBuildText,
  brokenSince,
  finishedStates,
  incidentKey,
  newIncidents,
  rememberIncidents,
} from './baseBranchHealth';
import { BuildRun } from './pipelines';

const NOW = new Date('2026-10-22T12:00:00Z');

/** Build n of the CI pipeline on develop, queued at 10:0n, finished at 10:3n */
const build = (id: number, overrides: Partial<BuildRun> = {}): BuildRun => ({
  id,
  definition: { id: 1, name: 'User-Interface-CI' },
  status: 'completed',
  result: 'succeeded',
  queueTime: `2026-10-22T10:0${id}:00Z`,
  finishTime: `2026-10-22T10:3${id}:00Z`,
  sourceBranch: 'refs/heads/develop',
  webUrl: `https://build/${id}`,
  ...overrides,
});

const merged = (id: number, pullRequestId: number, overrides: Partial<BuildRun> = {}): BuildRun =>
  build(id, {
    triggerInfo: { 'ci.message': `Merged PR ${pullRequestId}: Change ${pullRequestId}` },
    requestedFor: { displayName: 'Ana' },
    ...overrides,
  });

const health = (builds: BuildRun[], ignored: string[] = []) => baseBranchHealth(builds, 'develop', ignored, NOW);

describe('baseBranchHealth', () => {
  it('is green when the last finished run succeeded', () => {
    expect(health([build(1, { result: 'failed' }), build(2)]).broken).toEqual([]);
  });

  it('is broken by the first failure after the last green run, not by the latest one', () => {
    const { broken } = health([
      build(1),
      merged(2, 100, { result: 'failed' }),
      merged(3, 101, { result: 'partiallySucceeded' }),
    ]);
    expect(broken).toEqual([
      expect.objectContaining({
        pipeline: 'User-Interface-CI',
        run: expect.objectContaining({ id: 3, state: 'partial' }),
        brokenBy: expect.objectContaining({
          buildId: 2,
          pullRequestId: 100,
          message: 'Change 100',
          requestedFor: 'Ana',
        }),
        fixRunning: false,
      }),
    ]);
  });

  it('stays broken while a new run is going or after a canceled run, and says a run is going', () => {
    const { broken } = health([
      build(1),
      merged(2, 100, { result: 'failed' }),
      build(3, { result: 'canceled' }),
      build(4, { status: 'inProgress', result: undefined }),
    ]);
    expect(broken).toEqual([expect.objectContaining({ run: expect.objectContaining({ id: 2 }), fixRunning: true })]);
  });

  it('stays broken, with the same culprit, while the failed jobs of a run are re-run (same build id)', () => {
    const red = [build(5), merged(6, 100, { result: 'failed' })];
    const known = finishedStates(red, new Map());
    const rerun = [build(5), merged(6, 100, { status: 'inProgress', result: undefined })];
    expect(baseBranchHealth(rerun, 'develop', [], NOW, known).broken).toEqual([
      expect.objectContaining({ run: expect.objectContaining({ id: 6, state: 'failed' }), fixRunning: true }),
    ]);
    // Without the previous fetch (a cold start during the re-run) it looks green until the re-run finishes
    expect(baseBranchHealth(rerun, 'develop', [], NOW).broken).toEqual([]);
    // The state of the re-run build is kept for the next fetch too
    expect(finishedStates(rerun, known).get(6)).toBe('failed');
  });

  it('keeps the culprit when an older failure of the streak is re-run', () => {
    const red = [build(5), merged(6, 100, { result: 'failed' }), merged(7, 101, { result: 'failed' })];
    const known = finishedStates(red, new Map());
    const rerun = [
      build(5),
      merged(6, 100, { status: 'inProgress', result: undefined }),
      merged(7, 101, { result: 'failed' }),
    ];
    const [pipeline] = baseBranchHealth(rerun, 'develop', [], NOW, known).broken;
    expect(pipeline.brokenBy.buildId).toBe(6);
    expect(incidentKey(pipeline)).toBe(incidentKey(baseBranchHealth(red, 'develop', [], NOW).broken[0]));
  });

  it('takes the oldest failure known when no green run is in reach', () => {
    const { broken } = health([merged(1, 100, { result: 'failed' }), merged(2, 101, { result: 'failed' })]);
    expect(broken.map((pipeline) => pipeline.brokenBy.buildId)).toEqual([1]);
  });

  it('ignores the other branches, the ignored pipelines and the pipelines that no longer run there', () => {
    const { broken } = health(
      [
        build(1, { result: 'failed', sourceBranch: 'refs/heads/main' }),
        build(2, { result: 'failed', definition: { id: 2, name: 'Nightly-E2E' } }),
        build(3, {
          result: 'failed',
          definition: { id: 3, name: 'Old' },
          queueTime: '2026-09-01T10:00:00Z',
          finishTime: '2026-09-01T10:30:00Z',
        }),
      ],
      [' nightly-e2e ']
    );
    expect(broken).toEqual([]);
  });

  it('lists every broken pipeline by name, the time from the earliest break', () => {
    const result = health([
      build(5, { result: 'failed', definition: { id: 2, name: 'Lint' } }),
      build(3, { result: 'failed' }),
    ]);
    expect(result.broken.map((pipeline) => pipeline.pipeline)).toEqual(['Lint', 'User-Interface-CI']);
    expect(brokenSince(result)).toBe('2026-10-22T10:33:00Z');
  });
});

describe('alarm texts', () => {
  it('names the branch, the PR that broke it, the time and a running fix in the status bar', () => {
    expect(baseBranchStatusText(health([build(1), merged(2, 100, { result: 'failed' })]), NOW)).toBe(
      '$(flame) develop broken · PR 100 · 1h 28m'
    );
    expect(
      baseBranchStatusText(
        health([build(2, { result: 'failed' }), build(3, { status: 'notStarted', result: undefined })]),
        NOW
      )
    ).toBe('$(flame) develop broken · 1h 28m · $(sync~spin)');
  });

  it('describes the build that broke it', () => {
    expect(breakingBuildText({ buildId: 1, url: '', pullRequestId: 100, message: 'Fix', requestedFor: 'Ana' })).toBe(
      'PR 100: Fix (completed by Ana)'
    );
    expect(breakingBuildText({ buildId: 1, url: '', message: 'Bump' })).toBe('Push: Bump');
    expect(breakingBuildText({ buildId: 7, url: '' })).toBe('Run 7');
  });

  it('is blunt in the modal when the merge was the user own', () => {
    const { broken } = health([build(1), merged(2, 100, { result: 'failed' })]);
    expect(baseBranchModal('develop', broken, (id) => id === 100, NOW)).toEqual({
      message: '🔥 Your merge broke develop',
      detail: 'User-Interface-CI failed after PR 100: Change 100 (completed by Ana): Failed.',
      pullRequestId: 100,
      mine: true,
    });
    expect(baseBranchModal('develop', broken, () => false, NOW)).toMatchObject({
      message: '🔥 develop is broken. It must be fixed as soon as possible.',
      detail: '❌ User-Interface-CI: Failed\nBroken by PR 100: Change 100 (completed by Ana)',
      mine: false,
    });
  });
});

describe('baseBranchBanner', () => {
  const none = new Set<string>();
  const context = (mine: number[] = [], acknowledged = none) => ({
    isMine: (id: number) => mine.includes(id),
    acknowledged,
  });
  const failedTests = {
    tests: { total: 95, failed: 3, failedTests: [{ title: 'restarts', file: 'network-restart.spec.ts', error: '' }] },
  };

  it('has a line per broken pipeline, and nothing while the branch is green', () => {
    const banner = baseBranchBanner(health([build(1), merged(2, 100, { result: 'failed' })]), NOW);
    expect(banner).toMatchObject({
      variant: 'other',
      title: 'develop is broken',
      since: '2026-10-22T10:32:00Z',
      note: 'Avoid merging into develop until it is green.',
      acknowledged: false,
      lines: [
        {
          failure: 'User-Interface-CI · Failed',
          brokenBy: 'Broken by PR 100 Change 100',
          by: 'Ana',
          mine: false,
          newRun: false,
        },
      ],
    });
    expect(baseBranchBanner(health([build(1)]), NOW)).toBeUndefined();
    expect(baseBranchBanner(undefined, NOW)).toBeUndefined();
  });

  it('says "Your merge broke" and shows the user as "you" when the PR is theirs (variant a)', () => {
    const banner = baseBranchBanner(health([build(1), merged(2, 100, { result: 'failed' })]), NOW, context([100]));
    expect(banner).toMatchObject({
      variant: 'mine',
      title: 'Your merge broke develop',
      note: undefined,
      lines: [{ mine: true, by: undefined, brokenBy: 'Broken by PR 100 Change 100' }],
    });
    expect(banner?.buttons.map(({ label }) => label)).toEqual(["I'm on it", 'Open run']);
  });

  it('offers the PR, the failed tests and "I\'m on it" when somebody else broke it (variant b)', () => {
    const broken = health([build(1), merged(2, 100, { result: 'failed' })]);
    expect(baseBranchBanner(broken, NOW)?.buttons.map(({ label }) => label)).toEqual(['Open PR', "I'm on it"]);
    const withTests = baseBranchHealth([build(1), merged(2, 100, { result: 'failed' })], 'develop', [], NOW);
    withTests.broken[0].run = { ...withTests.broken[0].run, ...failedTests };
    expect(baseBranchBanner(withTests, NOW)?.buttons.map(({ label }) => label)).toEqual([
      'Open PR',
      'Failed tests',
      "I'm on it",
    ]);
  });

  it('has a block per pipeline when the culprits differ (variant c)', () => {
    const other = (id: number, pr: number, overrides: Partial<BuildRun> = {}) =>
      merged(id, pr, { definition: { id: 2, name: 'UI-E2E' }, ...overrides });
    const banner = baseBranchBanner(
      health([build(1), merged(2, 100, { result: 'failed' }), other(3, 101, { result: 'failed' })]),
      NOW,
      context([101])
    );
    expect(banner?.variant).toBe('several');
    expect(banner?.lines.map(({ failure, brokenBy, mine }) => [failure, brokenBy, mine])).toEqual([
      ['UI-E2E · Failed', 'Broken by PR 101', true],
      ['User-Interface-CI · Failed', 'Broken by PR 100', false],
    ]);
    expect(banner?.buttons.map(({ action }) => action)).toEqual(['showWhatBrokeIt', 'acknowledge']);
  });

  it('describes a run without a PR by what started it (variant d)', () => {
    const banner = baseBranchBanner(
      health([
        build(1),
        build(2, {
          result: 'failed',
          reason: 'schedule',
          triggerInfo: { 'ci.message': 'Bump eslint' },
          requestedFor: { displayName: 'Jonas' },
        }),
      ]),
      NOW
    );
    expect(banner).toMatchObject({
      variant: 'noPr',
      lines: [{ brokenBy: 'First failed run: scheduled, commit "Bump eslint"', by: 'Jonas' }],
    });
    expect(banner?.buttons.map(({ action }) => action)).toEqual(['openRun', 'acknowledge']);
  });

  it('is acknowledged once every incident was answered with "I\'m on it"', () => {
    const broken = health([build(1), merged(2, 100, { result: 'failed' })]);
    const keys = new Set(broken.broken.map(incidentKey));
    expect(baseBranchBanner(broken, NOW, context([], keys))?.acknowledged).toBe(true);
    expect(baseBranchBanner(broken, NOW, context([], new Set(['9:9'])))?.acknowledged).toBe(false);
  });

  it('finds what each button opens', () => {
    const broken = health([build(1), merged(2, 100, { result: 'failed' })]);
    expect(baseBranchTarget(broken, 'openRun', 1)).toEqual({ url: 'https://build/2' });
    expect(baseBranchTarget(broken, 'showTests', undefined)).toEqual({ url: 'https://build/2' });
    expect(baseBranchTarget(broken, 'openPullRequest', 1)).toEqual({ pullRequestId: 100 });
    expect(baseBranchTarget(broken, 'acknowledge', 1)).toBeUndefined();
    expect(baseBranchTarget(undefined, 'openRun', 1)).toBeUndefined();
  });
});

describe('incidents', () => {
  it('tells each incident once: a later failure of the same red streak is not new', () => {
    const first = health([build(1), merged(2, 100, { result: 'failed' })]);
    const notified = rememberIncidents([], newIncidents(first, []));
    expect(notified).toEqual([incidentKey(first.broken[0])]);
    const later = health([build(1), merged(2, 100, { result: 'failed' }), merged(3, 101, { result: 'failed' })]);
    expect(newIncidents(later, notified)).toEqual([]);
    // Green again, then broken by another merge: a new incident
    const again = health([
      build(1),
      merged(2, 100, { result: 'failed' }),
      build(3),
      merged(4, 102, { result: 'failed' }),
    ]);
    expect(newIncidents(again, notified).map(incidentKey)).toEqual(['1:4']);
  });

  it('keeps only the latest keys', () => {
    const keys = Array.from({ length: 60 }, (_, index) => `1:${index}`);
    const { broken } = health([build(1, { result: 'failed' })]);
    const remembered = rememberIncidents(keys, broken);
    expect(remembered).toHaveLength(50);
    expect(remembered.at(-1)).toBe('1:1');
  });
});
