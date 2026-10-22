import { describe, expect, it } from 'vitest';
import { summaryBadge, SummaryInput, summaryRows } from './summaryRows';

const empty: SummaryInput = { workItemsWithAlerts: 0, reviews: [], myPullRequests: [], failedRuns: 0 };
const pr = (over: Partial<SummaryInput['myPullRequests'][number]> = {}): SummaryInput['myPullRequests'][number] => ({
  isCompleted: false,
  readyToMerge: false,
  warnings: [],
  ...over,
});

describe('summaryRows', () => {
  it('shows a single muted row when nothing needs attention', () => {
    expect(summaryRows(empty).map((row) => row.id)).toEqual(['nothing']);
    expect(summaryRows(empty)[0].label).toBe('Nothing needs your attention');
  });

  it('celebrates a clean board under the other rows, only when asked and without alerts', () => {
    expect(summaryRows({ ...empty, celebrateCleanBoard: true }).map((row) => row.id)).toEqual([
      'nothing',
      'cleanBoard',
    ]);
    expect(summaryRows({ ...empty, failedRuns: 1, celebrateCleanBoard: true }).map((row) => row.id)).toEqual([
      'failedRuns',
      'cleanBoard',
    ]);
    expect(summaryRows({ ...empty, workItemsWithAlerts: 1, celebrateCleanBoard: true }).map((row) => row.id)).toEqual([
      'alerts',
    ]);
    expect(summaryRows(empty).map((row) => row.id)).toEqual(['nothing']);
    expect(summaryBadge({ ...empty, celebrateCleanBoard: true } as SummaryInput)).toBeUndefined();
  });

  it('lists only the rows with a count above 0, in order', () => {
    const rows = summaryRows({
      workItemsWithAlerts: 2,
      reviews: [{ isRequired: true, urgency: 'fresh' }],
      myPullRequests: [pr({ warnings: [{ severity: 'warning' }] }), pr({ readyToMerge: true })],
      failedRuns: 1,
    });
    expect(rows.map((row) => row.label)).toEqual([
      '2 work items need attention',
      '1 pull request waiting for your review',
      '1 of your pull request has warnings',
      '1 ready to merge',
      '1 failed CI run',
    ]);
  });

  it('puts a broken base branch first, with its pipelines', () => {
    const rows = summaryRows({
      ...empty,
      workItemsWithAlerts: 1,
      baseBranch: { branch: 'develop', brokenPipelines: ['Lint', 'User-Interface-CI'] },
    });
    expect(rows.map((row) => row.id)).toEqual(['baseBranch', 'alerts']);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        label: 'develop is broken',
        description: 'Lint, User-Interface-CI',
        icon: 'flame',
        color: 'errorForeground',
      })
    );
    expect(summaryRows({ ...empty, baseBranch: { branch: 'develop', brokenPipelines: [] } })[0].id).toBe('nothing');
  });

  it('describes the late reviews (required ones only)', () => {
    const [row] = summaryRows({
      ...empty,
      reviews: [
        { isRequired: true, urgency: 'overdue' },
        { isRequired: true, urgency: 'overdue' },
        { isRequired: true, urgency: 'dueSoon' },
        { isRequired: false, urgency: 'overdue' },
      ],
    });
    expect(row.label).toBe('4 pull requests waiting for your review');
    expect(row.description).toBe('2 overdue · 1 due soon');
  });

  it('has no description when no review is late', () => {
    expect(summaryRows({ ...empty, reviews: [{ isRequired: true, urgency: 'fresh' }] })[0].description).toBeUndefined();
  });

  it('counts errors apart and ignores the completed PRs', () => {
    const rows = summaryRows({
      ...empty,
      myPullRequests: [
        pr({ warnings: [{ severity: 'error' }, { severity: 'warning' }] }),
        pr({ warnings: [{ severity: 'warning' }] }),
        pr({ isCompleted: true, warnings: [{ severity: 'warning' }], readyToMerge: true }),
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('2 of your pull requests have warnings');
    expect(rows[0].description).toBe('1 with errors');
  });
});

describe('summaryBadge', () => {
  it('is undefined with nothing to show', () => {
    expect(summaryBadge(empty)).toBeUndefined();
  });

  it('adds the work items with alerts and the PRs waiting for review', () => {
    expect(summaryBadge({ workItemsWithAlerts: 2, reviews: [{ isRequired: true, urgency: 'fresh' }] })).toEqual({
      value: 3,
      tooltip: '2 work items need attention, 1 pull request is waiting for your review',
    });
  });

  it('counts a broken base branch once, first', () => {
    expect(
      summaryBadge({
        workItemsWithAlerts: 1,
        reviews: [],
        baseBranch: { branch: 'develop', brokenPipelines: ['A', 'B'] },
      })
    ).toEqual({ value: 2, tooltip: 'develop is broken, 1 work item needs attention' });
  });

  it('uses the singular and skips the empty reason', () => {
    expect(summaryBadge({ workItemsWithAlerts: 1, reviews: [] })).toEqual({
      value: 1,
      tooltip: '1 work item needs attention',
    });
  });
});

describe('stale worktrees row (Rule SUMMARY-10)', () => {
  it('comes after the attention rows, before the clean board, and lists why in the tooltip', () => {
    const staleWorktrees = [
      { branch: 'feature/a', reasons: 'PR 5 merged' },
      { branch: 'feature/b', reasons: 'folder missing' },
    ];
    const rows = summaryRows({ ...empty, staleWorktrees, celebrateCleanBoard: true });
    expect(rows.map((row) => row.id)).toEqual(['nothing', 'staleWorktrees', 'cleanBoard']);
    expect(rows[1].label).toBe('2 worktrees to clean up');
    expect(rows[1].tooltip).toContain('feature/a: PR 5 merged');
    expect(summaryRows({ ...empty, staleWorktrees: [] }).map((row) => row.id)).toEqual(['nothing']);
  });

  it('never counts in the badge', () => {
    expect(summaryBadge({ ...empty, staleWorktrees: [{ branch: 'a', reasons: 'x' }] } as SummaryInput)).toBeUndefined();
  });
});
