/**
 * Is the base branch (develop) broken? From the runs of its pipelines: which ones are red, since when, which build
 * broke them, and the texts of the alarm (status bar item, modal, sidebar banner, Summary row). No "vscode" import
 */
import {
  BuildRun,
  formatDuration,
  isActive,
  mergedPullRequestId,
  RunModel,
  runState,
  RunState,
  toRunModel,
} from './pipelines';
import { hasFailedTests, runLabel, testsUrl } from './runDetails';

/** A pipeline whose last run on the base branch has no run for this long no longer runs there: it is ignored */
export const STALE_PIPELINE_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The build that broke a pipeline: the first failure after its last green run */
export interface BreakingBuild {
  buildId: number;
  url: string;
  finishTime?: string;
  /** "Merged PR 13837: …" in its trigger message; undefined for a direct push, a schedule, a manual run */
  pullRequestId?: number;
  /** The commit message (the PR title after "Merged PR n: ") */
  message?: string;
  /** Whoever completed the PR (or queued the run), not necessarily the author */
  requestedFor?: string;
  /** What queued the run: "schedule", "manual", "individualCI"… */
  reason?: string;
}

export interface BrokenPipeline {
  definitionId: number;
  pipeline: string;
  /** Its last finished run that was not canceled: failed or partially succeeded */
  run: RunModel;
  brokenBy: BreakingBuild;
  /** A newer run is queued or running: maybe the fix */
  fixRunning: boolean;
}

export interface BaseBranchHealth {
  /** E.g. "develop" */
  branch: string;
  /** Sorted by pipeline name; empty: the branch is green (or has no run) */
  broken: BrokenPipeline[];
}

const MERGED_PREFIX = /^Merged PR \d+:\s*/;

function breakingBuild(build: BuildRun): BreakingBuild {
  const message = build.triggerInfo?.['ci.message']?.split('\n')[0]?.replace(MERGED_PREFIX, '').trim();
  return {
    buildId: build.id,
    url: build.webUrl,
    finishTime: build.finishTime,
    pullRequestId: mergedPullRequestId(build),
    message: message || undefined,
    requestedFor: build.requestedFor?.displayName,
    reason: build.reason,
  };
}

const isRed = (state: RunState) => state === 'failed' || state === 'partial';

/**
 * The state of a build, where a build that is running again (a re-run of its failed jobs keeps its id) keeps the
 * finished state it had at the previous fetch: a re-run neither clears the alarm nor moves its culprit
 */
function stateWith(previous: ReadonlyMap<number, RunState>): (build: BuildRun) => RunState {
  return (build) => {
    const state = runState(build);
    return isActive(state) ? previous.get(build.id) ?? state : state;
  };
}

/** The pipeline is broken when its last finished, not canceled run is red; undefined otherwise */
function brokenPipeline(
  builds: BuildRun[],
  previous: ReadonlyMap<number, RunState>,
  now: Date
): BrokenPipeline | undefined {
  const stateOf = stateWith(previous);
  // Newest first
  const sorted = [...builds].sort((a, b) => (b.queueTime ?? '').localeCompare(a.queueTime ?? ''));
  const newest = sorted.at(0);
  // Rule BASE-CI-3
  const newestTime = Date.parse(newest?.finishTime ?? newest?.queueTime ?? '');
  if (!newest || !(now.getTime() - newestTime < STALE_PIPELINE_DAYS * MS_PER_DAY)) {
    return undefined;
  }
  // Rule BASE-CI-1: running runs do not clear the alarm (re-runs keep their last state), canceled ones are skipped
  const finished = sorted.filter((build) => {
    const state = stateOf(build);
    return !isActive(state) && state !== 'canceled';
  });
  const latest = finished.at(0);
  if (!latest || !isRed(stateOf(latest))) {
    return undefined;
  }
  // Rule BASE-CI-2: the first failure of the red streak broke it (the oldest one known when no green run is in reach)
  const green = finished.findIndex((build) => stateOf(build) === 'succeeded');
  const streak = green === -1 ? finished : finished.slice(0, green);
  const breaker = streak.at(-1) ?? latest;
  return {
    definitionId: latest.definition.id,
    pipeline: latest.definition.name,
    run: { ...toRunModel(latest), state: stateOf(latest) },
    brokenBy: breakingBuild(breaker),
    fixRunning: sorted.some(
      (build) =>
        isActive(runState(build)) && (build.id === latest.id || (build.queueTime ?? '') > (latest.queueTime ?? ''))
    ),
  };
}

