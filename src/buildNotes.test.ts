import { describe, expect, it, vi } from 'vitest';
import {
  BuildNotesDiffCache,
  BuildNotesOptions,
  BuildNotesPullRequest,
  buildNotesWarningText,
  checkPullRequestNotes,
  diffCacheKey,
  diffChangesFile,
  hasSkipTag,
  localDiffChangesFile,
  needsBuildNotesWarning,
  needsDiffRequest,
  normalizeRepoPath,
  parseChangedFiles,
} from './buildNotes';

const OPTIONS: BuildNotesOptions = { enabled: true, path: 'build-notes/developer-notes.md', skipTag: 'no-build-notes' };
const ONE_MINUTE = 60_000;
const ELEVEN_MINUTES = 11 * ONE_MINUTE;
const LOCAL = { localRepo: true, fileExists: true };

function pr(overrides: Partial<BuildNotesPullRequest> = {}): BuildNotesPullRequest {
  return {
    pullRequestId: 7,
    status: 'active',
    isDraft: false,
    lastMergeSourceCommit: { commitId: 'src1' },
    lastMergeTargetCommit: { commitId: 'tgt1' },
    ...overrides,
  };
}

describe('hasSkipTag', () => {
  it('matches case-insensitively and ignores inactive labels', () => {
    expect(hasSkipTag([{ name: 'No-Build-Notes', active: true }], 'no-build-notes')).toBe(true);
    expect(hasSkipTag([{ name: 'no-build-notes', active: false }], 'no-build-notes')).toBe(false);
    expect(hasSkipTag([{ name: 'other' }], 'no-build-notes')).toBe(false);
    expect(hasSkipTag(undefined, 'no-build-notes')).toBe(false);
    expect(hasSkipTag([{ name: 'x' }], ' ')).toBe(false);
  });
});

describe('diffChangesFile', () => {
  const touched = { changes: [{ item: { path: '/build-notes/developer-notes.md' } }], allChangesIncluded: true };
  it('is true when the file is listed', () => {
    expect(diffChangesFile(touched, OPTIONS.path)).toBe(true);
    expect(diffChangesFile({ ...touched, allChangesIncluded: false }, OPTIONS.path)).toBe(true);
  });
  it('is false when the complete list lacks the file', () => {
    expect(diffChangesFile({ changes: [{ item: { path: '/a.ts' } }], allChangesIncluded: true }, OPTIONS.path)).toBe(
      false
    );
    expect(diffChangesFile({ changes: [] }, OPTIONS.path)).toBe(false);
  });
  it('is unknown when the list is incomplete and lacks the file', () => {
    expect(
      diffChangesFile({ changes: [{ item: { path: '/a.ts' } }], allChangesIncluded: false }, OPTIONS.path)
    ).toBeUndefined();
  });
});

describe('local diff', () => {
  it('parses one path per line', () => {
    expect(parseChangedFiles('a.ts\r\nbuild-notes/developer-notes.md\n\n')).toEqual([
      'a.ts',
      'build-notes/developer-notes.md',
    ]);
    expect(parseChangedFiles('')).toEqual([]);
  });
  it('tells whether the file is among them', () => {
    expect(localDiffChangesFile('a.ts\nbuild-notes/developer-notes.md\n', './build-notes/developer-notes.md')).toBe(
      true
    );
    expect(localDiffChangesFile('a.ts\n', OPTIONS.path)).toBe(false);
  });
  it('normalizes paths', () => {
    expect(normalizeRepoPath('\\build-notes\\x.md')).toBe('build-notes/x.md');
  });
});

describe('needsDiffRequest', () => {
  it('asks for a published, active, untagged PR of the local repo with the file', () => {
    expect(needsDiffRequest(pr(), LOCAL, OPTIONS)).toBe(true);
  });
  it.each([
    ['draft', pr({ isDraft: true }), LOCAL, OPTIONS],
    ['completed', pr({ status: 'completed' }), LOCAL, OPTIONS],
    ['tagged', pr({ labels: [{ name: 'no-build-notes', active: true }] }), LOCAL, OPTIONS],
    ['other repository', pr(), { localRepo: false, fileExists: true }, OPTIONS],
    ['no file', pr(), { localRepo: true, fileExists: false }, OPTIONS],
    ['disabled', pr(), LOCAL, { ...OPTIONS, enabled: false }],
    ['no source commit', pr({ lastMergeSourceCommit: undefined }), LOCAL, OPTIONS],
    ['no target commit', pr({ lastMergeTargetCommit: undefined }), LOCAL, OPTIONS],
  ])('does not ask for %s', (_name, pull, status, options) => {
    expect(needsDiffRequest(pull, status, options)).toBe(false);
  });
});

