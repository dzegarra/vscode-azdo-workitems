import { describe, expect, it } from 'vitest';
import { coversArea, teamsMissingIteration, type TeamPlan } from './teamPlans';

const PLATFORM = 'Flow Digital Architecture\\Platform Framework';
const plans: TeamPlan[] = [
  {
    name: 'Platform Team',
    areas: [{ path: PLATFORM, includeChildren: false }],
    iterationPaths: ['Flow Digital Architecture\\MVP R3\\Platform Sprint 123'],
  },
  {
    name: 'Interface Apps',
    areas: [{ path: 'Flow Digital Architecture\\Interfaces', includeChildren: true }],
    iterationPaths: ['Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123'],
  },
];

describe('coversArea (Rule ALERT-14)', () => {
  it('matches the exact area, ignoring case', () => {
    expect(coversArea([{ path: PLATFORM, includeChildren: false }], PLATFORM.toUpperCase())).toBe(true);
  });

  it('matches children only with includeChildren, on path boundaries', () => {
    const child = `${PLATFORM}\\Sub`;
    expect(coversArea([{ path: PLATFORM, includeChildren: false }], child)).toBe(false);
    expect(coversArea([{ path: PLATFORM, includeChildren: true }], child)).toBe(true);
    expect(coversArea([{ path: PLATFORM, includeChildren: true }], `${PLATFORM} Other`)).toBe(false);
  });
});

describe('teamsMissingIteration (Rule ALERT-14)', () => {
  it('flags an iteration the covering team did not select', () => {
    expect(
      teamsMissingIteration(plans, PLATFORM, 'Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123')
    ).toEqual(['Platform Team']);
  });

  it('says nothing for an iteration in the plan, compared case-insensitively', () => {
    expect(teamsMissingIteration(plans, PLATFORM, 'flow digital architecture\\mvp r3\\platform sprint 123')).toEqual(
      []
    );
  });

  it('counts children of an area owned with includeChildren', () => {
    expect(
      teamsMissingIteration(
        plans,
        'Flow Digital Architecture\\Interfaces\\Modbus',
        'Flow Digital Architecture\\MVP R3\\Platform Sprint 123'
      )
    ).toEqual(['Interface Apps']);
    expect(
      teamsMissingIteration(plans, `${PLATFORM}\\Sub`, 'Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123')
    ).toEqual([]);
  });

  it('is fine when any covering team planned the iteration', () => {
    const shared: TeamPlan[] = [
      ...plans,
      {
        name: 'Other',
        areas: [{ path: PLATFORM, includeChildren: false }],
        iterationPaths: ['Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123'],
      },
    ];
    expect(
      teamsMissingIteration(shared, PLATFORM, 'Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123')
    ).toEqual([]);
  });

  it('lists every covering team when none planned it', () => {
    const two: TeamPlan[] = [plans[0], { ...plans[0], name: 'Second' }];
    expect(teamsMissingIteration(two, PLATFORM, 'Flow Digital Architecture\\MVP R3\\Other Sprint 1')).toEqual([
      'Platform Team',
      'Second',
    ]);
  });

  it('is silent without covering team, for containers and with missing data', () => {
    const sprint = 'Flow Digital Architecture\\MVP R3\\Interface Apps Sprint 123';
    expect(teamsMissingIteration(plans, 'Flow Digital Architecture\\Nobody', sprint)).toEqual([]);
    expect(teamsMissingIteration(plans, PLATFORM, 'Flow Digital Architecture\\MVP R3')).toEqual([]);
    expect(teamsMissingIteration(plans, PLATFORM, 'Flow Digital Architecture')).toEqual([]);
    expect(teamsMissingIteration(undefined, PLATFORM, sprint)).toEqual([]);
    expect(teamsMissingIteration(plans, undefined, sprint)).toEqual([]);
    expect(teamsMissingIteration(plans, PLATFORM, undefined)).toEqual([]);
  });
});
