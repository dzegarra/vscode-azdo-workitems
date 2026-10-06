import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { Repository } from './git';
import { parseAzdoRemote } from './repoContext';
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
    branchTypeByWorkItemType: config.get<Partial<Record<string, string>>>('branchTypeByWorkItemType', {}),
    branchModules: config.get<string[]>('branchModules', []),
    prFeatureNames: config.get<string[]>('prFeatureNames', []),
    moduleToFeature: config.get<Partial<Record<string, string>>>('moduleToFeature', {}),
    linkBranchToWorkItem: config.get<boolean>('linkBranchToWorkItem', true),
    stateOnBranchCreated: config.get<Partial<Record<string, string>>>('stateOnBranchCreated', {}),
    stateOrder: config.get<string[]>('stateOrder', DEFAULT_STATE_ORDER),
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
