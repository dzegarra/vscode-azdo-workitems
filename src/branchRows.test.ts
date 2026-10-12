import { describe, expect, it } from 'vitest';
import { renderBranchList } from './branchRows';
import type { BranchModel } from './viewModel';

const branch = (name: string, over: Partial<BranchModel> = {}): BranchModel => ({
  name,
  location: 'remote',
  isCurrent: false,
  otherRepository: false,
  ...over,
});

const card = (over: Partial<Parameters<typeof renderBranchList>[0]> = {}) => ({
  id: 7,
  state: 'Active',
  branch: 'f/a',
  branches: [branch('f/a')],
  deletableBranches: [],
  ...over,
});

describe('renderBranchList', () => {
  it('gives a Delete button and the "not deleted" pill to the deletable branches only', () => {
    const html = renderBranchList(card({ branches: [branch('f/a'), branch('f/b')], deletableBranches: ['f/b'] }));
    expect(html.match(/data-action="deleteBranch"/g)).toHaveLength(1);
    expect(html).toContain('data-id="7" data-branch="f/b"');
    expect(html).toContain('not deleted');
  });

  it('uses one badge for the location and the worktree, and icon buttons instead of text', () => {
    const html = renderBranchList(
      card({
        branches: [branch('f/a', { location: 'local' }), branch('f/b', { location: 'local', worktree: '/w' })],
        deletableBranches: ['f/a'],
      })
    );
    expect(html).toContain('not deleted</span>');
    expect(html).toContain('local ⧉</span>');
    expect(html).not.toContain('worktree</span>');
    expect(html).toContain('aria-label="Checkout f/a"');
    expect(html).toContain('aria-label="Open the worktree of f/b"');
    expect(html).toContain('aria-label="Delete the branch f/a"');
    expect(html).not.toMatch(/>(Checkout|Open worktree|Delete)<\/button>/);
  });

  it('does it whatever the state of the work item, and lists the branch of a finished one', () => {
    for (const state of ['Active', 'Done']) {
      const html = renderBranchList(card({ state, deletableBranches: ['f/a'] }));
      expect(html).toContain('data-action="deleteBranch"');
    }
  });

  it('never offers it for a branch of another repository', () => {
    const html = renderBranchList(
      card({ branches: [branch('f/a', { otherRepository: true })], deletableBranches: ['f/a'] })
    );
    expect(html).not.toContain('data-action="deleteBranch"');
  });

  it('says there is nothing to delete for a finished work item without branches to show', () => {
    expect(renderBranchList(card({ state: 'Done' }))).toContain('No branch to delete');
    expect(renderBranchList(card({ state: 'Done', branch: undefined, branches: [] }))).toContain('No branch');
  });
});

describe('renderBranchList with the popover menu', () => {
  const popoverCard = card({
    branches: [branch('f/a', { location: 'local' }), branch('f/b')],
    deletableBranches: ['f/b'],
  });

  it('keeps the icon split button and the trash button; the ▾ opens the menu instead of a QuickPick', () => {
    const html = renderBranchList(popoverCard, {});
    expect(html.match(/data-action="toggleMenu"/g)).toHaveLength(2);
    expect(html).toContain('data-menu="branch-7-f/a"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('checkout-group');
    expect(html).toContain('data-action="checkout"');
    expect(html).not.toContain('data-action="checkoutMenu"');
    expect(html.match(/data-action="deleteBranch"/g)).toHaveLength(1);
    expect(html).not.toContain('class="action-menu"');
  });

  it('renders the menu of the open branch only', () => {
    const html = renderBranchList(popoverCard, { openMenu: 'branch-7-f/b' });
    expect(html.match(/class="action-menu"/g)).toHaveLength(1);
    expect(html).toContain('aria-expanded="true"');
    expect(html.match(/data-action="deleteBranch"/g)).toHaveLength(2);
    expect(html).toContain('data-action="checkoutHere"');
  });

  it('has no button for a branch of another repository or without actions', () => {
    const html = renderBranchList(
      card({ branches: [branch('f/a', { otherRepository: true }), branch('f/b', { isCurrent: true })] }),
      {}
    );
    expect(html).not.toContain('toggleMenu');
  });
});
