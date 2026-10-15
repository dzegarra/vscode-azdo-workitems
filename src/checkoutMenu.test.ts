import { describe, expect, it } from 'vitest';
import { checkoutMenuItems, checkoutMenuSections } from './checkoutMenu';

describe('checkoutMenuItems', () => {
  it('offers Checkout here and Open in a worktree, with the data the Checkout button sends', () => {
    const items = checkoutMenuItems({ id: 5, kind: 'review', name: 'feature/x' });
    expect(items.map((item) => item.label)).toEqual(['Checkout here', 'Open in a worktree']);
    expect(items.map((item) => item.act)).toEqual([
      { action: 'checkoutHere', id: 5, kind: 'review' },
      { action: 'openWorktree', id: 5, kind: 'review' },
    ]);
    expect(items[0].detail).toBe('feature/x');
  });

  it('sends the branch only when the button does (a row of the branch list)', () => {
    const items = checkoutMenuItems({ id: 7, kind: 'workItem', branch: 'f/a', name: 'f/a' });
    expect(items.map((item) => item.act)).toEqual([
      { action: 'checkoutHere', id: 7, kind: 'workItem', branch: 'f/a' },
      { action: 'openWorktree', id: 7, kind: 'workItem', branch: 'f/a' },
    ]);
  });

  it('offers Open / Remove worktree when a worktree has the branch', () => {
    const items = checkoutMenuItems({ id: 9, kind: 'myPullRequest', name: 'b', worktree: '/w/b' });
    expect(items.map((item) => [item.label, item.detail, item.act])).toEqual([
      ['Open worktree', '/w/b', { action: 'openWorktree', id: 9, kind: 'myPullRequest' }],
      ['Remove worktree', 'Keeps the branch', { action: 'removeWorktree', id: 9, kind: 'myPullRequest' }],
    ]);
  });

  it('only informs for the branch open in this window', () => {
    const [item] = checkoutMenuItems({ id: 1, kind: 'workItem', name: 'b', isCurrent: true });
    expect(item.label).toBe('Checked out');
    expect(item.act).toBeUndefined();
  });

  it('wraps the items in one section', () => {
    expect(checkoutMenuSections({ id: 1, kind: 'workItem', name: 'b' })).toEqual([
      { title: 'Branch', items: expect.any(Array) },
    ]);
  });
});
