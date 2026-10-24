/**
 * Pure helpers implementing the team's naming conventions.
 *
 * Branches:  <type>/<module>/<id>-<slug>        e.g. feature/fui-admin/5641-network-restart-button
 *            devops/<id>-<slug>                e.g. devops/5642-build-scripts-update (the module is the branch type)
 * PR titles: [<id>,<id>] <Feature Name>: <text>  e.g. [123,554] FUI Administration: Show the network configuration
 */

export const DEFAULT_BRANCH_TYPE = 'feature';
const MAX_SLUG_LENGTH = 50;
const MODULE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const BRANCH_PATTERN = /^(?<type>[a-z]+)\/(?<module>[a-z0-9-]+)\/(?<id>\d+)(?:-(?<slug>.*))?$/;
/** Modules whose branches are a type of their own, without the `<type>/` folder (DEVELOPMENT_APPROACH §8.1.3) */
const TOP_LEVEL_MODULES = ['devops'];
const TOP_LEVEL_PATTERN = new RegExp(`^(?<module>${TOP_LEVEL_MODULES.join('|')})\\/(?<id>\\d+)(?:-(?<slug>.*))?$`);

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

// Rule FLOW-BRANCH-4
export function branchTypeFor(workItemType: string, mapping: Partial<Record<string, string>>): string {
  return mapping[workItemType] ?? DEFAULT_BRANCH_TYPE;
}

export function isValidModule(module: string): boolean {
  return MODULE_PATTERN.test(module);
}

// Rule FLOW-BRANCH-8
/** The folders of a branch name before `<id>-`: `<type>/<module>`, or only `devops` for the DevOps module */
export function branchPrefix(type: string, module: string): string {
  return TOP_LEVEL_MODULES.includes(module) ? module : `${type}/${module}`;
}

// Rules FLOW-BRANCH-4, FLOW-BRANCH-8
export function buildBranchName(type: string, module: string, id: number, slug: string): string {
  const cleanSlug = slugify(slug, Number.MAX_SAFE_INTEGER);
  const prefix = branchPrefix(type, module);
  return cleanSlug ? `${prefix}/${id}-${cleanSlug}` : `${prefix}/${id}`;
}

export function parseBranchName(branch: string): ParsedBranch | undefined {
  const name = branch.replace(/^refs\/heads\//, '');
  const groups = BRANCH_PATTERN.exec(name)?.groups ?? TOP_LEVEL_PATTERN.exec(name)?.groups;
  if (!groups) {
    return undefined;
  }
  return {
    type: (groups.type as string | undefined) ?? groups.module,
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
