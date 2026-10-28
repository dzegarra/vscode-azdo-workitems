/**
 * Reads of one thing per id kept by an immutable key (a work item by its revision, a closed PR for good, an open one by
 * its last commit): asked once per key, at most MAX_IN_FLIGHT at a time, a failure tried again after a while. The
 * Sprint timeline uses it for the state histories (Rule TIMELINE-35), the votes of the reviewed PRs (Rule TIMELINE-37),
 * and the details of a PR row read on hover. No "vscode" import: the read is given
 */
import { mapLimit, MAX_IN_FLIGHT } from './concurrency';

export interface KeyedEntry<T> {
  key: string;
  value: T;
}

/** A failed read is asked again after this long (a wrong id must not be asked on every draw) */
export const RETRY_AFTER_MS = 10 * 60_000;

/** What has to be read: the ids whose kept key is not the wanted one, not in flight, not failed lately with that key */
export function idsToRead(
  wanted: readonly { id: number; key: string }[],
  state: {
    entries: ReadonlyMap<number, KeyedEntry<unknown>>;
    inFlight: ReadonlyMap<number, string>;
    failed: ReadonlyMap<number, { key: string; at: number }>;
    now: number;
  }
): { id: number; key: string }[] {
  const seen = new Set<number>();
  return wanted.filter(({ id, key }) => {
    if (seen.has(id)) {
      return false;
    }
    seen.add(id);
    const failed = state.failed.get(id);
    return (
      state.entries.get(id)?.key !== key &&
      state.inFlight.get(id) !== key &&
      !(failed?.key === key && state.now - failed.at < RETRY_AFTER_MS)
    );
  });
}

export class KeyedReads<T> {
  private readonly entries = new Map<number, KeyedEntry<T>>();
  private readonly inFlight = new Map<number, string>();
  private readonly failedReads = new Map<number, { key: string; at: number }>();
  /** Requests made so far */
  requests = 0;

  constructor(
    private readonly read: (id: number) => Promise<T>,
    /** Something was read (or failed): draw again */
    private readonly onChange: () => void,
    private readonly clock: () => number = Date.now
  ) {}

  /** What was read for the id, even under an older key (it is redrawn when the new one arrives) */
  get(id: number): T | undefined {
    return this.entries.get(id)?.value;
  }

  loading(id: number): boolean {
    return this.inFlight.has(id);
  }

  /** The last read of the id failed (it is asked again after a while, or after `forget`) */
  failed(id: number): boolean {
    return this.failedReads.has(id);
  }

  /** Forgets what was read or failed for the id: the next request reads it again (Refresh) */
  forget(id: number): void {
    this.entries.delete(id);
    this.failedReads.delete(id);
  }

  /** The ids being read */
  loadingIds(): Set<number> {
    return new Set(this.inFlight.keys());
  }

  /** The values read so far, by id */
  snapshot(): Map<number, T> {
    return new Map([...this.entries].map(([id, entry]) => [id, entry.value]));
  }

  /** Starts what is wanted and not kept yet. True when something started */
  request(wanted: readonly { id: number; key: string }[]): boolean {
    const toRead = idsToRead(wanted, {
      entries: this.entries,
      inFlight: this.inFlight,
      failed: this.failedReads,
      now: this.clock(),
    });
    if (!toRead.length) {
      return false;
    }
    toRead.forEach(({ id, key }) => this.inFlight.set(id, key));
    void this.load(toRead);
    return true;
  }

  private async load(toRead: readonly { id: number; key: string }[]): Promise<void> {
    await mapLimit(toRead, MAX_IN_FLIGHT, async ({ id, key }) => {
      try {
        this.requests += 1;
        this.entries.set(id, { key, value: await this.read(id) });
        this.failedReads.delete(id);
      } catch {
        this.failedReads.set(id, { key, at: this.clock() });
      } finally {
        this.inFlight.delete(id);
      }
    });
    this.onChange();
  }
}
