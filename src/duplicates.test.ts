import { describe, expect, it } from 'vitest';
import { duplicateFilterValue, duplicateLinks, iterationLabel, timelineDuplicates } from './duplicates';

const schedule = [{ path: 'Flow\\R3\\Platform Sprint 122', name: 'Platform Sprint 122' }];

describe('iterationLabel', () => {
  it('names the iteration from the schedule, else from the path', () => {
    expect(iterationLabel('Flow\\R3\\Platform Sprint 122', schedule)).toBe('Platform Sprint 122');
    expect(iterationLabel('Flow\\R3\\UX Sprint 9', schedule)).toBe('UX Sprint 9');
    expect(iterationLabel('Flow\\R3\\UX Sprint 9', undefined)).toBe('UX Sprint 9');
  });

  it('says nothing for the project root: the work item is not planned', () => {
    expect(iterationLabel('Flow', schedule)).toBeUndefined();
  });
});

describe('duplicateLinks', () => {
  const wi = (id: number, state: string, iterationPath: string) => ({
    id,
    title: `t${id}`,
    type: 'Bug',
    state,
    iterationPath,
  });

  it('lists the originals and the duplicates with their state and iteration', () => {
    expect(duplicateLinks([wi(1, 'Done', 'Flow\\R3\\Platform Sprint 122')], [wi(2, 'New', 'Flow')], schedule)).toEqual({
      duplicateOf: [
        { id: 1, title: 't1', type: 'Bug', state: 'Done', stateCategory: 'done', iterationName: 'Platform Sprint 122' },
      ],
      duplicates: [
        { id: 2, title: 't2', type: 'Bug', state: 'New', stateCategory: 'proposed', iterationName: undefined },
      ],
    });
  });

  it('keeps unknown lists unknown', () => {
    expect(duplicateLinks(undefined, undefined, schedule)).toEqual({ duplicateOf: undefined, duplicates: undefined });
  });
});

describe('duplicateFilterValue', () => {
  it('is set only for known duplicates', () => {
    expect(duplicateFilterValue({ duplicateOf: [{}] })).toBe('Duplicates');
    expect(duplicateFilterValue({ duplicateOf: [] })).toBeUndefined();
    expect(duplicateFilterValue({})).toBeUndefined();
  });
});

describe('timelineDuplicates (Rule TIMELINE-47)', () => {
  const link = (id: number) => ({ id, title: '', type: 'Bug', state: 'New', stateCategory: 'proposed' as const });

  it('lists the originals and the duplicates, both directions, with their role', () => {
    expect(timelineDuplicates({ duplicateOf: [link(1)], duplicates: [link(2), link(3)] })).toEqual([
      { id: 1, role: 'original' },
      { id: 2, role: 'duplicate' },
      { id: 3, role: 'duplicate' },
    ]);
  });

  it('says nothing when there are no links or they are unknown', () => {
    expect(timelineDuplicates({})).toBeUndefined();
    expect(timelineDuplicates({ duplicateOf: [], duplicates: [] })).toBeUndefined();
  });
});
