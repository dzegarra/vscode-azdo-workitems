/**
 * The "N teams" chip next to the sprint title of the Track board and the Sprint timeline (Rule SPRINT-TITLE-1): its
 * hover or focus lists each team with its full iteration name. CSS only (media/board.css), no state
 */
import { escapeHtml } from '../html';
import type { SprintTeams } from '../sprintTitle';

export function renderSprintTeams(teams: SprintTeams | undefined): string {
  if (!teams) {
    return '';
  }
  return `<span class="bd-teams" tabindex="0" aria-describedby="bd-teams-list">${escapeHtml(
    teams.text
  )}<span class="bd-teams-list" id="bd-teams-list" role="tooltip">${teams.lines
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join('')}</span></span>`;
}
