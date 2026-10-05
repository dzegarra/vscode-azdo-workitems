export interface AzdoRepoRef {
  organization: string;
  project: string;
  repository: string;
}

const SSH_PATTERN =
  /^(?:ssh:\/\/)?[^@]+@(?:ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com):(?:\d+\/)?v3\/([^/]+)\/([^/]+)\/([^/]+?)\/?$/;
const HTTPS_PATTERN = /^https:\/\/(?:[^@/]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+?)\/?$/;
const LEGACY_HTTPS_PATTERN =
  /^https:\/\/(?:[^@/]+@)?([^.]+)\.visualstudio\.com\/(?:DefaultCollection\/)?([^/]+)\/_git\/([^/]+?)\/?$/;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Extracts organization / project / repository from an Azure DevOps git remote URL */
export function parseAzdoRemote(url: string): AzdoRepoRef | undefined {
  const match = SSH_PATTERN.exec(url) ?? HTTPS_PATTERN.exec(url) ?? LEGACY_HTTPS_PATTERN.exec(url);
  if (!match) {
    return undefined;
  }
  const [, organization, project, repository] = match.map((part) => safeDecode(part));
  return { organization, project, repository };
}
