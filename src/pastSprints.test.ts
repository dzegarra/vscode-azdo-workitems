import { describe, expect, it } from 'vitest';
import {
  asOfMoment,
  axisIteration,
  endedText,
  historyRow,
  sprintChoices,
  withMembership,
  type CurrentIteration,
} from './pastSprints';
import { buildEverWorkItemsQuery, buildMyWorkItemsQuery, buildTeamWorkItemsQuery } from './iterations';
import type { TimelineRow } from './timelineTypes';

const iteration = (name: string, start: string, finish: string, team = 'Platform'): CurrentIteration => ({
  name,
  path: `FDA\\MVP R3\\${name}`,
  teams: [team],
  startDate: `${start}T00:00:00Z`,
  finishDate: `${finish}T00:00:00Z`,
});
const scheduled = (name: string, start: string, finish: string) => ({
  name,
  path: `FDA\\MVP R3\\${name}`,
  start: `${start}T00:00:00Z`,
  finish: `${finish}T00:00:00Z`,
});

describe('sprintChoices (Rule TIMELINE-40)', () => {
  const current = [
    iteration('Platform Sprint 123', '2026-10-28', '2026-11-10'),
    iteration('UX Sprint 123', '2026-10-28', '2026-11-10', 'UX'),
  ];
  const schedule = [
    ...[118, 119, 120, 121, 122, 123].flatMap((n) => {
      const start = new Date(Date.UTC(2026, 9, 28 - (123 - n) * 14)).toISOString().slice(0, 10);
      const finish = new Date(Date.UTC(2026, 9, 28 - (123 - n) * 14 + 13)).toISOString().slice(0, 10);
      return [
        scheduled(`Platform Sprint ${String(n)}`, start, finish),
        scheduled(`UX Sprint ${String(n)}`, start, finish),
      ];
    }),
    scheduled('Automation Sprint 122', '2026-10-14', '2026-10-27'),
  ];

  it('offers the current sprint and the 4 before it, each with the iteration of every team', () => {
    const choices = sprintChoices(current, schedule);
    expect(choices.map((choice) => [choice.offset, choice.title])).toEqual([
      [0, 'Sprint 123'],
      [1, 'Sprint 122'],
      [2, 'Sprint 121'],
      [3, 'Sprint 120'],
      [4, 'Sprint 119'],
    ]);
    expect(choices[1].iterations.map((it) => it.name)).toEqual(['Platform Sprint 122', 'UX Sprint 122']);
    expect(choices[1].iterations[1].teams).toEqual(['UX']);
  });

  it('has only the current sprint without a schedule, and stops where the series has no older sprint', () => {
    expect(sprintChoices(current, undefined)).toHaveLength(1);
    expect(sprintChoices(current, schedule.slice(0, 4)).map((choice) => choice.title)).toEqual([
      'Sprint 123',
      'Sprint 119',
      'Sprint 118',
    ]);
  });
});

