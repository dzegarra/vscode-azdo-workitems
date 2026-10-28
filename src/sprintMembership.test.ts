import { describe, expect, it } from 'vitest';
import { iterationTarget, sprintMembership } from './sprintMembership';
import type { WorkItemUpdate } from './workItemStateHistory';

const S123 = 'FDA\\MVP R3\\Platform Sprint 123';
const S124 = 'FDA\\MVP R3\\Platform Sprint 124';
const me = { id: 'me', displayName: 'Daniel Zegarra' };
const ana = { id: 'ana', displayName: 'Ana Pérez' };

const update = (at: string, fields: Record<string, unknown>): WorkItemUpdate => ({
  fields: {
    'System.ChangedDate': { newValue: `${at}Z` },
    ...Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, { newValue: value }])),
  },
});
const sprint = {
  paths: new Set([S123]),
  people: new Set(['me']),
  start: Date.parse('2026-10-14T00:00:00Z'),
  end: Date.parse('2026-10-27T23:59:59Z'),
};

describe('sprintMembership (Rules TIMELINE-43, TIMELINE-44)', () => {
  it('keeps a work item planned before the sprint and still in it at the end', () => {
    const updates = [update('2026-10-10T09:00:00', { 'System.IterationPath': S123, 'System.AssignedTo': me })];
    expect(sprintMembership(updates, sprint)).toEqual({});
  });

  it('says when a work item added while the sprint ran joined it', () => {
    const updates = [
      update('2026-10-01T09:00:00', { 'System.IterationPath': 'FDA\\MVP R3', 'System.AssignedTo': me }),
      update('2026-10-20T10:00:00', { 'System.IterationPath': S123 }),
      update('2026-10-21T10:00:00', { 'System.State': 'Committed' }),
    ];
    expect(sprintMembership(updates, sprint)).toEqual({ enteredAt: Date.parse('2026-10-20T10:00:00Z') });
  });

  it('says where a carried-over work item went after the end (Bug 60840: 122 → 123 → 124)', () => {
    const updates = [
      update('2026-09-29T09:00:00', {
        'System.IterationPath': 'FDA\\MVP R3\\Platform Sprint 122',
        'System.AssignedTo': me,
      }),
      update('2026-10-14T08:48:00', { 'System.IterationPath': S123 }),
      update('2026-10-28T08:30:00', { 'System.IterationPath': S124 }),
    ];
    expect(sprintMembership(updates, sprint)).toEqual({
      enteredAt: Date.parse('2026-10-14T08:48:00Z'),
      next: { kind: 'iteration', name: 'Sprint 124', sprint: true },
    });
  });

  it('says when and for where a work item left during the sprint: another iteration or another person', () => {
    const moved = [
      update('2026-10-10T09:00:00', { 'System.IterationPath': S123, 'System.AssignedTo': me }),
      update('2026-10-22T11:00:00', { 'System.IterationPath': S124 }),
    ];
    expect(sprintMembership(moved, sprint)).toEqual({
      left: { at: Date.parse('2026-10-22T11:00:00Z'), to: { kind: 'iteration', name: 'Sprint 124', sprint: true } },
    });
    const reassigned = [
      update('2026-10-10T09:00:00', { 'System.IterationPath': S123, 'System.AssignedTo': me }),
      update('2026-10-21T15:00:00', { 'System.AssignedTo': ana }),
    ];
    expect(sprintMembership(reassigned, sprint)?.left).toEqual({
      at: Date.parse('2026-10-21T15:00:00Z'),
      to: { kind: 'person', name: 'Ana Pérez', sprint: false },
    });
    const unassigned = [
      update('2026-10-10T09:00:00', { 'System.IterationPath': S123, 'System.AssignedTo': me }),
      update('2026-10-21T15:00:00', { 'System.AssignedTo': undefined }),
    ];
    expect(sprintMembership(unassigned, sprint)?.left?.to).toEqual({ kind: 'person', name: 'nobody', sprint: false });
  });

  it('leaves out a work item that was in the iteration only before the sprint, after it, or with someone else', () => {
    const before = [
      update('2026-10-05T09:00:00', { 'System.IterationPath': S123, 'System.AssignedTo': me }),
      update('2026-10-12T09:00:00', { 'System.IterationPath': S124 }),
    ];
    expect(sprintMembership(before, sprint)).toBeUndefined();
    const after = [update('2026-10-28T09:00:00', { 'System.IterationPath': S123, 'System.AssignedTo': me })];
    expect(sprintMembership(after, sprint)).toBeUndefined();
    const someoneElse = [update('2026-10-10T09:00:00', { 'System.IterationPath': S123, 'System.AssignedTo': ana })];
    expect(sprintMembership(someoneElse, sprint)).toBeUndefined();
  });

  it('names an iteration by its sprint, or by its last part when it is not a sprint', () => {
    expect(iterationTarget(S124)).toEqual({ kind: 'iteration', name: 'Sprint 124', sprint: true });
    expect(iterationTarget('FDA\\MVP R3')).toEqual({ kind: 'iteration', name: 'MVP R3', sprint: false });
  });
});
