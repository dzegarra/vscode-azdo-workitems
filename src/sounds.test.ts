import { describe, expect, it } from 'vitest';
import { SOUND_VOLUME, SoundId, soundLength, SOUNDS, streakSound } from './sounds';

describe('SOUNDS', () => {
  it('are short, quiet and audible', () => {
    for (const id of Object.keys(SOUNDS) as SoundId[]) {
      expect(soundLength(id)).toBeLessThanOrEqual(1);
      for (const note of SOUNDS[id]) {
        expect(note.frequency).toBeGreaterThan(100);
        expect(note.duration).toBeGreaterThan(0);
        expect(note.start).toBeGreaterThanOrEqual(0);
      }
    }
    expect(SOUND_VOLUME).toBeLessThanOrEqual(0.2);
  });

  it('rise for a merge and fall for a broken streak', () => {
    const merged = SOUNDS.merged.map((note) => note.frequency);
    expect(merged).toEqual([...merged].sort((a, b) => a - b));
    const broken = SOUNDS.streakBroken.map((note) => note.frequency);
    expect(broken).toEqual([...broken].sort((a, b) => b - a));
  });
});

describe('streakSound', () => {
  it('sounds for a record and a broken streak only', () => {
    expect(streakSound('record')).toBe('record');
    expect(streakSound('broken')).toBe('streakBroken');
    expect(streakSound('grew')).toBeUndefined();
    expect(streakSound(undefined)).toBeUndefined();
  });
});