describe('a past sprint (Rule TIMELINE-41)', () => {
  const sprint = [
    iteration('A Sprint 1', '2026-10-14', '2026-10-27'),
    iteration('B Sprint 1', '2026-10-14', '2026-10-28'),
  ];

  it('is read as of the end of its last day, its axis is the sprint that ends first', () => {
    expect(asOfMoment(sprint)).toBe('2026-10-28T23:59:59Z');
    expect(axisIteration(sprint)?.name).toBe('A Sprint 1');
    expect(endedText(sprint[0].finishDate)).toBe('ended Tue 27 Oct');
  });

  it('asks the WIQL as of that moment', () => {
    expect(buildMyWorkItemsQuery(['P\\S 1'], '2026-10-28T23:59:59Z')).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.IterationPath] IN ('P\\S 1') ORDER BY [System.WorkItemType], [System.Id] ASOF '2026-10-28T23:59:59Z'"
    );
  });

  it('asks the work of the people chosen as of that moment too (Whole team)', () => {
    expect(buildTeamWorkItemsQuery(['P\\S 1'], ['ana@abb.com'], '2026-10-28T23:59:59Z')).toMatch(
      /AND \[System\.AssignedTo\] IN \('ana@abb\.com'\) ORDER BY \[System\.Id\] ASOF '2026-10-28T23:59:59Z'$/
    );
    expect(buildTeamWorkItemsQuery(['P\\S 1'], ['ana@abb.com'])).not.toContain('ASOF');
  });

  it('draws its rows as history: no button, no popover, collapsed', () => {
    const row = {
      key: 'k',
      section: 'work',
      id: 1,
      header: '',
      title: '',
      segments: [],
      open: { type: 'openDetails', id: 1 },
      end: 0,
      action: { label: 'Complete…', message: { type: 'openDetails', id: 1 }, primary: true },
      popover: { title: '', text: '', rule: '', actions: [] },
      defaultExpanded: true,
      note: { text: 'needs you · CI failed', tone: 'needsYou' },
      children: [
        {
          kind: 'task',
          key: 't',
          taskId: 2,
          title: '',
          sub: '',
          segments: [],
          action: { label: 'Create PR', message: { type: 'openDetails', id: 2 }, primary: false },
          open: { type: 'openDetails', id: 2 },
          end: 0,
        },
      ],
    } satisfies TimelineRow;
    const history = historyRow(row);
    expect(history.action).toBeUndefined();
    expect(history.popover).toBeUndefined();
    expect(history.defaultExpanded).toBe(false);
    expect(history.note).toBeUndefined();
    expect(history.children?.at(0)).toMatchObject({ action: undefined });
  });

  it('asks every work item ever in its iterations and ever assigned to the user or the people (TIMELINE-43)', () => {
    expect(buildEverWorkItemsQuery(['P\\S 1'], '@Me')).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] IN ('Product Backlog Item', 'Bug') AND [System.IterationPath] EVER 'P\\S 1' AND [System.AssignedTo] EVER @Me ORDER BY [System.Id]"
    );
    expect(buildEverWorkItemsQuery(['P\\A 1', 'P\\B 1'], ['ana@abb.com', "o'neil@abb.com"])).toContain(
      "AND ([System.IterationPath] EVER 'P\\A 1' OR [System.IterationPath] EVER 'P\\B 1') AND ([System.AssignedTo] EVER 'ana@abb.com' OR [System.AssignedTo] EVER 'o''neil@abb.com')"
    );
  });

  it('cuts a row to the time its work item was in the sprint, and says where it went (TIMELINE-44)', () => {
    const row = {
      key: 'k',
      section: 'work',
      id: 1,
      header: '',
      title: '',
      segments: [
        { kind: 'stateApproved', start: 0, end: 3, tip: '' },
        { kind: 'stateCommitted', start: 3, end: 8, tip: '' },
      ],
      merged: { at: 9, text: '✓ Done' },
      open: { type: 'openDetails', id: 1 },
      end: 8,
    } satisfies TimelineRow;
    const day = 24 * 3600_000;
    const position = (ms: number): number => ms / day;
    const moved = withMembership(
      row,
      { enteredAt: day, left: { at: 5 * day, to: { kind: 'person', name: 'Ana Pérez', sprint: false } } },
      position
    );
    expect(moved.segments.map((segment) => [segment.start, segment.end])).toEqual([
      [1, 3],
      [3, 5],
    ]);
    expect(moved.end).toBe(5);
    expect(moved.merged).toBeUndefined();
    expect(moved.faded).toBe(true);
    expect(moved.note).toMatchObject({ text: '→ Ana Pérez', tone: 'moved' });
    expect(moved.note?.detail).toMatch(/^reassigned /);
    const backlog = withMembership(row, { next: { kind: 'iteration', name: 'MVP R3', sprint: false } }, position);
    expect(backlog.note).toEqual({ text: '→ MVP R3', tone: 'moved', detail: 'no sprint' });
    expect(backlog.segments).toEqual(row.segments);
    expect(withMembership(row, undefined, position)).toBe(row);
  });
});
