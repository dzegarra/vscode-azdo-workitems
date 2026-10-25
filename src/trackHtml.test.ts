import { describe, expect, it } from 'vitest';
import type { Station } from './track';
import { renderMiniTrackHtml, renderTrackColumnsHtml, renderTrackHtml, stationTitle } from './trackHtml';

const track: Station[] = [
  { id: 'branch', label: 'Branch', state: 'done' },
  { id: 'pullRequest', label: 'Pull request', state: 'done', detail: 'PR 1' },
  { id: 'ci', label: 'CI', state: 'needsYou', detail: 'failed' },
  { id: 'review', label: 'Review', state: 'pending' },
  { id: 'ready', label: 'Ready to be merged', state: 'pending' },
  { id: 'done', label: 'Done', state: 'pending' },
];

describe('trackHtml', () => {
  it('names the station to look at under the segments', () => {
    const html = renderTrackHtml(track, 'Track of 1');
    expect(html.match(/class="station /g)).toHaveLength(6);
    expect(html).toContain('<span class="track-current station-needsYou">CI</span> · failed');
    expect(html).not.toContain('track-names');
    expect(renderTrackHtml(track, 'Track of 1', true)).toContain('track-names');
  });

  it('says what comes next when nothing is reached yet', () => {
    const pending = track.map((station) => ({ ...station, state: 'pending' as const }));
    expect(renderTrackHtml(pending, 'Track')).toContain('Next: <span class="track-current">Branch</span>');
  });

  it('puts every station in the tooltip of the mini track', () => {
    // Rule SIGNAL-12
    expect(stationTitle(track[2])).toBe('CI: needs you · failed');
    expect(renderMiniTrackHtml(track).match(/mini-station /g)).toHaveLength(6);
  });
});

const columnsTrack: Station[] = [
  { id: 'branch', label: 'Branch', state: 'done' },
  { id: 'pullRequest', label: 'Pull request', state: 'needsYou', detail: 'draft' },
  { id: 'ci', label: 'CI', state: 'pending' },
  { id: 'review', label: 'Review', state: 'active', detail: 'in review' },
  { id: 'ready', label: 'Ready to be merged', state: 'broken', detail: 'x' },
  { id: 'done', label: 'Done', state: 'pending' },
];

describe('renderTrackColumnsHtml', () => {
  const html = renderTrackColumnsHtml(
    columnsTrack,
    { branch: ['feature/<x>', 'local'], pullRequest: ['PR 1', 'Self-review'] },
    'Track of 1'
  );

  it('draws one column per station with its name and notes, escaped', () => {
    expect(html.match(/class="track-col /g)).toHaveLength(6);
    expect(html).toContain('feature/&lt;x&gt;');
    expect(html).toContain('<span class="track-name">Ready to be merged</span>');
  });

  it('joins the markers, green after a passed station, none after the last one', () => {
    expect(html.match(/class="track-link/g)).toHaveLength(5);
    expect(html.match(/track-link passed/g)).toHaveLength(1);
  });

  it('colours the first note of a station with a detail, and keeps the stations readable for screen readers', () => {
    expect(html).toContain('note note-lead');
    expect(html).toContain('note-mono');
    expect(html).toContain('<span class="visually-hidden">Pull request: needs you · draft</span>');
    expect(html).toContain('aria-label="Track of 1"');
  });
});
