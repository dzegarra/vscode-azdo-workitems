/** HTML of the popover action menu (task pill, branch rows), shared by the sidebar. No "vscode" import */
import type { ActionMenuItem, ActionMenuSection } from './actionMenu';
import { escapeHtml } from './html';

function renderItem(item: ActionMenuItem): string {
  const detail = item.detail ? `<span class="action-menu-detail">${escapeHtml(item.detail)}</span>` : '';
  const text = `<span class="action-menu-label">${escapeHtml(item.label)}</span>${detail}`;
  if (!item.act) {
    return `<div class="action-menu-item info" role="menuitem" aria-disabled="true">${text}</div>`;
  }
  const { action, id, kind, branch, pr, task } = item.act;
  const attributes = [
    `data-action="${action}"`,
    `data-id="${id}"`,
    kind ? `data-kind="${kind}"` : '',
    branch ? `data-branch="${escapeHtml(branch)}"` : '',
    pr ? `data-pr="${pr}"` : '',
    task ? `data-task="${task}"` : '',
  ].filter(Boolean);
  const danger = item.danger ? ' danger' : '';
  return `<button class="action-menu-item${danger}" role="menuitem" tabindex="-1" ${attributes.join(
    ' '
  )}>${text}</button>`;
}

/** Id of the menu element of a trigger: its key, safe for an id attribute */
export function actionMenuId(key: string): string {
  return `action-menu-${key.replace(/[^\w-]/g, '_')}`;
}

/** The menu of `key`, open under its trigger (only the open menu is in the page) */
export function renderActionMenu(sections: ActionMenuSection[], key: string, label: string): string {
  const body = sections.map(
    (section) => `<div class="action-menu-section" role="group" aria-label="${escapeHtml(section.title)}">
      <div class="action-menu-title" aria-hidden="true">${escapeHtml(section.title)}</div>
      ${section.items.map(renderItem).join('')}</div>`
  );
  return `<div class="action-menu" id="${actionMenuId(key)}" role="menu" aria-label="${escapeHtml(label)}">${body.join(
    ''
  )}</div>`;
}