describe('needsBuildNotesWarning', () => {
  const status = (changed?: boolean) => ({ ...LOCAL, changed });
  it('warns only when the file surely is not changed', () => {
    expect(needsBuildNotesWarning(pr(), status(false), OPTIONS)).toBe(true);
    expect(needsBuildNotesWarning(pr(), status(true), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), status(undefined), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), undefined, OPTIONS)).toBe(false);
  });
  it('does not warn for tagged, draft, other-repo, missing-file or disabled cases', () => {
    expect(needsBuildNotesWarning(pr({ labels: [{ name: 'NO-BUILD-NOTES' }] }), status(false), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr({ isDraft: true }), status(false), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr({ status: 'completed' }), status(false), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), { localRepo: false, fileExists: true, changed: false }, OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), { localRepo: true, fileExists: false, changed: false }, OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), status(false), { ...OPTIONS, enabled: false })).toBe(false);
  });
  it('writes the text with the configured path and tag', () => {
    expect(buildNotesWarningText(OPTIONS)).toBe(
      'Explain the changes for testers in build-notes/developer-notes.md, or tag the PR "no-build-notes"'
    );
  });
});

describe('diffCacheKey', () => {
  it('depends on the PR, its head commit and the file', () => {
    expect(diffCacheKey(pr(), OPTIONS.path)).toBe('7:src1:build-notes/developer-notes.md');
    expect(diffCacheKey(pr({ lastMergeSourceCommit: { commitId: 'src2' } }), OPTIONS.path)).not.toBe(
      diffCacheKey(pr(), OPTIONS.path)
    );
    expect(diffCacheKey(pr({ lastMergeSourceCommit: undefined }), OPTIONS.path)).toBeUndefined();
  });
});

describe('checkPullRequestNotes', () => {
  const diff = { changes: [{ item: { path: '/x.ts' } }], allChangesIncluded: true };

  it('requests once per head commit and again after a push', async () => {
    const cache = new BuildNotesDiffCache();
    const fetchDiff = vi.fn().mockResolvedValue(diff);
    expect(await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff)).toBe(false);
    expect(await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff)).toBe(false);
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    expect(fetchDiff).toHaveBeenCalledWith('tgt1', 'src1');
    await checkPullRequestNotes(pr({ lastMergeSourceCommit: { commitId: 'src2' } }), LOCAL, OPTIONS, cache, fetchDiff);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
  });

  it('makes no request when it is not needed', async () => {
    const fetchDiff = vi.fn();
    const cache = new BuildNotesDiffCache();
    await checkPullRequestNotes(pr({ isDraft: true }), LOCAL, OPTIONS, cache, fetchDiff);
    await checkPullRequestNotes(pr({ labels: [{ name: 'no-build-notes' }] }), LOCAL, OPTIONS, cache, fetchDiff);
    await checkPullRequestNotes(pr(), { localRepo: false, fileExists: true }, OPTIONS, cache, fetchDiff);
    expect(fetchDiff).not.toHaveBeenCalled();
  });

  it('is unknown after a failure and retries it only after a while', async () => {
    let now = 0;
    const cache = new BuildNotesDiffCache(() => now);
    const fetchDiff = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(diff);
    expect(await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff)).toBeUndefined();
    now = ONE_MINUTE;
    expect(await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff)).toBeUndefined();
    expect(fetchDiff).toHaveBeenCalledTimes(1);
    now = ELEVEN_MINUTES;
    expect(await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff)).toBe(false);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
  });

  it('remembers an incomplete (unknown) result', async () => {
    const cache = new BuildNotesDiffCache();
    const fetchDiff = vi.fn().mockResolvedValue({ ...diff, allChangesIncluded: false });
    expect(await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff)).toBeUndefined();
    expect(await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff)).toBeUndefined();
    expect(fetchDiff).toHaveBeenCalledTimes(1);
  });

  it('forgets the PRs that are no longer listed', async () => {
    const cache = new BuildNotesDiffCache();
    const fetchDiff = vi.fn().mockResolvedValue(diff);
    await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff);
    cache.keepOnly([8]);
    await checkPullRequestNotes(pr(), LOCAL, OPTIONS, cache, fetchDiff);
    expect(fetchDiff).toHaveBeenCalledTimes(2);
  });
});
