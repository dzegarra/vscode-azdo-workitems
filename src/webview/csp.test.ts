import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The sidebar and the dependency map run under a Content Security Policy without 'unsafe-inline' styles:
 * VS Code silently ignores inline style attributes there, so positions and sizes must be set from the script
 */
describe('webviews with a strict Content Security Policy', () => {
  const sources = readdirSync(__dirname).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

  it.each(sources)('%s does not render inline style attributes', (file) => {
    expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(/\sstyle=["']/);
  });
});
