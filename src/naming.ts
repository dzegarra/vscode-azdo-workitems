/**
 * Pure helpers implementing the team's naming conventions.
 *
 * Branches:  <type>/<module>/<id>-<slug>        e.g. feature/fui-admin/5641-network-restart-button
 * PR titles: [<id>,<id>] <Feature Name>: <text>  e.g. [123,554] FUI Administration: Show the network configuration
 */

export const DEFAULT_BRANCH_TYPE = 'feature';
const MAX_SLUG_LENGTH = 50;
const MODULE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BRANCH_PATTERN = /^(?<type>[a-z]+)\/(?<module>[a-z0-9-]+)\/(?<id>\d+)(?:-(?<slug>.*))?$/;

export interface ParsedBranch {
  type: string;
  module: string;
  id: number;
  slug: string;
}

export function slugify(title: string, maxLength = MAX_SLUG_LENGTH): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) {
    return slug;
  }
  // Cut on a word boundary when possible
  const cut = slug.slice(0, maxLength + 1);
  const lastDash = cut.lastIndexOf('-');
  return (lastDash > 0 ? cut.slice(0, lastDash) : slug.slice(0, maxLength)).replace(/-+$/, '');
}

export function branchTypeFor(workItemType: string, mapping: Partial<Record<string, string>>): string {
  return mapping[workItemType] ?? DEFAULT_BRANCH_TYPE;
}

export function isValidModule(module: string): boolean {
  return MODULE_PATTERN.test(module);
}

export function buildBranchName(type: string, module: string, id: number, slug: string): string {
  const cleanSlug = slugify(slug, Number.MAX_SAFE_INTEGER);
  return cleanSlug ? `${type}/${module}/${id}-${cleanSlug}` : `${type}/${module}/${id}`;
}

export function parseBranchName(branch: string): ParsedBranch | undefined {
  const groups = BRANCH_PATTERN.exec(branch.replace(/^refs\/heads\//, ''))?.groups;
  if (!groups) {
    return undefined;
  }
  return {
    type: groups.type,
    module: groups.module,
    id: Number(groups.id),
    slug: (groups.slug as string | undefined) ?? '',
  };
}

/**
 * Work item a branch refers to. Branches of other developers do not always follow the convention
 * ("feature/MA/60800_unit_config"), so, failing that, a folder of the name starting with a number is used
 */
export function workItemIdFromBranch(branch: string): number | undefined {
  const strict = parseBranchName(branch);
  if (strict) {
    return strict.id;
  }
  const [, ...folders] = branch.replace(/^refs\/heads\//, '').split('/');
  const numbered = folders.map((folder) => /^(\d+)(?:[-_].*)?$/.exec(folder)?.[1]).find((id) => id !== undefined);
  return numbered === undefined ? undefined : Number(numbered);
}

/** True when the branch name follows the convention and refers to the given work item */
export function branchBelongsToWorkItem(branch: string, id: number): boolean {
  return parseBranchName(branch)?.id === id;
}

export function buildPrTitle(ids: number[], featureName: string, description: string): string {
  const uniqueIds = [...new Set(ids)];
  return `[${uniqueIds.join(',')}] ${featureName.trim()}: ${description.trim()}`;
}

const PR_TITLE_PATTERN = /^\[\d+(?:,\s*\d+)*\] [^:\s][^:]*: \S/;

/** True when the title is "[<id>,<id>] <Feature Name>: <description>" */
export function isValidPullRequestTitle(title: string): boolean {
  return PR_TITLE_PATTERN.test(title.trim());
}

/** Bullet list of commits. Azure DevOps appends "Related work items" by itself from the linked work items */
export function buildPrDescription(commitSubjects: string[]): string {
  return commitSubjects.map((subject) => `- ${subject}`).join('\n');
}
