import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { BuildNotesOptions, DEFAULT_BUILD_NOTES_OPTIONS, normalizeRepoPath } from './buildNotes';
import { CoverageThresholds, normalizeThresholds } from './coverage';
import { Repository } from './git';
import { parseAzdoRemote } from './repoContext';
import { parseCheckoutMode } from './worktrees';
import { DEFAULT_COMPLETED_STATES } from './predecessors';
import { DEFAULT_STATE_ORDER } from './states';
import { parseWorkingDays } from './workingTime';
import { parsePeople, type PickedPerson } from './teamPeople';
import { normalizePopoverDelay } from './popoverDelay';
import { normalizeHoverStyle } from './hoverStyle';
import { normalizeCodingStart } from './codingStart';
import { normalizeLook } from './look';
import { normalizeTaskCountStyle } from './taskCountStyle';
import { normalizeWorkingOnAnimation } from './workingOn';

export const SECTION = 'totalflowx';

/** Recognizes the PR task by its title: "PR", "Create PR", "Pull Request review"… */
export const DEFAULT_PULL_REQUEST_TASK_PATTERN = /\b(PR|pull request)\b/i;

/** Compiles the pattern of the PR tasks; the default one when the setting is not a valid regular expression */
export function compilePullRequestTaskPattern(source: string): RegExp {
  try {
    return new RegExp(source, 'i');
  } catch {
    return DEFAULT_PULL_REQUEST_TASK_PATTERN;
  }
}

/** The Completed chip of the Track board and of the Sprint timeline (Rule BOARD-25): the setting is the user's, for both */
export async function setShowCompleted(show: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION)
    .update('appearance.showCompleted', show, vscode.ConfigurationTarget.Global);
}

/** Rule TEAM-1: the people of the Whole team view are saved in the user's settings (the picker writes them) */
export async function setTeamPeople(people: readonly PickedPerson[]): Promise<void> {
  await vscode.workspace
    .getConfiguration(SECTION)
    .update('teamView.people', [...people], vscode.ConfigurationTarget.Global);
}

export function settings() {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    organization: config.get<string>('organization', ''),
    project: config.get<string>('project', ''),
    repository: config.get<string>('repository', ''),
    teams: config.get<string[]>('teams', []),
    /** Rule TEAM-1: invalid entries are ignored */
    teamPeople: parsePeople(config.get<unknown>('teamView.people', [])),
    remote: config.get<string>('remote', 'origin'),
    baseBranch: config.get<string>('branches.baseBranch', 'develop'),
    checkoutMode: parseCheckoutMode(config.get<string>('checkout.mode', 'ask')),
    branchTypeByWorkItemType: config.get<Partial<Record<string, string>>>('branches.typeByWorkItemType', {}),
    branchModules: config.get<string[]>('branches.modules', []),
    prFeatureNames: config.get<string[]>('pullRequests.featureNames', []),
    moduleToFeature: config.get<Partial<Record<string, string>>>('pullRequests.featureByModule', {}),
    linkBranchToWorkItem: config.get<boolean>('branches.linkToWorkItem', true),
    /** Rule TASK-PR-8: the tasks of the user's published PRs move to In Progress by themselves */
    startPullRequestTasks: config.get<boolean>('pullRequestTasks.startWhenPublished', true),
    stateOnBranchCreated: config.get<Partial<Record<string, string>>>('branches.workItemStateOnCreate', {}),
    stateOrder: config.get<string[]>('workItems.stateOrder', DEFAULT_STATE_ORDER),
    showInReviewState: config.get<boolean>('workItems.showInReviewState', true),
    /** Hours back to look for the manual and post-merge runs (Rules STATUSBAR-CI-6, STATUSBAR-CI-8); 0: off */
    branchRunsHours: Math.max(0, config.get<number>('pipelines.branchRunsHours', 24)),
    /** Rules BASE-CI-*: the alarm when the CI of the base branch is red */
    baseBranchAlert: {
      enabled: config.get<boolean>('pipelines.baseBranchAlert', true),
      ignoredPipelines: config.get<string[]>('pipelines.baseBranchIgnoredPipelines', []),
    },
    dependencies: {
      completedStates: config.get<string[]>('dependencies.completedStates', DEFAULT_COMPLETED_STATES),
    },
    integrationBuild: {
      field: config.get<string>('integrationBuild.field', 'Integrated in Build'),
      workItemTypes: config.get<string[]>('integrationBuild.workItemTypes', ['Bug']),
      states: config.get<string[]>('integrationBuild.states', ['Ready to Test']),
      feed: config.get<string>('integrationBuild.feed', 'bison_deployimage_rmc'),
      packageName: config.get<string>('integrationBuild.package', 'rmc.image.deploy'),
      protocolType: config.get<string>('integrationBuild.protocolType', 'UPack'),
      suffix: config.get<string>('integrationBuild.suffix', '+'),
    },
    hoverStyle: normalizeHoverStyle(config.get<string>('appearance.hoverStyle', 'border')),
    look: normalizeLook(config.get<string>('appearance.look', 'theme')),
    /** Rule BOARD-25: the finished work items and the merged PRs on the Track board and the Sprint timeline */
    showCompleted: config.get<boolean>('appearance.showCompleted', true),
    asleepPulse: config.get<boolean>('appearance.asleepPulse', true),
    /** Rule TIMELINE-20: where coding starts on the Sprint timeline */
    timelineCodingStart: normalizeCodingStart(config.get<string>('appearance.timelineCodingStart', 'earliest')),
    popoverDelay: normalizePopoverDelay(config.get<unknown>('popovers.hoverDelay')),
    tasksCountStyle: normalizeTaskCountStyle(config.get<string>('tasks.countStyle', 'filled')),
    workingOn: {
      showWorktrees: config.get<boolean>('workingOn.showWorktrees', true),
      includeLinkedWorkItems: config.get<boolean>('workingOn.includeLinkedWorkItems', true),
      ignoreFilters: config.get<boolean>('workingOn.ignoreFilters', true),
      animation: normalizeWorkingOnAnimation(config.get<string>('workingOn.animation', 'none')),
      pulseBadge: config.get<boolean>('workingOn.pulseBadge', true),
    },
    alerts: {
      enabled: config.get<boolean>('alerts.enabled', true),
      workItemTypes: config.get<string[]>('alerts.workItemTypes', ['Product Backlog Item', 'Bug']),
      blockingTags: config.get<string[]>('alerts.blockingTags', []),
      pullRequestTaskPattern: config.get<string>(
        'alerts.pullRequestTaskPattern',
        DEFAULT_PULL_REQUEST_TASK_PATTERN.source
      ),
      requiredFields: config.get<{ types: string[]; states?: string[]; fields: string[] }[]>(
        'alerts.requiredFields',
        []
      ),
      titlePrefixes: config.get<string[]>('alerts.titlePrefixes', []),
      effortScale: config.get<number[]>('alerts.effortScale', []),
      stretchTitlePrefix: config.get<string>('alerts.stretchTitlePrefix', ''),
      stretchTags: config.get<string[]>('alerts.stretchTags', []),
      staleAfterWorkingDays: Math.max(0, config.get<number>('alerts.staleAfterWorkingDays', 1)),
    },
  };
}

