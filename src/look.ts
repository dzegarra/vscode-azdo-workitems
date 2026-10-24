/**
 * The look of the webviews (totalflowx.appearance.look): the colours and fonts of the VS Code theme, or the
 * palette and fonts of the redesign. Pure, so no "vscode" import: the webviews use it too
 */
export const LOOKS = ['theme', 'totalflow'] as const;
export type Look = (typeof LOOKS)[number];

/** Unknown values fall back to the theme */
export function normalizeLook(value: string | undefined): Look {
  return LOOKS.find((look) => look === value) ?? 'theme';
}

// Rule LOOK-1
/**
 * Class of the page for the look. High contrast themes always keep their own colours: the user chose them to read
 * the screen, the design's palette must not replace them
 */
export function lookClass(look: Look, bodyClasses: readonly string[]): string | undefined {
  const highContrast = bodyClasses.some((name) => name.startsWith('vscode-high-contrast'));
  return look === 'totalflow' && !highContrast ? 'look-totalflow' : undefined;
}
