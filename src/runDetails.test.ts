import { describe, expect, it } from 'vitest';
import { RunModel } from './pipelines';
import {
  failedStepOf,
  finishedRunMessage,
  firstErrorLine,
  runExtraLines,
  runLabel,
  runText,
  runTooltip,
  stripAnsi,
  summarizeTests,
  runViewUrl,
  testsUrl,
} from './runDetails';

const NOW = new Date('2026-10-07T12:00:00Z');

const run = (overrides: Partial<RunModel> = {}): RunModel => ({
  id: 72045,
  pipeline: 'User-Interface-PR-Pipeline',
  state: 'failed',
  url: 'https://dev.azure.com/org/p/_build/results?buildId=72045',
  startTime: '2026-10-07T11:00:00Z',
  finishTime: '2026-10-07T11:34:00Z',
  ...overrides,
});

const failedTests = (count: number) => ({
  total: 4200,
  failed: count,
  failedTests: Array.from({ length: Math.min(count, 5) }, (_, i) => ({
    title: i === 0 ? 'Other User Without Changes Sees Snackbar' : `Test ${i}`,
    file: 'packages/fui-common-components/hooks/useSyncFormWithServerValues.stories.tsx',
    error: 'Unable to find an accessible element',
  })),
});

describe('stripAnsi / firstErrorLine', () => {
  it('removes colour codes with the escape character', () => {
    expect(stripAnsi('\u001b[34mhello\u001b[39m world')).toBe('hello world');
  });

  it('removes colour codes where Azure DevOps replaced the escape character with a space', () => {
    expect(stripAnsi(' [34mhello [39m')).toBe('hello');
    expect(stripAnsi('array [0] and [1;2] stay')).toBe('array [0] and [1;2] stay');
  });

  it('skips the Storybook hint of the real error and shortens the rest', () => {
    const message =
      ' [34mClick to debug the error directly in Storybook: http://localhost:6006/?path=/story/x&addonPanel=storybook/interactions/panel [39m  Unable to find an accessible element with the role "region" and name "User 1"  Here are the accessible roles:';
    expect(firstErrorLine(message)).toBe(
      'Unable to find an accessible element with the role "region" and name "User 1" Here are the accessible roles:'
    );
  });

  it('keeps only the first line and truncates long ones', () => {
    expect(firstErrorLine('Expected 1\nReceived 2')).toBe('Expected 1');
    const long = firstErrorLine('x'.repeat(500));
    expect(long).toHaveLength(140);
    expect(long.endsWith('…')).toBe(true);
    expect(firstErrorLine(undefined)).toBe('');
  });
});

describe('summarizeTests', () => {
  it('does not count the skipped tests and names the failures', () => {
    const tests = summarizeTests(
      [{ id: 1, totalTests: 4200, passedTests: 4107, notApplicableTests: 92 }],
      [
        {
          failed: 1,
          results: [
            {
              testCaseTitle: 'Other User Without Changes Sees Snackbar',
              automatedTestStorage: 'packages/x/useSync.stories.tsx',
              errorMessage: ' [34mboom [39m',
            },
          ],
        },
      ]
    );
    expect(tests).toEqual({
      total: 4108,
      failed: 1,
      failedTests: [
        { title: 'Other User Without Changes Sees Snackbar', file: 'packages/x/useSync.stories.tsx', error: 'boom' },
      ],
    });
  });

  it('adds up several test runs and keeps at most 5 failures', () => {
    const results = Array.from({ length: 5 }, (_, i) => ({ testCaseTitle: `t${i}` }));
    const tests = summarizeTests(
      [
        { id: 1, totalTests: 10, passedTests: 4 },
        { id: 2, totalTests: 5, passedTests: 5 },
      ],
      [{ failed: 12, results }, undefined]
    );
    expect(tests?.total).toBe(15);
    expect(tests?.failed).toBe(12);
    expect(tests?.failedTests).toHaveLength(5);
  });

  it('is undefined when no tests ran', () => {
    expect(summarizeTests([], [])).toBeUndefined();
  });
});

describe('failedStepOf', () => {
  const task = (name: string, order: number, result = 'failed') => ({ type: 'Task', name, order, result });

  it('is the first failed task, not the job or the stage', () => {
    expect(
      failedStepOf([
        { type: 'Job', name: 'UI_Build_Test', result: 'failed', order: 1 },
        task('Build UI bundles', 12),
        task('Linting', 11),
        task('Install', 3, 'succeeded'),
      ])
    ).toBe('Linting');
  });

  it('ignores the tasks that publish results: they are not the cause', () => {
    expect(failedStepOf([task('Publish test results', 18), task('Run tests', 15)])).toBe('Run tests');
    expect(failedStepOf([task('Publish test results', 18), task('Linting', 20)])).toBe('Linting');
  });

  it('falls back to a publishing task when nothing else failed', () => {
    expect(failedStepOf([task('Publish test results', 18)])).toBe('Publish test results');
  });

  it('is undefined when no task failed', () => {
    expect(failedStepOf([task('Run tests', 1, 'succeeded')])).toBeUndefined();
  });
});

describe('testsUrl', () => {
  it('opens the tests tab of the build', () => {
    expect(testsUrl('https://dev.azure.com/o/p/_build/results?buildId=1')).toBe(
      'https://dev.azure.com/o/p/_build/results?buildId=1&view=ms.vss-test-web.build-test-results-tab'
    );
  });
});

