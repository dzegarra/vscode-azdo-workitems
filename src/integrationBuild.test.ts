import { describe, expect, it } from 'vitest';
import { integrationBuildValue, lastPublishedVersion } from './integrationBuild';

describe('lastPublishedVersion', () => {
  it('takes the last published version, not the highest one', () => {
    expect(
      lastPublishedVersion([
        { version: '2.0.0', publishDate: '2026-09-01T10:00:00Z', isLatest: true },
        { version: '1.9.4', publishDate: '2026-09-20T08:30:00Z' },
        { version: '1.9.3', publishDate: '2026-08-15T08:30:00Z' },
      ])
    ).toBe('1.9.4');
  });

  it('skips deleted versions', () => {
    expect(
      lastPublishedVersion([
        { version: '1.9.5', publishDate: '2026-09-30T08:30:00Z', isDeleted: true },
        { version: '1.9.4', publishDate: '2026-09-20T08:30:00Z' },
      ])
    ).toBe('1.9.4');
  });

  it('falls back to the latest version when there are no dates', () => {
    expect(lastPublishedVersion([{ version: '1.0.0' }, { version: '1.1.0', isLatest: true }])).toBe('1.1.0');
    expect(lastPublishedVersion([])).toBeUndefined();
  });
});

describe('integrationBuildValue', () => {
  it('appends the suffix once', () => {
    expect(integrationBuildValue('2026.10.3', '+')).toBe('2026.10.3+');
    expect(integrationBuildValue(' 2026.10.3+ ', '+')).toBe('2026.10.3+');
    expect(integrationBuildValue('2026.10.3', '')).toBe('2026.10.3');
  });
});
