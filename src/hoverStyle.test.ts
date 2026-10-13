import { describe, expect, it } from 'vitest';
import { hoverStyleClass, normalizeHoverStyle } from './hoverStyle';

describe('hover style', () => {
  it('keeps the known values', () => {
    expect(normalizeHoverStyle('border')).toBe('border');
    expect(normalizeHoverStyle('tint')).toBe('tint');
    expect(normalizeHoverStyle('accent')).toBe('accent');
  });

  it('falls back to border for unknown values', () => {
    expect(normalizeHoverStyle('glow')).toBe('border');
    expect(normalizeHoverStyle('')).toBe('border');
    expect(normalizeHoverStyle(undefined)).toBe('border');
  });

  it('maps the style to a CSS class', () => {
    expect(hoverStyleClass('tint')).toBe('hover-tint');
  });
});
