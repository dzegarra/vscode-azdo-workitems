import { AsyncLocalStorage } from 'node:async_hooks';

/** The features of the extension that call Azure DevOps. Each request is attributed to one of them */
export const FEATURES = [
  'sidebar',
  'ci',
  'myPullRequests',
  'reviews',
  'notifications',
  'dependencyMap',
  'trackBoard',
  'sprintTimeline',
  'details',
  'statusBar',
  'commands',
  'other',
] as const;

export type Feature = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<Feature, string> = {
  sidebar: 'Sidebar (work items)',
  ci: 'CI runs',
  myPullRequests: 'My Pull Requests',
  reviews: 'Waiting for your review',
  notifications: 'PR notifications',
  dependencyMap: 'Dependency map',
  trackBoard: 'Track board',
  sprintTimeline: 'Sprint timeline',
  details: 'Work Item Details panel',
  statusBar: 'Status bar',
  commands: 'Commands',
  other: 'Other',
};

const storage = new AsyncLocalStorage<Feature>();

/** Runs `fn` so that every request made by it (also after awaits) is attributed to `feature`. The innermost wins */
export function withFeature<T>(feature: Feature, fn: () => T): T {
  return storage.run(feature, fn);
}

/** Feature the running code belongs to: `other` outside of any `withFeature` */
export function currentFeature(): Feature {
  return storage.getStore() ?? 'other';
}
