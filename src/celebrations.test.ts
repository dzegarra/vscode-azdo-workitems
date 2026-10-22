import { describe, expect, it } from 'vitest';
import {
  approvalSpeedNote,
  coverageGainNote,
  isPalindromeNumber,
  mergedCelebration,
  mergeMilestone,
  ordinal,
  pullRequestEasterEgg,
} from './celebrations';

describe('ordinal', () => {
  it('uses the English suffixes', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });
});

describe('easter eggs', () => {
  it('spots palindromes of 3 digits or more', () => {
    expect(isPalindromeNumber(12321)).toBe(true);
    expect(isPalindromeNumber(4554)).toBe(true);
    expect(isPalindromeNumber(11)).toBe(false);
    expect(isPalindromeNumber(12345)).toBe(false);
  });

  it('celebrates round and palindromic PR numbers', () => {
    expect(pullRequestEasterEgg(14000)).toBe('🎯 A round number: PR 14000!');
    expect(pullRequestEasterEgg(13931)).toBe('🪞 PR 13931 reads the same backwards!');
    expect(pullRequestEasterEgg(13932)).toBeUndefined();
  });

  it('celebrates the milestones of merged PRs only', () => {
    expect(mergeMilestone(10)).toBe('🏅 That makes 10 merged pull requests!');
    expect(mergeMilestone(11)).toBeUndefined();
  });
});

describe('mergedCelebration', () => {
  it('counts the PR in the sprint and adds the eggs', () => {
    expect(mergedCelebration({ id: 13931, title: 'Fix the header' }, { thisSprint: 3, total: 10 })).toBe(
      '🚀 PR 13931 shipped: Fix the header. Your 3rd this sprint! 🪞 PR 13931 reads the same backwards! 🏅 That makes 10 merged pull requests!'
    );
  });

  it('leaves the sprint out when its dates are unknown', () => {
    expect(mergedCelebration({ id: 13932, title: 'T' }, { total: 4 })).toBe('🚀 PR 13932 shipped: T.');
  });
});

describe('approvalSpeedNote', () => {
  it('praises the approvals of the first hour, more within 15 minutes', () => {
    expect(approvalSpeedNote(12)).toBe('⚡ Lightning review: 12 min after publishing!');
    expect(approvalSpeedNote(40)).toBe('⚡ First approval 40 min after publishing.');
    expect(approvalSpeedNote(61)).toBeUndefined();
    expect(approvalSpeedNote(undefined)).toBeUndefined();
  });
});

describe('coverageGainNote', () => {
  it('only notes a real gain', () => {
    expect(coverageGainNote(1.84)).toBe('🎯 +1.8 pts of coverage over your previous PR.');
    expect(coverageGainNote(0.05)).toBeUndefined();
    expect(coverageGainNote(-2)).toBeUndefined();
    expect(coverageGainNote(undefined)).toBeUndefined();
  });
});
