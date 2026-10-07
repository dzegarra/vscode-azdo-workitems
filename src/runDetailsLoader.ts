/** Loads the tests and coverage of finished runs, once per build. No "vscode" import */
import { CoverageSummary, shapeCoverage } from './coverage';
import { RunModel, TestSummary } from './pipelines';
import { failedStepOf, MAX_LISTED_TESTS, summarizeTests } from './runDetails';
import type { AzdoClient } from './azdoClient';

export type RunDetailsSource = Pick<
  AzdoClient,
  'getBuildCoverageFiles' | 'getBuildCoverageSummary' | 'getBuildTestRuns' | 'getBuildTimeline' | 'getTestRunFailures'
>;

interface Outcome {
  tests?: TestSummary;
  failedStep?: string;
}

/** Runs that have a result worth explaining */
function isExplainable(run: Pick<RunModel, 'state'>): boolean {
  return run.state === 'succeeded' || run.state === 'failed' || run.state === 'partial';
}

/**
 * Keeps what was read about each finished build: it does not change, so every build is asked once.
 * Whatever cannot be read is left out of the run (and asked again next time)
 */
export class RunDetailsLoader {
  private readonly outcomes = new Map<number, Outcome>();
  /** Only the final ones: Azure DevOps may still be processing the coverage of a recent build */
  private readonly coverages = new Map<number, CoverageSummary | null>();
  private readonly pending = new Map<string, Promise<unknown>>();

  /** Runs with their tests, failed step and coverage when finished and known */
  async enrich(source: RunDetailsSource, runs: RunModel[]): Promise<RunModel[]> {
    return Promise.all(runs.map((run) => this.enrichRun(source, run)));
  }

  private async enrichRun(source: RunDetailsSource, run: RunModel): Promise<RunModel> {
    if (!isExplainable(run)) {
      return run;
    }
    const [outcome, coverage] = await Promise.all([
      this.once(`outcome:${run.id}`, () => this.outcomeOf(source, run)),
      run.state === 'succeeded' || run.state === 'partial'
        ? this.once(`coverage:${run.id}`, () => this.coverageOf(source, run.id))
        : undefined,
    ]);
    return { ...run, ...outcome, ...(coverage ? { coverage } : {}) };
  }

  /** Concurrent callers (the store and the PRs list) share a request */
  private once<T>(key: string, load: () => Promise<T>): Promise<T> {
    const running = this.pending.get(key) as Promise<T> | undefined;
    if (running) {
      return running;
    }
    const promise = load().finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }

  private async outcomeOf(source: RunDetailsSource, run: RunModel): Promise<Outcome | undefined> {
    const known = this.outcomes.get(run.id);
    if (known) {
      return known;
    }
    try {
      const testRuns = await source.getBuildTestRuns(run.id);
      const mayHaveFailures = testRuns.filter(
        (testRun) => testRun.passedTests + (testRun.notApplicableTests ?? 0) < testRun.totalTests
      );
      const failures = new Map(
        await Promise.all(
          mayHaveFailures.map(
            async (testRun) => [testRun.id, await source.getTestRunFailures(testRun.id, MAX_LISTED_TESTS)] as const
          )
        )
      );
      const tests = summarizeTests(
        testRuns,
        testRuns.map((testRun) => failures.get(testRun.id))
      );
      const failedStep =
        run.state === 'failed' && !tests?.failed ? failedStepOf(await source.getBuildTimeline(run.id)) : undefined;
      const outcome = { tests, failedStep };
      this.outcomes.set(run.id, outcome);
      return outcome;
    } catch {
      return undefined;
    }
  }

  private async coverageOf(source: RunDetailsSource, buildId: number): Promise<CoverageSummary | null | undefined> {
    const known = this.coverages.get(buildId);
    if (known !== undefined) {
      return known;
    }
    try {
      const summary = await source.getBuildCoverageSummary(buildId);
      const files = await source.getBuildCoverageFiles(buildId).catch(() => undefined);
      const { coverage, final } = shapeCoverage(summary, files);
      // Without the files, the answer is incomplete: ask again next time
      if (final && (files || !coverage)) {
        this.coverages.set(buildId, coverage ?? null);
      }
      return coverage;
    } catch {
      return undefined;
    }
  }
}

/** Shared by everything that shows runs, so a build is read once */
export const runDetailsLoader = new RunDetailsLoader();
