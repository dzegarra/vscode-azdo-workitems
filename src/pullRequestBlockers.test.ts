import { describe, expect, it } from 'vitest';
import { COMPLETES_BY_ITSELF, NO_APPROVALS_YET, READY_TO_MERGE, type ReviewerModel } from './myPullRequests';
import { whatStopsTheMerge, type BlockerInput } from './pullRequestBlockers';

const reviewer = (name: string, overrides: Partial<ReviewerModel> = {}): ReviewerModel => ({
  name,
  vote: 'none',
  isRequired: false,
  isContainer: false,
  ...overrides,
});

const input = (overrides: Partial<BlockerInput> = {}): BlockerInput => ({
  reviewers: [reviewer('Ana', { vote: 'approved' })],
  conflicts: false,
  runs: [],
  ...overrides,
});

const run = (id: number, state: BlockerInput['runs'][number]['state'], pipeline = 'CI') => ({ id, pipeline, state });

describe('what stops a PR in review from being merged (TIMELINE-52)', () => {
  it('says the Next line of the user own PRs', () => {
    const mine = { readyToMerge: false, next: '1 more approval needed · Resolve 2 comments' };
    expect(whatStopsTheMerge(input({ mine, conflicts: true }))).toBe('1 more approval needed · Resolve 2 comments');
  });

  it('says nothing of an own PR that is ready, completes by itself or has no Next line', () => {
    expect(whatStopsTheMerge(input({ mine: { readyToMerge: true, next: 'Something' } }))).toBeUndefined();
    expect(whatStopsTheMerge(input({ mine: { readyToMerge: false, next: READY_TO_MERGE } }))).toBeUndefined();
    expect(whatStopsTheMerge(input({ mine: { readyToMerge: false, next: COMPLETES_BY_ITSELF } }))).toBeUndefined();
    expect(whatStopsTheMerge(input({ mine: { readyToMerge: false } }))).toBeUndefined();
  });

  it('says nothing when somebody approved and nothing else is missing', () => {
    expect(whatStopsTheMerge(input())).toBeUndefined();
  });

  it('asks to resolve the conflicts', () => {
    expect(whatStopsTheMerge(input({ conflicts: true }))).toBe('Resolve the conflicts');
  });

  it('names who rejected and who waits for the author', () => {
    const reviewers = [
      reviewer('Ana', { vote: 'rejected' }),
      reviewer('Bo', { vote: 'rejected' }),
      reviewer('Cy', { vote: 'waiting' }),
    ];
    expect(whatStopsTheMerge(input({ reviewers }))).toBe('Rejected by Ana, Bo · Feedback of Cy to address');
  });

  it('says CI failed when the latest finished run of a pipeline failed or partially succeeded', () => {
    expect(whatStopsTheMerge(input({ runs: [run(1, 'succeeded'), run(2, 'failed')] }))).toBe('CI failed');
    expect(whatStopsTheMerge(input({ runs: [run(1, 'partial')] }))).toBe('CI failed');
    expect(whatStopsTheMerge(input({ runs: [run(1, 'failed'), run(2, 'succeeded')] }))).toBeUndefined();
  });

  it('says nothing of CI while a run is running or queued, or after a canceled run', () => {
    expect(whatStopsTheMerge(input({ runs: [run(1, 'failed'), run(2, 'running')] }))).toBeUndefined();
    expect(whatStopsTheMerge(input({ runs: [run(1, 'succeeded'), run(2, 'canceled')] }))).toBeUndefined();
  });

  it('names the required people who have not voted', () => {
    const reviewers = [
      reviewer('Ana', { vote: 'approved' }),
      reviewer('Bo', { isRequired: true }),
      reviewer('Cy', { isRequired: true }),
      reviewer('Di'),
    ];
    expect(whatStopsTheMerge(input({ reviewers }))).toBe('Approval of Bo, Cy missing');
  });

  it('asks for a required group only when no person is pending and nobody approved', () => {
    const group = reviewer('Team', { isRequired: true, isContainer: true });
    expect(whatStopsTheMerge(input({ reviewers: [group] }))).toBe('Approval of Team missing');
    expect(whatStopsTheMerge(input({ reviewers: [group, reviewer('Ana', { vote: 'approved' })] }))).toBeUndefined();
    expect(whatStopsTheMerge(input({ reviewers: [group, reviewer('Bo', { isRequired: true })] }))).toBe(
      'Approval of Bo missing'
    );
  });

  it('says no approvals yet when nothing else is known and nobody approved', () => {
    expect(whatStopsTheMerge(input({ reviewers: [] }))).toBe(NO_APPROVALS_YET);
    expect(whatStopsTheMerge(input({ reviewers: [reviewer('Ana')] }))).toBe(NO_APPROVALS_YET);
  });

  it('counts an approval with suggestions as an approval', () => {
    expect(whatStopsTheMerge(input({ reviewers: [reviewer('Ana', { vote: 'suggestions' })] }))).toBeUndefined();
  });

  it('joins the steps in order: conflicts, rejections, feedback, CI, approvals', () => {
    const reviewers = [
      reviewer('Ana', { vote: 'rejected' }),
      reviewer('Bo', { vote: 'waiting' }),
      reviewer('Cy', { isRequired: true }),
    ];
    expect(whatStopsTheMerge(input({ reviewers, conflicts: true, runs: [run(1, 'failed')] }))).toBe(
      'Resolve the conflicts · Rejected by Ana · Feedback of Bo to address · CI failed · Approval of Cy missing'
    );
  });
});
