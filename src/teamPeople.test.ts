import { describe, expect, it } from 'vitest';
import {
  matchesFilter,
  mergeCandidates,
  parsePeople,
  peopleLabel,
  pickerRows,
  queryIdentity,
  shortSignIn,
  togglePerson,
} from './teamPeople';

const ana = { id: 'ana', name: 'Ana Ruiz EXT', uniqueName: 'ana.ruiz@abb.com' };
const zed = { id: 'zed', name: 'Zed Zebra' };
const kim = { id: 'kim', name: 'Kim Lee', uniqueName: 'kim.lee@abb.com' };

describe('the people setting', () => {
  it('reads valid entries and ignores the invalid ones and the repeats', () => {
    expect(
      parsePeople([
        ana,
        { id: 'zed', name: ' Zed Zebra ' },
        { id: 'zed', name: 'Zed Again' },
        { id: '', name: 'No id' },
        { id: 'x' },
        { name: 'No id either' },
        { id: 3, name: 'Number' },
        'text',
        null,
      ])
    ).toEqual([ana, zed]);
  });

  it('is empty for anything that is not a list', () => {
    expect(parsePeople(undefined)).toEqual([]);
    expect(parsePeople({ id: 'a', name: 'b' })).toEqual([]);
  });

  it('asks the query for the sign-in name, else the display name', () => {
    expect(queryIdentity(ana)).toBe('ana.ruiz@abb.com');
    expect(queryIdentity(zed)).toBe('Zed Zebra');
    expect(shortSignIn('ana.ruiz@abb.com')).toBe('ana.ruiz');
    expect(shortSignIn(undefined)).toBe('');
  });

  it('ticks and unticks a person', () => {
    expect(togglePerson([ana], zed)).toEqual([ana, zed]);
    expect(togglePerson([ana, zed], ana)).toEqual([zed]);
    expect(peopleLabel(3)).toBe('People 3');
  });
});

describe('the candidates of the picker', () => {
  it('merges the sources without repeats and without the user', () => {
    const merged = mergeCandidates(
      [[zed, { id: 'me', name: 'Me Myself' }], [kim, { id: 'zed', name: 'Zed (other spelling)' }], [ana]],
      'me'
    );
    expect(merged).toEqual([zed, kim, ana]);
  });

  it('puts the people chosen first, then the candidates, each by name', () => {
    const rows = pickerRows([zed, ana], [kim, zed, ana, { id: 'amy', name: 'Amy Doe' }]);
    expect(rows.selected.map((person) => person.id)).toEqual(['ana', 'zed']);
    expect(rows.candidates.map((person) => person.id)).toEqual(['amy', 'kim']);
  });

  it('filters by every word typed, in the name or the sign-in name, ignoring case', () => {
    expect(matchesFilter(ana, 'RUIZ')).toBe(true);
    expect(matchesFilter(ana, 'ana ruiz')).toBe(true);
    expect(matchesFilter(ana, 'ruiz kim')).toBe(false);
    expect(matchesFilter(kim, 'lee@abb')).toBe(true);
    expect(matchesFilter(zed, '  ')).toBe(true);
    const rows = pickerRows([ana, zed], [kim, { id: 'amy', name: 'Amy Doe' }], 'a');
    expect(rows.selected.map((person) => person.id)).toEqual(['ana', 'zed']);
    expect(rows.candidates.map((person) => person.id)).toEqual(['amy', 'kim']);
    expect(pickerRows([ana, zed], [kim], 'zeb').selected.map((person) => person.id)).toEqual(['zed']);
    expect(pickerRows([ana], [kim], 'zeb').candidates).toEqual([]);
  });
});