/** Team rule about the notes for testers. Blank settings fall back to the defaults */
export function buildNotesSettings(): BuildNotesOptions {
  const config = vscode.workspace.getConfiguration(`${SECTION}.buildNotes`);
  return {
    enabled: config.get<boolean>('enabled', DEFAULT_BUILD_NOTES_OPTIONS.enabled),
    directory: normalizeRepoPath(config.get<string>('directory', '')) || DEFAULT_BUILD_NOTES_OPTIONS.directory,
    fileSuffix: config.get<string>('fileSuffix', '').trim() || DEFAULT_BUILD_NOTES_OPTIONS.fileSuffix,
    skipTag: config.get<string>('skipTag', '').trim() || DEFAULT_BUILD_NOTES_OPTIONS.skipTag,
  };
}

/** Weekdays whose time counts as waiting time of pull requests (setting totalflowx.reviews.workingDays) */
export function workingDaysSetting(): number[] {
  return parseWorkingDays(vscode.workspace.getConfiguration(`${SECTION}.reviews`).get<string[]>('workingDays'));
}

/** totalflowx.fun.enabled: celebrations, green streak, clean board row, sprint countdown, recap offer. Off by default */
export function funEnabled(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>('fun.enabled', false);
}

/** totalflowx.fun.sounds: short sounds with the celebrations; only with totalflowx.fun.enabled. Off by default */
export function funSoundsEnabled(): boolean {
  const config = vscode.workspace.getConfiguration(SECTION);
  return config.get<boolean>('fun.enabled', false) && config.get<boolean>('fun.sounds', false);
}

/** totalflowx.worktrees.*: tracking of the leftover worktrees (Rules WORKTREE-STALE-*, WORKTREE-IDLE-*, WORKTREE-NUDGE-1) */
export function worktreeSettings(): { idleDays: number; notifyWhenStale: boolean; showInSummary: boolean } {
  const config = vscode.workspace.getConfiguration(`${SECTION}.worktrees`);
  return {
    idleDays: Math.max(0, Math.floor(config.get<number>('idleDays', 14))),
    notifyWhenStale: config.get<boolean>('notifyWhenStale', true),
    showInSummary: config.get<boolean>('showInSummary', true),
  };
}

/** totalflowx.pipelines.baseBranchAlarmSound: the alarm sound when the base branch breaks. Not a fun feature: on by default */
export function baseBranchAlarmSoundEnabled(): boolean {
  return vscode.workspace.getConfiguration(SECTION).get<boolean>('pipelines.baseBranchAlarmSound', true);
}

/** Coverage levels: below `minimum` is low, from `target` is good, from `excellent` is excellent */
export function coverageThresholds(): CoverageThresholds {
  const config = vscode.workspace.getConfiguration(`${SECTION}.coverage`);
  return normalizeThresholds({
    minimum: config.get<number>('minimum'),
    target: config.get<number>('target'),
    excellent: config.get<number>('excellent'),
  });
}

export interface AzdoContext {
  client: AzdoClient;
  repositoryName: string;
}

/** Resolves organization / project / repository from the settings, falling back to the git remote */
export function resolveContext(repository: Repository | undefined): AzdoContext {
  const s = settings();
  const remote = repository?.state.remotes.find((r) => r.name === s.remote);
  const detected = parseAzdoRemote(remote?.fetchUrl ?? remote?.pushUrl ?? '');
  const organization = s.organization || detected?.organization;
  const project = s.project || detected?.project;
  const repositoryName = s.repository || detected?.repository;
  if (!organization || !project || !repositoryName) {
    throw new Error(
      `Unable to detect the Azure DevOps repository from the '${s.remote}' remote. Set "${SECTION}.organization", "${SECTION}.project" and "${SECTION}.repository".`
    );
  }
  return {
    client: new AzdoClient(organization, project),
    repositoryName,
  };
}

/** Organization and project the personal records belong to; undefined when they cannot be told */
export function recordsScope(repository: Repository | undefined): string | undefined {
  try {
    const { client } = resolveContext(repository);
    return `${client.organization}/${client.project}`;
  } catch {
    return undefined;
  }
}
