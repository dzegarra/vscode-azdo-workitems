import { describe, expect, it } from 'vitest';
import { branchMenuSections, hasBranchActions } from './branchMenu';
import type { BranchModel } from './viewModel';

const branch = (over: Partial<BranchModel> = {}): BranchModel => ({
  name: 'f/a',
  location: 'local',
  isCurrent: false,
  otherRepository: false,
  ...over,
});
const labels = (b: BranchModel, deletable = false, checkout = true) =>
  branchMenuSections(b, { id: 7, deletable, checkout }).flatMap((s) => s.items.map((i) => i.label));

describe('branchMenuSections', () => {
  it('offers Checkout here and Open in a worktree for a branch that is not checked out', () => {
    const [section] = branchMenuSections(branch(), { id: 7, deletable: false, checkout: true });
    expect(section.items.map((item) => item.act)).toEqual([
      { action: 'checkoutHere', id: 7, kind: 'workItem', branch: 'f/a' },
      { action: 'openWorktree', id: 7, kind: 'workItem', branch: 'f/a' },
    ]);
  });

  it('offers Open / Remove worktree, with the path, for a branch that has a worktree', () => {
    const sections = branchMenuSections(branch({ worktree: '/w/a' }), { id: 7, deletable: false, checkout: true });
    expect(sections[0].items.map((item) => [item.label, item.detail, item.act?.action])).toEqual([
      ['Open worktree', '/w/a', 'openWorktree'],
      ['Remove worktree', 'Keeps the branch', 'removeWorktree'],
    ]);
  });

  it('shows the current branch as a disabled row', () => {
    const sections = branchMenuSections(branch({ isCurrent: true, location: 'current' }), {
      id: 7,
      deletable: false,
      checkout: true,
    });
    expect(sections[0].items).toEqual([expect.objectContaining({ label: 'Checked out' })]);
    expect(sections[0].items[0].act).toBeUndefined();
    expect(hasBranchActions(sections)).toBe(false);
  });

  it('adds a danger Delete branch when it is deletable', () => {
    const sections = branchMenuSections(branch(), { id: 7, deletable: true, checkout: true });
    const remove = sections[1].items[0];
    expect(remove).toMatchObject({ label: 'Delete branch f/a', detail: 'The PR is merged', danger: true });
    expect(remove.act).toEqual({ action: 'deleteBranch', id: 7, kind: 'workItem', branch: 'f/a' });
  });

  it('leaves the checkout items out when the card-level button covers the branch', () => {
    expect(labels(branch(), true, false)).toEqual(['Delete branch f/a']);
    expect(hasBranchActions(branchMenuSections(branch(), { id: 7, deletable: false, checkout: false }))).toBe(false);
  });

  it('has nothing for a branch of another repository', () => {
    expect(labels(branch({ otherRepository: true }))).toEqual([]);
  });
});
