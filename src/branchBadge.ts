/** The one badge of a branch row: where the branch is and whether it has a worktree. Pure, no "vscode" import */
import type { BranchModel } from './viewModel';

export interface BranchBadge {
  text: string;
  /** Full explanation, for the native tooltip */
  title: string;
  /** Colour class suffix (`tone-<tone>`) */
  tone: 'current' | 'local' | 'remote' | 'linked' | 'leftover' | 'worktree';
}

/** Marker added to the badge when another worktree has the branch */
export const WORKTREE_MARK = '⧉';

const LOCATION_TITLES = {
  current: 'Checked out here',
  local: 'Local branch (exists in your clone)',
  remote: 'Only in Azure DevOps: Checkout creates the local branch',
  linked: 'Known only from a link or a PR',
} as const;

// Rules BRANCH-BADGE-1..3
export function branchBadge(
  branch: Pick<BranchModel, 'location' | 'worktree'>,
  deletable: boolean,
  mergedHint = 'The PR is merged: the branch should be deleted'
): BranchBadge {
  const base = deletable
    ? { text: 'not deleted', title: mergedHint, tone: 'leftover' as const }
    : { text: branch.location, title: LOCATION_TITLES[branch.location], tone: branch.location };
  if (!branch.worktree) {
    return base;
  }
  return {
    text: `${base.text} ${WORKTREE_MARK}`,
    title: `${base.title} · checked out in a worktree at ${branch.worktree}`,
    tone: base.tone === 'leftover' ? 'leftover' : 'worktree',
  };
}
