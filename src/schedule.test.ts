import { describe, expect, it } from 'vitest';
import {
  containerPath,
  dependencyRisk,
  DependencyRisk,
  flattenIterations,
  iterationKind,
  toIterationPath,
} from './schedule';

const range = (name: string, startDate: string, finishDate: string) => ({
  name,
  path: `\\Flow\\Iteration\\R1\\${name}`,
  attributes: { startDate: `${startDate}T00:00:00Z`, finishDate: `${finishDate}T00:00:00Z` },
});

const schedule = flattenIterations({
  name: 'Flow',
  path: '\\Flow\\Iteration',
  children: [
    {
      name: 'R1',
      path: '\\Flow\\Iteration\\R1',
      attributes: { startDate: '2026-09-01T00:00:00Z', finishDate: '2027-03-01T00:00:00Z' },
      children: [
        range('Platform Sprint 41', '2026-09-21', '2026-10-02'),
        range('UX Sprint 41', '2026-09-21', '2026-10-02'),
        range('Platform Sprint 42', '2026-10-05', '2026-10-16'),
        range('Wide Sprint', '2026-09-21', '2026-10-16'),
        { name: 'Undated', path: '\\Flow\\Iteration\\R1\\Undated' },
      ],
    },
  ],
});

describe('iterations', () => {
  it('converts classification node paths to iteration paths', () => {
    expect(toIterationPath('\\Flow Digital Architecture\\Iteration\\R1\\Sprint 42')).toBe(
      'Flow Digital Architecture\\R1\\Sprint 42'
    );
    expect(toIterationPath('\\Flow Digital Architecture\\Iteration')).toBe('Flow Digital Architecture');
  });

  it('tells the kind of an iteration by its depth', () => {
    expect(iterationKind('Flow')).toBe('limbo');
    expect(iterationKind('Flow\\R1')).toBe('container');
    expect(iterationKind('Flow\\R1\\Platform Sprint 41')).toBe('sprint');
    expect(iterationKind('Flow\\R1\\Team\\Sprint 1')).toBe('sprint');
    expect(containerPath('Flow\\R1\\Platform Sprint 41')).toBe('Flow\\R1');
  });
});

describe('dependencyRisk', () => {
  const sprint = (name: string) => `Flow\\R1\\${name}`;
  const open = (iterationPath: string) => ({ state: 'Committed', iterationPath });

  it.each<[string, { state: string; iterationPath: string }, string, DependencyRisk]>([
    [
      'predecessor done',
      { state: 'Done', iterationPath: sprint('Platform Sprint 42') },
      sprint('Platform Sprint 41'),
      'done',
    ],
    ['predecessor done in the release', { state: 'Done', iterationPath: 'Flow\\R1' }, 'Flow\\R1', 'done'],
    ['successor in the release', open(sprint('Platform Sprint 42')), 'Flow\\R1', 'ok'],
    ['successor in the project', open('Flow\\R1'), 'Flow', 'ok'],
    ['predecessor in the release', open('Flow\\R1'), sprint('Platform Sprint 41'), 'unscheduled'],
    ['predecessor in the project', open('Flow'), sprint('Platform Sprint 41'), 'unscheduled'],
    ['predecessor in a sprint without dates', open(sprint('Undated')), sprint('Platform Sprint 41'), 'unscheduled'],
    ['successor in a sprint without dates', open(sprint('Platform Sprint 41')), sprint('Undated'), 'ok'],
    ['same sprint', open(sprint('Platform Sprint 41')), sprint('Platform Sprint 41'), 'tight'],
    ['same dates, other team', open(sprint('UX Sprint 41')), sprint('Platform Sprint 41'), 'tight'],
    ['later slot', open(sprint('Platform Sprint 42')), sprint('Platform Sprint 41'), 'late'],
    ['earlier slot', open(sprint('Platform Sprint 41')), sprint('Platform Sprint 42'), 'ok'],
    ['same start, finishes later', open(sprint('Wide Sprint')), sprint('Platform Sprint 41'), 'late'],
    ['same start, finishes earlier', open(sprint('Platform Sprint 41')), sprint('Wide Sprint'), 'ok'],
  ])('%s', (_name, predecessor, successorPath, risk) => {
    expect(dependencyRisk(predecessor, { iterationPath: successorPath }, schedule)).toBe(risk);
  });
});
