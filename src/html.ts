/** HTML helpers shared by the extension and the webviews, so no "vscode" import */
import { stateCategory } from './states';

const ENTITIES: Partial<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

const BLOCKED_ELEMENTS = 'script|style|iframe|object|embed|form|link|meta|base';

/**
 * Removes active content from the rich text fields of a work item (description, repro steps…).
 * The details webview also blocks inline scripts through its Content Security Policy
 */
export function sanitizeHtml(html: string): string {
  return html
    .replace(new RegExp(`<(${BLOCKED_ELEMENTS})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\/?(${BLOCKED_ELEMENTS})\\b[^>]*>`, 'gi'), '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*("|')?\s*javascript:[^"'>\s]*("|')?/gi, '$1="#"');
}

/**
 * Coloured state of a work item. Clicking it lets the user change the state. When the shown state is derived
 * (Rule STATE-10), the tooltip tells the real one
 */
export function stateButton(id: number, shown: string, real = shown): string {
  const title =
    shown === real
      ? 'Change state'
      : `${real} in Azure DevOps — shown as ${shown}: only the review of its PRs is left. Change state`;
  return `<button class="state state-${stateCategory(shown)}" data-action="changeState" data-id="${id}"
    title="${escapeHtml(title)}">${escapeHtml(shown)}</button>`;
}

/** Work item types that cannot have tasks under them */
const LEAF_TYPES = ['Task'];

export function canHaveTasks(type: string): boolean {
  return !LEAF_TYPES.includes(type);
}
