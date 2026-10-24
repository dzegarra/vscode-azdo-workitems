import { describe, expect, it } from 'vitest';
import { lookClass, normalizeLook } from './look';

describe('normalizeLook', () => {
  it('falls back to the theme', () => {
    expect(normalizeLook('totalflow')).toBe('totalflow');
    expect(normalizeLook('neon')).toBe('theme');
    expect(normalizeLook(undefined)).toBe('theme');
  });
});

describe('lookClass', () => {
  it('applies the Totalflow look, never over a high contrast theme', () => {
    // Rule LOOK-1
    expect(lookClass('totalflow', ['vscode-dark'])).toBe('look-totalflow');
    expect(lookClass('totalflow', ['vscode-high-contrast'])).toBeUndefined();
    expect(lookClass('totalflow', ['vscode-high-contrast-light'])).toBeUndefined();
    expect(lookClass('theme', ['vscode-dark'])).toBeUndefined();
  });
});
