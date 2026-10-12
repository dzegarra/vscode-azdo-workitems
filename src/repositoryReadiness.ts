/** What is known about the git extension at a given moment */
export interface ReadinessInput {
  /** State of the git API: its repositories are discovered asynchronously while it is 'uninitialized' */
  apiState: 'uninitialized' | 'initialized' | undefined;
  hasRepository: boolean;
  /** Remotes loaded in the state of the picked repository (filled asynchronously after it is opened) */
  remotesCount: number;
  /** organization, project and repository are all set in the settings: the remote is not needed */
  overridesSet: boolean;
}

/**
 * Whether the Azure DevOps context can be resolved now. A repository is announced by the git extension before
 * its state is loaded, so having a repository is not enough: its remotes must be there.
 * An API without a state (older git extension) is treated as initialized.
 */
export function isRepositoryReady({ apiState, hasRepository, remotesCount, overridesSet }: ReadinessInput): boolean {
  if (overridesSet) {
    return true;
  }
  if (apiState === 'uninitialized') {
    return false;
  }
  return hasRepository && remotesCount > 0;
}
