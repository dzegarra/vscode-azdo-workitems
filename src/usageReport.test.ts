import { describe, expect, it } from 'vitest';
import { RequestStats } from './requestStats';
import { buildUsageReport } from './usageReport';

const MIN = 60_000;
const T0 = new Date(2026, 0, 1, 10, 0, 0).getTime();

function sample() {
  let now = T0;
  const stats = new RequestStats(() => now);
  const add = (
    feature: Parameters<RequestStats['record']>[0]['feature'],
    status: number | 'network error' = 200,
    throttle?: Record<string, string>
  ) =>
    stats.record({
      time: now,
      method: 'GET',
      url: 'dev.azure.com/…/_apis/git/pullrequests?status=active',
      status,
      durationMs: 50,
      feature,
      throttle,
    });
  return { stats, add, advance: (ms: number) => (now += ms) };
}

describe('buildUsageReport', () => {
  it('reports an idle session', () => {
    const { stats } = sample();
    const md = buildUsageReport(stats.snapshot());
    expect(md).toContain('No requests yet.');
    expect(md).toContain('No errors.');
    expect(md).toContain('No throttling.');
    expect(md).toContain('Busiest minute: none');
  });

  it('lists the features sorted by the last hour', () => {
    const { stats, add, advance } = sample();
    add('sidebar');
    add('sidebar');
    add('sidebar');
    advance(2 * 60 * MIN);
    add('ci');
    add('ci');
    add('reviews', 500);
    const md = buildUsageReport(stats.snapshot());
    const rows = md.split('\n').filter((l) => l.startsWith('| ') && /^\| (Sidebar|CI|Waiting)/.test(l));
    expect(rows).toEqual([
      '| CI runs | 2 | 0 | 2 | 0 |',
      '| Waiting for your review | 1 | 1 | 1 | 1 |',
      '| Sidebar (work items) | 0 | 0 | 3 | 0 |',
    ]);
    expect(md).toContain('| **Total** | **3** | **1** | **6** | **1** |');
  });

  it('reports rates and the busiest minute', () => {
    const { stats, add, advance } = sample();
    for (let i = 0; i < 6; i++) add('ci');
    advance(10 * MIN);
    add('ci');
    advance(MIN);
    add('ci');
    add('ci');
    add('ci');
    const md = buildUsageReport(stats.snapshot());
    expect(md).toContain('Average, last 60 minutes: **0.2**');
    expect(md).toContain('Average, last 5 minutes: **0.8**');
    expect(md).toContain('Busiest minute: **6** at 10:00');
    expect(md).toContain('| 10:11 | 3 | ██████████ |');
  });

  it('reports errors and throttling', () => {
    const { stats, add, advance } = sample();
    add('commands', 401);
    advance(1000);
    add('ci', 'network error');
    add('myPullRequests', 429, { 'Retry-After': '7', 'X-RateLimit-Remaining': '0' });
    const md = buildUsageReport(stats.snapshot());
    expect(md).toContain('| 429 | 1 |');
    expect(md).toContain('| network error | 1 |');
    expect(md).toContain(
      '| 10:00:01.000 | My Pull Requests | 429 | `dev.azure.com/…/_apis/git/pullrequests?status=active` |'
    );
    expect(md).toContain('Throttled responses: **1**');
    expect(md).toContain('`Retry-After=7, X-RateLimit-Remaining=0`');
    expect(md).not.toContain('No throttling.');
  });
});
