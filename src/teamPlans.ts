/** Sprint plans of the teams: pure, so no "vscode" import */
import { iterationKind } from './schedule';

/** An area a team owns (`teamsettings/teamfieldvalues`) */
export interface TeamArea {
  path: string;
  includeChildren: boolean;
}

/** What a team owns and plans: its areas and the iterations it selected */
export interface TeamPlan {
  name: string;
  areas: TeamArea[];
  /** Paths of the iterations in the team's settings */
  iterationPaths: string[];
}

const normalize = (path: string) => path.trim().replace(/\\+$/, '').toLowerCase();

/** The team owns the area itself, or (with `includeChildren`) one of its parents, compared on `\` boundaries */
export function coversArea(areas: readonly TeamArea[], areaPath: string): boolean {
  const area = normalize(areaPath);
  return areas.some((candidate) => {
    const owned = normalize(candidate.path);
    return area === owned || (candidate.includeChildren && area.startsWith(`${owned}\\`));
  });
}

// Rule ALERT-14
/**
 * Names of the teams whose sprint plan lacks the iteration, when the work item will not show on any sprint board:
 * the iteration is a sprint, at least one team covers the area and none of them selected the iteration. Empty when
 * the alert does not apply (unknown data included: no plans, no area, no iteration)
 */
export function teamsMissingIteration(
  plans: readonly TeamPlan[] | undefined,
  areaPath: string | undefined,
  iterationPath: string | undefined
): string[] {
  if (!plans || !areaPath || !iterationPath || iterationKind(iterationPath) !== 'sprint') {
    return [];
  }
  const covering = plans.filter((plan) => coversArea(plan.areas, areaPath));
  const iteration = normalize(iterationPath);
  if (!covering.length || covering.some((plan) => plan.iterationPaths.some((path) => normalize(path) === iteration))) {
    return [];
  }
  return covering.map((plan) => plan.name);
}
