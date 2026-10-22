/**
 * Rows of the Worktrees view and entries of the Remove Worktrees / Clean Up Worktrees pickers, from the classified
 * worktrees. Pure: no "vscode" import
 */
import {
  ageText,
  ClassifiedWorktree,
  hygieneReasonsText,
  ownerText,
  sortClassified,
  WorktreeOwner,
  WorktreeStatus,
} from './worktreeHygiene';
import { worktreeDescription, worktreeDetail, worktreeLabel } from './worktrees';

export const WORKTREE_GROUP_LABELS: Record<WorktreeStatus, string> = {
  stale: 'Can be removed',
  idle: 'Idle',
  inUse: 'In use',
};

const STATUS_ICONS: Record<WorktreeStatus, { icon: string; color?: string }> = {
  stale: { icon: 'trash', color: 'list.warningForeground' },
  idle: { icon: 'history', color: 'descriptionForeground' },
  inUse: { icon: 'folder-opened', color: 'charts.blue' },
};

export interface WorktreeRow {
  path: string;
  label: string;
  description: string;
  /** Markdown */
  tooltip: string;
  icon: string;
  color?: string;
  status: WorktreeStatus;
  owner?: WorktreeOwner;
  /** The folder is gone: it cannot be opened */
  missing: boolean;
}

export interface WorktreeGroup {
  status: WorktreeStatus;
  label: string;
  rows: WorktreeRow[];
}

/** Escapes the characters that Markdown would interpret in a branch name or a title */
function markdownText(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!|<>~-]/g, '\\$&');
}

function tooltipOf(item: ClassifiedWorktree, now: number): string {
  const { worktree } = item;
  const age = ageText(item.lastCommitAt, now);
  return [
    `**${markdownText(worktreeLabel(worktree))}**`,
    markdownText(worktree.path),
    ...(item.owner ? [`For ${markdownText(ownerText(item.owner))}`] : []),
    ...(item.reasons.length
      ? [`${WORKTREE_GROUP_LABELS[item.status]}: ${markdownText(hygieneReasonsText(item.reasons))}`]
      : []),
    ...(age ? [`Last commit ${age}`] : []),
    ...(item.dirty ? ['$(circle-filled) Uncommitted changes'] : []),
    ...(worktree.locked ? ['$(lock) Locked: it is never offered for removal'] : []),
  ].join('\n\n');
}

// Rule WORKTREE-VIEW-1
/**
 * One row per worktree: the branch, then why it can be removed (or what it is for when in use), its age and a ● when
 * it has uncommitted changes
 */
export function worktreeRow(item: ClassifiedWorktree, now: number): WorktreeRow {
  const age = ageText(item.lastCommitAt, now);
  const what = item.reasons.length ? hygieneReasonsText(item.reasons) : item.owner && ownerText(item.owner);
  return {
    path: item.worktree.path,
    label: worktreeLabel(item.worktree),
    description: [item.dirty ? '●' : undefined, what, age].filter(Boolean).join(' · '),
    tooltip: tooltipOf(item, now),
    ...STATUS_ICONS[item.status],
    status: item.status,
    owner: item.owner,
    missing: item.worktree.prunable,
  };
}

// Rule WORKTREE-VIEW-1
/** The groups of the Worktrees view: Can be removed, Idle, In use; empty groups are left out */
export function worktreeGroups(classified: readonly ClassifiedWorktree[], now: number): WorktreeGroup[] {
  const sorted = sortClassified(classified);
  return (['stale', 'idle', 'inUse'] as const)
    .map((status) => ({
      status,
      label: WORKTREE_GROUP_LABELS[status],
      rows: sorted.filter((item) => item.status === status).map((item) => worktreeRow(item, now)),
    }))
    .filter((group) => group.rows.length);
}

/** Description of the view: how many can be removed */
export function worktreesViewDescription(classified: readonly ClassifiedWorktree[]): string | undefined {
  const stale = classified.filter((item) => item.status === 'stale').length;
  return stale ? `${String(stale)} to clean up` : undefined;
}

export type WorktreePickEntry =
  | { separator: string }
  | { label: string; description: string; detail?: string; picked: boolean; path: string };

// Rule WORKTREE-PICK-1
/**
 * Entries of the removal picker: stale worktrees first (pre-selected), then idle ones, then (unless `cleanupOnly`)
 * the ones in use, each group under a separator. The detail tells why, what it is for and its uncommitted changes
 */
export function worktreePickEntries(
  classified: readonly ClassifiedWorktree[],
  mainWorktreePath: string,
  cleanupOnly: boolean
): WorktreePickEntry[] {
  const statuses: WorktreeStatus[] = cleanupOnly ? ['stale', 'idle'] : ['stale', 'idle', 'inUse'];
  const sorted = sortClassified(classified);
  return statuses.flatMap((status) => {
    const items = sorted.filter((item) => item.status === status);
    if (!items.length) {
      return [];
    }
    return [
      { separator: WORKTREE_GROUP_LABELS[status] },
      ...items.map((item) => {
        const detail = [
          item.reasons.length ? hygieneReasonsText(item.reasons) : undefined,
          item.owner ? ownerText(item.owner) : undefined,
          // The missing folder is already one of the reasons
          worktreeDetail({ ...item.worktree, prunable: false }, item.dirty) || undefined,
        ]
          .filter(Boolean)
          .join(' · ');
        return {
          label: worktreeLabel(item.worktree),
          description: worktreeDescription(mainWorktreePath, item.worktree),
          detail: detail || undefined,
          picked: status === 'stale',
          path: item.worktree.path,
        };
      }),
    ];
  });
}
