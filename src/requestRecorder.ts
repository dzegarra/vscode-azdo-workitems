import { currentFeature } from './requestContext';
import { formatLogLine, shortenUrl, throttleInfo } from './requestLog';
import { NETWORK_ERROR, RequestStats, RequestStatus } from './requestStats';

/** Counters of this session. Shared by everything that calls Azure DevOps */
export const requestStats = new RequestStats();

let logWriter: ((line: string) => void) | undefined;

/** Turns the log of requests on (a writer) or off (undefined). Off, no line is even built */
export function setRequestLogWriter(writer: ((line: string) => void) | undefined): void {
  logWriter = writer;
}

function record(
  start: number,
  method: string,
  url: string,
  status: RequestStatus,
  headers: { get(name: string): string | null } | undefined
): void {
  const entry = {
    time: start,
    method,
    url: shortenUrl(url),
    status,
    durationMs: Date.now() - start,
    feature: currentFeature(),
    throttle: headers ? throttleInfo(status, headers) : undefined,
  };
  requestStats.record(entry);
  logWriter?.(formatLogLine(entry));
}

/**
 * The only way the extension calls Azure DevOps over HTTP: `fetch` plus a record of the request (never of its
 * headers or body). The duration is the time to get the response headers
 */
export async function recordedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const start = Date.now();
  const method = init.method ?? 'GET';
  try {
    const response = await fetch(url, init);
    record(start, method, url, response.status, response.headers);
    return response;
  } catch (error) {
    record(start, method, url, NETWORK_ERROR, undefined);
    throw error;
  }
}
