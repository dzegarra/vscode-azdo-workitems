import { describe, expect, it } from 'vitest';
import {
  asleepIdsOf,
  asleepKnown,
  countLoading,
  loadingText,
  workItemsLoading,
  type LoadingFacts,
} from './timelineFooter';

const facts = (overrides: Partial<LoadingFacts> = {}): LoadingFacts => ({
  status: 'ready',
  statesLoading: 0,
  work: [],
  finished: [],
  movedOut: [],
  reviews: [],
  reviewed: [],
  ...overrides,
});

const prRow = (id: number, history: string, detailsLoading = false) => ({
  id,
  children: [{ kind: 'pr', prId: id * 10, history, detailsLoading }],
});

describe('asleepIdsOf (Rule TIMELINE-25)', () => {
  it('lists the asleep cards once each, in order', () => {
    expect(
      asleepIdsOf([
        { id: 3, asleep: { days: 4, text: 'zZ' } },
        { id: 4 },
        { id: 3, asleep: { days: 4, text: 'zZ' } },
        { id: 1, asleep: { days: 2, text: 'zZ' } },
      ])
    ).toEqual([3, 1]);
  });
});

describe('loadingText (Rule TIMELINE-50)', () => {
  it('says nothing when nothing is loading', () => {
    expect(loadingText(facts())).toBeUndefined();
  });

  it('says the sprint is loading', () => {
    expect(loadingText(facts({ status: 'loading' }))).toBe('Loading the sprint…');
  });

  it('names the people whose work is being read', () => {
    const team = { status: 'loading' as const, pending: [{ name: 'Piotr' }, { name: 'Marta' }], sections: [] };
    expect(loadingText(facts({ team }))).toBe('Loading the work of 2 people (Piotr, Marta)…');
    expect(loadingText(facts({ team: { ...team, pending: [{ name: 'Piotr' }] } }))).toBe(
      'Loading the work of 1 person (Piotr)…'
    );
    expect(loadingText(facts({ team: { ...team, pending: [] } }))).toBe('Loading the work of the team…');
  });

  it('counts the PRs whose history, details or threads are being read, once each', () => {
    const text = loadingText(
      facts({
        work: [prRow(1, 'loading'), prRow(2, 'loaded', true), prRow(3, 'loaded')],
        reviewed: [{ id: 77, loading: true }],
      })
    );
    expect(text).toBe('Loading the PR events of 3 PRs…');
    expect(loadingText(facts({ work: [prRow(1, 'loading'), prRow(1, 'loading')] }))).toBe(
      'Loading the PR events of 1 PR…'
    );
  });

  it('counts the PRs of the other people too', () => {
    const team = {
      status: 'ready' as const,
      pending: [],
      sections: [{ rows: [prRow(5, 'loading')], finished: [], movedOut: [] }],
    };
    expect(loadingText(facts({ team }))).toBe('Loading the PR events of 1 PR…');
  });

  it('joins what is loading with "and"', () => {
    expect(loadingText(facts({ status: 'loading', work: [prRow(1, 'loading')], statesLoading: 2 }))).toBe(
      'Loading the sprint and the PR events of 1 PR and the state history of 2 work items…'
    );
  });
});

describe('countLoading', () => {
  it('counts the work items drawn whose history is being read', () => {
    expect(countLoading([{ id: 1 }, { id: 2 }, { id: 3 }], new Set([2, 3, 9]))).toBe(2);
    expect(countLoading([{ id: 1 }], undefined)).toBe(0);
  });
});

describe('asleepKnown (Rule TIMELINE-25)', () => {
  const team = { status: 'ready' as const, pending: [], sections: [] };
  it('is known once the sprint and the team are read', () => {
    expect(asleepKnown(facts())).toBe(true);
    expect(asleepKnown(facts({ team }))).toBe(true);
  });
  it('is not known while the sprint, the team or a person is loading', () => {
    expect(asleepKnown(facts({ status: 'loading' }))).toBe(false);
    expect(asleepKnown(facts({ team: { ...team, status: 'loading' } }))).toBe(false);
    expect(asleepKnown(facts({ team: { ...team, pending: [{ name: 'Piotr' }] } }))).toBe(false);
  });
});

describe('work items not loaded yet (Rule TIMELINE-50)', () => {
  it('is only while loading with no work item drawn', () => {
    expect(workItemsLoading(facts({ status: 'loading' }))).toBe(true);
    expect(workItemsLoading(facts({ status: 'ready' }))).toBe(false);
    expect(workItemsLoading(facts({ status: 'loading', work: [prRow(1, 'loaded')] }))).toBe(false);
  });

  it('says the work items are loading when the PRs to review are already there', () => {
    expect(loadingText(facts({ status: 'loading', reviews: [{ id: 9 }] }))).toBe('Loading your work items…');
  });
});
