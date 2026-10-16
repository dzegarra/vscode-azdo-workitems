import { describe, expect, it } from 'vitest';
import type { MyPullRequestModel } from './myPullRequests';
import { myPullRequestsPanelTone, reviewsPanelTone } from './panelTone';
import type { ReviewRequestModel } from './reviewRequests';

type Request = Pick<ReviewRequestModel, 'isRequired' | 'urgency'>;
const request = (overrides: Partial<Request> = {}): Request => ({ isRequired: true, urgency: 'fresh', ...overrides });

function pr(overrides: Partial<MyPullRequestModel> = {}): MyPullRequestModel {
  return {
    id: 1,
    title: 'Title',
    url: 'https://pr/1',
    isDraft: false,
    isCompleted: false,
    reviewers: [],
    unresolved: 0,
    conflicts: false,
    runs: [],
    autoComplete: false,
    readyToMerge: false,
    warnings: [],
    ...overrides,
  } as MyPullRequestModel;
}

describe('reviewsPanelTone', () => {
  it('is alert when a required review is overdue', () => {
    // Rule PANEL-TONE-1
    expect(reviewsPanelTone([request(), request({ urgency: 'overdue' })])).toBe('alert');
  });

  it('is attention when only an optional review is overdue', () => {
    // Rule PANEL-TONE-1
    expect(reviewsPanelTone([request({ isRequired: false, urgency: 'overdue' })])).toBe('attention');
  });

  it('is attention for fresh or due soon requests', () => {
    // Rule PANEL-TONE-1
    expect(reviewsPanelTone([request()])).toBe('attention');
    expect(reviewsPanelTone([request({ urgency: 'dueSoon' })])).toBe('attention');
  });

  it('is none when nothing is waiting (the reviewed list is never involved)', () => {
    // Rule PANEL-TONE-1
    expect(reviewsPanelTone([])).toBe('none');
  });
});

describe('myPullRequestsPanelTone', () => {
  it('is attention when an active PR needs the user', () => {
    // Rule PANEL-TONE-2
    expect(myPullRequestsPanelTone([pr(), pr({ conflicts: true })])).toBe('attention');
  });

  it('is info when there are only active PRs, drafts included', () => {
    // Rule PANEL-TONE-2
    expect(myPullRequestsPanelTone([pr()])).toBe('info');
    expect(myPullRequestsPanelTone([pr({ isDraft: true })])).toBe('info');
  });

  it('is none with no PRs or only completed ones', () => {
    // Rule PANEL-TONE-2
    expect(myPullRequestsPanelTone([])).toBe('none');
    expect(myPullRequestsPanelTone([pr({ isCompleted: true })])).toBe('none');
  });

  it('ignores completed PRs next to active ones', () => {
    // Rule PANEL-TONE-2
    expect(myPullRequestsPanelTone([pr({ isCompleted: true }), pr()])).toBe('info');
  });

  it('does not count a completed PR that would otherwise need attention', () => {
    // Rule PANEL-TONE-2
    expect(myPullRequestsPanelTone([pr({ isCompleted: true, conflicts: true, unresolved: 2 })])).toBe('none');
    expect(myPullRequestsPanelTone([pr({ isCompleted: true, conflicts: true }), pr()])).toBe('info');
  });
});
