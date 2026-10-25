import { describe, expect, it } from 'vitest';
import { stationNotes, type NotesCard, type NotesPullRequest } from './stationNotes';
import type { PullRequestModel } from './viewModel';
import type { ReviewerModel } from './myPullRequests';
import type { RunModel } from './pipelines';

const branch = (location: 'current' | 'linked' | 'local' | 'remote', worktree?: string) => ({
  name: 'feature/x/1-a',
  location,
  isCurrent: location === 'current',
  worktree,
  otherRepository: false,
});

const pr = (overrides: Partial<PullRequestModel> = {}): PullRequestModel => ({
  id: 7,
  title: 'PR',
  status: 'In review',
  tone: 'review',
  url: '',
  isActive: true,
  runs: [],
  repository: 'User_Interface',
  otherRepository: false,
  ...overrides,
});

const card = (overrides: Partial<NotesCard> = {}): NotesCard => ({
  branch: 'feature/x/1-a',
  branches: [branch('local')],
  pullRequests: [],
  state: 'Committed',
  type: 'Product Backlog Item',
  ...overrides,
});

const reviewer = (name: string, overrides: Partial<ReviewerModel> = {}): ReviewerModel => ({
  name,
  vote: 'none',
  isRequired: true,
  isContainer: false,
  ...overrides,
});

const mine = (overrides: Partial<NotesPullRequest> = {}): NotesPullRequest => ({
  id: 7,
  autoComplete: false,
  canComplete: false,
  isCompleted: false,
  isDraft: false,
  reviewers: [],
  runs: [],
  time: '1 d 2 h',
  ...overrides,
});

const run = (overrides: Partial<RunModel> = {}): RunModel => ({
  id: 1,
  pipeline: 'ci',
  state: 'succeeded',
  url: '',
  ...overrides,
});

