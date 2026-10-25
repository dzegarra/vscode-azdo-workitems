import { describe, expect, it } from 'vitest';
import { buildTeamWorkItemsQuery } from './iterations';
import { avatarColour, initials, parseScope, shownTeams, shortPersonName, teamBadge, teamBadges } from './teamView';

describe('teams shown', () => {
  const available = ['Platform Team', 'Interface Apps', 'UX', 'Measurement Apps'];

  it('reads the teams of the sidebar that exist', () => {
    expect(shownTeams(available, ['Interface Apps', 'Unknown'])).toEqual(['Interface Apps']);
  });

  it('reads all the teams of the user when none is set or none exists', () => {
    expect(shownTeams(available, [])).toEqual(available);
    expect(shownTeams(available, ['Gone'])).toEqual(available);
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
  it('asks for Backlog Items and Bugs of all the iterations at once, of the people chosen', () => {
    const query = buildTeamWorkItemsQuery(
      ['P\\R\\Platform Sprint 1', "P\\R\\O'Neil Sprint"],
      ['ana.ruiz@abb.com', "Pat O'Neil"]
    );
    expect(query).toContain("[System.WorkItemType] IN ('Product Backlog Item', 'Bug')");
    expect(query).toContain("[System.State] <> 'Removed'");
    expect(query).toContain("IN ('P\\R\\Platform Sprint 1', 'P\\R\\O''Neil Sprint')");
    expect(query).toContain("[System.AssignedTo] IN ('ana.ruiz@abb.com', 'Pat O''Neil')");
  });
});
