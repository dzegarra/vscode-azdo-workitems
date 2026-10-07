/** Icons and type styles shared by the webviews. No "vscode" import */

export const ICONS = {
  graph:
    '<circle cx="3.5" cy="4" r="1.8"/><circle cx="12.5" cy="4" r="1.8"/><circle cx="8" cy="12" r="1.8"/><path d="M5.3 4h5.4M4.5 5.6 7 10.4M11.5 5.6 9 10.4"/>',
  figma:
    '<path d="M8 1.5H5.75a2.25 2.25 0 0 0 0 4.5H8zM8 1.5h2.25a2.25 2.25 0 0 1 0 4.5H8zM8 6H5.75a2.25 2.25 0 0 0 0 4.5H8zM8 10.5H5.75A2.25 2.25 0 1 0 8 12.75z"/><circle cx="10.25" cy="8.25" r="2.25"/>',
  external:
    '<path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5H7"/>',
  rows: '<path d="M2.5 4h11M2.5 8h11M2.5 12h11"/>',
  cards: '<rect x="2.5" y="2.5" width="11" height="4.5" rx="1"/><rect x="2.5" y="9" width="11" height="4.5" rx="1"/>',
  expandAll: '<path d="m4 3.5 4 3.5 4-3.5M4 9l4 3.5L12 9"/>',
  collapseAll: '<path d="m4 7 4-3.5L12 7M4 12.5 8 9l4 3.5"/>',
  chevron: '<path d="m6 3.5 4.5 4.5L6 12.5"/>',
  caretDown: '<path d="m4 6.5 4 4 4-4"/>',
  clock: '<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.2l2 1.3"/>',
  sync: '<path d="M13 8a5 5 0 0 1-8.5 3.5M3 8a5 5 0 0 1 8.5-3.5M11.5 2v2.5H9M4.5 14v-2.5H7"/>',
  check: '<circle cx="8" cy="8" r="5.5"/><path d="m5.5 8.2 1.7 1.7 3.3-3.4"/>',
  error: '<circle cx="8" cy="8" r="5.5"/><path d="m6 6 4 4m0-4-4 4"/>',
  stop: '<circle cx="8" cy="8" r="5.5"/><path d="M6.2 6.2h3.6v3.6H6.2z"/>',
  warning: '<path d="M8 2 14.5 13.5h-13z"/><path d="M8 6.5v3.2M8 11.6v.1"/>',
  bug: '<path d="M8 2.5a2.5 2.5 0 0 0-2.4 1.8A4 4 0 0 0 4 7.5V10a4 4 0 0 0 8 0V7.5a4 4 0 0 0-1.6-3.2A2.5 2.5 0 0 0 8 2.5zM2 8h2m8 0h2M2.5 12.5 4.3 11m9.2 1.5L11.7 11M2.5 4l1.8 1.4M13.5 4l-1.8 1.4M8 6v8"/>',
  book: '<path d="M3 2.5h7.5a2 2 0 0 1 2 2v9H5a2 2 0 0 1-2-2zM3 11.5a2 2 0 0 1 2-2h7.5"/>',
  task: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="m5 8 2 2 4-4"/>',
  item: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/>',
  branch:
    '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5.5" r="1.5"/><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.5 4"/>',
  pullRequest:
    '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="12.5" r="1.5"/><path d="M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7m1.5-2-2 2 2 2"/>',
  parent: '<path d="M8 13.5v-11M4 6.5l4-4 4 4"/>',
  comment: '<path d="M2.5 3h11v7.5H8l-3 2.5v-2.5H2.5z"/>',
  circle: '<circle cx="8" cy="8" r="5.5" stroke-dasharray="2 2"/>',
  shield: '<path d="M8 1.8 13 3.6v4c0 3-2.1 5.1-5 6.6-2.9-1.5-5-3.6-5-6.6v-4z"/>',
  trophy: '<path d="M5 2.5h6v4a3 3 0 0 1-6 0zM5 4H2.5a2 2 0 0 0 2.5 3M11 4h2.5A2 2 0 0 1 11 7M8 9.5v2.5M5.5 13.5h5"/>',
  link: '<path d="M6.8 9.2a2.4 2.4 0 0 0 3.4 0l2.3-2.3a2.4 2.4 0 0 0-3.4-3.4L8 4.6M9.2 6.8a2.4 2.4 0 0 0-3.4 0L3.5 9.1a2.4 2.4 0 0 0 3.4 3.4L8 11.4"/>',
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

/** Class colouring the ID link like the icon of its type ('' for unknown types) */
export function typeIdClass(type: string): string {
  const cls = TYPE_CLASSES[type];
  return cls ? ` id-${cls}` : '';
}

/** Icon of the work item type, coloured by type */
export function typeIcon(type: string): string {
  return icon(TYPE_ICONS[type] ?? 'item', TYPE_CLASSES[type] ?? '');
}
