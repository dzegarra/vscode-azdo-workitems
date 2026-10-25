import { describe, expect, it } from 'vitest';
import { buildTeamWorkItemsQuery } from './iterations';
import {
  avatarColour,
  initials,
  parseScope,
  resolveSelection,
  selectionLabel,
  shortPersonName,
  teamBadge,
  teamBadges,
  toggleTeam,
} from './teamView';

describe('team selection', () => {
  const available = ['Platform Team', 'Interface Apps', 'UX', 'Measurement Apps'];

  it('keeps the remembered teams that still exist', () => {
    expect(resolveSelection(['UX', 'Gone'], available, ['Platform Team'])).toEqual(['UX']);
  });

  it('falls back to the teams of the sidebar, then to all the teams', () => {
    expect(resolveSelection(undefined, available, ['Interface Apps', 'Unknown'])).toEqual(['Interface Apps']);
    expect(resolveSelection(['Gone'], available, [])).toEqual(available);
  });

  it('toggles a team but never leaves the view without one', () => {
    expect(toggleTeam(['UX'], available, 'Interface Apps')).toEqual(['Interface Apps', 'UX']);
    expect(toggleTeam(['UX', 'Interface Apps'], available, 'UX')).toEqual(['Interface Apps']);
    expect(toggleTeam(['UX'], available, 'UX')).toEqual(['UX']);
  });

  it('labels the dropdown button', () => {
    expect(selectionLabel(3, 4)).toBe('Teams 3 of 4');
  });

  it('reads the scope', () => {
    expect(parseScope('team')).toBe('team');
    expect(parseScope('anything')).toBe('mine');
    expect(parseScope(undefined)).toBe('mine');
  });
});

describe('names', () => {
  it('abbreviates the teams', () => {
    expect(teamBadge('UX')).toBe('UX');
    expect(teamBadge('Platform Team')).toBe('PLT');
    expect(teamBadge('Interface Apps')).toBe('IA');
    expect(teamBadge('UI Development Team')).toBe('UD');
  });

  it('tells two teams with the same badge apart', () => {
    const badges = teamBadges(['Measurement Apps', 'Mobile Apps']);
    expect(badges.get('Measurement Apps')).toBe('MA');
    expect(badges.get('Mobile Apps')).toBe('MA2');
  });

  it('makes initials and drops the EXT of external accounts', () => {
    expect(initials('Krzysztof Siwak EXT')).toBe('KS');
    expect(initials('Madonna')).toBe('MA');
    expect(initials('')).toBe('?');
    expect(shortPersonName('Daniel Zegarra EXT')).toBe('Daniel Zegarra');
  });

  it('gives a person always the same avatar colour', () => {
    expect(avatarColour('Ana Ruiz')).toBe(avatarColour('Ana Ruiz'));
    expect(avatarColour('Ana Ruiz')).toBeGreaterThanOrEqual(0);
    expect(avatarColour('Ana Ruiz')).toBeLessThan(6);
  });
});

describe('team work items query', () => {
  it('asks for Backlog Items and Bugs of all the iterations at once, whoever has them', () => {
    const query = buildTeamWorkItemsQuery(['P\\R\\Platform Sprint 1', "P\\R\\O'Neil Sprint"]);
    expect(query).toContain("[System.WorkItemType] IN ('Product Backlog Item', 'Bug')");
    expect(query).toContain("[System.State] <> 'Removed'");
    expect(query).toContain("IN ('P\\R\\Platform Sprint 1', 'P\\R\\O''Neil Sprint')");
    expect(query).not.toContain('AssignedTo');
  });
});
