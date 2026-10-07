import { describe, expect, it, vi } from 'vitest';
import { RunModel } from './pipelines';
import { RunDetailsLoader, RunDetailsSource } from './runDetailsLoader';

const run = (id: number, state: RunModel['state']): RunModel => ({
  id,
  pipeline: 'PR',
  state,
  url: `https://build/${id}`,
});

const source = (overrides: Partial<RunDetailsSource> = {}): RunDetailsSource => ({
  getBuildTestRuns: vi.fn().mockResolvedValue([{ id: 1, totalTests: 10, passedTests: 10 }]),
  getTestRunFailures: vi.fn().mockResolvedValue({ failed: 0, results: [] }),
  getBuildTimeline: vi.fn().mockResolvedValue([{ type: 'Task', name: 'Linting', result: 'failed', order: 1 }]),
  getBuildCoverageSummary: vi.fn().mockResolvedValue({
    status: 'finalized',
    coverageDetailedSummaryStatus: 'finalized',
    coverageData: [{ coverageStats: [{ label: 'Lines', covered: 9, total: 10, delta: 1, isDeltaAvailable: true }] }],
  }),
  getBuildCoverageFiles: vi.fn().mockResolvedValue({ value: [] }),
  ...overrides,
});

describe('RunDetailsLoader', () => {
  it('adds the tests and the coverage to a successful run', async () => {
    const [enriched] = await new RunDetailsLoader().enrich(source(), [run(1, 'succeeded')]);
    expect(enriched.tests).toEqual({ total: 10, failed: 0, failedTests: [] });
    expect(enriched.coverage?.percent).toBe(90);
    expect(enriched.failedStep).toBeUndefined();
  });

  it('asks each finished build once', async () => {
    const api = source();
    const loader = new RunDetailsLoader();
    await loader.enrich(api, [run(1, 'succeeded')]);
    await loader.enrich(api, [run(1, 'succeeded')]);
    expect(api.getBuildTestRuns).toHaveBeenCalledTimes(1);
    expect(api.getBuildCoverageSummary).toHaveBeenCalledTimes(1);
  });

  it('does not ask for the runs that are not finished', async () => {
    const api = source();
    const runs = [run(1, 'running'), run(2, 'queued'), run(3, 'canceled')];
    expect(await new RunDetailsLoader().enrich(api, runs)).toEqual(runs);
    expect(api.getBuildTestRuns).not.toHaveBeenCalled();
  });

  it('does not cache a coverage that is still being processed', async () => {
    const api = source({
      getBuildCoverageSummary: vi.fn().mockResolvedValue({ status: 'inProgress', coverageData: [] }),
    });
    const loader = new RunDetailsLoader();
    await loader.enrich(api, [run(1, 'succeeded')]);
    await loader.enrich(api, [run(1, 'succeeded')]);
    expect(api.getBuildCoverageSummary).toHaveBeenCalledTimes(2);
    expect(api.getBuildTestRuns).toHaveBeenCalledTimes(1);
  });

  it('caches a final answer without coverage', async () => {
    const api = source({
      getBuildCoverageSummary: vi
        .fn()
        .mockResolvedValue({ status: 'finalized', coverageDetailedSummaryStatus: 'noModulesFound', coverageData: [] }),
    });
    const loader = new RunDetailsLoader();
    const [enriched] = await loader.enrich(api, [run(1, 'succeeded')]);
    await loader.enrich(api, [run(1, 'succeeded')]);
    expect(enriched.coverage).toBeUndefined();
    expect(api.getBuildCoverageSummary).toHaveBeenCalledTimes(1);
  });

  it('reads the failed tests of a failed run, and not the timeline', async () => {
    const api = source({
      getBuildTestRuns: vi.fn().mockResolvedValue([{ id: 7, totalTests: 10, passedTests: 9 }]),
      getTestRunFailures: vi
        .fn()
        .mockResolvedValue({ failed: 1, results: [{ testCaseTitle: 'It breaks', automatedTestStorage: 'a.spec.ts' }] }),
    });
    const [enriched] = await new RunDetailsLoader().enrich(api, [run(1, 'failed')]);
    expect(enriched.tests?.failed).toBe(1);
    expect(enriched.tests?.failedTests[0].title).toBe('It breaks');
    expect(enriched.failedStep).toBeUndefined();
    expect(api.getBuildTimeline).not.toHaveBeenCalled();
    expect(api.getBuildCoverageSummary).not.toHaveBeenCalled();
  });

  it('finds the failed step when no test failed', async () => {
    const api = source({ getBuildTestRuns: vi.fn().mockResolvedValue([]) });
    const [enriched] = await new RunDetailsLoader().enrich(api, [run(1, 'failed')]);
    expect(enriched.failedStep).toBe('Linting');
    expect(enriched.tests).toBeUndefined();
  });

  it('leaves out what cannot be read, and tries again later', async () => {
    const api = source({
      getBuildTestRuns: vi.fn().mockRejectedValue(new Error('403')),
      getBuildCoverageSummary: vi.fn().mockRejectedValue(new Error('500')),
    });
    const loader = new RunDetailsLoader();
    const [enriched] = await loader.enrich(api, [run(1, 'succeeded')]);
    expect(enriched).toEqual(run(1, 'succeeded'));
    await loader.enrich(api, [run(1, 'succeeded')]);
    expect(api.getBuildTestRuns).toHaveBeenCalledTimes(2);
  });

  it('shares the requests of concurrent callers', async () => {
    const api = source();
    const loader = new RunDetailsLoader();
    await Promise.all([loader.enrich(api, [run(1, 'succeeded')]), loader.enrich(api, [run(1, 'succeeded')])]);
    expect(api.getBuildTestRuns).toHaveBeenCalledTimes(1);
  });
});
