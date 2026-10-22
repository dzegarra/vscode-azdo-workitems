import * as vscode from 'vscode';
import { FunJournal, normalizeJournal } from './funJournal';

const KEY_PREFIX = 'totalflowx.funJournal:';

/**
 * The fun journal of the user, per organization / project in the global state. It is recorded even while the fun
 * features are off, so the recap of the sprint is complete when the user turns them on (or opens it by hand)
 */
export class FunJournalStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;

  constructor(private readonly state: vscode.Memento) {}

  journal(scope: string): FunJournal {
    return normalizeJournal(this.state.get<Partial<FunJournal>>(`${KEY_PREFIX}${scope}`));
  }

  /**
   * Applies a change to the stored journal. Read just before writing, so the entries of another window are kept.
   * Returns the journals before and after. Never throws: the pollers call it on their main path, and a failure of the
   * fun features must not cost a notification. Then before and after are the same (nothing to celebrate)
   */
  async update(
    scope: string,
    change: (journal: FunJournal) => FunJournal
  ): Promise<{ before: FunJournal; after: FunJournal }> {
    const before = this.journal(scope);
    try {
      const after = change(before);
      if (after !== before) {
        await this.state.update(`${KEY_PREFIX}${scope}`, after);
        this.changed.fire();
      }
      return { before, after };
    } catch {
      return { before, after: before };
    }
  }

  dispose(): void {
    this.changed.dispose();
  }
}
