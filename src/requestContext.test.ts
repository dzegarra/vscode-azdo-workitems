import { describe, expect, it } from 'vitest';
import { currentFeature, withFeature } from './requestContext';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('request context', () => {
  it('is other outside of any feature', () => {
    expect(currentFeature()).toBe('other');
  });

  it('keeps the feature across awaits and timers', async () => {
    await withFeature('ci', async () => {
      await tick(1);
      expect(currentFeature()).toBe('ci');
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 1));
      expect(currentFeature()).toBe('ci');
    });
    expect(currentFeature()).toBe('other');
  });

  it('lets the innermost feature win and restores the outer one', async () => {
    await withFeature('commands', async () => {
      await withFeature('myPullRequests', async () => {
        await tick(1);
        expect(currentFeature()).toBe('myPullRequests');
      });
      expect(currentFeature()).toBe('commands');
    });
  });

  it('does not mix up features running in parallel', async () => {
    const seen: string[] = [];
    const run = (feature: 'sidebar' | 'reviews' | 'details', delay: number) =>
      withFeature(feature, async () => {
        await tick(delay);
        seen.push(`${feature}:${currentFeature()}`);
        await tick(delay);
        seen.push(`${feature}:${currentFeature()}`);
      });
    await Promise.all([run('sidebar', 5), run('reviews', 2), run('details', 3)]);
    expect(seen.filter((s) => s.startsWith('sidebar')).every((s) => s === 'sidebar:sidebar')).toBe(true);
    expect(seen.filter((s) => s.startsWith('reviews')).every((s) => s === 'reviews:reviews')).toBe(true);
    expect(seen.filter((s) => s.startsWith('details')).every((s) => s === 'details:details')).toBe(true);
    expect(seen).toHaveLength(6);
  });
});
