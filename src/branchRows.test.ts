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
