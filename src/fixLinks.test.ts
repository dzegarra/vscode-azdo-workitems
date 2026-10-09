import { describe, expect, it } from 'vitest';
import { fixesBugsText, fixRelationLabel, fixLinks, fixLinksTooltip } from './fixLinks';

const wi = (id: number, type: string, state = 'New') => ({ id, title: `t${id}`, type, state });

describe('fixLinks', () => {
  it('lists the successor bugs of a Backlog Item, leaving out other types', () => {
    const result = fixLinks(
      { type: 'Product Backlog Item' },
      [wi(1, 'Bug')],
      [wi(2, 'Bug', 'In Progress'), wi(3, 'Task'), wi(4, 'Bug', 'Done')]
    );
    expect(result.fixedBy).toBeUndefined();
    expect(result.fixesBugs).toEqual([
      { id: 2, title: 't2', state: 'In Progress', stateCategory: 'in-progress' },
      { id: 4, title: 't4', state: 'Done', stateCategory: 'done' },
    ]);
  });

  it('works for User Stories too', () => {
    expect(fixLinks({ type: 'User Story' }, [], [wi(2, 'Bug')]).fixesBugs?.map(({ id }) => id)).toEqual([2]);
  });

  it('lists the predecessor Backlog Items of a Bug', () => {
    const result = fixLinks(
      { type: 'Bug' },
      [wi(10, 'Product Backlog Item', 'Committed'), wi(11, 'Bug'), wi(12, 'User Story'), wi(13, 'Feature')],
      [wi(20, 'Product Backlog Item')]
    );
    expect(result.fixesBugs).toBeUndefined();
    expect(result.fixedBy?.map(({ id }) => id)).toEqual([10, 12]);
    expect(result.fixedBy?.[0].stateCategory).toBe('in-progress');
  });

  it('gives an empty list when none applies', () => {
    expect(fixLinks({ type: 'Bug' }, [wi(1, 'Task')], []).fixedBy).toEqual([]);
    expect(fixLinks({ type: 'Product Backlog Item' }, [], [wi(1, 'Task')]).fixesBugs).toEqual([]);
  });

  it('is undefined when the related work items are unknown', () => {
    expect(fixLinks({ type: 'Bug' }, undefined, undefined)).toEqual({ fixedBy: undefined });
    expect(fixLinks({ type: 'Product Backlog Item' }, undefined, undefined)).toEqual({ fixesBugs: undefined });
  });

  it('says nothing for other types', () => {
    expect(fixLinks({ type: 'Task' }, [wi(1, 'Bug')], [wi(2, 'Bug')])).toEqual({});
  });

  it('words the texts', () => {
    expect(fixesBugsText(1)).toBe('Fixes 1 bug');
    expect(fixesBugsText(2)).toBe('Fixes 2 bugs');
    expect(fixLinksTooltip('Fixes 1 bug', [{ id: 5, title: 'X', state: 'New', stateCategory: 'proposed' }])).toBe(
      'Fixes 1 bug\n#5 New · X'
    );
  });

  it('labels the bug / Backlog Item pairs of the details', () => {
    expect(fixRelationLabel({ type: 'Bug' }, { type: 'User Story' }, 'predecessor')).toEqual({
      text: 'fixes this bug',
      tone: 'backlog',
    });
    expect(fixRelationLabel({ type: 'Product Backlog Item' }, { type: 'Bug' }, 'successor')?.text).toBe(
      'fixed by this backlog item'
    );
    expect(fixRelationLabel({ type: 'Bug' }, { type: 'Product Backlog Item' }, 'successor')).toBeUndefined();
    expect(fixRelationLabel({ type: 'Task' }, { type: 'Bug' }, 'successor')).toBeUndefined();
  });
});
