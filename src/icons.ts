/** Icons and type styles shared by the webviews. No "vscode" import */

export const ICONS = {
  bug: '<path d="M8 2.5a2.5 2.5 0 0 0-2.4 1.8A4 4 0 0 0 4 7.5V10a4 4 0 0 0 8 0V7.5a4 4 0 0 0-1.6-3.2A2.5 2.5 0 0 0 8 2.5zM2 8h2m8 0h2M2.5 12.5 4.3 11m9.2 1.5L11.7 11M2.5 4l1.8 1.4M13.5 4l-1.8 1.4M8 6v8"/>',
  book: '<path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2zM3 11.5a2 2 0 0 1 2-2h7.5"/>',
  task: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="m5 8 2 2 4-4"/>',
  item: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/>',
  branch:
    '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.5 4"/>',
  pullRequest:
    '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7m1.5-2-2 2 2 2"/>',
  parent: '<path d="M8 13.5v-11M4 6.5l4-4 4 4"/>',
  refresh: '<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5v3h-3"/>',
};

export function icon(name: keyof typeof ICONS, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
}

export const TYPE_ICONS: Partial<Record<string, keyof typeof ICONS>> = {
  Bug: 'bug',
  'Product Backlog Item': 'book',
  'User Story': 'book',
  Task: 'task',
};

export const TYPE_CLASSES: Partial<Record<string, string>> = {
  Bug: 'type-bug',
  'Product Backlog Item': 'type-backlog',
  'User Story': 'type-backlog',
  Task: 'type-task',
  Feature: 'type-feature',
};

/** Icon of the work item type, coloured by type */
export function typeIcon(type: string): string {
  return icon(TYPE_ICONS[type] ?? 'item', TYPE_CLASSES[type] ?? '');
}
