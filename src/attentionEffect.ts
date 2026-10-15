/** The effect of the My Pull Requests tiles that need the user (totalflowx.myPullRequests.attentionEffect). Pure: no "vscode" import */

export const ATTENTION_EFFECTS = [
  'none',
  'static',
  'pulse',
  'waves',
  'shimmer',
  'ripple',
  'rainbow',
  'breathe',
] as const;
export type AttentionEffect = (typeof ATTENTION_EFFECTS)[number];

/** The effect of the previous design, so an unknown value (a typo in settings.json) keeps the default look */
export const DEFAULT_ATTENTION_EFFECT: AttentionEffect = 'pulse';

// Rule MYPR-PULSE-4
export function normalizeAttentionEffect(value: unknown): AttentionEffect {
  return ATTENTION_EFFECTS.find((effect) => effect === value) ?? DEFAULT_ATTENTION_EFFECT;
}

/** CSS class (on #app) that switches the rules of the stylesheet */
export function attentionEffectClass(effect: AttentionEffect): string {
  return `attention-${effect}`;
}
