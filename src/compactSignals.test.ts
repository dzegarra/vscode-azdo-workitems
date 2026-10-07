import { describe, expect, it } from 'vitest';
import { compactSignals } from './compactSignals';
import type { RunModel } from './pipelines';
import type { PullRequestModel, WorkItemModel } from './viewModel';

const NOW = new Date('2026-01-01T12:00:00Z');

function item(overrides: Partial<WorkItemModel> = {}): WorkItemModel {
  return {
    id: 1,
    title: 'Title',
    type: 'Product Backlog Item',
    state: 'In Progress',
    iterationPath: 'p',
    url: '',
    alerts: [],
    isCurrentBranch: false,
    pullRequests: [],
    ...overrides,
  };
}

const run = (state: RunModel['state'], id = 1): RunModel => ({ id, pipeline: `pipe ${id}`, state, url: '' });

function pr(runs: RunModel[] = [], overrides: Partial<PullRequestModel> = {}): PullRequestModel {
  return {
    id: 7,
    title: 'The PR',
    status: 'In review',
    tone: 'review',
    url: '',
    isActive: true,
    runs,
    ...overrides,
  };
}

const kinds = (signals: { kind: string }[]) => signals.map((signal) => signal.kind);

describe('compactSignals', () => {
  it('has nothing to say about a bare work item', () => {
    expect(compactSignals(item(), [], NOW)).toEqual([]);
  });

  it('shows priority and severity pills', () => {
    const signals = compactSignals(item({ type: 'Bug', priority: 1, severity: '2 - High' }), [], NOW);
    expect(signals).toEqual([
      { kind: 'priority', label: 'P1', title: 'Bug · Priority 1', tone: 'urgency-1' },
      { kind: 'severity', label: 'S2', title: 'Severity 2 - High', tone: 'urgency-2' },
    ]);
  });

  it('shows no PR signal without PR, and the state of the first one otherwise', () => {
    expect(kinds(compactSignals(item(), [], NOW))).not.toContain('pullRequest');
    const [signal] = compactSignals(
      item({ pullRequests: [pr(), pr([], { id: 8, status: 'Draft', tone: 'draft' })] }),
      [],
      NOW
    );
    expect(signal).toEqual({ kind: 'pullRequest', label: 'In review', title: 'PR 7: The PR', tone: 'review' });
  });

  it('summarises the CI runs with the worst state first', () => {
    const ciOf = (...states: RunModel['state'][]) =>
      compactSignals(item({ pullRequests: [pr(states.map((state, i) => run(state, i)))] }), [], NOW).find(
        (signal) => signal.kind === 'ci'
      )?.tone;
    expect(ciOf('succeeded', 'queued', 'running', 'failed')).toBe('failed');
    expect(ciOf('succeeded', 'queued', 'running')).toBe('running');
    expect(ciOf('succeeded', 'queued')).toBe('queued');
    expect(ciOf('succeeded', 'succeeded')).toBe('succeeded');
    expect(ciOf('canceled')).toBeUndefined();
    expect(ciOf()).toBeUndefined();
  });

  it('ignores the CI of a PR that is not active', () => {
    const signals = compactSignals(item({ pullRequests: [pr([run('failed')], { isActive: false })] }), [], NOW);
    expect(kinds(signals)).toEqual(['pullRequest']);
  });

  it('lists every pipeline in the CI tooltip', () => {
    const signal = compactSignals(item({ pullRequests: [pr([run('failed', 1), run('succeeded', 2)])] }), [], NOW).find(
      ({ kind }) => kind === 'ci'
    );
    expect(signal?.title).toBe('pipe 1: Failed\npipe 2: Succeeded');
  });

  it('explains the failure of a run in the CI tooltip', () => {
    const failed: RunModel = {
      ...run('failed', 1),
      tests: { total: 10, failed: 1, failedTests: [{ title: 'It breaks', file: 'a.spec.ts', error: 'boom' }] },
    };
    const linting: RunModel = { ...run('failed', 2), failedStep: 'Linting' };
    const signal = compactSignals(item({ pullRequests: [pr([failed, linting])] }), [], NOW).find(
      ({ kind }) => kind === 'ci'
    );
    expect(signal?.title).toBe(
      [
        'pipe 1: ✗ 1 test failed',
        '• It breaks (a.spec.ts)',
        '    boom',
        'Failed',
        'pipe 2: ✗ Failed at Linting',
        'Failed',
      ].join('\n')
    );
  });

  it('counts the tasks but the removed ones', () => {
    const tasks = [{ state: 'Done' }, { state: 'To Do' }, { state: 'Removed' }];
    const [signal] = compactSignals(item(), tasks, NOW);
    expect(signal).toEqual({ kind: 'tasks', label: '1/2', title: '1 of 2 tasks done', tone: 'neutral' });
    expect(compactSignals(item(), [{ state: 'Done' }, { state: 'Removed' }], NOW)[0].tone).toBe('approved');
    expect(compactSignals(item(), [{ state: 'Removed' }], NOW)).toEqual([]);
  });

  it('counts the alerts', () => {
    const alerts = [
      { rule: 'tasksNotDone', message: 'Open tasks' },
      { rule: 'missingField', message: 'No build' },
    ] as WorkItemModel['alerts'];
    const [signal] = compactSignals(item({ alerts }), [], NOW);
    expect(signal).toEqual({ kind: 'alerts', label: '2', title: 'Open tasks\nNo build', tone: 'rejected' });
  });

  it('marks the checked out branch', () => {
    const [signal] = compactSignals(
      item({ branch: 'feature/1', isCurrentBranch: true, branchLocation: 'local' }),
      [],
      NOW
    );
    expect(signal).toMatchObject({ kind: 'branch', label: 'current', tone: 'current' });
  });

  it('shows the other branches with the icon only', () => {
    expect(compactSignals(item({ branch: 'f', branchLocation: 'local' }), [], NOW)[0]).toMatchObject({
      label: '',
      tone: 'local',
    });
    expect(compactSignals(item({ branch: 'f' }), [], NOW)[0]).toMatchObject({ label: '', tone: 'remote' });
  });

  it('flags the leftover branch of a finished work item, and ignores a deleted one', () => {
    const leftover = { name: 'f', local: false, remote: true };
    expect(compactSignals(item({ state: 'Done', branch: 'f', leftoverBranch: leftover }), [], NOW)).toEqual([
      expect.objectContaining({ kind: 'branch', label: 'not deleted', tone: 'leftover' }),
    ]);
    expect(compactSignals(item({ state: 'Done', branch: 'f' }), [], NOW)).toEqual([]);
  });

  it('keeps the order of the signals', () => {
    const signals = compactSignals(
      item({
        priority: 2,
        severity: '3 - Medium',
        branch: 'f',
        pullRequests: [pr([run('running')])],
        alerts: [{ rule: 'missingField', message: 'x' }] as WorkItemModel['alerts'],
      }),
      [{ state: 'To Do' }],
      NOW
    );
    expect(kinds(signals)).toEqual(['priority', 'severity', 'branch', 'pullRequest', 'ci', 'tasks', 'alerts']);
  });
});
