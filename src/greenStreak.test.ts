import { describe, expect, it } from 'vitest';
import type { JournalRun } from './funJournal';
import { greenStreak, greenStreakChange, greenStreakLabel, greenStreakNote, greenStreakTooltip } from './greenStreak';

/** "+" a green run, "-" a red one */
const runs = (outcomes: string): JournalRun[] =>
  outcomes.split('').map((outcome, i) => ({ id: i, ok: outcome === '+', at: `2026-10-${String(10 + i)}T00:00:00Z` }));

describe('greenStreak', () => {
  it('counts the green runs in a row from the latest one, and the best streak', () => {
    expect(greenStreak(runs('++++-++'))).toEqual({ current: 2, best: 4 });
    expect(greenStreak(runs('++-'))).toEqual({ current: 0, best: 2 });
    expect(greenStreak([])).toEqual({ current: 0, best: 0 });
  });

  it('orders the runs by finish time, whatever the order they were recorded in', () => {
    const [a, b, c] = runs('-++');
    expect(greenStreak([c, a, b]).current).toBe(2);
  });
});

describe('greenStreakLabel / greenStreakTooltip', () => {
  it('shows the streak from 3 green runs', () => {
    expect(greenStreakLabel({ current: 2, best: 9 })).toBe('');
    expect(greenStreakTooltip({ current: 2, best: 9 })).toBeUndefined();
    expect(greenStreakLabel({ current: 3, best: 9 })).toBe('$(flame) 3');
    expect(greenStreakTooltip({ current: 3, best: 9 })).toBe('🔥 3 green CI runs in a row (best: 9)');
    expect(greenStreakTooltip({ current: 9, best: 9 })).toBe('🔥 9 green CI runs in a row (your best so far)');
  });
});

describe('greenStreakNote', () => {
  it('celebrates a streak that grows from 3', () => {
    expect(greenStreakNote({ current: 1, best: 1 }, { current: 2, best: 2 })).toBeUndefined();
    expect(greenStreakNote({ current: 2, best: 5 }, { current: 3, best: 5 })).toBe('🔥 3 green runs in a row.');
  });

  it('calls a new record when the streak beats the best one', () => {
    expect(greenStreakNote({ current: 5, best: 5 }, { current: 6, best: 6 })).toBe(
      '🔥 6 green runs in a row: a new record!'
    );
  });

  it('says when a failure ends a streak worth mentioning', () => {
    expect(greenStreakNote({ current: 4, best: 4 }, { current: 0, best: 4 })).toBe(
      '💔 That ends a streak of 4 green runs.'
    );
    expect(greenStreakNote({ current: 2, best: 4 }, { current: 0, best: 4 })).toBeUndefined();
  });

  it('says nothing when the run was already recorded', () => {
    expect(greenStreakNote({ current: 4, best: 4 }, { current: 4, best: 4 })).toBeUndefined();
  });
});

describe('greenStreakChange', () => {
  it('tells a grown streak, a record and a broken streak apart', () => {
    expect(greenStreakChange({ current: 2, best: 5 }, { current: 3, best: 5 })).toBe('grew');
    expect(greenStreakChange({ current: 5, best: 5 }, { current: 6, best: 6 })).toBe('record');
    expect(greenStreakChange({ current: 4, best: 4 }, { current: 0, best: 4 })).toBe('broken');
    expect(greenStreakChange({ current: 1, best: 1 }, { current: 2, best: 2 })).toBeUndefined();
    expect(greenStreakChange({ current: 4, best: 4 }, { current: 4, best: 4 })).toBeUndefined();
  });
});
