/**
 * Team rule: a PR with changes testers should know about explains them in the build notes file; any other PR
 * carries a tag (label) saying so. Pure helpers, so no "vscode" import
 */

export interface BuildNotesOptions {
  enabled: boolean;
  /** Repository-relative, e.g. "build-notes/developer-notes.md" */
  path: string;
  /** Azure DevOps PR tag of the PRs without changes for testers, e.g. "no-build-notes" */
  skipTag: string;
}

export const DEFAULT_BUILD_NOTES_OPTIONS: BuildNotesOptions = {
  enabled: true,
  path: 'build-notes/developer-notes.md',
  skipTag: 'no-build-notes',
};

export interface PullRequestLabel {
  id?: string;
  name: string;
  active?: boolean;
}

/** What the PR list tells about a PR, enough to decide without more requests */
export interface BuildNotesPullRequest {
  pullRequestId: number;
  status: string;
  isDraft: boolean;
  labels?: PullRequestLabel[];
  lastMergeSourceCommit?: { commitId: string };
  lastMergeTargetCommit?: { commitId: string };
}

/** Path as the API and git write it: forward slashes, no leading slash, no "./" */
export function normalizeRepoPath(path: string): string {
  return path
    .trim()
    .replace(/\\/g, '/')
    .replace(/^(\.?\/)+/, '');
}

// Rule BUILDNOTES-2
/** The PR has the tag (case-insensitive); removed tags (inactive labels) do not count */
export function hasSkipTag(labels: PullRequestLabel[] | undefined, tag: string): boolean {
  const wanted = tag.trim().toLowerCase();
  return (
    !!wanted && (labels ?? []).some((label) => label.active !== false && label.name.trim().toLowerCase() === wanted)
  );
}

/** Response of the "diffs/commits" API (the part used) */
export interface CommitsDiff {
  changes?: { item?: { path?: string } }[];
  allChangesIncluded?: boolean;
}

// Rule BUILDNOTES-3
/**
 * Whether the diff touches the file. Undefined (unknown) when the file is not in the list and the list is not
 * complete
 */
export function diffChangesFile(diff: CommitsDiff, path: string): boolean | undefined {
  const wanted = normalizeRepoPath(path).toLowerCase();
  const touched = (diff.changes ?? []).some(
    (change) => normalizeRepoPath(change.item?.path ?? '').toLowerCase() === wanted
  );
  if (touched) {
    return true;
  }
  return diff.allChangesIncluded === false ? undefined : false;
}

/** Output of `git diff --name-only`: one path per line */
export function parseChangedFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function localDiffChangesFile(output: string, path: string): boolean {
  const wanted = normalizeRepoPath(path);
  return parseChangedFiles(output).some((file) => normalizeRepoPath(file) === wanted);
}

/** Where the PR stands regarding the rule, as far as it is known */
export interface BuildNotesStatus {
  /** The PR belongs to the repository open in VS Code */
  localRepo: boolean;
  /** The notes file exists in the local repository */
  fileExists: boolean;
  /** The PR changes the notes file. Undefined: not known */
  changed?: boolean;
}

// Rule BUILDNOTES-1
/** Whether the rule applies to the PR at all: published, active, enabled, local repository with the file */
export function ruleApplies(
  pr: Pick<BuildNotesPullRequest, 'isDraft' | 'status'>,
  status: Pick<BuildNotesStatus, 'fileExists' | 'localRepo'>,
  options: Pick<BuildNotesOptions, 'enabled'>
): boolean {
  return options.enabled && !pr.isDraft && pr.status === 'active' && status.localRepo && status.fileExists;
}

/** Key of the cache of diffs: the result only changes with a new push (or another file to look for) */
export function diffCacheKey(pr: BuildNotesPullRequest, path: string): string | undefined {
  const commit = pr.lastMergeSourceCommit?.commitId;
  return commit ? `${pr.pullRequestId}:${commit}:${normalizeRepoPath(path).toLowerCase()}` : undefined;
}

