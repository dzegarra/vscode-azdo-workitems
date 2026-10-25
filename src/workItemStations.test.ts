import { describe, expect, it } from 'vitest';
import type { StationSpan } from './prLifecycle';
import { stationAt, workItemStations, type PrStations, type WorkItemStationInput } from './workItemStations';

const at = (day: number, hour = 12): number => new Date(2026, 9, day, hour).getTime();

const span = (
  kind: StationSpan['kind'],
  start: number,
  end: number,
  extra: Partial<StationSpan> = {}
): StationSpan => ({
  kind,
  start,
  end,
  ...extra,
});

const pr = (id: number, created: number, stations: StationSpan[], closed?: number): PrStations => ({
  id,
  created,
  closed,
  stations: stations.map((station) => ({ ...station, prId: id })),
});

const shape = (input: WorkItemStationInput): [string, number, number][] =>
  workItemStations(input).map((station) => [station.kind, station.start, station.end]);

const base: WorkItemStationInput = {
  now: at(22),
  started: { at: at(14), approximate: false },
  prs: [],
  tasksOpen: false,
};

describe('station of a work item at a moment (TIMELINE-16)', () => {
  it('is Branch from the start of the work until its PR is created', () => {
    const input = { ...base, prs: [pr(1, at(16), [span('pullRequest', at(16), at(22))])] };
    expect(stationAt(input, at(15))).toMatchObject({ kind: 'branch' });
    expect(stationAt(input, at(17))).toMatchObject({ kind: 'pullRequest', prId: 1 });
    expect(stationAt(input, at(13))).toBeUndefined();
  });

  it('follows the stations of a single PR, and ends at its merge (the mark says done)', () => {
    const input: WorkItemStationInput = {
      ...base,
      finished: at(21, 18),
      prs: [
        pr(
          1,
          at(16),
          [
            span('pullRequest', at(16), at(17)),
            span('ci', at(17), at(17, 13)),
            span('review', at(17, 13), at(20)),
            span('ready', at(20), at(21)),
          ],
          at(21)
        ),
      ],
    };
    expect(shape(input)).toEqual([
      ['branch', at(14), at(16)],
      ['pullRequest', at(16), at(17)],
      ['ci', at(17), at(17, 13)],
      ['review', at(17, 13), at(20)],
      ['ready', at(20), at(21)],
    ]);
    expect(stationAt(input, at(21, 17))).toEqual({ kind: 'done' });
  });

  it('is the station of the least advanced open PR when several are open', () => {
    const input = {
      ...base,
      prs: [
        pr(1, at(15), [span('ready', at(15), at(22))]),
        pr(2, at(16), [span('review', at(16), at(22))]),
        pr(3, at(17), [span('ci', at(17), at(22))]),
      ],
    };
    expect(stationAt(input, at(15, 18))).toMatchObject({ kind: 'ready', prId: 1 });
    expect(stationAt(input, at(16, 18))).toMatchObject({ kind: 'review', prId: 2 });
    expect(stationAt(input, at(18))).toMatchObject({ kind: 'ci', prId: 3 });
  });

  it('needs the user when any open PR does, even if another one is less advanced', () => {
    const input = {
      ...base,
      prs: [
        pr(14030, at(15), [span('pullRequest', at(15), at(22))]),
        pr(14012, at(15), [span('review', at(15), at(22))]),
        pr(14021, at(16), [
          span('review', at(16), at(18)),
          span('needsYou', at(18), at(22), { of: 'ci', reason: 'CI failed' }),
        ]),
      ],
    };
    expect(stationAt(input, at(17))).toMatchObject({ kind: 'pullRequest', prId: 14030 });
    expect(stationAt(input, at(19))).toEqual({
      kind: 'needsYou',
      of: 'ci',
      reason: 'CI failed',
      prId: 14021,
      approximate: undefined,
    });
  });

  it('goes back to Branch when merged PRs leave tasks open (TRACK-7)', () => {
    const input = {
      ...base,
      tasksOpen: true,
      prs: [pr(1, at(15), [span('review', at(15), at(17))], at(17))],
    };
    expect(shape(input)).toEqual([
      ['branch', at(14), at(15)],
      ['review', at(15), at(17)],
      ['branch', at(17), at(22)],
    ]);
  });

  it('goes back to Branch between two PRs even when no task is open now', () => {
    const input = {
      ...base,
      prs: [pr(1, at(15), [span('review', at(15), at(17))], at(17)), pr(2, at(19), [span('ci', at(19), at(22))])],
    };
    expect(stationAt(input, at(18))).toMatchObject({ kind: 'branch' });
  });

  it('waits for the user to move it to Done when the last PR was merged, no task is open and it is not finished', () => {
    const input = { ...base, prs: [pr(1, at(15), [span('ready', at(15), at(17))], at(17))] };
    expect(stationAt(input, at(18))).toMatchObject({ kind: 'needsYou', of: 'done' });
  });

  it('has nothing for a work item with no start and no PR', () => {
    expect(workItemStations({ ...base, started: undefined })).toEqual([]);
  });

  it('marks the Branch before the first PR approximate when the start is a guess', () => {
    const input = { ...base, started: { at: at(14), approximate: true } };
    expect(workItemStations(input)[0]).toMatchObject({ kind: 'branch', approximate: true });
  });

  it('is one needs-you span while the PR and the reason behind it change, and says the latest (TIMELINE-16)', () => {
    const input = {
      ...base,
      prs: [
        pr(1, at(15), [span('needsYou', at(15), at(17), { of: 'review', reason: 'Jonas waits for the author' })]),
        pr(2, at(15), [
          span('review', at(15), at(17)),
          span('needsYou', at(17), at(22), { of: 'ci', reason: 'CI failed' }),
        ]),
      ],
    };
    const spans = workItemStations(input);
    expect(spans.map((entry) => [entry.kind, entry.start, entry.end])).toEqual([
      ['branch', at(14), at(15)],
      ['needsYou', at(15), at(22)],
    ]);
    expect(spans[1]).toMatchObject({ of: 'ci', reason: 'CI failed', prId: 2 });
  });

  it('stops a finished work item at its finish, even when a PR is still open', () => {
    const input = { ...base, finished: at(18), prs: [pr(1, at(15), [span('review', at(15), at(22))])] };
    expect(shape(input).at(-1)).toEqual(['review', at(15), at(18)]);
  });
});
