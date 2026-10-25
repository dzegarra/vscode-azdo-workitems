/** HTML of the track (Rules TRACK-*), shared by the sidebar and the Work Item Details panel. Pure, no "vscode" import */
import { escapeHtml } from './html';
import { currentStation, type Station, type StationId } from './track';

const STATION_STATE_LABELS: Record<Station['state'], string> = {
  done: 'passed',
  active: 'in progress',
  needsYou: 'needs you',
  broken: 'breaks a team rule',
  pending: 'not reached',
};

export function stationTitle(station: Station): string {
  return `${station.label}: ${STATION_STATE_LABELS[station.state]}${station.detail ? ` · ${station.detail}` : ''}`;
}

/**
 * The six stations: one segment each, then the station to look at in words. `named`: the name of each station
 * under its segment, for wide places (the details panel); a narrow sidebar keeps them in the tooltips
 */
export function renderTrackHtml(track: Station[], label: string, named = false): string {
  const current = currentStation(track);
  const stations = track
    .map(
      (station) =>
        `<li class="station station-${station.state}${station === current ? ' current' : ''}" title="${escapeHtml(
          stationTitle(station)
        )}"><span class="visually-hidden">${escapeHtml(stationTitle(station))}</span></li>`
    )
    .join('');
  const names = named
    ? `<ol class="track-names" aria-hidden="true">${track
        .map(
          (station) =>
            `<li class="${station === current ? `track-current station-${station.state}` : ''}">${escapeHtml(
              station.label
            )}</li>`
        )
        .join('')}</ol>`
    : '';
  let caption = '<p class="track-caption">Done</p>';
  if (current?.state === 'pending') {
    // Not reached yet: the next step of the work
    caption = `<p class="track-caption">Next: <span class="track-current">${escapeHtml(current.label)}</span></p>`;
  } else if (current) {
    caption = `<p class="track-caption"><span class="track-current station-${current.state}">${escapeHtml(
      current.label
    )}</span>${current.detail ? ` · ${escapeHtml(current.detail)}` : ''}</p>`;
  }
  return `<div class="track${named ? ' named' : ''}"><ol class="track-bars" aria-label="${escapeHtml(
    label
  )}">${stations}</ol>${names}${caption}</div>`;
}

// Rule SIGNAL-12
/** The track of a compact row: six small segments, the details in the tooltip */
export function renderMiniTrackHtml(track: Station[]): string {
  const title = track.map(stationTitle).join('\n');
  return `<span class="mini-track" role="img" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}">${track
    .map((station) => `<span class="mini-station station-${station.state}"></span>`)
    .join('')}</span>`;
}

/** A bare check mark (stroked), for the round markers of the details panel */
export const CHECK_MARK =
  '<svg class="mark-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';

const MARKERS: Record<Station['state'], string> = {
  done: CHECK_MARK,
  needsYou: '<span class="mark-text">!</span>',
  broken: '<span class="mark-text">!</span>',
  active: '<span class="mark-dot"></span>',
  pending: '',
};

function renderNotes(station: Station, notes: string[]): string {
  return notes
    .map((note, index) => {
      const classes = ['note'];
      if (index === 0 && station.detail) {
        classes.push('note-lead');
      }
      if (index === 0 && station.id === 'branch') {
        classes.push('note-mono');
      }
      return `<span class="${classes.join(' ')}">${escapeHtml(note)}</span>`;
    })
    .join('');
}

/**
 * The track of the Work Item Details panel: six columns, each with a round marker joined to the next one, the
 * name of the station and the notes under it. They wrap to three and two columns on narrow panels
 */
export function renderTrackColumnsHtml(
  track: Station[],
  notes: Partial<Record<StationId, string[]>>,
  label: string
): string {
  const columns = track
    .map((station, index) => {
      const connector =
        index < track.length - 1 ? `<span class="track-link${station.state === 'done' ? ' passed' : ''}"></span>` : '';
      return `<li class="track-col station-${station.state}" title="${escapeHtml(stationTitle(station))}">
        <div class="track-head"><span class="marker marker-${station.state}">${
        MARKERS[station.state]
      }</span>${connector}</div>
        <span class="track-name">${escapeHtml(station.label)}</span>
        ${renderNotes(station, notes[station.id] ?? [])}
        <span class="visually-hidden">${escapeHtml(stationTitle(station))}</span></li>`;
    })
    .join('');
  return `<section class="track-box"><ol class="track-cols" aria-label="${escapeHtml(
    label
  )}">${columns}</ol></section>`;
}
