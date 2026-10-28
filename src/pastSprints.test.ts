import { describe, expect, it } from 'vitest';
import { asOfMoment, axisIteration, endedText, historyRow, sprintChoices, type CurrentIteration } from './pastSprints';
import { buildMyWorkItemsQuery } from './iterations';
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
});
