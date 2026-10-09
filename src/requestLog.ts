import { FEATURE_LABELS, Feature } from './requestContext';
import { RequestStatus, ThrottleHeaders } from './requestStats';

const MAX_QUERY_LENGTH = 60;
const MAX_PATH_LENGTH = 80;
const PAD = 2;

/** Headers that tell the request was (or is about to be) rate limited */
export const THROTTLE_HEADERS = [
  'Retry-After',
  'X-RateLimit-Resource',
  'X-RateLimit-Delay',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
] as const;

const HTTP_TOO_MANY_REQUESTS = 429;

/** The throttling headers present in a response, undefined when there are none and the status is not 429 */
export function throttleInfo(
  status: RequestStatus,
  headers: { get(name: string): string | null }
): ThrottleHeaders | undefined {
  const found: ThrottleHeaders = {};
  for (const name of THROTTLE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) {
      found[name] = value;
    }
  }
  return status === HTTP_TOO_MANY_REQUESTS || Object.keys(found).length ? found : undefined;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * `https://dev.azure.com/org/project/_apis/git/pullrequests?a=1&api-version=7.1` becomes
 * `dev.azure.com/…/_apis/git/pullrequests?a=1`: no organization, no project, no api-version, a short query
 */
export function shortenUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return truncate(url.split('?')[0], MAX_PATH_LENGTH);
  }
  const apiIndex = parsed.pathname.indexOf('/_apis/');
  const path = apiIndex >= 0 ? `/…${parsed.pathname.slice(apiIndex)}` : `/…/${parsed.pathname.split('/').at(-1)}`;
  const query = [...parsed.searchParams]
    .filter(([key]) => key !== 'api-version')
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return `${parsed.host}${truncate(path, MAX_PATH_LENGTH)}${query ? `?${truncate(query, MAX_QUERY_LENGTH)}` : ''}`;
}

function twoDigits(value: number, width = PAD): string {
  return String(value).padStart(width, '0');
}

/** HH:MM:SS.mmm in local time */
export function formatClock(time: number): string {
  const d = new Date(time);
  return `${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}:${twoDigits(d.getSeconds())}.${twoDigits(
    d.getMilliseconds(),
    3
  )}`;
}

export function formatThrottle(headers: ThrottleHeaders): string {
  const entries = Object.entries(headers);
  return entries.length ? entries.map(([name, value]) => `${name}=${value}`).join(', ') : 'HTTP 429';
}

export interface LogLineInput {
  time: number;
  method: string;
  url: string;
  status: RequestStatus;
  durationMs: number;
  feature: Feature;
  throttle?: ThrottleHeaders;
}

/** `[10:05:03.007] GET 200 143 ms  My Pull Requests  dev.azure.com/…/_apis/git/pullrequests?…` */
export function formatLogLine(r: LogLineInput): string {
  const warning = r.throttle ? ` ⚠ throttled: ${formatThrottle(r.throttle)}` : '';
  return `[${formatClock(r.time)}] ${r.method} ${r.status} ${Math.round(r.durationMs)} ms  ${
    FEATURE_LABELS[r.feature]
  }  ${r.url}${warning}`;
}
