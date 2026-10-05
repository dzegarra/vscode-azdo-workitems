import * as vscode from 'vscode';

/**
 * Subset of the API exposed by the built-in "vscode.git" extension.
 * Full definition: https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
 */
export interface Ref {
  readonly type: number;
  readonly name?: string;
  readonly commit?: string;
  readonly remote?: string;
}

export interface UpstreamRef {
  readonly remote: string;
  readonly name: string;
}

export interface Branch extends Ref {
  readonly upstream?: UpstreamRef;
  readonly ahead?: number;
  readonly behind?: number;
}

export interface Remote {
  readonly name: string;
  readonly fetchUrl?: string;
  readonly pushUrl?: string;
}

export interface Change {
  readonly uri: vscode.Uri;
}

export interface Commit {
  readonly hash: string;
  readonly message: string;
}

export interface RepositoryState {
  readonly HEAD: Branch | undefined;
  readonly remotes: Remote[];
  readonly workingTreeChanges: Change[];
  readonly indexChanges: Change[];
  readonly onDidChange: vscode.Event<void>;
}

export interface Repository {
  readonly rootUri: vscode.Uri;
  readonly state: RepositoryState;
  getBranches(query: { remote?: boolean; pattern?: string }): Promise<Ref[]>;
  getBranch(name: string): Promise<Branch>;
  createBranch(name: string, checkout: boolean, ref?: string): Promise<void>;
  checkout(treeish: string): Promise<void>;
  fetch(remote?: string, ref?: string): Promise<void>;
  push(remoteName?: string, branchName?: string, setUpstream?: boolean): Promise<void>;
  log(options?: { maxEntries?: number; range?: string }): Promise<Commit[]>;
}

export interface GitAPI {
  readonly repositories: Repository[];
  readonly onDidOpenRepository: vscode.Event<Repository>;
  getRepository(uri: vscode.Uri): Repository | null;
}

interface GitExtension {
  getAPI(version: 1): GitAPI;
}

export const REF_TYPE_HEAD = 0;

export async function getGitApi(): Promise<GitAPI> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) {
    throw new Error('The built-in Git extension is not available.');
  }
  const exports = extension.isActive ? extension.exports : await extension.activate();
  return exports.getAPI(1);
}

/** Repository of the active editor, or the first repository of the workspace */
export function pickRepository(git: GitAPI): Repository {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const repository = (activeUri && git.getRepository(activeUri)) || git.repositories.at(0);
  if (!repository) {
    throw new Error('No Git repository is open in this workspace.');
  }
  return repository;
}
