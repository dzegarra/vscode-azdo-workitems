import { describe, expect, it, vi } from 'vitest';
import {
  BuildNotesDiffCache,
  BuildNotesOptions,
  BuildNotesPullRequest,
  buildNotesWarningText,
  checkPullRequestNotes,
  diffCacheKey,
  diffChangesNotes,
  hasSkipTag,
  isNotesFile,
  localDiffChangesNotes,
  needsBuildNotesWarning,
  needsDiffRequest,
  normalizeRepoPath,
  notesFileNames,
  parseChangedFiles,
} from './buildNotes';

const OPTIONS: BuildNotesOptions = {
  enabled: true,
  directory: 'build-notes',
  fileSuffix: '-notes.md',
  skipTag: 'no-build-notes',
};
const ONE_MINUTE = 60_000;
const ELEVEN_MINUTES = 11 * ONE_MINUTE;
const LOCAL = { localRepo: true, folderExists: true };

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

describe('isNotesFile', () => {
  it.each([
    ['/build-notes/pid-notes.md', true],
    ['build-notes/PID-Notes.md', true],
    ['build-notes/developer-notes.md', true],
    ['\\build-notes\\admin-notes.md', true],
    ['build-notes/_template.md', false],
    ['build-notes/-notes.md', false],
    ['build-notes/sub/x-notes.md', false],
    ['/build-notes', false],
    ['other/build-notes/x-notes.md', false],
    ['build-notes-old/x-notes.md', false],
    ['src/pid-notes.md', false],
  ])('%s → %s', (path, expected) => {
    expect(isNotesFile(path, OPTIONS)).toBe(expected);
  });
  it('accepts a folder written with slashes', () => {
    expect(isNotesFile('docs/notes/a-notes.md', { directory: './docs/notes/', fileSuffix: '-notes.md' })).toBe(true);
  });
});

describe('diffChangesNotes', () => {
  const touched = { changes: [{ item: { path: '/build-notes/pid-notes.md' } }], allChangesIncluded: true };
  it('is true when a notes file is listed', () => {
    expect(diffChangesNotes(touched, OPTIONS)).toBe(true);
    expect(diffChangesNotes({ ...touched, allChangesIncluded: false }, OPTIONS)).toBe(true);
  });
  it('is false when the complete list lacks notes files', () => {
    expect(
      diffChangesNotes(
        {
          changes: [
            { item: { path: '/a.ts' } },
            { item: { path: '/build-notes' } },
            { item: { path: '/build-notes/_template.md' } },
          ],
          allChangesIncluded: true,
        },
        OPTIONS
      )
    ).toBe(false);
    expect(diffChangesNotes({ changes: [] }, OPTIONS)).toBe(false);
  });
  it('is unknown when the list is incomplete and lacks notes files', () => {
    expect(
      diffChangesNotes({ changes: [{ item: { path: '/a.ts' } }], allChangesIncluded: false }, OPTIONS)
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
  it('tells whether a notes file is among them', () => {
    expect(localDiffChangesNotes('a.ts\nbuild-notes/tfio-notes.md\n', OPTIONS)).toBe(true);
    expect(localDiffChangesNotes('a.ts\nbuild-notes/_template.md\n', OPTIONS)).toBe(false);
    expect(localDiffChangesNotes('a.ts\n', OPTIONS)).toBe(false);
  });
  it('normalizes paths', () => {
    expect(normalizeRepoPath('\\build-notes\\x.md')).toBe('build-notes/x.md');
    expect(normalizeRepoPath('./build-notes/')).toBe('build-notes');
  });
  it('lists the notes files of the folder, sorted', () => {
    expect(notesFileNames(['tfio-notes.md', '_template.md', 'admin-notes.md', 'readme.txt'], OPTIONS)).toEqual([
      'admin-notes.md',
      'tfio-notes.md',
    ]);
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
    ['other repository', pr(), { localRepo: false, folderExists: true }, OPTIONS],
    ['no folder', pr(), { localRepo: true, folderExists: false }, OPTIONS],
    ['disabled', pr(), LOCAL, { ...OPTIONS, enabled: false }],
    ['no source commit', pr({ lastMergeSourceCommit: undefined }), LOCAL, OPTIONS],
    ['no target commit', pr({ lastMergeTargetCommit: undefined }), LOCAL, OPTIONS],
  ])('does not ask for %s', (_name, pull, status, options) => {
    expect(needsDiffRequest(pull, status, options)).toBe(false);
  });
});

describe('needsBuildNotesWarning', () => {
  const status = (changed?: boolean) => ({ ...LOCAL, changed });
  it('warns only when the notes files surely are not changed', () => {
    expect(needsBuildNotesWarning(pr(), status(false), OPTIONS)).toBe(true);
    expect(needsBuildNotesWarning(pr(), status(true), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), status(undefined), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), undefined, OPTIONS)).toBe(false);
  });
  it('does not warn for tagged, draft, other-repo, missing-folder or disabled cases', () => {
    expect(needsBuildNotesWarning(pr({ labels: [{ name: 'NO-BUILD-NOTES' }] }), status(false), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr({ isDraft: true }), status(false), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr({ status: 'completed' }), status(false), OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), { localRepo: false, folderExists: true, changed: false }, OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), { localRepo: true, folderExists: false, changed: false }, OPTIONS)).toBe(false);
    expect(needsBuildNotesWarning(pr(), status(false), { ...OPTIONS, enabled: false })).toBe(false);
  });
  it('writes the text with the configured path and tag', () => {
    expect(buildNotesWarningText(OPTIONS)).toBe(
      'Explain the changes for testers in build-notes/*-notes.md, or tag the PR "no-build-notes"'
    );
  });
});

describe('diffCacheKey', () => {
  it('depends on the PR, its head commit and the notes files', () => {
    expect(diffCacheKey(pr(), OPTIONS)).toBe('7:src1:build-notes/*-notes.md');
    expect(diffCacheKey(pr({ lastMergeSourceCommit: { commitId: 'src2' } }), OPTIONS)).not.toBe(
      diffCacheKey(pr(), OPTIONS)
    );
    expect(diffCacheKey(pr({ lastMergeSourceCommit: undefined }), OPTIONS)).toBeUndefined();
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
    await checkPullRequestNotes(pr(), { localRepo: false, folderExists: true }, OPTIONS, cache, fetchDiff);
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
