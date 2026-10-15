import { describe, expect, it } from 'vitest';
import { actionMenuIcon, type ActionMenuAction } from './actionMenu';

const act = (action: ActionMenuAction['action']): ActionMenuAction => ({ action, id: 1 });

describe('actionMenuIcon', () => {
  it('gives every action its own codicon and colour', () => {
    expect(actionMenuIcon({ act: act('checkoutHere') })).toEqual({ codicon: 'git-branch', tone: 'blue' });
    expect(actionMenuIcon({ act: act('openWorktree') })).toEqual({ codicon: 'folder-opened', tone: 'blue' });
    expect(actionMenuIcon({ act: act('removeWorktree') })).toEqual({ codicon: 'close', tone: 'orange' });
    expect(actionMenuIcon({ act: act('deleteBranch') })).toEqual({ codicon: 'trash', tone: 'red' });
    expect(actionMenuIcon({ act: act('openPullRequest') })).toEqual({ codicon: 'git-pull-request', tone: 'green' });
    expect(actionMenuIcon({ act: act('createBranch') })).toEqual({ codicon: 'git-branch-create', tone: 'yellow' });
    expect(actionMenuIcon({ act: act('createPullRequest') })).toEqual({
      codicon: 'git-pull-request-create',
      tone: 'green',
    });
  });

  it('gives the items that only inform a grey branch', () => {
    expect(actionMenuIcon({})).toEqual({ codicon: 'git-branch', tone: 'grey' });
  });
});
