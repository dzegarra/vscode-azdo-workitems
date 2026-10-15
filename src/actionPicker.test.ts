import { describe, expect, it } from 'vitest';
import type { ActionMenuAction, ActionMenuSection } from './actionMenu';
import { actionToMessage, hasPickerActions, pickerEntries } from './actionPicker';

const act = (over: Partial<ActionMenuAction> & Pick<ActionMenuAction, 'action'>): ActionMenuAction => ({
  id: 7,
  ...over,
});

describe('actionToMessage', () => {
  it('turns every action the builders produce into the message of its button', () => {
    expect(actionToMessage(act({ action: 'checkoutHere', kind: 'workItem', branch: 'b' }))).toEqual({
      type: 'checkoutHere',
      kind: 'workItem',
      id: 7,
      branch: 'b',
    });
    expect(actionToMessage(act({ action: 'openWorktree', kind: 'review' }))).toEqual({
      type: 'openWorktree',
      kind: 'review',
      id: 7,
    });
    expect(actionToMessage(act({ action: 'removeWorktree', kind: 'myPullRequest' }))).toEqual({
      type: 'removeWorktree',
      kind: 'myPullRequest',
      id: 7,
    });
    expect(actionToMessage(act({ action: 'deleteBranch', kind: 'task', branch: 'b' }))).toEqual({
      type: 'deleteBranch',
      id: 7,
      branch: 'b',
    });
    expect(actionToMessage(act({ action: 'openPullRequest', pr: 3 }))).toEqual({
      type: 'openPullRequest',
      id: 7,
      pullRequestId: 3,
    });
    expect(actionToMessage(act({ action: 'createBranch', task: 9 }))).toEqual({
      type: 'createBranch',
      id: 7,
      taskId: 9,
    });
    expect(actionToMessage(act({ action: 'createPullRequest', task: 9, branch: 'b' }))).toEqual({
      type: 'createPullRequest',
      id: 7,
      taskId: 9,
      branch: 'b',
    });
    expect(actionToMessage(act({ action: 'createPullRequest' }))).toEqual({ type: 'createPullRequest', id: 7 });
  });

  it('ignores actions that are not on the list', () => {
    for (const action of ['refresh', 'openFile', 'checkout', 'setFilter', 'constructor', '', undefined, 3]) {
      expect(actionToMessage({ action, id: 7, kind: 'workItem', branch: 'b', pr: 3 })).toBeUndefined();
    }
  });

  it('ignores items whose fields have the wrong type', () => {
    expect(actionToMessage(undefined)).toBeUndefined();
    expect(actionToMessage('checkoutHere')).toBeUndefined();
    expect(actionToMessage({ action: 'checkoutHere', id: '7', kind: 'workItem' })).toBeUndefined();
    expect(actionToMessage({ action: 'checkoutHere', id: 0, kind: 'workItem' })).toBeUndefined();
    expect(actionToMessage({ action: 'checkoutHere', id: 1.5, kind: 'workItem' })).toBeUndefined();
    expect(actionToMessage({ action: 'checkoutHere', id: 7, kind: 'other' })).toBeUndefined();
    expect(actionToMessage({ action: 'checkoutHere', id: 7 })).toBeUndefined();
    expect(actionToMessage({ action: 'checkoutHere', id: 7, kind: 'task', branch: 5 })).toBeUndefined();
    expect(actionToMessage({ action: 'deleteBranch', id: 7 })).toBeUndefined();
    expect(actionToMessage({ action: 'deleteBranch', id: 7, branch: '' })).toBeUndefined();
    expect(actionToMessage({ action: 'openPullRequest', id: 7 })).toBeUndefined();
    expect(actionToMessage({ action: 'openPullRequest', id: 7, pr: '3' })).toBeUndefined();
    expect(actionToMessage({ action: 'createBranch', id: 7, task: 'x' })).toBeUndefined();
  });

  it('does not pass on fields of its own: only the ones of the message', () => {
    const message = actionToMessage({ action: 'openPullRequest', id: 7, pr: 3, url: 'https://evil', type: 'openFile' });
    expect(message).toEqual({ type: 'openPullRequest', id: 7, pullRequestId: 3 });
  });
});

