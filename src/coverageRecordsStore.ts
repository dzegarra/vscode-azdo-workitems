import { CoverageRecords, CoverageResult, EMPTY_RECORDS, recordResult } from './coverageRecords';

/** The part of vscode.Memento that is used (globalState) */
export interface RecordsStorage {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

const KEY_PREFIX = 'azdoWorkItems.coverageRecords:';

/** Personal records of the coverage of the user's PRs, kept per organization / project in the global state */
export class CoverageRecordsStore {
  constructor(private readonly storage: RecordsStorage) {}

  records(scope: string): CoverageRecords {
    return this.storage.get<CoverageRecords>(`${KEY_PREFIX}${scope}`, EMPTY_RECORDS);
  }

  /** Records the results in the given order. Returns the records and whether anything changed */
  async observe(scope: string, results: CoverageResult[]): Promise<{ records: CoverageRecords; changed: boolean }> {
    const before = this.records(scope);
    const after = results.reduce(recordResult, before);
    if (after !== before) {
      await this.storage.update(`${KEY_PREFIX}${scope}`, after);
    }
    return { records: after, changed: after !== before };
  }
}
