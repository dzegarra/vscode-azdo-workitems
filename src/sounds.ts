/**
 * The short sounds of totalflowx.fun.sounds, as notes the sidebar webview synthesizes with the Web Audio API: no audio
 * file, no change to the CSP. Pure, no "vscode" import (the webview imports it too)
 */
import type { GreenStreakChange } from './greenStreak';

export type SoundId = 'merged' | 'record' | 'streakBroken';

export interface Note {
  /** Hz */
  frequency: number;
  /** Seconds from the start of the sound */
  start: number;
  /** Seconds until it has faded out */
  duration: number;
  wave: 'sine' | 'triangle';
}

/** Peak gain of a note: quiet on purpose, it plays at work */
export const SOUND_VOLUME = 0.12;

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;
const E6 = 1318.51;
const B6 = 1975.53;
const G3 = 196;
const D3 = 146.83;

export const SOUNDS: Record<SoundId, Note[]> = {
  /** A rising arpeggio, played with the confetti */
  merged: [
    { frequency: C5, start: 0, duration: 0.25, wave: 'triangle' },
    { frequency: E5, start: 0.09, duration: 0.25, wave: 'triangle' },
    { frequency: G5, start: 0.18, duration: 0.25, wave: 'triangle' },
    { frequency: C6, start: 0.27, duration: 0.6, wave: 'triangle' },
  ],
  /** A bright double ding */
  record: [
    { frequency: E6, start: 0, duration: 0.5, wave: 'sine' },
    { frequency: B6, start: 0.12, duration: 0.7, wave: 'sine' },
  ],
  /** A low, falling "bonk" */
  streakBroken: [
    { frequency: G3, start: 0, duration: 0.25, wave: 'triangle' },
    { frequency: D3, start: 0.18, duration: 0.45, wave: 'triangle' },
  ],
};

// Rule FUN-SOUND-1
/** The sound of a change of the green streak: a new record or a broken streak; a streak that only grows is silent */
export function streakSound(change: GreenStreakChange | undefined): SoundId | undefined {
  switch (change) {
    case 'record':
      return 'record';
    case 'broken':
      return 'streakBroken';
    case 'grew':
    case undefined:
      return undefined;
  }
}

/** Seconds until the last note has faded out */
export function soundLength(id: SoundId): number {
  return Math.max(...SOUNDS[id].map((note) => note.start + note.duration));
}
