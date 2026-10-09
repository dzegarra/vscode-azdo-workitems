import { describe, expect, it } from 'vitest';
import { Feature } from './requestContext';
import { NETWORK_ERROR, RequestRecord, RequestStats, RequestStatus } from './requestStats';

const MIN = 60_000;
const T0 = Date.UTC(2026, 0, 1, 10, 0, 0);

function setup() {
  let now = T0;
  const stats = new RequestStats(() => now);
  const add = (feature: Feature, status: RequestStatus = 200, extra: Partial<RequestRecord> = {}) =>
    stats.record({
      time: now,
      method: 'GET',
      url: 'dev.azure.com/…/_apis/x',
      status,
      durationMs: 10,
      feature,
      ...extra,
    });
  return { stats, add, advance: (ms: number) => (now += ms) };
}

describe('RequestStats', () => {
  it('counts per feature since the start and in the last hour', () => {
    const { stats, add, advance } = setup();
    add('sidebar');
    add('sidebar');
    add('ci', 500);
    advance(61 * MIN);
    add('sidebar');
    const s = stats.snapshot();
    expect(s.total.sidebar).toEqual({ requests: 3, errors: 0 });
    expect(s.total.ci).toEqual({ requests: 1, errors: 1 });
    expect(s.lastHour.sidebar.requests).toBe(1);
    expect(s.lastHour.ci.requests).toBe(0);
  });

  it('rolls the minute buckets over time', () => {
    const { stats, add, advance } = setup();
    add('sidebar');
    advance(MIN);
    add('sidebar');
    add('sidebar');
    let s = stats.snapshot();
    expect(s.perMinute).toHaveLength(60);
    expect(s.perMinute.slice(-2)).toEqual([1, 2]);
    expect(s.perMinute.slice(0, 58).every((n) => n === 0)).toBe(true);
    advance(58 * MIN);
    s = stats.snapshot();
    // The first minute is still inside the hour, the second one too
    expect(s.perMinute.slice(0, 2)).toEqual([1, 2]);
    advance(MIN);
    expect(stats.snapshot().perMinute[0]).toBe(2);
    advance(MIN);
    expect(stats.snapshot().perMinute.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('reuses a bucket after an hour without mixing the old counts', () => {
    const { stats, add, advance } = setup();
    add('sidebar');
    advance(60 * MIN);
    add('ci');
    const s = stats.snapshot();
    expect(s.lastHour.sidebar.requests).toBe(0);
    expect(s.lastHour.ci.requests).toBe(1);
    expect(s.perMinute.at(-1)).toBe(1);
    expect(s.perMinute.slice(0, -1).every((n) => n === 0)).toBe(true);
  });

  it('counts errors by status and keeps the last 10, newest first', () => {
    const { stats, add, advance } = setup();
    for (let i = 0; i < 12; i++) {
      advance(1000);
      add('reviews', i % 2 ? 401 : 404, { url: `u${i}` });
    }
    add('reviews', NETWORK_ERROR);
    add('reviews', 200);
    add('reviews', 302);
    const s = stats.snapshot();
    expect(s.statusCounts).toEqual([
      { status: '404', count: 6 },
      { status: '401', count: 6 },
      { status: NETWORK_ERROR, count: 1 },
    ]);
    expect(s.recentErrors).toHaveLength(10);
    expect(s.recentErrors[0].status).toBe(NETWORK_ERROR);
    expect(s.recentErrors[1].url).toBe('u11');
    expect(s.total.reviews).toEqual({ requests: 15, errors: 13 });
  });

  it('records throttling', () => {
    const { stats, add, advance } = setup();
    expect(stats.snapshot().throttle).toEqual({ count: 0, last: undefined });
    add('commands', 429, { throttle: { 'Retry-After': '5' } });
    advance(1000);
    add('ci', 200, { throttle: { 'X-RateLimit-Remaining': '3' } });
    const { throttle } = stats.snapshot();
    expect(throttle.count).toBe(2);
    expect(throttle.last).toMatchObject({ feature: 'ci', status: 200, headers: { 'X-RateLimit-Remaining': '3' } });
  });
});
