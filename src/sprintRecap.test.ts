import { describe, expect, it } from 'vitest';
import { EMPTY_JOURNAL, FunJournal } from './funJournal';
import { renderRecapBody, reviewKarma, sprintRecap } from './sprintRecap';

const sprint = { name: 'Platform Sprint 123', startDate: '2026-10-14T00:00:00Z', finishDate: '2026-10-27T00:00:00Z' };
const IN = '2026-10-20T10:00:00Z';
const BEFORE = '2026-10-01T10:00:00Z';

const journal: FunJournal = {
  ...EMPTY_JOURNAL,
  runs: [
    { id: 1, ok: true, at: '2026-10-15T10:00:00Z' },
    { id: 2, ok: true, at: '2026-10-16T10:00:00Z' },
    { id: 3, ok: true, at: '2026-10-17T10:00:00Z' },
    { id: 4, ok: false, at: '2026-10-18T10:00:00Z' },
    { id: 5, ok: false, at: BEFORE },
  ],
  merged: [
    { id: 10, title: 'Quick <fix>', publishedAt: '2026-10-20T08:00:00Z', mergedAt: '2026-10-20T10:00:00Z' },
    { id: 11, title: 'Big feature', publishedAt: '2026-10-15T08:00:00Z', mergedAt: '2026-10-21T08:00:00Z' },
    { id: 12, title: 'Old', publishedAt: BEFORE, mergedAt: BEFORE },
  ],
  opened: [
    { id: 10, at: IN },
    { id: 11, at: IN },
    { id: 12, at: BEFORE },
  ],
  reviewed: [
    { id: 20, at: IN },
    { id: 21, at: IN },
    { id: 22, at: IN },
  ],
  approvals: [
    { pullRequestId: 10, by: 'Ana', minutes: 25, at: IN },
    { pullRequestId: 11, by: 'Bo', at: IN },
    { pullRequestId: 12, by: 'Cy', minutes: 1, at: BEFORE },
  ],
};

describe('sprintRecap', () => {
  const recap = sprintRecap({
    sprint,
    journal,
    workItems: [
      { type: 'Bug', state: 'Done' },
      { type: 'Task', state: 'In Progress' },
    ],
  });

  it('only counts what happened during the sprint', () => {
    expect(recap.merged.map((merge) => merge.id)).toEqual([10, 11]);
    expect(recap.opened).toBe(2);
    expect(recap.reviewed).toBe(3);
    expect(recap.ci).toEqual({ total: 4, green: 3, bestStreak: 3 });
    expect(recap.fastestApproval).toEqual({ pullRequestId: 10, by: 'Ana', minutes: 25 });
    expect(recap.workItems).toEqual({ done: 1, total: 2 });
  });

  it('finds the quickest and the longest merges', () => {
    expect(recap.fastestMerge).toEqual({ id: 10, title: 'Quick <fix>', took: '2 h' });
    expect(recap.longestMerge).toEqual({ id: 11, title: 'Big feature', took: '6 d 0 h' });
  });

  it('sums the sprint up in highlights', () => {
    expect(recap.title).toBe('Platform Sprint 123 wrap-up');
    expect(recap.highlights).toEqual([
      '🚀 2 pull requests shipped',
      '✅ 1 of 2 work items done',
      '🟢 75% of your CI runs green',
      '🔥 Best green streak: 3 runs',
      '⚡ Fastest first approval: 25 min',
    ]);
  });

  it('has a gentle line for a quiet sprint', () => {
    expect(sprintRecap({ sprint, journal: EMPTY_JOURNAL, workItems: [] }).highlights).toEqual([
      '🌱 A quiet sprint: the extension did not see much of it',
    ]);
  });

  it('renders escaped, script-less HTML', () => {
    const html = renderRecapBody(recap);
    expect(html).toContain('Quick &lt;fix&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('style=');
  });
});

describe('reviewKarma', () => {
  it('compares the reviews with the PRs opened', () => {
    expect(reviewKarma(6, 4)).toBe('🤝 Net giver: you reviewed 6 and opened 4.');
    expect(reviewKarma(2, 2)).toBe('⚖️ Perfect balance: 2 reviewed, 2 opened.');
    expect(reviewKarma(1, 3)).toBe('🙏 You opened 3 and reviewed 1: your teammates covered for you.');
    expect(reviewKarma(0, 0)).toBeUndefined();
  });
});
