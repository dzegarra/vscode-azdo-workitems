import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * docs/RULES.md and the code stay in sync: every `Rule <ID>` written in src/** exists in the tables of the document,
 * and every ID defined in a table is referenced by a code comment
 */

const PROJECT_ROOT = join(import.meta.dirname, '..');
const SRC = join(PROJECT_ROOT, 'src');
const ID = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\\d+';
const ID_WITH_RANGE = new RegExp(`(${ID})(?:\\.\\.(\\d+))?`, 'g');
const TABLE_ROW_ID = new RegExp(`^\\|\\s*(${ID})\\s*\\|`);
/** Rows with these prefixes are open questions, not rules */
const UNCHECKED_PREFIXES = ['GAP-'];

/** Expands "PR-STATUS-1..9" into its nine IDs; a plain ID is itself */
function expand(id: string, upTo?: string): string[] {
  if (!upTo) {
    return [id];
  }
  const [, prefix, from] = /^(.*)-(\d+)$/.exec(id) ?? [];
  const last = Number(upTo);
  return Array.from(
    { length: Math.max(0, last - Number(from) + 1) },
    (_, index) => `${prefix}-${Number(from) + index}`
  );
}

function sourceFiles(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return name.endsWith('.ts') && !name.endsWith('.test.ts') ? [path] : [];
  });
}

/** IDs written after "Rule" / "Rules" in a comment, with the file they are in */
function referencedInCode(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(SRC)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const start = line.search(/\bRules? /);
      if (start === -1) {
        continue;
      }
      for (const [, id, upTo] of line.slice(start).matchAll(ID_WITH_RANGE)) {
        for (const expanded of expand(id, upTo)) {
          found.set(expanded, [...(found.get(expanded) ?? []), relative(PROJECT_ROOT, file)]);
        }
      }
    }
  }
  return found;
}

const document = readFileSync(join(PROJECT_ROOT, 'docs', 'RULES.md'), 'utf8');

function definedInDocument(): string[] {
  return document.split('\n').flatMap((line) => {
    const id = TABLE_ROW_ID.exec(line)?.[1];
    return id && !UNCHECKED_PREFIXES.some((prefix) => id.startsWith(prefix)) ? [id] : [];
  });
}

/** `<!-- rules-exempt: ID, ID -->`: rules that are pure configuration and have no code site */
function exempt(): string[] {
  const list = /<!--\s*rules-exempt:([^>]*)-->/.exec(document)?.[1] ?? '';
  return list
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

describe('docs/RULES.md', () => {
  const defined = definedInDocument();
  const referenced = referencedInCode();

  it('defines each rule ID once', () => {
    const repeated = defined.filter((id, index) => defined.indexOf(id) !== index);
    expect(repeated).toEqual([]);
  });

  it('has every rule ID that the code references', () => {
    const unknown = [...referenced.keys()].filter((id) => !defined.includes(id));
    expect(unknown.map((id) => `${id} (${referenced.get(id)?.join(', ')})`)).toEqual([]);
  });

  it('is referenced in the code for every rule it defines', () => {
    const exemptIds = exempt();
    const missing = defined.filter((id) => !referenced.has(id) && !exemptIds.includes(id));
    expect(missing).toEqual([]);
  });

  it('only exempts rules it defines', () => {
    expect(exempt().filter((id) => !defined.includes(id))).toEqual([]);
  });
});