/** The finished state of each build, kept for the builds running again (re-runs), for the next fetch */
export function finishedStates(builds: BuildRun[], previous: ReadonlyMap<number, RunState>): Map<number, RunState> {
  const stateOf = stateWith(previous);
  return new Map(
    builds.flatMap((build) => {
      const state = stateOf(build);
      return isActive(state) ? [] : [[build.id, state] as const];
    })
  );
}

// Rules BASE-CI-1..4
/**
 * The pipelines broken on the branch, from its recent runs (any reason: merges, pushes, schedules, manual runs).
 * `previous`: the finished states of the previous fetch (finishedStates), for the re-runs
 */
export function baseBranchHealth(
  builds: BuildRun[],
  branch: string,
  ignoredPipelines: string[],
  now: Date,
  previous: ReadonlyMap<number, RunState> = new Map()
): BaseBranchHealth {
  const ref = `refs/heads/${branch}`;
  // Rule BASE-CI-4
  const ignored = new Set(ignoredPipelines.map((name) => name.trim().toLowerCase()));
  const byDefinition = new Map<number, BuildRun[]>();
  for (const build of builds) {
    if (build.sourceBranch === ref && !ignored.has(build.definition.name.toLowerCase())) {
      byDefinition.set(build.definition.id, [...(byDefinition.get(build.definition.id) ?? []), build]);
    }
  }
  const broken = [...byDefinition.values()]
    .map((definitionBuilds) => brokenPipeline(definitionBuilds, previous, now))
    .filter((pipeline): pipeline is BrokenPipeline => !!pipeline)
    .sort((a, b) => a.pipeline.localeCompare(b.pipeline));
  return { branch, broken };
}

/** A finished run of a pipeline on the base branch, for the history strip of the Sprint timeline */
export interface BaseBranchRun {
  buildId: number;
  definitionId: number;
  pipeline: string;
  red: boolean;
  finishTime: string;
  /** "Merged PR 13837: …" in its trigger message */
  pullRequestId?: number;
}

// Rule TIMELINE-12
/** The finished, not canceled runs on the branch (the pipelines not ignored), oldest first */
export function baseBranchRuns(
  builds: BuildRun[],
  branch: string,
  ignoredPipelines: string[],
  previous: ReadonlyMap<number, RunState> = new Map()
): BaseBranchRun[] {
  const ignored = new Set(ignoredPipelines.map((name) => name.trim().toLowerCase()));
  const stateOf = stateWith(previous);
  return builds
    .flatMap((build): BaseBranchRun[] => {
      const state = stateOf(build);
      if (
        build.sourceBranch !== `refs/heads/${branch}` ||
        ignored.has(build.definition.name.toLowerCase()) ||
        isActive(state) ||
        state === 'canceled' ||
        !build.finishTime
      ) {
        return [];
      }
      return [
        {
          buildId: build.id,
          definitionId: build.definition.id,
          pipeline: build.definition.name,
          red: isRed(state),
          finishTime: build.finishTime,
          pullRequestId: mergedPullRequestId(build),
        },
      ];
    })
    .sort((a, b) => a.finishTime.localeCompare(b.finishTime));
}

/** One incident per pipeline and breaking build: a later failure of the same red streak is the same incident */
export function incidentKey(pipeline: Pick<BrokenPipeline, 'brokenBy' | 'definitionId'>): string {
  return `${pipeline.definitionId}:${pipeline.brokenBy.buildId}`;
}