const sections: ActionMenuSection[] = [
  {
    title: 'Branches',
    items: [
      { label: 'Checkout a', detail: 'remote only', act: act({ action: 'checkoutHere', kind: 'task', branch: 'a' }) },
      { label: 'b', detail: 'Checked out (here)' },
      {
        label: 'Delete branch a',
        detail: 'The PR is merged',
        danger: true,
        act: act({ action: 'deleteBranch', kind: 'task', branch: 'a' }),
      },
    ],
  },
  { title: 'Info', items: [{ label: 'Only information' }] },
  {
    title: 'Pull requests',
    items: [{ label: 'Open PR 3', act: act({ action: 'openPullRequest', pr: 3 }) }],
  },
];

describe('pickerEntries', () => {
  const entries = pickerEntries(sections);

  it('puts a separator with the title of the section before its items, and drops sections without actions', () => {
    expect(entries.map((entry) => (entry.kind === 'separator' ? `-- ${entry.label}` : entry.label))).toEqual([
      '-- Branches',
      'Checkout a',
      'Delete branch a',
      '-- Pull requests',
      'Open PR 3',
    ]);
  });

  it('leaves out the items that only inform: a picker cannot show an inert item', () => {
    expect(entries.some((entry) => entry.kind === 'item' && entry.label === 'b')).toBe(false);
  });

  it('shows the detail as the description', () => {
    expect(entries[1]).toMatchObject({ description: 'remote only' });
    expect(
      pickerEntries([{ title: 'T', items: [{ label: 'x', act: act({ action: 'createBranch' }) }] }])[1]
    ).not.toHaveProperty('description');
  });

  it('gives each action its codicon and theme colour', () => {
    expect(entries[1]).toMatchObject({ iconId: 'git-branch', colorId: 'charts.blue', danger: false });
    expect(entries[4]).toMatchObject({ iconId: 'git-pull-request', colorId: 'charts.green' });
    const create = pickerEntries([
      {
        title: 'Create',
        items: [
          { label: 'a', act: act({ action: 'createBranch' }) },
          { label: 'b', act: act({ action: 'createPullRequest' }) },
          { label: 'c', act: act({ action: 'openWorktree', kind: 'workItem' }) },
          { label: 'd', act: act({ action: 'removeWorktree', kind: 'workItem' }) },
        ],
      },
    ]);
    expect(create.slice(1)).toMatchObject([
      { iconId: 'git-branch-create', colorId: 'charts.yellow' },
      { iconId: 'git-pull-request-create', colorId: 'charts.green' },
      { iconId: 'folder-opened', colorId: 'charts.blue' },
      { iconId: 'close', colorId: 'charts.orange' },
    ]);
  });

  it('marks the destructive item: red trash', () => {
    expect(entries[2]).toMatchObject({ danger: true, iconId: 'trash', colorId: 'charts.red' });
  });

  it('carries the validated message of the item, not the data it came with', () => {
    expect(entries[1]).toMatchObject({
      message: { type: 'checkoutHere', kind: 'task', id: 7, branch: 'a' },
    });
  });

  it('ignores items with an action that is not allowed, and malformed input', () => {
    const bad = [
      {
        title: 'T',
        items: [{ label: 'x', act: { action: 'openFile', id: 1 } }, null, { act: act({ action: 'createBranch' }) }],
      },
      'nope',
      { title: 5, items: [] },
    ];
    expect(pickerEntries(bad)).toEqual([]);
    expect(pickerEntries(undefined)).toEqual([]);
    expect(pickerEntries({})).toEqual([]);
  });
});

describe('hasPickerActions', () => {
  it('is true when something can be chosen', () => {
    expect(hasPickerActions(sections)).toBe(true);
  });

  it('is false for an info-only menu', () => {
    expect(hasPickerActions([{ title: 'Info', items: [{ label: 'Checked out' }] }])).toBe(false);
    expect(hasPickerActions([])).toBe(false);
  });
});
