import { describe, expect, it, vi } from 'vitest';

/** Fake `vscode`: records the commands the actions run */
const executed = vi.hoisted(() => ({ commands: [] as unknown[][] }));
vi.mock('vscode', () => ({
  commands: {
    executeCommand: (...args: unknown[]) => {
      executed.commands.push(args);
      return Promise.resolve();
    },
  },
}));

import { runWorkItemAction } from './workItemActions';
import type { WorkItemsStore } from './workItemsStore';

const store = { find: () => undefined } as unknown as WorkItemsStore;

describe('runWorkItemAction', () => {
  it('runs the command of each action, and only changeState gets a target state', async () => {
    executed.commands = [];
    await runWorkItemAction(store, { type: 'openDetails', id: 1 });
    await runWorkItemAction(store, { type: 'openDependencyMap', id: 2 });
    await runWorkItemAction(store, { type: 'changeState', id: 3, state: 'Done' });
    await runWorkItemAction(store, { type: 'changeState', id: 4 });
    expect(executed.commands).toEqual([
      ['totalflowx.openDetails', 1],
      ['totalflowx.openDependencyMap', 2],
      ['totalflowx.changeState', 3, 'Done'],
      ['totalflowx.changeState', 4, undefined],
    ]);
  });
});