// Rule BASE-CI-6
/** The broken pipelines the user was not told about yet (the modal is shown once per incident) */
export function newIncidents(health: BaseBranchHealth, notified: Iterable<string>): BrokenPipeline[] {
  const known = new Set(notified);
  return health.broken.filter((pipeline) => !known.has(incidentKey(pipeline)));
}

/** How many incident keys are kept: enough for every pipeline of a few weeks of red */
const MAX_NOTIFIED = 50;

/** The notified keys plus the new ones, the newest last, trimmed */
export function rememberIncidents(notified: string[], incidents: BrokenPipeline[]): string[] {
  const keys = incidents.map(incidentKey);
  return [...notified.filter((key) => !keys.includes(key)), ...keys].slice(-MAX_NOTIFIED);
}

/** When the branch broke: the earliest breaking build; undefined when not known */
export function brokenSince(health: BaseBranchHealth): string | undefined {
  return health.broken
    .map((pipeline) => pipeline.brokenBy.finishTime)
    .filter((time): time is string => !!time)
    .sort()
    .at(0);
}

/** "PR 13837" when one merge broke every pipeline */
function singleCulprit(health: BaseBranchHealth): number | undefined {
  const ids = new Set(health.broken.map((pipeline) => pipeline.brokenBy.pullRequestId));
  const [only] = ids;
  return ids.size === 1 ? only : undefined;
}

