import { describe, expect, it } from 'vitest';
import { formatLogLine, shortenUrl, throttleInfo } from './requestLog';

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe('shortenUrl', () => {
  it('drops organization, project and api-version', () => {
    expect(
      shortenUrl(
        'https://dev.azure.com/org/My%20Project/_apis/git/pullrequests?searchCriteria.status=active&api-version=7.1'
      )
    ).toBe('dev.azure.com/…/_apis/git/pullrequests?searchCriteria.status=active');
  });

  it('shortens other hosts and long queries', () => {
    expect(
      shortenUrl(
        'https://vstmr.dev.azure.com/org/proj/_apis/testresults/codecoverage?buildId=1&api-version=7.1-preview.1'
      )
    ).toBe('vstmr.dev.azure.com/…/_apis/testresults/codecoverage?buildId=1');
    expect(shortenUrl(`https://dev.azure.com/o/p/_apis/wit/workitems?ids=${'1,'.repeat(100)}`)).toMatch(
      /\?ids=(1,)+…$/
    );
  });

  it('keeps no token-like parts of URLs outside _apis', () => {
    expect(shortenUrl('https://dev.azure.com/org/pic.png?a=b')).toBe('dev.azure.com/…/pic.png?a=b');
  });
});

describe('throttleInfo', () => {
  it('is undefined for a normal response', () => {
    expect(throttleInfo(200, headers({}))).toBeUndefined();
  });

  it('collects the rate limit headers', () => {
    expect(throttleInfo(200, headers({ 'Retry-After': '3', 'X-RateLimit-Limit': '200' }))).toEqual({
      'Retry-After': '3',
      'X-RateLimit-Limit': '200',
    });
  });

  it('flags a 429 even without headers', () => {
    expect(throttleInfo(429, headers({}))).toEqual({});
  });
});

describe('formatLogLine', () => {
  const time = new Date(2026, 0, 1, 9, 5, 3, 7).getTime();
  const base = { time, method: 'GET', url: 'dev.azure.com/…/_apis/git/pullrequests?x=1', durationMs: 142.6 };

  it('formats a normal request', () => {
    expect(formatLogLine({ ...base, status: 200, feature: 'myPullRequests' })).toBe(
      '[09:05:03.007] GET 200 143 ms  My Pull Requests  dev.azure.com/…/_apis/git/pullrequests?x=1'
    );
  });

  it('adds the throttling and shows errors', () => {
    expect(formatLogLine({ ...base, status: 429, feature: 'ci', throttle: { 'Retry-After': '5' } })).toBe(
      '[09:05:03.007] GET 429 143 ms  CI runs  dev.azure.com/…/_apis/git/pullrequests?x=1 ⚠ throttled: Retry-After=5'
    );
    expect(formatLogLine({ ...base, status: 'network error', feature: 'other' })).toContain(
      'GET network error 143 ms  Other'
    );
  });
});
