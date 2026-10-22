import { describe, expect, it } from 'vitest';
import {
  CoverageRecords,
  currentStreak,
  describeRecords,
  EMPTY_RECORDS,
  gainOverPreviousPullRequest,
  isNewBest,
  recordResult,
} from './coverageRecords';

const record = (records: CoverageRecords, pullRequestId: number, runId: number, percent: number) =>
  recordResult(records, { pullRequestId, runId, percent });

describe('recordResult', () => {
  it('starts the best with the first result, without calling it a new best', () => {
    const records = record(EMPTY_RECORDS, 1, 10, 70);
    expect(records.best).toMatchObject({ percent: 70, runId: 10, previous: undefined });
    expect(isNewBest(records, 10)).toBe(false);
  });

  it('detects a new personal best', () => {
    const records = record(record(EMPTY_RECORDS, 1, 10, 70), 2, 20, 85);
    expect(records.best).toMatchObject({ percent: 85, previous: 70 });
    expect(isNewBest(records, 20)).toBe(true);
    expect(isNewBest(records, 10)).toBe(false);
  });

  it('keeps the best when a result is lower or equal', () => {
    const records = record(record(EMPTY_RECORDS, 1, 10, 90), 2, 20, 90);
    expect(records.best?.runId).toBe(10);
  });

  it('ignores the same run twice and older runs of a PR', () => {
    const once = record(EMPTY_RECORDS, 1, 10, 90);
    expect(record(once, 1, 10, 90)).toBe(once);
    expect(record(once, 1, 9, 50)).toBe(once);
  });

  it('replaces the value of a PR with its re-run instead of adding a step', () => {
    const records = record(record(EMPTY_RECORDS, 1, 10, 85), 1, 11, 90);
    expect(records.results).toEqual([{ pullRequestId: 1, runId: 11, percent: 90 }]);
    expect(currentStreak(records, 80)).toBe(1);
  });
});

describe('currentStreak', () => {
  it('grows with each PR at or above the target', () => {
    let records = EMPTY_RECORDS;
    records = record(records, 1, 1, 80);
    records = record(records, 2, 2, 91);
    records = record(records, 3, 3, 99);
    expect(currentStreak(records, 80)).toBe(3);
  });

  it('is reset by a PR below the target', () => {
    let records = EMPTY_RECORDS;
    records = record(records, 1, 1, 90);
    records = record(records, 2, 2, 70);
    expect(currentStreak(records, 80)).toBe(0);
    records = record(records, 3, 3, 90);
    expect(currentStreak(records, 80)).toBe(1);
  });

  it('does not grow with a re-run of a PR already counted', () => {
    let records = EMPTY_RECORDS;
    records = record(records, 1, 1, 90);
    records = record(records, 2, 2, 90);
    records = record(records, 2, 3, 95);
    expect(currentStreak(records, 80)).toBe(2);
  });

  it('is lost when the re-run of a PR falls below the target', () => {
    let records = EMPTY_RECORDS;
    records = record(records, 1, 1, 90);
    records = record(records, 2, 2, 90);
    records = record(records, 2, 3, 60);
    expect(currentStreak(records, 80)).toBe(0);
  });

  it('is empty without results', () => {
    expect(currentStreak(EMPTY_RECORDS, 80)).toBe(0);
  });
});

describe('describeRecords', () => {
  it('shows the best and the streak', () => {
    let records = EMPTY_RECORDS;
    [90, 98, 85, 82].forEach((percent, i) => (records = record(records, i + 1, i + 1, percent)));
    expect(describeRecords(records, 80)).toBe('Your best: 98% · streak: 4 PRs ≥ 80%');
  });

  it('says nothing before the first result', () => {
    expect(describeRecords(EMPTY_RECORDS, 80)).toBeUndefined();
  });
});

describe('gainOverPreviousPullRequest', () => {
  it('compares a run with the PR recorded before its own', () => {
    const records = record(record(record(EMPTY_RECORDS, 1, 10, 80), 2, 20, 81.5), 3, 30, 79);
    expect(gainOverPreviousPullRequest(records, 20)).toBeCloseTo(1.5);
    expect(gainOverPreviousPullRequest(records, 30)).toBeCloseTo(-2.5);
    expect(gainOverPreviousPullRequest(records, 10)).toBeUndefined();
    expect(gainOverPreviousPullRequest(records, 99)).toBeUndefined();
  });
});
