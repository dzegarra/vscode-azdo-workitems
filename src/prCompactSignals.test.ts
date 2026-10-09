import { describe, expect, it } from 'vitest';
import type { MyPullRequestModel } from './myPullRequests';
import { myPullRequestCompactSignals, reviewCompactSignals } from './prCompactSignals';
import type { ReviewDetails } from './reviewCard';
import type { ReviewRequestModel } from './reviewRequests';

const NOW = new Date('2026-10-07T12:00:00Z');
const run = (state: 'failed' | 'queued' | 'succeeded', id = 1) => ({ id, pipeline: `pipe ${id}`, state, url: '' });

function details(overrides: Partial<ReviewDetails> = {}): ReviewDetails {
  return {
    status: 'In review',
    tone: 'review',
    timeline: { events: [], earlier: 0 },
    workItems: [],
    reviewers: [],
    conflicts: false,
    runs: [],
    autoComplete: false,
    approvalCompletes: false,
    teamRules: [],
    ...overrides,
  };
}

function review(overrides: Partial<ReviewRequestModel> = {}): ReviewRequestModel {
  return {
    id: 7,
    title: 'Title',
    url: '',
    repository: 'User_Interface',
    repositoryId: 'repo',
    author: 'Ana',
    targetBranch: 'develop',
    sourceBranch: 'feature/x',
    publishedAt: '2026-10-07T01:00:00Z',
    isRequired: true,
    urgency: 'fresh',
    timeLeft: '13 h left',
    waited: '11 h',
    elapsed: 0.46,
    dueText: 'due today 01:00',
    barCaption: '11 h of 24 h',
    barValueText: '',
    waitedHours: 11,
    ...overrides,
  };
}

function mine(overrides: Partial<MyPullRequestModel> = {}): MyPullRequestModel {
  return {
    id: 1,
    title: 'Title',
    repository: 'User_Interface',
    repositoryId: 'repo',
    url: '',
    sourceBranch: 'feature/x',
    time: '2 h',
    timeline: { events: [], earlier: 0 },
    workItems: [],
    status: 'In review',
    tone: 'review',
    isDraft: false,
    isCompleted: false,
    reviewers: [],
    conflicts: false,
    runs: [],
    autoComplete: false,
    warnings: [],
    readyToMerge: false,
    nextTone: 'pending',
    ...overrides,
  };
}

const kinds = (signals: { kind: string }[]) => signals.map(({ kind }) => kind);

describe('compact signals of the PRs waiting for review', () => {
  it('tells the role, the author and the time waited while the details are not known', () => {
    const signals = reviewCompactSignals(review(), NOW);
    expect(kinds(signals)).toEqual(['role', 'author', 'bar']);
    expect(signals[0]).toMatchObject({ label: 'Required', tone: 'required' });
    expect(signals[1]).toMatchObject({ label: 'Ana', title: 'User_Interface: Ana → develop' });
    expect(signals[2]).toMatchObject({ tone: 'fresh', elapsed: 0.46, title: '11 h of 24 h; due today 01:00' });
  });

  it('marks the optional reviews and takes the urgency colour for the bar', () => {
    const signals = reviewCompactSignals(review({ isRequired: false, urgency: 'overdue' }), NOW);
    expect(signals[0]).toMatchObject({ label: 'Optional', tone: 'optional' });
    expect(signals.find(({ kind }) => kind === 'bar')?.tone).toBe('overdue');
  });

  it('adds the worst CI state, the unresolved comments and the branch state when they apply', () => {
    const signals = reviewCompactSignals(
      review({
        details: details({ runs: [run('succeeded', 1), run('failed', 2)], unresolved: 3 }),
        worktree: '/work/x',
      }),
      NOW
    );
    expect(kinds(signals)).toEqual(['role', 'author', 'bar', 'ci', 'comments', 'branch']);
    expect(signals.find(({ kind }) => kind === 'ci')?.tone).toBe('failed');
    expect(signals.find(({ kind }) => kind === 'comments')).toMatchObject({ label: '3', tone: 'warning' });
    expect(signals.find(({ kind }) => kind === 'branch')).toMatchObject({ label: 'worktree' });
  });

  it('says nothing about CI and comments when there is none, and marks the current branch', () => {
    const signals = reviewCompactSignals(
      review({ details: details({ runs: [], unresolved: 0 }), isCurrentBranch: true, worktree: '/work/x' }),
      NOW
    );
    expect(kinds(signals)).toEqual(['role', 'author', 'bar', 'branch']);
    expect(signals.at(-1)).toMatchObject({ label: 'current', tone: 'current' });
  });
});

describe('compact signals of my PRs', () => {
  it('has none besides the next step for a PR without CI, comments nor warnings', () => {
    const signals = myPullRequestCompactSignals(mine({ next: 'Wait for 2 more approvals' }), NOW);
    expect(signals).toEqual([
      expect.objectContaining({ kind: 'next', label: 'Wait for 2 more approvals', tone: 'pending' }),
    ]);
    expect(myPullRequestCompactSignals(mine(), NOW)).toEqual([]);
  });

  it('lists the next step, CI, comments, warnings, auto-complete and ready to merge in order', () => {
    const signals = myPullRequestCompactSignals(
      mine({
        next: 'Ready to merge',
        nextTone: 'ready',
        runs: [run('queued')],
        unresolved: 2,
        warnings: [
          { text: 'Missing release notes', severity: 'warning' },
          { text: 'Linked to a Bug', severity: 'error' },
        ],
        autoComplete: true,
        readyToMerge: true,
      }),
      NOW
    );
    expect(kinds(signals)).toEqual(['next', 'ci', 'comments', 'warnings', 'autoComplete', 'ready']);
    expect(signals[3]).toMatchObject({ label: '2', tone: 'error', title: 'Missing release notes\nLinked to a Bug' });
  });

  it('shows the warnings as a warning when none is an error', () => {
    const signals = myPullRequestCompactSignals(mine({ warnings: [{ text: 'Careful', severity: 'warning' }] }), NOW);
    expect(signals[0]).toMatchObject({ kind: 'warnings', tone: 'warning' });
  });

  it('only tells when a completed PR was completed', () => {
    expect(
      myPullRequestCompactSignals(mine({ isCompleted: true, time: 'completed 3 h ago', next: 'ignored' }), NOW)
    ).toEqual([expect.objectContaining({ kind: 'time', label: 'completed 3 h ago' })]);
  });
});
