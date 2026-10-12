import { describe, expect, it } from 'vitest';
import { actionMenuIcon, type ActionMenuAction } from './actionMenu';
import { renderActionMenu } from './actionMenuHtml';

const act = (action: ActionMenuAction['action']): ActionMenuAction => ({ action, id: 1 });

describe('actionMenuIcon', () => {
  it('gives every action its own icon and colour', () => {
    expect(actionMenuIcon({ act: act('checkoutHere') })).toEqual({ icon: 'checkout', tone: 'blue' });
    expect(actionMenuIcon({ act: act('openWorktree') })).toEqual({ icon: 'worktree', tone: 'purple' });
    expect(actionMenuIcon({ act: act('removeWorktree') })).toEqual({ icon: 'worktreeRemove', tone: 'orange' });
    expect(actionMenuIcon({ act: act('deleteBranch') })).toEqual({ icon: 'trash', tone: 'red' });
    expect(actionMenuIcon({ act: act('openPullRequest') })).toEqual({ icon: 'pullRequest', tone: 'green' });
    expect(actionMenuIcon({ act: act('createBranch') })).toEqual({ icon: 'branchAdd', tone: 'yellow' });
    expect(actionMenuIcon({ act: act('createPullRequest') })).toEqual({ icon: 'pullRequestAdd', tone: 'green' });
  });

  it('gives the items that only inform a grey branch', () => {
    expect(actionMenuIcon({})).toEqual({ icon: 'branch', tone: 'grey' });
  });
});

describe('renderActionMenu', () => {
  it('draws the icon of each item, hidden from screen readers', () => {
    const html = renderActionMenu(
      [{ title: 'Branch', items: [{ label: 'Checkout here', act: act('checkoutHere') }, { label: 'Checked out' }] }],
      'k',
      'Actions'
    );
    expect(html).toContain('action-menu-icon tone-blue');
    expect(html).toContain('action-menu-icon tone-grey');
    expect(html.match(/aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
