/** Why a CI run failed, and how runs are described with their tests and coverage. Pure, so no "vscode" import */
import { describeCoverage } from './coverage';
import { describeRun, FailedTest, RunModel, TestSummary } from './pipelines';

/** Failed tests listed in the tooltips */
export const MAX_LISTED_TESTS = 5;
const MAX_ERROR_LENGTH = 140;
/** Failed tests named in a notification */
const MAX_NAMED_TESTS = 2;
/** Azure DevOps view of a build with its tests */
const TESTS_VIEW = 'view=ms.vss-test-web.build-test-results-tab';

/* Colour codes: with or without the escape character (Azure DevOps replaces it with a space) */
// The escape character is what the colour codes start with
// eslint-disable-next-line no-control-regex
const ANSI = /(?:\u001b|\s)?\[\d+(?:;\d+)*m/g;
/** Storybook adds this line to every error; it says nothing about the failure */
const STORYBOOK_HINT = /Click to debug the error directly in Storybook: \S+/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** The first meaningful line of an error message, short and without colour codes */
export function firstErrorLine(message: string | undefined): string {
  const lines = stripAnsi(message ?? '')
    .replace(STORYBOOK_HINT, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const line = lines.at(0) ?? '';
  return line.length > MAX_ERROR_LENGTH ? `${line.slice(0, MAX_ERROR_LENGTH - 1)}…` : line;
}

/* ---------- Azure DevOps payloads ---------- */

export interface RawTestRun {
  id: number;
  totalTests: number;
  passedTests: number;
  notApplicableTests?: number;
}

export interface RawFailedResult {
  testCaseTitle?: string;
  automatedTestName?: string;
  automatedTestStorage?: string;
  errorMessage?: string;
}

/** Failures of one test run: how many, and the first ones */
export interface RunFailures {
  failed: number;
  results: RawFailedResult[];
}

/** Tests of a build from its test runs and, for each one, its failures (same order). Undefined: no tests ran */
export function summarizeTests(runs: RawTestRun[], failures: (RunFailures | undefined)[]): TestSummary | undefined {
  const total = runs.reduce((sum, run) => sum + run.totalTests - (run.notApplicableTests ?? 0), 0);
  if (total <= 0) {
    return undefined;
  }
  const known = failures.filter((entry): entry is RunFailures => !!entry);
  const failedTests: FailedTest[] = known
    .flatMap((entry) => entry.results)
    .map((result) => ({
      title: result.testCaseTitle ?? result.automatedTestName ?? 'Unnamed test',
      file: result.automatedTestStorage ?? '',
      error: firstErrorLine(result.errorMessage),
    }))
    .slice(0, MAX_LISTED_TESTS);
  const failed = known.reduce((sum, entry) => sum + Math.max(entry.failed, entry.results.length), 0);
  return { total, failed, failedTests };
}

export interface RawTimelineRecord {
  type: string;
  name: string;
  result?: string | null;
  order?: number;
}

/**
 * The step to blame when no test failed: the first failed task, ignoring the ones that publish results
 * (they fail by themselves now and then, and they are not the cause), unless there is nothing else
 */
export function failedStepOf(records: RawTimelineRecord[]): string | undefined {
  const failed = records
    .filter((record) => record.type === 'Task' && record.result === 'failed')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return (failed.find((record) => !record.name.startsWith('Publish')) ?? failed.at(0))?.name;
}

/* ---------- Texts ---------- */

/** Page of the tests of a run in Azure DevOps */
export function testsUrl(runUrl: string): string {
  return `${runUrl}${runUrl.includes('?') ? '&' : '?'}${TESTS_VIEW}`;
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** The run has tests that failed */
export function hasFailedTests(run: Pick<RunModel, 'state' | 'tests'>): boolean {
  return run.state === 'failed' && (run.tests?.failed ?? 0) > 0;
}

export interface RunLabel {
  /** Short text of the pill, without a mark: the pills have an icon */
  text: string;
  /** The run failed because of its tests: clicking it should open them */
  opensTests: boolean;
}

/** "3 tests failed", "Failed at Linting", "95 tests", "Running 12m"… */
export function runLabel(run: RunModel, now: Date): RunLabel {
  if (hasFailedTests(run)) {
    return { text: `${plural(run.tests?.failed ?? 0, 'test')} failed`, opensTests: true };
  }
  if (run.state === 'failed' && run.failedStep) {
    return { text: `Failed at ${run.failedStep}`, opensTests: false };
  }
  if (run.state === 'succeeded' && run.tests) {
    return { text: plural(run.tests.total, 'test'), opensTests: false };
  }
  return { text: describeRun(run, now), opensTests: false };
}

const MARKS: Partial<Record<RunModel['state'], string>> = { failed: '✗', partial: '!', succeeded: '✓' };

/** The label with a mark when it does not already say how the run ended, for the places without icons */
export function runText(run: RunModel, now: Date): string {
  const mark = MARKS[run.state];
  const { text } = runLabel(run, now);
  // "Failed in 34m" already says it
  return mark && text !== describeRun(run, now) ? `${mark} ${text}` : text;
}

function failedTestLines(tests: TestSummary): string[] {
  const lines = tests.failedTests
    .slice(0, MAX_LISTED_TESTS)
    .flatMap((test) => [
      `• ${test.title}${test.file ? ` (${test.file})` : ''}`,
      ...(test.error ? [`    ${test.error}`] : []),
    ]);
  const more = tests.failed - Math.min(tests.failedTests.length, MAX_LISTED_TESTS);
  return more > 0 ? [...lines, `… and ${more} more`] : lines;
}

/** Failed tests of a failed run, or the coverage of a successful one, one per line */
export function runExtraLines(run: RunModel): string[] {
  if (hasFailedTests(run) && run.tests) {
    return failedTestLines(run.tests);
  }
  return run.state === 'succeeded' && run.coverage ? [describeCoverage(run.coverage)] : [];
}

/** Everything known about a run, as lines of a tooltip: "Pipeline: ✗ 1 test failed", the failures, "Failed in 34m" */
export function runDetailLines(run: RunModel, now: Date): string[] {
  const duration = describeRun(run, now);
  return [
    `${run.pipeline}: ${runText(run, now)}`,
    ...runExtraLines(run),
    ...(runLabel(run, now).text === duration ? [] : [duration]),
  ];
}

export function runTooltip(run: RunModel, now: Date): string {
  return runDetailLines(run, now).join('\n');
}

/* ---------- Notification of a finished run ---------- */

export interface FinishedRunContext {
  pullRequestId: number;
  /** The coverage of this run is the best of the user */
  newBest?: boolean;
  /** PRs of the user in a row at or above the target; the coverage target */
  streak?: number;
  target: number;
  /** The coverage is at the excellent level */
  excellent?: boolean;
}

export interface FinishedRunMessage {
  text: string;
  /** Warning (true) or information */
  warning: boolean;
  /** "Show tests" is offered */
  hasFailedTests: boolean;
}

/** "failed: 2 tests failed (A, B, +1 more)", "failed at Linting", "failed" */
function failureReason(run: RunModel): string {
  if (hasFailedTests(run) && run.tests) {
    const titles = run.tests.failedTests.map((test) => test.title);
    const listed = titles.slice(0, MAX_NAMED_TESTS).join(', ');
    const rest = run.tests.failed - Math.min(titles.length, MAX_NAMED_TESTS);
    const names = listed ? ` (${listed}${rest > 0 ? `, +${rest} more` : ''})` : '';
    return `failed: ${plural(run.tests.failed, 'test')} failed${names}`;
  }
  return run.failedStep ? `failed at ${run.failedStep}` : 'failed';
}

/** "PR 13713 passed: 95 tests, coverage 87% ▲ +3.2% 🏆" / "PR 13770 failed: 1 test failed (Name)" */
export function finishedRunMessage(run: RunModel, context: FinishedRunContext, now = new Date()): FinishedRunMessage {
  const pr = `PR ${context.pullRequestId}`;
  if (run.state === 'succeeded') {
    const details = [
      run.tests ? plural(run.tests.total, 'test') : undefined,
      run.coverage ? `${describeCoverage(run.coverage)}${context.excellent ? ' 🏆' : ''}` : undefined,
    ].filter(Boolean);
    const records = [
      context.newBest ? 'New personal best!' : undefined,
      context.streak && context.streak >= 2
        ? `${context.streak} PRs in a row above ${Math.round(context.target)}%.`
        : undefined,
    ].filter(Boolean);
    const text = `${pr} passed${details.length ? `: ${details.join(', ')}` : ''}`;
    return { text: [`${text}.`, ...records].join(' '), warning: false, hasFailedTests: false };
  }
  if (run.state === 'failed') {
    return { text: `${pr} ${failureReason(run)}`, warning: true, hasFailedTests: hasFailedTests(run) };
  }
  return {
    text: `${pr}: ${run.pipeline} — ${describeRun(run, now)}`,
    warning: run.state === 'partial',
    hasFailedTests: false,
  };
}
