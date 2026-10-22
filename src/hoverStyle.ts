/** How the work item cards and the PR tiles react to the pointer (totalflowx.appearance.hoverStyle). Pure: no "vscode" import */

export const HOVER_STYLES = ['border', 'tint', 'accent'] as const;
export type HoverStyle = (typeof HOVER_STYLES)[number];

/** Unknown values (a typo in settings.json) mean "border", the one that never lowers the text contrast */
export function normalizeHoverStyle(value: string | undefined): HoverStyle {
  return HOVER_STYLES.find((style) => style === value) ?? 'border';
}

/** CSS class (on #app) that switches the hover rules of the stylesheet */
export function hoverStyleClass(style: HoverStyle): string {
  return `hover-${style}`;
}
