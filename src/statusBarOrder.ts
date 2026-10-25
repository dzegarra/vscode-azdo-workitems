/**
 * The order of the extension's status bar items, left to right (Rule STATUSBAR-ORDER-1): the alarm of a broken base
 * branch, the place (main folder / worktree), the current work item, CI, reviews, my PRs that need me, the work items
 * to fix. A higher priority is further left. No "vscode" import
 */
export const STATUS_BAR_PRIORITY = {
  baseBranch: 1000,
  place: 990,
  workItem: 980,
  ci: 970,
  reviews: 960,
  myPullRequests: 950,
  toFix: 940,
} as const;

// Rule STATUSBAR-FIX-1
/** Text of the "to fix" item: "$(warning) 2 to fix"; undefined (hidden) when no work item breaks a team rule */
export function toFixText(count: number): string | undefined {
  return count > 0 ? `$(warning) ${count} to fix` : undefined;
}

/** Tooltip lines of the "to fix" item: one per work item and what is wrong */
export function toFixTooltipLines(
  entries: { workItem: { id: number; title: string }; alerts: { message: string }[] }[]
): string[] {
  return [
    `${entries.length} work item${entries.length === 1 ? '' : 's'} to fix`,
    ...entries.map((e) => `${e.workItem.id} ${e.workItem.title}: ${e.alerts.map((a) => a.message).join('; ')}`),
  ];
}
