import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { BuildNotesOptions, DEFAULT_BUILD_NOTES_OPTIONS, normalizeRepoPath } from './buildNotes';
import { CoverageThresholds, normalizeThresholds } from './coverage';
import { Repository } from './git';
import { parseAzdoRemote } from './repoContext';
import { parseCheckoutMode } from './worktrees';
import { DEFAULT_COMPLETED_STATES } from './predecessors';
import { DEFAULT_STATE_ORDER } from './states';

export const SECTION = 'azdoWorkItems';

/** Recognizes the PR task by its title: "PR", "Create PR", "Pull Request review"… */
export const DEFAULT_PULL_REQUEST_TASK_PATTERN = /\b(PR|pull request)\b/i;

export function settings() {
  const config = vscode.workspace.getConfiguration(SECTION);
  return {
    organization: config.get<string>('organization', ''),
    project: config.get<string>('project', ''),
    repository: config.get<string>('repository', ''),
    teams: config.get<string[]>('teams', []),
    remote: config.get<string>('remote', 'origin'),
    baseBranch: config.get<string>('baseBranch', 'develop'),
    checkoutMode: parseCheckoutMode(config.get<string>('checkout.mode', 'ask')),
    branchTypeByWorkItemType: config.get<Partial<Record<string, string>>>('branchTypeByWorkItemType', {}),
    branchModules: config.get<string[]>('branchModules', []),
    prFeatureNames: config.get<string[]>('prFeatureNames', []),
    moduleToFeature: config.get<Partial<Record<string, string>>>('moduleToFeature', {}),
    linkBranchToWorkItem: config.get<boolean>('linkBranchToWorkItem', true),
    stateOnBranchCreated: config.get<Partial<Record<string, string>>>('stateOnBranchCreated', {}),
    stateOrder: config.get<string[]>('stateOrder', DEFAULT_STATE_ORDER),
    dependencies: {
      completedStates: config.get<string[]>('dependencies.completedStates', DEFAULT_COMPLETED_STATES),
      confirmBeforeStart: config.get<boolean>('dependencies.confirmBeforeStart', true),
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
    workingOn: {
      showWorktrees: config.get<boolean>('workingOn.showWorktrees', true),
      includeLinkedWorkItems: config.get<boolean>('workingOn.includeLinkedWorkItems', true),
      ignoreFilters: config.get<boolean>('workingOn.ignoreFilters', true),
      section: config.get<boolean>('workingOn.section', true),
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
    },
  };
}

/** Team rule about the notes for testers. Blank settings fall back to the defaults */
export function buildNotesSettings(): BuildNotesOptions {
  const config = vscode.workspace.getConfiguration(`${SECTION}.buildNotes`);
  return {
    enabled: config.get<boolean>('enabled', DEFAULT_BUILD_NOTES_OPTIONS.enabled),
    path: normalizeRepoPath(config.get<string>('path', '')) || DEFAULT_BUILD_NOTES_OPTIONS.path,
    skipTag: config.get<string>('skipTag', '').trim() || DEFAULT_BUILD_NOTES_OPTIONS.skipTag,
  };
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
