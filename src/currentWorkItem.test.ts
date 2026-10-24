import { describe, expect, it } from 'vitest';
import {
  describeCurrentWorkItem,
  isSamePerson,
  shortTitle,
  statusBarLabel,
  statusBarText,
  statusBarTypeColor,
  statusBarTypeIcon,
} from './currentWorkItem';

const me = { id: 'me', displayName: 'you' };
const borislav = {
  id: '8b9dd468-b1d8-65ac-a3f6-bb7e0e138802',
  displayName: 'Borislav Surovi EXT',
  uniqueName: 'borislav.surovi@us.abb.com',
};
// Like work item 60800, whose branch is "feature/MA/60800_unit_config_for_rates_multiplier"
const info = {
  id: 60800,
  title: '[Measurement] Update Unit Configuration for multiplier rates',
  type: 'Product Backlog Item',
  state: 'Committed',
};

describe('current work item', () => {
  it('presents the work items assigned to me as mine', () => {
    const view = describeCurrentWorkItem(
      { ...info, assignedTo: { ...me, displayName: 'Daniel Zegarra EXT' } },
      me,
      undefined
    );
    expect(view).toMatchObject({ isMine: true, assignee: 'you', branchOwner: undefined });
    expect(statusBarText({ ...info, assignedTo: me }, view, 'id')).toBe('$(book) 60800');
    expect(statusBarText({ ...info, assignedTo: me }, view, 'idAndTitle')).toBe(
      '$(book) 60800 [Measurement] Update Unit Configuration…'
    );
  });

  it("names the owner of a colleague's branch", () => {
    const view = describeCurrentWorkItem({ ...info, assignedTo: borislav }, me, borislav);
    expect(view).toEqual({
      isMine: false,
      assignee: 'Borislav Surovi EXT',
      branchOwner: 'Borislav Surovi EXT',
      ownerLabel: 'Borislav Surovi EXT',
    });
    expect(statusBarText(info, view, 'id')).toBe('$(eye) $(book) 60800 · Borislav Surovi EXT');
    expect(statusBarText(info, view, 'idAndTitle')).toBe(
      '$(eye) $(book) 60800 [Measurement] Update Unit Configuration… · Borislav Surovi EXT'
    );
  });

  it('tells apart the owner of the branch and the assignee, and handles unknown ones', () => {
    const ana = { id: 'ana', displayName: 'Ana' };
    expect(describeCurrentWorkItem({ ...info, assignedTo: ana }, me, borislav)).toMatchObject({
      isMine: false,
      assignee: 'Ana',
      branchOwner: 'Borislav Surovi EXT',
      ownerLabel: 'Borislav Surovi EXT',
    });
    // Not pushed yet: the owner is not known, so the assignee is named. Unassigned: nobody
    expect(describeCurrentWorkItem({ ...info, assignedTo: ana }, me, undefined).ownerLabel).toBe('Ana');
    expect(describeCurrentWorkItem(info, me, undefined)).toMatchObject({
      isMine: false,
      assignee: 'nobody',
      ownerLabel: 'nobody',
    });
    // My branch of a work item assigned to someone else
    expect(describeCurrentWorkItem({ ...info, assignedTo: ana }, me, me)).toMatchObject({
      isMine: false,
      branchOwner: 'you',
    });
  });

  it('compares people by ID, or by user name when there is no ID', () => {
    expect(isSamePerson(borislav, { ...borislav, displayName: 'Other' })).toBe(true);
    expect(isSamePerson({ displayName: 'A', uniqueName: 'A@x.com' }, { displayName: 'B', uniqueName: 'a@x.com' })).toBe(
      true
    );
    expect(isSamePerson(borislav, me)).toBe(false);
    expect(isSamePerson(undefined, me)).toBe(false);
  });

  it('shortens long titles', () => {
    expect(shortTitle('  A   short\ntitle ', 40)).toBe('A short title');
    expect(shortTitle('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('shows the icon and colour of the type', () => {
    expect(statusBarTypeIcon('Bug')).toBe('$(bug)');
    expect(statusBarTypeIcon('Task')).toBe('$(tasklist)');
    expect(statusBarTypeIcon('Impediment')).toBe('$(issues)');
    expect(statusBarTypeColor('Bug')).toBe('totalflowx.workItemType.bugForeground');
    expect(statusBarTypeColor('User Story')).toBe('totalflowx.workItemType.backlogForeground');
    expect(statusBarTypeColor('Impediment')).toBeUndefined();
  });

  it('shows the ID alone unless the title is asked for', () => {
    expect(statusBarLabel(undefined)).toBe('id');
    expect(statusBarLabel('something else')).toBe('id');
    expect(statusBarLabel('idAndTitle')).toBe('idAndTitle');
  });
});
