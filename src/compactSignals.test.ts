import { describe, expect, it } from 'vitest';
import { compactSignals } from './compactSignals';
import type { RunModel } from './pipelines';
import type { BranchModel, PullRequestModel, WorkItemModel } from './viewModel';

const NOW = new Date('2026-01-01T12:00:00Z');

function item(overrides: Partial<WorkItemModel> = {}): WorkItemModel {
  return {
    id: 1,
    title: 'Title',
    type: 'Product Backlog Item',
    state: 'In Progress',
    displayState: 'In Progress',
    iterationPath: 'p',
    url: '',
    alerts: [],
    isCurrentBranch: false,
    branches: [],
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
    repository: 'User_Interface',
    otherRepository: false,
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
    expect(signal).toEqual({
      kind: 'pullRequest',
      label: 'In review',
      title: 'PR 7: The PR',
      tone: 'review',
      otherRepository: false,
    });
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
    const tasks = ['To Do', 'To Do', 'In Progress', 'Done', 'Done', 'Done', 'Removed'].map((state) => ({ state }));
    const [signal] = compactSignals(item(), tasks, NOW);
    expect(signal).toEqual({
      kind: 'tasks',
      label: '2/1/3',
      title: '2 to do, 1 in progress, 3 done (to do/in progress/done)',
      tone: 'neutral',
      counts: [
        { category: 'proposed', count: 2 },
        { category: 'in-progress', count: 1 },
        { category: 'done', count: 3 },
      ],
    });
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

  it('counts several branches and lists them, the ones of other repositories marked', () => {
    const branch = (name: string, overrides: Partial<BranchModel> = {}): BranchModel => ({
      name,
      location: 'local',
      isCurrent: false,
      otherRepository: false,
      ...overrides,
    });
    const branches = [
      branch('feature/a/1-a', { location: 'current', isCurrent: true }),
      branch('feature/a/1-b', { worktree: '/w' }),
      branch('feature/a/1-c', { location: 'linked', otherRepository: true, repository: 'Common' }),
    ];
    const [signal] = compactSignals(
      item({ branch: 'feature/a/1-a', isCurrentBranch: true, branchLocation: 'local', branches }),
      [],
      NOW
    );
    expect(signal).toEqual({
      kind: 'branch',
      label: '3',
      title:
        '3 branches\nfeature/a/1-a (current)\nfeature/a/1-b (local) · worktree\nfeature/a/1-c · Common — in another repository',
      tone: 'current',
      otherRepository: false,
    });
  });

  it('dims the branch signal when every branch is in another repository', () => {
    const other: BranchModel = {
      name: 'feature/x/1',
      location: 'linked',
      isCurrent: false,
      otherRepository: true,
      repository: 'Common',
    };
    expect(compactSignals(item({ branches: [other] }), [], NOW)[0]).toMatchObject({
      kind: 'branch',
      otherRepository: true,
      title: 'feature/x/1 · Common — in another repository',
    });
  });

  it('flags the branches of completed PRs that still exist, whatever the state, and ignores the rest', () => {
    expect(compactSignals(item({ state: 'Done', branch: 'f', deletableBranches: ['f'] }), [], NOW)).toEqual([
      expect.objectContaining({ kind: 'branch', label: 'not deleted', tone: 'leftover' }),
    ]);
    expect(compactSignals(item({ state: 'Active', branch: 'f', deletableBranches: ['f'] }), [], NOW)).toEqual([
      expect.objectContaining({ kind: 'branch', label: 'not deleted', tone: 'leftover' }),
    ]);
    // Another branch is merged, the main one is not
    expect(compactSignals(item({ state: 'Active', branch: 'f', deletableBranches: ['g'] }), [], NOW)[0]).toMatchObject({
      label: '',
    });
    expect(compactSignals(item({ state: 'Done', branch: 'f' }), [], NOW)).toEqual([]);
  });

  it('keeps the order of the signals', () => {
    const signals = compactSignals(
      item({
        priority: 2,
        severity: '3 - Medium',
        branch: 'f',
        openPredecessors: [{ id: 5, title: 'T', type: 'Bug', state: 'New' }],
        pullRequests: [pr([run('running')])],
        alerts: [{ rule: 'missingField', message: 'x' }] as WorkItemModel['alerts'],
      }),
      [{ state: 'To Do' }],
      NOW
    );
    expect(kinds(signals)).toEqual([
      'priority',
      'severity',
      'completion',
      'branch',
      'pullRequest',
      'ci',
      'tasks',
      'alerts',
    ]);
  });

  it('cautions about the open predecessors with their count', () => {
    const open = (id: number) => ({ id, title: 'T', type: 'Bug', state: 'New' });
    expect(compactSignals(item({ openPredecessors: [open(5), open(6)] }), [], NOW)).toEqual([
      {
        kind: 'completion',
        label: '2',
        title: 'Cannot be completed yet: 2 open predecessors',
        tone: 'caution',
      },
    ]);
    expect(compactSignals(item({ openPredecessors: [open(5)] }), [], NOW)[0].title).toContain('1 open predecessor');
  });

  it('counts blocking tags and missing fields with the open predecessors', () => {
    const open = { id: 5, title: 'T', type: 'Bug', state: 'New' };
    expect(
      compactSignals(
        item({ openPredecessors: [open], blockingTags: ['Blocked'], missingFields: ['Acceptance criteria', 'Effort'] }),
        [],
        NOW
      )
    ).toEqual([
      {
        kind: 'completion',
        label: '4',
        title: 'Cannot be completed yet: 1 open predecessor · Tagged Blocked · Missing Acceptance criteria, Effort',
        tone: 'caution',
      },
    ]);
  });

  it('has no hint without issues, whatever the state', () => {
    expect(compactSignals(item({ state: 'New', openPredecessors: [] }), [], NOW)).toEqual([]);
    expect(compactSignals(item({ state: 'New' }), [], NOW)).toEqual([]);
    expect(compactSignals(item({ state: 'Committed', openPredecessors: [], blockingTags: [] }), [], NOW)).toEqual([]);
  });
  it('signals the bugs a Backlog Item fixes and the Backlog Item that fixes a Bug', () => {
    const link = (id: number, state = 'New') => ({ id, title: `t${id}`, state, stateCategory: 'proposed' as const });
    expect(compactSignals(item({ fixesBugs: [link(1), link(2, 'Done')] }), [], NOW)).toEqual([
      { kind: 'fixesBugs', label: '2', title: 'Fixes 2 bugs\n#1 New · t1\n#2 Done · t2', tone: 'bug' },
    ]);
    expect(compactSignals(item({ type: 'Bug', fixedBy: [link(66068, 'In Progress')] }), [], NOW)).toEqual([
      { kind: 'fixedBy', label: '66068', title: 'Fixed by\n#66068 In Progress · t66068', tone: 'backlog' },
    ]);
    expect(compactSignals(item({ type: 'Bug', fixedBy: [link(1), link(2)] }), [], NOW)[0].label).toBe('2');
    expect(compactSignals(item({ fixesBugs: [], fixedBy: [] }), [], NOW)).toEqual([]);
  });

  it('shows the working on badge first', () => {
    const signals = compactSignals(item({ priority: 2, workingOn: 'here' }), [], NOW);
    expect(signals[0]).toMatchObject({ kind: 'workingOn', label: 'Working on', tone: 'working-here' });
    expect(kinds(signals)).toEqual(['workingOn', 'priority']);
    expect(compactSignals(item({ workingOn: 'worktree', worktree: '/dev/wt' }), [], NOW)[0]).toMatchObject({
      label: 'In worktree',
      title: expect.stringContaining('/dev/wt'),
      tone: 'working-worktree',
    });
    expect(compactSignals(item(), [], NOW)).toEqual([]);
  });

  it('names the repository of a PR from another repository and flags it', () => {
    const other = pr([], { repository: 'Common_Translations', otherRepository: true });
    const signal = compactSignals(item({ pullRequests: [other] }), [], NOW).find((s) => s.kind === 'pullRequest');
    expect(signal?.otherRepository).toBe(true);
    expect(signal?.title).toBe('PR 7 · Common_Translations: The PR — in another repository');
    const own = compactSignals(item({ pullRequests: [pr()] }), [], NOW).find((s) => s.kind === 'pullRequest');
    expect(own?.otherRepository).toBe(false);
    expect(own?.title).toBe('PR 7: The PR');
  });
});
