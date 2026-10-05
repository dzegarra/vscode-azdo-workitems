import * as vscode from 'vscode';
import { AzdoClient } from './azdoClient';
import { Repository } from './git';
import { parseAzdoRemote } from './repoContext';

export const SECTION = 'azdoWorkItems';

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
