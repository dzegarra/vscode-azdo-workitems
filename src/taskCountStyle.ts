/** How the counts on the bar of the Tasks header look (totalflowx.tasks.countStyle). Pure: no "vscode" import */

export const TASK_COUNT_STYLES = ['filled', 'outlined'] as const;
export type TaskCountStyle = (typeof TASK_COUNT_STYLES)[number];

/** Unknown values (a typo in settings.json) mean "filled", the one with a guaranteed text contrast */
export function normalizeTaskCountStyle(value: string | undefined): TaskCountStyle {
  return TASK_COUNT_STYLES.find((style) => style === value) ?? 'filled';
}

/** CSS class (on #app) that switches the rules of the count circles in the stylesheet */
export function taskCountStyleClass(style: TaskCountStyle): string {
  return `task-counts-${style}`;
}
