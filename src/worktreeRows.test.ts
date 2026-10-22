import { describe, expect, it } from 'vitest';
import type { ClassifiedWorktree } from './worktreeHygiene';
import { worktreeGroups, worktreePickEntries, worktreeRow, worktreesViewDescription } from './worktreeRows';
import type { Worktree } from './worktrees';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-22T12:00:00Z');

const worktree = (branch: string, over: Partial<Worktree> = {}): Worktree => ({
  path: `/dev/app.worktrees/${branch}`,
  branch,
  bare: false,
  detached: false,
  prunable: false,
  locked: false,
  ...over,
});

const item = (branch: string, over: Partial<ClassifiedWorktree> = {}): ClassifiedWorktree => ({
  worktree: worktree(branch),
  status: 'inUse',
  reasons: [],
  dirty: false,
  ...over,
});

const merged = item('feature/merged', {
  status: 'stale',
  reasons: [{ kind: 'merged', pullRequestId: 5 }],
  owner: { kind: 'myPullRequest', id: 5, title: 'Fix it' },
  dirty: true,
  lastCommitAt: NOW - 3 * DAY,
});
const idle = item('feature/idle', { status: 'idle', reasons: [{ kind: 'idle', days: 20 }] });
const used = item('feature/used', { owner: { kind: 'workItem', id: 1, title: 'Work' }, lastCommitAt: NOW });

describe('worktreeRow (Rule WORKTREE-VIEW-1)', () => {
  it('tells why it can be removed, its changes and its age', () => {
    expect(worktreeRow(merged, NOW)).toMatchObject({
      label: 'feature/merged',
      description: '● · PR 5 merged · 3 days ago',
      icon: 'trash',
      status: 'stale',
      missing: false,
    });
    expect(worktreeRow(merged, NOW).tooltip).toContain('Uncommitted changes');
  });

  it('tells what a worktree in use is for', () => {
    expect(worktreeRow(used, NOW).description).toBe('#1 Work · today');
  });

  it('cannot open a missing folder', () => {
    expect(worktreeRow(item('x', { worktree: worktree('x', { prunable: true }) }), NOW).missing).toBe(true);
  });
});

describe('worktreeGroups (Rule WORKTREE-VIEW-1)', () => {
  it('groups by status, stale first, without empty groups', () => {
    expect(worktreeGroups([used, merged], NOW).map((group) => [group.label, group.rows.length])).toEqual([
      ['Can be removed', 1],
      ['In use', 1],
    ]);
  });

  it('counts the worktrees to clean up', () => {
    expect(worktreesViewDescription([used, merged, idle])).toBe('1 to clean up');
    expect(worktreesViewDescription([used])).toBeUndefined();
  });
});

describe('worktreePickEntries (Rule WORKTREE-PICK-1)', () => {
  it('lists the stale ones first, pre-selected, then the idle ones and the ones in use', () => {
    const entries = worktreePickEntries([used, idle, merged], '/dev/app', false);
    expect(entries.map((entry) => ('separator' in entry ? `-- ${entry.separator}` : entry.label))).toEqual([
      '-- Can be removed',
      'feature/merged',
      '-- Idle',
      'feature/idle',
      '-- In use',
      'feature/used',
    ]);
    expect(entries[1]).toMatchObject({
      picked: true,
      description: 'app.worktrees/feature/merged',
      detail: 'PR 5 merged · PR 5 Fix it · uncommitted changes',
    });
    expect(entries[3]).toMatchObject({ picked: false });
  });

  it('leaves out the ones in use for the cleanup', () => {
    const entries = worktreePickEntries([used, idle], '/dev/app', true);
    expect(entries.map((entry) => ('separator' in entry ? entry.separator : entry.label))).toEqual([
      'Idle',
      'feature/idle',
    ]);
  });

  it('does not repeat the missing folder', () => {
    const missing = item('gone', {
      worktree: worktree('gone', { prunable: true }),
      status: 'stale',
      reasons: [{ kind: 'missing' }],
    });
    expect(worktreePickEntries([missing], '/dev/app', true)[1]).toMatchObject({ detail: 'folder missing' });
  });
});
