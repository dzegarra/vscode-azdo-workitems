import type { Feature } from './requestContext';
import { FEATURES } from './requestContext';

export const MINUTE_MS = 60_000;
/** Minutes kept: the last hour */
export const WINDOW_MINUTES = 60;
const MAX_RECENT_ERRORS = 10;

/** Status of a request that got no response */
export const NETWORK_ERROR = 'network error';

export type RequestStatus = number | typeof NETWORK_ERROR;

/** Rate limit related headers of a response, by name */
export type ThrottleHeaders = Record<string, string>;

export interface RequestRecord {
  /** Epoch ms of the start of the request */
  time: number;
  method: string;
  /** Already shortened: never the full URL */
  url: string;
  status: RequestStatus;
  durationMs: number;
  feature: Feature;
  throttle?: ThrottleHeaders;
}

export interface FeatureCount {
  requests: number;
  errors: number;
}

export interface ThrottleEvent {
  time: number;
  feature: Feature;
  status: RequestStatus;
  headers: ThrottleHeaders;
}

export interface StatsSnapshot {
  now: number;
  startedAt: number;
  /** Since the extension started */
  total: Record<Feature, FeatureCount>;
  /** Last 60 minutes */
  lastHour: Record<Feature, FeatureCount>;
  /** Requests of each of the last 60 minutes: the last one is the current minute */
  perMinute: number[];
  /** Epoch ms of the start of the minute of `perMinute[0]` */
  firstMinuteStart: number;
  statusCounts: { status: string; count: number }[];
  /** Newest first */
  recentErrors: RequestRecord[];
  throttle: { count: number; last?: ThrottleEvent };
}

interface Bucket {
  /** Minute since the epoch the bucket holds. A different one means the bucket is stale */
  minute: number;
  counts: Record<Feature, FeatureCount>;
}

function emptyCounts(): Record<Feature, FeatureCount> {
  return Object.fromEntries(FEATURES.map((f) => [f, { requests: 0, errors: 0 }])) as Record<Feature, FeatureCount>;
}

/** A request failed when it got no response or a status of 400 or more */
export function isErrorStatus(status: RequestStatus): boolean {
  return status === NETWORK_ERROR || status >= 400;
}

/**
 * Counters of the requests to Azure DevOps. Memory is bounded (60 minute buckets, a few counters, 10 errors) and
 * recording is O(1)
 */
export class RequestStats {
  private readonly startedAt: number;
  private readonly buckets: Bucket[] = Array.from({ length: WINDOW_MINUTES }, () => ({
    minute: -1,
    counts: emptyCounts(),
  }));
  private readonly total = emptyCounts();
  private readonly statuses = new Map<string, number>();
  private errors: RequestRecord[] = [];
  private throttleCount = 0;
  private lastThrottle: ThrottleEvent | undefined;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  record(request: RequestRecord): void {
    const minute = Math.floor(request.time / MINUTE_MS);
    const bucket = this.buckets[minute % WINDOW_MINUTES];
    if (bucket.minute !== minute) {
      bucket.minute = minute;
      bucket.counts = emptyCounts();
    }
    const failed = isErrorStatus(request.status);
    for (const counts of [bucket.counts[request.feature], this.total[request.feature]]) {
      counts.requests++;
      if (failed) {
        counts.errors++;
      }
    }
    if (failed) {
      const key = String(request.status);
      this.statuses.set(key, (this.statuses.get(key) ?? 0) + 1);
      this.errors.unshift(request);
      this.errors.length = Math.min(this.errors.length, MAX_RECENT_ERRORS);
    }
    if (request.throttle) {
      this.throttleCount++;
      this.lastThrottle = {
        time: request.time,
        feature: request.feature,
        status: request.status,
        headers: request.throttle,
      };
    }
  }

  snapshot(): StatsSnapshot {
    const now = this.now();
    const currentMinute = Math.floor(now / MINUTE_MS);
    const lastHour = emptyCounts();
    const perMinute: number[] = [];
    for (let minute = currentMinute - WINDOW_MINUTES + 1; minute <= currentMinute; minute++) {
      const bucket = this.buckets[((minute % WINDOW_MINUTES) + WINDOW_MINUTES) % WINDOW_MINUTES];
      if (bucket.minute !== minute) {
        perMinute.push(0);
        continue;
      }
      let requests = 0;
      for (const feature of FEATURES) {
        lastHour[feature].requests += bucket.counts[feature].requests;
        lastHour[feature].errors += bucket.counts[feature].errors;
        requests += bucket.counts[feature].requests;
      }
      perMinute.push(requests);
    }
    return {
      now,
      startedAt: this.startedAt,
      total: structuredClone(this.total),
      lastHour,
      perMinute,
      firstMinuteStart: (currentMinute - WINDOW_MINUTES + 1) * MINUTE_MS,
      statusCounts: [...this.statuses].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
      recentErrors: [...this.errors],
      throttle: { count: this.throttleCount, last: this.lastThrottle },
    };
  }
}
