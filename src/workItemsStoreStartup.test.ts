import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const resolveContext = vi.hoisted(() => vi.fn());

vi.mock('vscode', () => ({
  EventEmitter: class {
    private listeners: ((e: unknown) => void)[] = [];
    event = (listener: (e: unknown) => void) => {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    };
    fire(e?: unknown) {
      this.listeners.forEach((l) => l(e));
    }
    dispose() {}
  },
  window: { activeTextEditor: undefined },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
}));
vi.mock('./config', async () => ({
  ...(await vi.importActual<object>('./config').catch(() => ({}))),
  resolveContext,
  settings: () => ({ organization: '', project: '', repository: '', teams: [], remote: 'origin' }),
  DEFAULT_PULL_REQUEST_TASK_PATTERN: /PR/,
}));
vi.mock('./worktreeGit', () => ({ listWorktrees: vi.fn().mockResolvedValue([]) }));

const NO_ORIGIN = "Unable to detect the Azure DevOps repository from the 'origin' remote.";

async function newStore() {
  const { WorkItemsStore } = await import('./workItemsStore');
  type Listener = () => void;
  const listeners = { change: [] as Listener[], open: [] as Listener[], state: [] as Listener[] };
  const remotes: { name: string; fetchUrl: string }[] = [];
  const repository = {
    rootUri: { fsPath: '/nonexistent' },
    state: {
      remotes,
      onDidChange: (l: Listener) => {
        listeners.change.push(l);
        return { dispose: () => undefined };
      },
    },
  };
  const git = {
    state: 'uninitialized' as 'uninitialized' | 'initialized',
    repositories: [] as unknown[],
    onDidOpenRepository: (l: Listener) => {
      listeners.open.push(l);
      return { dispose: () => undefined };
    },
    onDidChangeState: (l: Listener) => {
      listeners.state.push(l);
      return { dispose: () => undefined };
    },
    getRepository: () => null,
  };
  const store = new WorkItemsStore(git as never);
  return { store, git, repository, remotes, listeners };
}

describe('startup of the store with the git extension still loading', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resolveContext.mockReset();
    // Like the real one: fails without the origin remote
    resolveContext.mockImplementation((repository?: { state: { remotes: unknown[] } }) => {
      if (!repository?.state.remotes.length) {
        throw new Error(NO_ORIGIN);
      }
      return { client: { failure: true }, repositoryName: 'User_Interface' };
    });
  });
  afterEach(() => vi.useRealTimers());

  it('does not resolve the context nor fail while the remotes are empty, then loads once', async () => {
    const { store, git, repository, remotes, listeners } = await newStore();
    const loads = [store.ensureLoaded(), store.refresh(), store.ensureLoaded()];
    git.repositories.push(repository);
    git.state = 'initialized';
    listeners.open.forEach((l) => l());
    await vi.advanceTimersByTimeAsync(5000);
    expect(resolveContext).not.toHaveBeenCalled();
    expect(store.status).toBe('loading');
    expect(store.error).toBeUndefined();

    remotes.push({ name: 'origin', fetchUrl: 'https://dev.azure.com/o/p/_git/r' });
    listeners.change.forEach((l) => l());
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(loads);
    // The fake client has no methods, so the load ends in an error of its own, but only one load ran
    expect(resolveContext.mock.calls.length).toBeGreaterThan(0);
    expect(store.error).not.toBe(NO_ORIGIN);
    const callsAfterFirstLoad = resolveContext.mock.calls.length;
    await store.ensureLoaded();
    expect(resolveContext.mock.calls.length).toBe(callsAfterFirstLoad);
  });

  it('shows the clear error once when there is no origin for the whole timeout', async () => {
    const { store, git, repository } = await newStore();
    git.repositories.push(repository);
    git.state = 'initialized';
    const loads = [store.ensureLoaded(), store.refresh()];
    await vi.advanceTimersByTimeAsync(29_000);
    expect(resolveContext).not.toHaveBeenCalled();
    expect(store.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(loads);
    expect(resolveContext).toHaveBeenCalledTimes(1);
    expect(store.status).toBe('error');
    expect(store.error).toBe(NO_ORIGIN);
  });
});
