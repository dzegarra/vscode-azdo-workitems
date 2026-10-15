import { describe, expect, it } from 'vitest';
import { ATTENTION_EFFECTS, attentionEffectClass, normalizeAttentionEffect } from './attentionEffect';

describe('attention effect', () => {
  it('keeps every known value', () => {
    for (const effect of ATTENTION_EFFECTS) {
      expect(normalizeAttentionEffect(effect)).toBe(effect);
    }
  });

  it('lists none, the steady tint and the default pulse among the effects', () => {
    expect(ATTENTION_EFFECTS).toEqual(
      expect.arrayContaining(['none', 'static', 'pulse', 'waves', 'shimmer', 'ripple', 'rainbow', 'breathe'])
    );
  });

  it('falls back to pulse for unknown values', () => {
    expect(normalizeAttentionEffect('sparkle')).toBe('pulse');
    expect(normalizeAttentionEffect('')).toBe('pulse');
    expect(normalizeAttentionEffect(undefined)).toBe('pulse');
    expect(normalizeAttentionEffect(true)).toBe('pulse');
    expect(normalizeAttentionEffect(null)).toBe('pulse');
  });

  it('maps the effect to a CSS class', () => {
    expect(attentionEffectClass('waves')).toBe('attention-waves');
    expect(attentionEffectClass('none')).toBe('attention-none');
  });
});
