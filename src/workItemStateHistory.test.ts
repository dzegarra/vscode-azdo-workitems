import { describe, expect, it } from 'vitest';
import {
  finalKind,
  finishedAt,
  finishedChange,
  stateChanges,
  stateKind,
  stateSpans,
  type WorkItemUpdate,
} from './workItemStateHistory';

const at = (day: number, hour = 10): number => new Date(2026, 9, day, hour).getTime();
const iso = (day: number, hour = 10): string => new Date(at(day, hour)).toISOString();
const update = (state: string | undefined, day: number, hour = 10): WorkItemUpdate => ({
  fields: {
    ...(state ? { 'System.State': { newValue: state } } : {}),
    'System.ChangedDate': { newValue: iso(day, hour) },
  },
});

describe('stateChanges (Rule TIMELINE-35)', () => {
  it('keeps the updates that set the state, at their changed date', () => {
    expect(stateChanges([update('New', 5), update(undefined, 6), update('Committed', 13), { rev: 4 }])).toEqual([
      { at: at(5), state: 'New' },
      { at: at(13), state: 'Committed' },
    ]);
  });

  it('reads who changed the state: the ChangedBy of the update, else its reviser', () => {
    const by = (name: string): WorkItemUpdate['fields'] => ({
      'System.State': { newValue: 'Done' },
      'System.ChangedDate': { newValue: iso(5) },
      'System.ChangedBy': { newValue: { displayName: name } },
    });
    expect(stateChanges([{ fields: by('Ana Ruiz') }])).toEqual([{ at: at(5), state: 'Done', by: 'Ana Ruiz' }]);
    expect(stateChanges([{ revisedBy: { displayName: 'Marta' }, fields: { ...update('Done', 5).fields } }])).toEqual([
      { at: at(5), state: 'Done', by: 'Marta' },
    ]);
  });
});

describe('finalKind (Rule TIMELINE-35)', () => {
  it('is Done or Removed for the final states, and nothing for Ready to Test and the open ones', () => {
    expect(['Done', 'Closed', 'Removed', 'Ready to Test', 'Committed', 'ReOpened'].map(finalKind)).toEqual([
      'done',
      'done',
      'removed',
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('stateKind (Rule TIMELINE-35)', () => {
  it('maps the states of Backlog Items and Bugs', () => {
    expect(['New', 'Approved', 'Committed', 'Done', 'Ready to Test', 'ReOpened', 'Active'].map(stateKind)).toEqual([
      'new',
      'approved',
      'committed',
      'done',
      'readyToTest',
      'reopened',
      'committed',
    ]);
  });
});

describe('stateSpans (Rules TIMELINE-35, TIMELINE-36)', () => {
  const now = at(22, 14);

  it('draws each state up to the next one, the last up to now', () => {
    const spans = stateSpans({
      changes: [
        { at: at(9), state: 'New' },
        { at: at(12), state: 'Approved' },
        { at: at(14), state: 'Committed' },
      ],
      state: 'Committed',
      now,
    });
    expect(spans.map((span) => [span.kind, span.start, span.end])).toEqual([
      ['new', at(9), at(12)],
      ['approved', at(12), at(14)],
      ['committed', at(14), now],
    ]);
  });

  it('draws a Bug in Ready to Test as a bar up to now: it is not a final state', () => {
    const spans = stateSpans({
      changes: [
        { at: at(12), state: 'Committed' },
        { at: at(15), state: 'Ready to Test' },
      ],
      state: 'Ready to Test',
      now,
    });
    expect(spans.map((span) => [span.kind, span.end])).toEqual([
      ['committed', at(15)],
      ['readyToTest', now],
    ]);
  });

  it('draws no section for the final state (a badge marks it), and a Done left behind as a bar', () => {
    const final = stateSpans({
      changes: [
        { at: at(12), state: 'Committed' },
        { at: at(15), state: 'Done' },
      ],
      state: 'Done',
      now,
    });
    expect(final.map((span) => [span.kind, span.end])).toEqual([['committed', at(15)]]);
    const reopened = stateSpans({
      changes: [
        { at: at(12), state: 'Committed' },
        { at: at(15), state: 'Done' },
        { at: at(16), state: 'ReOpened' },
      ],
      state: 'ReOpened',
      now,
    });
    expect(reopened.map((span) => span.kind)).toEqual(['committed', 'done', 'reopened']);
    const removed = stateSpans({
      changes: [
        { at: at(12), state: 'New' },
        { at: at(13), state: 'Removed' },
        { at: at(14), state: 'New' },
      ],
      state: 'New',
      now,
    });
    expect(removed.map((span) => span.kind)).toEqual(['new', 'removed', 'new']);
    expect(finishedChange({ changes: [{ at: at(15), state: 'Done', by: 'Ana' }], state: 'Done' })).toEqual({
      at: at(15),
      by: 'Ana',
    });
  });

  it('ends a finished work item where it finished, and draws a reopened Bug again', () => {
    const changes = [
      { at: at(12), state: 'Committed' },
      { at: at(15), state: 'Ready to Test' },
      { at: at(16), state: 'ReOpened' },
      { at: at(19), state: 'Committed' },
      { at: at(21), state: 'Ready to Test' },
    ];
    const spans = stateSpans({ changes, state: 'Ready to Test', now });
    expect(spans.map((span) => span.kind)).toEqual([
      'committed',
      'readyToTest',
      'reopened',
      'committed',
      'readyToTest',
    ]);
    expect(spans.at(-1)?.end).toBe(now);
    expect(finishedAt({ changes, state: 'Ready to Test' })).toBe(at(21));
  });

  it('approximates In review from the publication of the first PR while Committed, dashed', () => {
    const spans = stateSpans({
      changes: [{ at: at(14), state: 'Committed' }],
      state: 'Committed',
      firstPublished: at(16, 15),
      now,
    });
    expect(spans.map((span) => [span.kind, span.start, span.derived === true])).toEqual([
      ['committed', at(14), false],
      ['inReview', at(16, 15), true],
    ]);
  });

  it('guesses from the dates until the history is read: the state now exact, Committed before it approximate', () => {
    const spans = stateSpans({
      state: 'Committed',
      dates: { activated: iso(13), stateChanged: iso(15) },
      now,
    });
    expect(spans.map((span) => [span.kind, span.start, span.end, span.approximate])).toEqual([
      ['committed', at(13), at(15), true],
      ['committed', at(15), now, false],
    ]);
    expect(stateSpans({ state: 'New', dates: { created: iso(10) }, now }).at(0)).toMatchObject({
      kind: 'new',
      approximate: true,
    });
    expect(finishedAt({ state: 'Done', dates: { stateChanged: iso(19) } })).toBe(at(19));
    expect(finishedAt({ state: 'Committed' })).toBeUndefined();
  });
});
