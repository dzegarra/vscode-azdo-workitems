import { describe, expect, it } from 'vitest';
import type { MyPullRequestModel, ReviewerModel } from './myPullRequests';
import {
  attentionIcon,
  attentionLine,
  attentionOf,
  attentionReasons,
  myPullRequestsItem,
} from './myPullRequestsAttention';
import type { RunModel } from './pipelines';

const reviewer = (name: string, vote: ReviewerModel['vote'], isContainer = false): ReviewerModel => ({
  name,
  vote,
  isContainer,
  isRequired: false,
});
const run = (state: RunModel['state']): RunModel => ({ id: 1, pipeline: 'PR', state, url: 'https://run' });

function model(overrides: Partial<MyPullRequestModel> = {}): MyPullRequestModel {
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
    ...overrides,
  } as MyPullRequestModel;
}

describe('attentionReasons', () => {
  it('names who rejected or is waiting, people before groups', () => {
    // Rule STATUSBAR-MYPR-2
    const reasons = attentionReasons(
      model({
        reviewers: [
          reviewer('Team', 'waiting', true),
          reviewer('Paulina Hudziak EXT', 'waiting'),
          reviewer('Ann', 'rejected'),
        ],
      })
    );
    expect(reasons.map((reason) => [reason.severity, reason.text])).toEqual([
      ['error', 'Rejected (Ann)'],
      ['warning', 'Waiting for author (Paulina Hudziak EXT)'],
    ]);
  });

  it('lists conflicts, failed CI and unresolved comments, most urgent first', () => {
    // Rule STATUSBAR-MYPR-2
    const reasons = attentionReasons(
      model({ conflicts: true, runs: [run('succeeded'), run('failed')], unresolved: 3 })
    );
    expect(reasons.map((reason) => reason.text)).toEqual(['Conflicts', 'CI failed', '3 unresolved comments']);
    expect(attentionReasons(model({ unresolved: 1 }))[0].text).toBe('1 unresolved comment');
  });

  it('counts a partially succeeded run as failed CI, but not running, queued or canceled ones', () => {
    // Rule STATUSBAR-MYPR-2
    expect(attentionReasons(model({ runs: [run('partial')] }))[0]).toMatchObject({
      severity: 'error',
      text: 'CI partially succeeded',
    });
    expect(attentionReasons(model({ runs: [run('running'), run('queued'), run('canceled')] }))).toEqual([]);
  });

  it('ignores unknown comments (undefined) and approvals', () => {
    // Rule STATUSBAR-MYPR-2
    expect(attentionReasons(model({ unresolved: undefined, reviewers: [reviewer('Bob', 'approved')] }))).toEqual([]);
  });

  it('leaves out drafts and completed PRs', () => {
    // Rule STATUSBAR-MYPR-1
    expect(attentionReasons(model({ isDraft: true, conflicts: true }))).toEqual([]);
    expect(attentionReasons(model({ isCompleted: true, conflicts: true }))).toEqual([]);
    expect(attentionOf(model({ isDraft: true, readyToMerge: true })).ready).toBe(false);
  });
});

describe('attentionOf', () => {
  it('is ready when nothing stops the merge and it does not complete by itself', () => {
    // Rule STATUSBAR-MYPR-3
    expect(attentionOf(model({ readyToMerge: true })).ready).toBe(true);
    expect(attentionOf(model({ readyToMerge: true, autoComplete: true })).ready).toBe(false);
    expect(attentionOf(model({ readyToMerge: true, unresolved: 2 })).ready).toBe(false);
  });
});

describe('myPullRequestsItem', () => {
  it('is hidden when nothing needs the user', () => {
    // Rule STATUSBAR-MYPR-6
    expect(myPullRequestsItem([])).toBeUndefined();
    expect(myPullRequestsItem([model(), model({ id: 2, isDraft: true, conflicts: true })])).toBeUndefined();
  });

  it('counts the PRs that need the user, in error when one is rejected, has conflicts or failed CI', () => {
    // Rules STATUSBAR-MYPR-4, STATUSBAR-MYPR-5
    const item = myPullRequestsItem([model({ id: 1, unresolved: 2 }), model({ id: 2, conflicts: true })]);
    expect(item).toMatchObject({ text: '$(git-pull-request) 2 need you', background: 'error' });
    expect(item?.title).toBe('2 pull requests need you');
  });

  it('is a warning with only waiting for author or unresolved comments', () => {
    // Rule STATUSBAR-MYPR-5
    const item = myPullRequestsItem([
      model({ reviewers: [reviewer('Ann', 'waiting')] }),
      model({ id: 2, unresolved: 1 }),
    ]);
    expect(item).toMatchObject({ background: 'warning' });
    expect(myPullRequestsItem([model({ unresolved: 1 })])?.title).toBe('1 pull request needs you');
  });

  it('says ready to merge with the default background when only ready PRs exist', () => {
    // Rules STATUSBAR-MYPR-4, STATUSBAR-MYPR-5
    const item = myPullRequestsItem([model({ readyToMerge: true })]);
    expect(item?.text).toBe('$(git-merge) 1 ready to merge');
    expect(item?.background).toBeUndefined();
  });

  it('shows both counts, and the ready ones do not colour the item', () => {
    // Rules STATUSBAR-MYPR-4, STATUSBAR-MYPR-5
    const item = myPullRequestsItem([
      model({ id: 1, readyToMerge: true }),
      model({ id: 2, unresolved: 1 }),
      model({ id: 3, unresolved: 4 }),
    ]);
    expect(item?.text).toBe('$(git-pull-request) 2 need you · $(git-merge) 1 ready');
    expect(item?.background).toBe('warning');
  });

  it('lists the most urgent PRs first and the ready ones last, with a line each', () => {
    // Rule STATUSBAR-MYPR-7
    const item = myPullRequestsItem([
      model({ id: 1, readyToMerge: true }),
      model({ id: 2, unresolved: 3 }),
      model({ id: 3, conflicts: true, unresolved: 1 }),
      model({ id: 4, reviewers: [reviewer('Ann', 'rejected')] }),
    ]);
    expect(item?.pullRequests.map((pr) => pr.id)).toEqual([4, 3, 2, 1]);
    expect(item?.pullRequests.map((pr) => [attentionIcon(pr), attentionLine(pr)])).toEqual([
      ['$(error)', 'Rejected (Ann)'],
      ['$(error)', 'Conflicts · 1 unresolved comment'],
      ['$(warning)', '3 unresolved comments'],
      ['$(git-merge)', 'Ready to merge'],
    ]);
  });
});
