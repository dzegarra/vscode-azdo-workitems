import type { GitAPI, Repository } from './git';
import { isRepositoryReady } from './repositoryReadiness';

/** Seconds after which the wait ends anyway: a repository without 'origin' then gets the clear error */
export const READY_TIMEOUT_MS = 30_000;

interface Disposable {
  dispose(): void;
}

export interface GateOptions {
  git: Pick<GitAPI, 'repositories' | 'onDidOpenRepository'> & Partial<Pick<GitAPI, 'state' | 'onDidChangeState'>>;
  pick: () => Repository | undefined;
  overridesSet: () => boolean;
  timeoutMs?: number;
}

/**
 * Resolves when the Azure DevOps context can be resolved: the git extension is initialized and the repository has
 * its remotes (or the settings give the context), or after a timeout. Resolved once, it stays resolved.
 */
export class RepositoryGate {
  private promise?: Promise<void>;
  private resolved = false;
  private release?: () => void;
  private readonly watched = new Set<Repository>();
  private readonly disposables: Disposable[] = [];
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly options: GateOptions) {}

  get isReady(): boolean {
    return this.resolved;
  }

  whenReady(): Promise<void> {
    this.promise ??= this.start();
    return this.promise;
  }

  /** Call when the settings change: the overrides may now be enough */
  recheck(): void {
    if (this.promise && !this.resolved) {
      this.check();
    }
  }

  dispose(): void {
    this.finish();
  }

  private start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.release = resolve;
      if (this.isNowReady()) {
        this.finish();
        return;
      }
      const { git } = this.options;
      const onChange = () => this.check();
      this.disposables.push(
        git.onDidOpenRepository(() => this.check()),
        ...(git.onDidChangeState ? [git.onDidChangeState(onChange)] : [])
      );
      this.watchRepositories();
      this.timer = setTimeout(() => this.finish(), this.options.timeoutMs ?? READY_TIMEOUT_MS);
    });
  }

  private watchRepositories(): void {
    for (const repository of this.options.git.repositories) {
      if (!this.watched.has(repository)) {
        this.watched.add(repository);
        this.disposables.push(repository.state.onDidChange(() => this.check()));
      }
    }
  }

  private check(): void {
    if (this.resolved) {
      return;
    }
    this.watchRepositories();
    if (this.isNowReady()) {
      this.finish();
    }
  }

  private isNowReady(): boolean {
    const repository = this.options.git.repositories.length ? this.options.pick() : undefined;
    return isRepositoryReady({
      apiState: this.options.git.state,
      hasRepository: !!repository,
      remotesCount: repository?.state.remotes.length ?? 0,
      overridesSet: this.options.overridesSet(),
    });
  }

  private finish(): void {
    this.resolved = true;
    clearTimeout(this.timer);
    this.disposables.splice(0).forEach((d) => d.dispose());
    this.release?.();
  }
}