describe('runViewUrl', () => {
  it('opens the code coverage tab of the build', () => {
    expect(runViewUrl('https://dev.azure.com/o/p/_build/results?buildId=1', 'coverage')).toBe(
      'https://dev.azure.com/o/p/_build/results?buildId=1&view=codecoverage-tab'
    );
  });
});

describe('runLabel', () => {
  it('counts the failed tests', () => {
    expect(runLabel(run({ tests: failedTests(1) }), NOW)).toEqual({ text: '1 test failed', opensTests: true });
    expect(runLabel(run({ tests: failedTests(3) }), NOW)).toEqual({ text: '3 tests failed', opensTests: true });
  });

  it('names the failed step when no test failed', () => {
    expect(runLabel(run({ failedStep: 'Linting' }), NOW)).toEqual({ text: 'Failed at Linting', opensTests: false });
  });

  it('falls back to the plain description', () => {
    expect(runLabel(run(), NOW).text).toBe('Failed in 34m');
  });

  it('counts the tests of a successful run', () => {
    const ok = run({ state: 'succeeded', tests: { total: 95, failed: 0, failedTests: [] } });
    expect(runLabel(ok, NOW).text).toBe('95 tests');
    expect(runLabel(run({ state: 'succeeded' }), NOW).text).toBe('Succeeded in 34m');
  });

  it('does not use the failures of a run that is not failed', () => {
    expect(runLabel(run({ state: 'running', tests: failedTests(2) }), NOW).text).toBe('Running 1h 00m');
  });
});

describe('tooltips', () => {
  it('lists the failing tests with their file and error, and how long the run took', () => {
    const lines = runTooltip(run({ tests: failedTests(1) }), NOW).split('\n');
    expect(lines).toEqual([
      'User-Interface-PR-Pipeline: ✗ 1 test failed',
      '• Other User Without Changes Sees Snackbar (packages/fui-common-components/hooks/useSyncFormWithServerValues.stories.tsx)',
      '    Unable to find an accessible element',
      'Failed in 34m',
    ]);
  });

  it('says how many more failures there are beyond the 5 listed', () => {
    const lines = runExtraLines(run({ tests: failedTests(8) }));
    expect(lines.filter((line) => line.startsWith('•'))).toHaveLength(5);
    expect(lines.at(-1)).toBe('… and 3 more');
  });

  it('shows the coverage of a successful run', () => {
    const ok = run({
      state: 'succeeded',
      tests: { total: 95, failed: 0, failedTests: [] },
      coverage: { percent: 87, covered: 87, total: 100, delta: 3.2, files: [] },
    });
    expect(runTooltip(ok, NOW)).toBe('User-Interface-PR-Pipeline: ✓ 95 tests\ncoverage 87% ▲ +3.2%\nSucceeded in 34m');
  });

  it('keeps the old text for runs without details', () => {
    expect(runText(run({ state: 'succeeded' }), NOW)).toBe('Succeeded in 34m');
    expect(runTooltip(run({ state: 'running' }), NOW)).toBe('User-Interface-PR-Pipeline: Running 1h 00m');
  });
});

describe('finishedRunMessage', () => {
  const context = { pullRequestId: 13713, target: 80 };
  const ok = run({
    state: 'succeeded',
    tests: { total: 95, failed: 0, failedTests: [] },
    coverage: { percent: 87, covered: 87, total: 100, delta: 3.2, files: [] },
  });

  it('reports a pass with tests and coverage', () => {
    expect(finishedRunMessage(ok, context, NOW)).toEqual({
      text: 'PR 13713 passed: 95 tests, coverage 87% ▲ +3.2%.',
      warning: false,
      hasFailedTests: false,
    });
  });

  it('adds the trophy at the excellent level and the personal records', () => {
    const { text } = finishedRunMessage(ok, { ...context, excellent: true, newBest: true, streak: 4 }, NOW);
    expect(text).toBe(
      'PR 13713 passed: 95 tests, coverage 87% ▲ +3.2% 🏆. New personal best! 4 PRs in a row above 80%.'
    );
  });

  it('does not boast of a streak of one', () => {
    expect(finishedRunMessage(ok, { ...context, streak: 1 }, NOW).text).not.toContain('in a row');
  });

  it('reports a pass without details', () => {
    expect(finishedRunMessage(run({ state: 'succeeded' }), context, NOW).text).toBe('PR 13713 passed.');
  });

  it('names the failed test', () => {
    expect(finishedRunMessage(run({ tests: failedTests(1) }), { ...context, pullRequestId: 13770 }, NOW)).toEqual({
      text: 'PR 13770 failed: 1 test failed (Other User Without Changes Sees Snackbar)',
      warning: true,
      hasFailedTests: true,
    });
  });

  it('names two tests and counts the rest', () => {
    expect(finishedRunMessage(run({ tests: failedTests(5) }), context, NOW).text).toBe(
      'PR 13713 failed: 5 tests failed (Other User Without Changes Sees Snackbar, Test 1, +3 more)'
    );
  });

  it('names the failed step', () => {
    expect(finishedRunMessage(run({ failedStep: 'Lint' }), context, NOW)).toEqual({
      text: 'PR 13713 failed at Lint',
      warning: true,
      hasFailedTests: false,
    });
  });

  it('keeps the old message for the other states', () => {
    expect(finishedRunMessage(run({ state: 'canceled' }), context, NOW).text).toBe(
      'PR 13713: User-Interface-PR-Pipeline — Canceled in 34m'
    );
  });
});