// Rule BASE-CI-5
/** Text of the status bar item: "$(flame) develop broken · PR 13837 · 12m", spinning while a new run is going */
export function baseBranchStatusText(health: BaseBranchHealth, now: Date): string {
  const since = brokenSince(health);
  const culprit = singleCulprit(health);
  return [
    `$(flame) ${health.branch} broken`,
    culprit === undefined ? undefined : `PR ${culprit}`,
    since ? formatDuration(now.getTime() - Date.parse(since)) : undefined,
    health.broken.some((pipeline) => pipeline.fixRunning) ? '$(sync~spin)' : undefined,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Merged PR 13837: Fix the login (completed by Ana)", "Direct push: Bump version", "Run 4567" */
export function breakingBuildText(brokenBy: BreakingBuild): string {
  const by = brokenBy.requestedFor ? ` (completed by ${brokenBy.requestedFor})` : '';
  if (brokenBy.pullRequestId !== undefined) {
    return `PR ${brokenBy.pullRequestId}${brokenBy.message ? `: ${brokenBy.message}` : ''}${by}`;
  }
  return brokenBy.message ? `Push: ${brokenBy.message}` : `Run ${brokenBy.buildId}`;
}

/** "Linting failed" / "User-Interface: 3 tests failed" */
export function brokenPipelineText(pipeline: BrokenPipeline, now: Date): string {
  const label = runLabel(pipeline.run, now).text;
  return `${pipeline.pipeline}: ${label}${pipeline.fixRunning ? ' · a new run is going' : ''}`;
}

export interface BaseBranchModal {
  message: string;
  detail: string;
  /** The breaking PR, when one merge broke every new incident */
  pullRequestId?: number;
  /** The user's own merge broke it: the modal is blunt (Rule BASE-CI-7) */
  mine: boolean;
}

/** "3 tests failed in network-restart.spec.ts" / "Failed at Build": what failed, with the test files when known */
function failureWithFiles(pipeline: BrokenPipeline, now: Date): string {
  const label = runLabel(pipeline.run, now).text;
  const files = [...new Set((pipeline.run.tests?.failedTests ?? []).map((test) => test.file).filter(Boolean))];
  return hasFailedTests(pipeline.run) && files.length ? `${label} in ${files.slice(0, 2).join(', ')}` : label;
}

// Rule BASE-CI-7
/** The modal of new incidents: blunt about the PR when it is the user's own */
export function baseBranchModal(
  branch: string,
  incidents: BrokenPipeline[],
  isMine: (pullRequestId: number) => boolean,
  now: Date
): BaseBranchModal {
  const culprit = singleCulprit({ branch, broken: incidents });
  const mine = culprit !== undefined && isMine(culprit);
  const message = mine
    ? `🔥 Your merge broke ${branch}`
    : `🔥 ${branch} is broken. It must be fixed as soon as possible.`;
  const detail = incidents
    .map((pipeline) =>
      mine
        ? `${pipeline.pipeline} failed after ${breakingBuildText(pipeline.brokenBy)}: ${failureWithFiles(
            pipeline,
            now
          )}.`
        : `❌ ${brokenPipelineText(pipeline, now)}\nBroken by ${breakingBuildText(pipeline.brokenBy)}`
    )
    .join('\n\n');
  return { message, detail, pullRequestId: culprit, mine };
}

/** The buttons of the banner and of the modal; what each does is decided by baseBranchTarget */
export type BannerAction = 'acknowledge' | 'openPullRequest' | 'openRun' | 'showTests' | 'showWhatBrokeIt';

export interface BannerButton {
  action: BannerAction;
  label: string;
  /** The pipeline the button is about (open its run, show its tests) */
  definitionId?: number;
}

/** Which of the four banners of the design */
export type BannerVariant = 'mine' | 'noPr' | 'other' | 'several';

export interface BannerLine {
  definitionId: number;
  /** "UI-CI · 3 tests failed" */
  failure: string;
  /** When this pipeline broke (ISO), for "since Fri 14:52" */
  since?: string;
  /** A newer run is going: maybe the fix */
  newRun: boolean;
  /** "Broken by PR 13901 Network restart button" / `First failed run: scheduled, commit "Bump eslint"` */
  brokenBy: string;
  /** Whoever completed the PR or queued the run */
  by?: string;
  /** The user's own PR broke this pipeline: shown as "you" */
  mine: boolean;
}

/** The red banner at the top of the sidebar */
export interface BaseBranchBanner {
  variant: BannerVariant;
  /** "Your merge broke develop" / "develop is broken" */
  title: string;
  /** When it broke (ISO), for the elapsed time */
  since?: string;
  /** One per broken pipeline: what failed, then what broke it */
  lines: BannerLine[];
  /** A line under the lines ("Avoid merging into develop until it is green.") */
  note?: string;
  buttons: BannerButton[];
  /** The user said "I'm on it" for every broken pipeline (kept locally): the banner shrinks */
  acknowledged: boolean;
}

/** "scheduled", "manual", "push"… for "First failed run: scheduled" */
function reasonWord(reason: string | undefined): string {
  const words: Record<string, string> = {
    schedule: 'scheduled',
    manual: 'manual',
    individualCI: 'push',
    batchedCI: 'push',
  };
  return (reason && words[reason]) || 'run';
}

/** Who/what broke the pipeline, split in the text and the person (the webview writes "you" for the user) */
function bannerBrokenBy(
  pipeline: BrokenPipeline,
  mine: boolean,
  withTitle: boolean
): Pick<BannerLine, 'brokenBy' | 'by'> {
  const { brokenBy } = pipeline;
  const by = brokenBy.requestedFor;
  if (brokenBy.pullRequestId === undefined) {
    const commit = brokenBy.message ? `, commit "${brokenBy.message}"` : '';
    return { brokenBy: `First failed run: ${reasonWord(brokenBy.reason)}${commit}`, by };
  }
  const title = withTitle && brokenBy.message ? ` ${brokenBy.message}` : '';
  return { brokenBy: `Broken by PR ${brokenBy.pullRequestId}${title}`, by: mine ? undefined : by };
}

/** One culprit for every pipeline: the PR, or the build when there is no PR */
function sharedCulprit(health: BaseBranchHealth): boolean {
  return new Set(health.broken.map(({ brokenBy }) => brokenBy.pullRequestId ?? `build ${brokenBy.buildId}`)).size === 1;
}

// Rule BASE-CI-10
/** The buttons of each variant, in the order of the design */
function bannerButtons(variant: BannerVariant, health: BaseBranchHealth): BannerButton[] {
  const [first] = health.broken;
  const withTests = health.broken.find((pipeline) => hasFailedTests(pipeline.run));
  const tests: BannerButton[] = withTests
    ? [{ action: 'showTests', label: 'Failed tests', definitionId: withTests.definitionId }]
    : [];
  const run: BannerButton = { action: 'openRun', label: 'Open run', definitionId: first.definitionId };
  const onIt: BannerButton = { action: 'acknowledge', label: "I'm on it" };
  switch (variant) {
    case 'mine':
      return [onIt, ...tests, run];
    case 'other':
      return [{ action: 'openPullRequest', label: 'Open PR', definitionId: first.definitionId }, ...tests, onIt];
    case 'several':
      return [{ action: 'showWhatBrokeIt', label: 'Show what broke it' }, onIt];
    case 'noPr':
      return [run, onIt];
  }
}

export interface BannerContext {
  /** Whether a PR is one of the user's own (the watcher of My Pull Requests) */
  isMine: (pullRequestId: number) => boolean;
  /** Incident keys the user answered with "I'm on it" */
  acknowledged: ReadonlySet<string>;
}

// Rules BASE-CI-8, BASE-CI-10, BASE-CI-11
/** The banner of the sidebar; undefined while the branch is green */
export function baseBranchBanner(
  health: BaseBranchHealth | undefined,
  now: Date,
  context: BannerContext = { isMine: () => false, acknowledged: new Set() }
): BaseBranchBanner | undefined {
  if (!health?.broken.length) {
    return undefined;
  }
  const shared = sharedCulprit(health);
  const [first] = health.broken;
  const mineOf = (pipeline: BrokenPipeline) =>
    pipeline.brokenBy.pullRequestId !== undefined && context.isMine(pipeline.brokenBy.pullRequestId);
  let variant: BannerVariant = 'several';
  if (shared) {
    if (first.brokenBy.pullRequestId === undefined) {
      variant = 'noPr';
    } else {
      variant = mineOf(first) ? 'mine' : 'other';
    }
  }
  return {
    variant,
    title: variant === 'mine' ? `Your merge broke ${health.branch}` : `${health.branch} is broken`,
    since: brokenSince(health),
    lines: health.broken.map((pipeline) => {
      const mine = mineOf(pipeline);
      return {
        definitionId: pipeline.definitionId,
        failure: `${pipeline.pipeline} · ${runLabel(pipeline.run, now).text}`,
        since: pipeline.brokenBy.finishTime,
        newRun: pipeline.fixRunning,
        mine,
        ...bannerBrokenBy(pipeline, mine, variant !== 'several'),
      };
    }),
    note: variant === 'other' ? `Avoid merging into ${health.branch} until it is green.` : undefined,
    buttons: bannerButtons(variant, health),
    acknowledged: health.broken.every((pipeline) => context.acknowledged.has(incidentKey(pipeline))),
  };
}

export interface BaseBranchTarget {
  /** Opens this URL in the browser */
  url?: string;
  /** Opens this PR of the repository (its URL depends on the repository) */
  pullRequestId?: number;
}

/** What a button of the banner opens; undefined when there is nothing to open (the caller does something else) */
export function baseBranchTarget(
  health: BaseBranchHealth | undefined,
  action: BannerAction,
  definitionId: number | undefined
): BaseBranchTarget | undefined {
  const pipeline = health?.broken.find((item) => item.definitionId === definitionId) ?? health?.broken.at(0);
  if (!pipeline) {
    return undefined;
  }
  switch (action) {
    case 'openRun':
      return { url: pipeline.run.url };
    case 'showTests':
      return { url: hasFailedTests(pipeline.run) ? testsUrl(pipeline.run.url) : pipeline.run.url };
    case 'openPullRequest':
      return pipeline.brokenBy.pullRequestId === undefined
        ? { url: pipeline.brokenBy.url }
        : { pullRequestId: pipeline.brokenBy.pullRequestId };
    case 'acknowledge':
    case 'showWhatBrokeIt':
      return undefined;
  }
}