/** The diff request is only worth it when the rule applies, the PR is not tagged and the commits are known */
export function needsDiffRequest(
  pr: BuildNotesPullRequest,
  status: Pick<BuildNotesStatus, 'fileExists' | 'localRepo'>,
  options: BuildNotesOptions
): boolean {
  return (
    ruleApplies(pr, status, options) &&
    !hasSkipTag(pr.labels, options.skipTag) &&
    !!pr.lastMergeSourceCommit?.commitId &&
    !!pr.lastMergeTargetCommit?.commitId
  );
}

export function buildNotesWarningText(options: Pick<BuildNotesOptions, 'path' | 'skipTag'>): string {
  return `Explain the changes for testers in ${options.path}, or tag the PR "${options.skipTag}"`;
}

// Rule BUILDNOTES-3
/** The PR should explain its changes: the rule applies, it is not tagged, and it surely does not change the file */
export function needsBuildNotesWarning(
  pr: BuildNotesPullRequest,
  status: BuildNotesStatus | undefined,
  options: BuildNotesOptions
): boolean {
  return (
    !!status && ruleApplies(pr, status, options) && !hasSkipTag(pr.labels, options.skipTag) && status.changed === false
  );
}

/** A failed request is not repeated on every poll: it is retried after this long */
const MS_PER_MINUTE = 60_000;
const FAILURE_RETRY_MINUTES = 10;
const FAILURE_RETRY_MS = FAILURE_RETRY_MINUTES * MS_PER_MINUTE;

/**
 * Remembers whether each PR changes the notes file, by head commit: a PR is asked about again only after a push.
 * Failures are retried after a while, not on every poll. Unknown results (incomplete list) are remembered too
 */
export class BuildNotesDiffCache {
  private readonly results = new Map<string, boolean | undefined>();
  private readonly failures = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  /** The remembered result. `known` is false when it must be requested */
  lookup(key: string): { known: boolean; changed?: boolean } {
    if (this.results.has(key)) {
      return { known: true, changed: this.results.get(key) };
    }
    const failedAt = this.failures.get(key);
    if (failedAt !== undefined && this.now() - failedAt < FAILURE_RETRY_MS) {
      return { known: true, changed: undefined };
    }
    return { known: false };
  }

  store(key: string, changed: boolean | undefined): void {
    this.results.set(key, changed);
    this.failures.delete(key);
  }

  fail(key: string): void {
    this.failures.set(key, this.now());
  }

  /** Forgets the PRs that are no longer listed */
  keepOnly(pullRequestIds: number[]): void {
    const keep = new Set(pullRequestIds.map(String));
    for (const map of [this.results, this.failures]) {
      for (const key of [...map.keys()]) {
        if (!keep.has(key.split(':')[0])) {
          map.delete(key);
        }
      }
    }
  }
}

/**
 * Whether the PR changes the notes file, asking at most once per head commit. `fetchDiff` is called only when
 * needed; its failure leaves the result unknown
 */
export async function checkPullRequestNotes(
  pr: BuildNotesPullRequest,
  status: Pick<BuildNotesStatus, 'fileExists' | 'localRepo'>,
  options: BuildNotesOptions,
  cache: BuildNotesDiffCache,
  fetchDiff: (base: string, target: string) => Promise<CommitsDiff>
): Promise<boolean | undefined> {
  const key = diffCacheKey(pr, options.path);
  if (!key || !needsDiffRequest(pr, status, options)) {
    return undefined;
  }
  const cached = cache.lookup(key);
  if (cached.known) {
    return cached.changed;
  }
  try {
    const diff = await fetchDiff(pr.lastMergeTargetCommit?.commitId ?? '', pr.lastMergeSourceCommit?.commitId ?? '');
    const changed = diffChangesFile(diff, options.path);
    cache.store(key, changed);
    return changed;
  } catch {
    cache.fail(key);
    return undefined;
  }
}
