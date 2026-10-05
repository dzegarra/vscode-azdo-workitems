/** HTML helpers shared by the extension and the webviews, so no "vscode" import */

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
