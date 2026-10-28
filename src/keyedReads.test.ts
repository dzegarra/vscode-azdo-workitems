import { describe, expect, it, vi } from 'vitest';
import { idsToRead, KeyedReads, RETRY_AFTER_MS } from './keyedReads';

describe('idsToRead', () => {
  const empty = { entries: new Map(), inFlight: new Map(), failed: new Map(), now: 1_000_000 };

  it('reads what is not kept under the wanted key, once per id', () => {
    const entries = new Map([
      [1, { key: '1:5', value: [] }],
      [2, { key: '2:3', value: [] }],
    ]);
    expect(
      idsToRead(
        [
          { id: 1, key: '1:5' },
          { id: 2, key: '2:4' },
          { id: 3, key: '3:1' },
          { id: 3, key: '3:1' },
        ],
        { ...empty, entries }
      )
    ).toEqual([
      { id: 2, key: '2:4' },
      { id: 3, key: '3:1' },
    ]);
  });

  it('does not ask again what is in flight, nor a failure before a while', () => {
    const wanted = [{ id: 1, key: 'a' }];
    expect(idsToRead(wanted, { ...empty, inFlight: new Map([[1, 'a']]) })).toEqual([]);
    const failed = new Map([[1, { key: 'a', at: empty.now - 1000 }]]);
    expect(idsToRead(wanted, { ...empty, failed })).toEqual([]);
    expect(idsToRead(wanted, { ...empty, failed, now: empty.now + RETRY_AFTER_MS })).toEqual(wanted);
    expect(idsToRead([{ id: 1, key: 'b' }], { ...empty, failed })).toEqual([{ id: 1, key: 'b' }]);
  });
});

describe('KeyedReads', () => {
  it('reads once per key, keeps the value and tells when it is done', async () => {
    const read = vi.fn((id: number) => Promise.resolve(id * 10));
    const done = vi.fn();
    const reads = new KeyedReads(read, done);
    expect(reads.request([{ id: 2, key: 'x' }])).toBe(true);
    expect(reads.loading(2)).toBe(true);
    await vi.waitFor(() => {
      expect(done).toHaveBeenCalled();
    });
    expect(reads.get(2)).toBe(20);
    expect(reads.request([{ id: 2, key: 'x' }])).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(reads.snapshot()).toEqual(new Map([[2, 20]]));
  });

  it('keeps a failure from being asked again at once', async () => {
    const done = vi.fn();
    const reads = new KeyedReads<number>(() => Promise.reject(new Error('no')), done);
    reads.request([{ id: 1, key: 'x' }]);
    await vi.waitFor(() => {
      expect(done).toHaveBeenCalled();
    });
    expect(reads.get(1)).toBeUndefined();
    expect(reads.request([{ id: 1, key: 'x' }])).toBe(false);
  });
});