describe('stationNotes', () => {
  it('says where the branch is, and the worktree that has it', () => {
    expect(stationNotes({ card: card() }).branch).toEqual(['feature/x/1-a', 'local']);
    expect(stationNotes({ card: card({ branches: [branch('current')] }) }).branch[1]).toBe('checked out here');
    expect(stationNotes({ card: card({ branches: [branch('remote')] }) }).branch[1]).toBe('only in the remote');
    expect(stationNotes({ card: card({ branches: [branch('linked')] }) }).branch[1]).toBe('linked only');
    expect(stationNotes({ card: card({ branches: [branch('local', '/work/tree-a')] }) }).branch[1]).toBe(
      'local · in worktree tree-a'
    );
    expect(stationNotes({ card: card({ branch: undefined, branches: [] }) }).branch).toEqual(['No branch yet']);
  });

  it('describes the PR: none, draft, published (mine or not), other repository', () => {
    expect(stationNotes({ card: card() }).pullRequest).toEqual([
      'No PR yet',
      'Opens as draft: self-review, then publish',
    ]);
    expect(stationNotes({ card: card({ branch: undefined, branches: [] }) }).pullRequest).toEqual(['After the branch']);
    const draft = card({ pullRequests: [pr({ tone: 'draft', status: 'Draft' })] });
    expect(stationNotes({ card: draft }).pullRequest).toEqual(['PR 7 · draft', 'Self-review, then publish']);
    const published = card({ pullRequests: [pr()] });
    expect(stationNotes({ card: published, mine: mine() }).pullRequest).toEqual(['PR 7 · published 1 d 2 h ago']);
    expect(stationNotes({ card: published }).pullRequest).toEqual(['PR 7 · In review']);
    const completed = card({ pullRequests: [pr({ tone: 'completed' })] });
    expect(
      stationNotes({ card: completed, mine: mine({ isCompleted: true, time: 'completed 3 h ago' }) }).pullRequest
    ).toEqual(['PR 7 · completed 3 h ago']);
    const other = card({ pullRequests: [pr({ otherRepository: true, repository: 'Common_Translations' })] });
    expect(stationNotes({ card: other }).pullRequest[0]).toBe('PR 7 · In review · Common_Translations');
  });

  it('starts CI and review when the draft is published', () => {
    const draft = card({ pullRequests: [pr({ tone: 'draft' })] });
    expect(stationNotes({ card: draft }).ci).toEqual(['Starts when the draft is published']);
    expect(stationNotes({ card: draft }).review).toEqual(['Starts when the draft is published']);
    expect(stationNotes({ card: card() }).ci).toEqual(['Starts when the draft is published']);
  });

  it('sums tests and shows the coverage with its change', () => {
    const runs = [
      run({ tests: { total: 60, failed: 0, failedTests: [] } }),
      run({
        id: 2,
        tests: { total: 35, failed: 0, failedTests: [] },
        coverage: { percent: 87.2, covered: 1, total: 1, delta: 3.24, files: [] },
      }),
    ];
    const withRuns = card({ pullRequests: [pr({ runs })] });
    expect(stationNotes({ card: withRuns }).ci).toEqual(['95 tests · 87% ▲ 3.2']);
    const down = [run({ coverage: { percent: 80, covered: 1, total: 1, delta: -1, files: [] } })];
    expect(stationNotes({ card: card({ pullRequests: [pr({ runs: down })] }) }).ci).toEqual(['80% ▼ 1.0']);
  });

  it('names failed tests, the failed step, and runs in flight', () => {
    const failedTests = [run({ state: 'failed', tests: { total: 95, failed: 3, failedTests: [] } })];
    expect(stationNotes({ card: card({ pullRequests: [pr({ runs: failedTests })] }) }).ci).toEqual([
      '3 of 95 tests failed',
    ]);
    const lint = [run({ state: 'failed', failedStep: 'Linting' })];
    expect(stationNotes({ card: card({ pullRequests: [pr({ runs: lint })] }) }).ci).toEqual(['Linting failed']);
    const running = [run({ state: 'running' })];
    expect(stationNotes({ card: card({ pullRequests: [pr({ runs: running })] }) }).ci).toEqual(['running']);
    expect(stationNotes({ card: card({ pullRequests: [pr()] }) }).ci).toEqual(['No run yet']);
    expect(stationNotes({ card: card({ pullRequests: [pr()] }), mine: mine({ runs: running }) }).ci).toEqual([
      'running',
    ]);
  });

  it('counts the required approvals and names who is missing', () => {
    const reviewers = [
      reviewer('Ana Ruiz'),
      reviewer('Jonas Berg', { vote: 'approved' }),
      reviewer('Team', { isContainer: true }),
      reviewer('Optional', { isRequired: false }),
    ];
    const withPr = card({ pullRequests: [pr()] });
    expect(stationNotes({ card: withPr, mine: mine({ reviewers }) }).review).toEqual([
      '1 of 2 required approved',
      'approval of Ana Ruiz missing',
    ]);
    const many = ['A', 'B', 'C'].map((name) => reviewer(name));
    expect(stationNotes({ card: withPr, mine: mine({ reviewers: many }) }).review[1]).toBe(
      'approval of A, B +1 missing'
    );
    const sentBack = [reviewer('Ana', { vote: 'rejected' }), reviewer('Bo', { vote: 'waiting' })];
    expect(stationNotes({ card: withPr, mine: mine({ reviewers: sentBack }) }).review).toEqual([
      '0 of 2 required approved',
      'approval of Ana, Bo missing',
      'Ana rejected',
      'Bo is waiting for you',
    ]);
    expect(
      stationNotes({ card: withPr, mine: mine({ reviewers: [reviewer('X', { isRequired: false })] }) }).review
    ).toEqual(['1 reviewers']);
    expect(stationNotes({ card: withPr }).review).toEqual(['In review']);
  });

  it('says how the merge goes', () => {
    const withPr = card({ pullRequests: [pr()] });
    expect(stationNotes({ card: withPr }).ready).toEqual(['squash · delete branch']);
    expect(stationNotes({ card: withPr, mine: mine({ autoComplete: true }) }).ready).toEqual(['auto-complete set']);
    expect(stationNotes({ card: withPr, mine: mine({ canComplete: true }) }).ready).toEqual([
      'Complete… from My Pull Requests: squash, delete branch',
    ]);
    expect(stationNotes({ card: card({ pullRequests: [pr({ tone: 'completed' })] }) }).ready).toEqual(['merged']);
  });

  it('explains the last station per type, and removed work items', () => {
    const bug = card({ type: 'Bug' });
    expect(stationNotes({ card: bug, integrationBuild: '0.24.63' }).done).toEqual(['Integrated in Build 0.24.63']);
    expect(stationNotes({ card: bug }).done[0]).toContain('Integrated in Build is set');
    expect(stationNotes({ card: card() }).done).toEqual(['When no other task or PR is open']);
    const removed = stationNotes({ card: card({ state: 'Removed' }) });
    expect(removed.done).toEqual(['removed']);
    expect(removed.branch).toEqual([]);
  });
});
