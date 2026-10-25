import { describe, expect, it } from 'vitest';
import { mapLimit } from './concurrency';

describe('mapLimit', () => {
  it('never runs more than the limit at once and keeps the order', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit(
      Array.from({ length: 20 }, (_, index) => index),
      6,
      async (n) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running -= 1;
        return n * 2;
      }
    );
    expect(peak).toBe(6);
    expect(results.map((result) => (result.status === 'fulfilled' ? result.value : -1))).toEqual(
      Array.from({ length: 20 }, (_, index) => index * 2)
    );
  });

  it('reports a failure without stopping the others', async () => {
    const results = await mapLimit([1, 2, 3], 2, (n) =>
      n === 2 ? Promise.reject(new Error('no')) : Promise.resolve(n)
    );
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('does nothing for an empty list', async () => {
    expect(await mapLimit([], 6, () => Promise.resolve(1))).toEqual([]);
  });
});
