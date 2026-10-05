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

/** Coloured state of a work item. Clicking it lets the user change the state */
export function stateButton(id: number, state: string): string {
  return `<button class="state state-${stateCategory(state)}" data-action="changeState" data-id="${id}"
    title="Change state">${escapeHtml(state)}</button>`;
}

/** Work item types that cannot have tasks under them */
const LEAF_TYPES = ['Task'];

export function canHaveTasks(type: string): boolean {
  return !LEAF_TYPES.includes(type);
}
