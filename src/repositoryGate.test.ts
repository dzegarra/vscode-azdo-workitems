import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from './git';
import { RepositoryGate } from './repositoryGate';

type Listener = () => void;

class FakeEvent {
  private listeners = new Set<Listener>();
  readonly event = (listener: Listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(): void {
    [...this.listeners].forEach((listener) => listener());
  }
}

function setup(options: { overrides?: boolean } = {}) {
  const stateChange = new FakeEvent();
  const opened = new FakeEvent();
  const repoChange = new FakeEvent();
  const remotes: { name: string }[] = [];
  const repository = { state: { remotes, onDidChange: repoChange.event } } as unknown as Repository;
  const git = {
    state: 'uninitialized' as 'uninitialized' | 'initialized',
    repositories: [] as Repository[],
    onDidOpenRepository: opened.event,
    onDidChangeState: stateChange.event,
  };
  let overrides = options.overrides ?? false;
  const gate = new RepositoryGate({
    git: git as never,
    pick: () => git.repositories[0],
    overridesSet: () => overrides,
    timeoutMs: 1000,
  });
  return {
    gate,
    git,
    repository,
    remotes,
    stateChange,
    opened,
    repoChange,
    setOverrides: (value: boolean) => (overrides = value),
  };
}

describe('RepositoryGate', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays pending while the repository has no remotes, then resolves when they appear', async () => {
    const t = setup();
    const done = vi.fn();
    void t.gate.whenReady().then(done);
    t.git.state = 'initialized';
    t.git.repositories.push(t.repository);
    t.opened.fire();
    t.stateChange.fire();
    await vi.advanceTimersByTimeAsync(10);
    expect(done).not.toHaveBeenCalled();

    t.remotes.push({ name: 'origin' });
    t.repoChange.fire();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
    expect(t.gate.isReady).toBe(true);
  });

  it('resolves immediately when the settings give the context', async () => {
    const t = setup({ overrides: true });
    await t.gate.whenReady();
    expect(t.gate.isReady).toBe(true);
  });

  it('resolves when the overrides are set later', async () => {
    const t = setup();
    const done = vi.fn();
    void t.gate.whenReady().then(done);
    await vi.advanceTimersByTimeAsync(10);
    expect(done).not.toHaveBeenCalled();
    t.setOverrides(true);
    t.gate.recheck();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('resolves after the timeout when the remotes never appear', async () => {
    const t = setup();
    t.git.state = 'initialized';
    t.git.repositories.push(t.repository);
    const done = vi.fn();
    void t.gate.whenReady().then(done);
    await vi.advanceTimersByTimeAsync(999);
    expect(done).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('is shared by all the callers and stays resolved', async () => {
    const t = setup();
    t.git.state = 'initialized';
    t.git.repositories.push(t.repository);
    t.remotes.push({ name: 'origin' });
    const first = t.gate.whenReady();
    expect(t.gate.whenReady()).toBe(first);
    await first;
    t.remotes.length = 0;
    t.repoChange.fire();
    expect(t.gate.isReady).toBe(true);
  });
});
