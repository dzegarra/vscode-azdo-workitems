import { describe, expect, it } from 'vitest';
import { TASK_COUNT_STYLES, normalizeTaskCountStyle, taskCountStyleClass } from './taskCountStyle';

describe('task count style', () => {
  it('keeps the known values', () => {
    expect(normalizeTaskCountStyle('filled')).toBe('filled');
    expect(normalizeTaskCountStyle('outlined')).toBe('outlined');
  });

  it('falls back to filled for unknown values', () => {
    expect(normalizeTaskCountStyle('ring')).toBe('filled');
    expect(normalizeTaskCountStyle('')).toBe('filled');
    expect(normalizeTaskCountStyle(undefined)).toBe('filled');
  });

  it('maps every style to its own CSS class', () => {
    expect(taskCountStyleClass('outlined')).toBe('task-counts-outlined');
    expect(new Set(TASK_COUNT_STYLES.map(taskCountStyleClass)).size).toBe(TASK_COUNT_STYLES.length);
  });
});
