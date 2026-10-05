import * as vscode from 'vscode';

/** Resource ID of Azure DevOps in Microsoft Entra ID */
const AZURE_DEVOPS_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';

export async function getAccessToken(): Promise<string> {
  const session = await vscode.authentication.getSession('microsoft', [AZURE_DEVOPS_SCOPE], { createIfNone: true });
  return session.accessToken;
}
