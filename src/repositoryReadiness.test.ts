import { describe, expect, it } from 'vitest';
import { isRepositoryReady, ReadinessInput } from './repositoryReadiness';

const base: ReadinessInput = { apiState: 'initialized', hasRepository: true, remotesCount: 1, overridesSet: false };

describe('isRepositoryReady', () => {
  it('is ready with an initialized API and a repository with remotes', () => {
    expect(isRepositoryReady(base)).toBe(true);
  });

  it('waits while the git API is uninitialized', () => {
    expect(isRepositoryReady({ ...base, apiState: 'uninitialized' })).toBe(false);
  });

  it('waits for a repository', () => {
    expect(isRepositoryReady({ ...base, hasRepository: false, remotesCount: 0 })).toBe(false);
  });

  it('waits while the repository has no remotes yet', () => {
    expect(isRepositoryReady({ ...base, remotesCount: 0 })).toBe(false);
  });

  it('treats an API without state as initialized', () => {
    expect(isRepositoryReady({ ...base, apiState: undefined })).toBe(true);
  });

  it('is ready right away when the settings give the whole context', () => {
    expect(
      isRepositoryReady({ apiState: 'uninitialized', hasRepository: false, remotesCount: 0, overridesSet: true })
    ).toBe(true);
  });
});
