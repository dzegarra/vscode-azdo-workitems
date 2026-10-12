import { describe, expect, it } from 'vitest';
import { branchBadge } from './branchBadge';

describe('branchBadge', () => {
  it('names the location with a tooltip that explains it', () => {
    expect(branchBadge({ location: 'current' }, false)).toEqual({
      text: 'current',
      title: 'Checked out here',
      tone: 'current',
    });
    expect(branchBadge({ location: 'local' }, false).title).toContain('exists in your clone');
    expect(branchBadge({ location: 'remote' }, false).title).toContain('Checkout creates the local branch');
    expect(branchBadge({ location: 'linked' }, false).title).toBe('Known only from a link or a PR');
  });

  it('absorbs the worktree into the same badge, with its folder in the tooltip', () => {
    const badge = branchBadge({ location: 'local', worktree: '/w/a' }, false);
    expect(badge.text).toBe('local ⧉');
    expect(badge.tone).toBe('worktree');
    expect(badge.title).toBe('Local branch (exists in your clone) · checked out in a worktree at /w/a');
  });

  it('says "not deleted" for a merged branch, and keeps that tone with a worktree', () => {
    expect(branchBadge({ location: 'local' }, true)).toMatchObject({ text: 'not deleted', tone: 'leftover' });
    const withTree = branchBadge({ location: 'local', worktree: '/w' }, true);
    expect(withTree.text).toBe('not deleted ⧉');
    expect(withTree.tone).toBe('leftover');
    expect(withTree.title).toContain('The PR is merged');
    expect(withTree.title).toContain('/w');
  });
});
