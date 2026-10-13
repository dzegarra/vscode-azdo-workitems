/** Pure helpers about the iteration schedule and the risk of dependencies. No "vscode" import */
import { stateCategory } from './states';

/** Node of the "Iterations" classification tree, as returned by Azure DevOps */
export interface IterationNode {
  name: string;
  /** "\Project\Iteration\Sprint 42" */
  path: string;
  attributes?: { startDate?: string; finishDate?: string };
  children?: IterationNode[];
}

export interface ScheduledIteration {
  /** Same format as the "System.IterationPath" field: "Project\Sprint 42" */
  path: string;
  name: string;
  start?: string;
  finish?: string;
}

/** "\Project\Iteration\Sprint 42" → "Project\Sprint 42" */
export function toIterationPath(nodePath: string): string {
  const [project, , ...rest] = nodePath.replace(/^\\/, '').split('\\');
  return [project, ...rest].join('\\');
}

export function flattenIterations(root: IterationNode): ScheduledIteration[] {
  const result: ScheduledIteration[] = [];
  const visit = (node: IterationNode) => {
    result.push({
      path: toIterationPath(node.path),
      name: node.name,
      start: node.attributes?.startDate,
      finish: node.attributes?.finishDate,
    });
    node.children?.forEach(visit);
  };
  visit(root);
  return result;
}

/**
 * Azure DevOps iterations are nested as "Project\Container\Sprint": the container is usually a release whose
 * dates cover the sprints of several teams. Work items planned in the container are in the release but not in a sprint
 * yet, and the ones directly in the project are not planned in any release (limbo)
 */
export type IterationKind = 'container' | 'limbo' | 'sprint';

export function iterationKind(path: string): IterationKind {
  const depth = path.split('\\').filter(Boolean).length - 1;
  if (depth < 1) {
    return 'limbo';
  }
  return depth === 1 ? 'container' : 'sprint';
}

/** "Project\Release\Platform Sprint 1" → "Project\Release" */
export function containerPath(path: string): string {
  return path.split('\\').filter(Boolean).slice(0, 2).join('\\');
}

/** Dates of a sprint, when the schedule knows them (YYYY-MM-DD) */
export function sprintDates(
  path: string,
  schedule: ScheduledIteration[]
): { start: string; finish: string } | undefined {
  if (iterationKind(path) !== 'sprint') {
    return undefined;
  }
  const iteration = schedule.find((candidate) => candidate.path === path);
  return iteration?.start && iteration.finish
    ? { start: iteration.start.slice(0, 10), finish: iteration.finish.slice(0, 10) }
    : undefined;
}

/** Negative when the first period starts (or, starting together, finishes) before the second one */
export function compareDates(a: { start: string; finish: string }, b: { start: string; finish: string }): number {
  return a.start.localeCompare(b.start) || a.finish.localeCompare(b.finish);
}

export function isCurrentIteration(iteration: ScheduledIteration, today: Date): boolean {
  if (!iteration.start || !iteration.finish) {
    return false;
  }
  const day = today.toISOString().slice(0, 10);
  return iteration.start.slice(0, 10) <= day && day <= iteration.finish.slice(0, 10);
}

/**
 * - done: the predecessor is finished, nothing to worry about
 * - late: the predecessor is planned in a sprint period after the one of its successor
 * - tight: both are planned in the same sprint period (even if they are sprints of different teams)
 * - unscheduled: the successor is in a sprint but the predecessor is not (it is in a release, or in no release at all)
 * - ok: the predecessor is planned before its successor (or the successor is not in a sprint)
 */
export type DependencyRisk = 'done' | 'late' | 'ok' | 'tight' | 'unscheduled';

// Rule DEP-2
export function dependencyRisk(
  predecessor: { state: string; iterationPath: string },
  successor: { iterationPath: string },
  schedule: ScheduledIteration[]
): DependencyRisk {
  if (['done', 'removed'].includes(stateCategory(predecessor.state))) {
    return 'done';
  }
  // Nothing is scheduled to be late against
  if (iterationKind(successor.iterationPath) !== 'sprint') {
    return 'ok';
  }
  if (iterationKind(predecessor.iterationPath) !== 'sprint') {
    return 'unscheduled';
  }
  const successorDates = sprintDates(successor.iterationPath, schedule);
  const predecessorDates = sprintDates(predecessor.iterationPath, schedule);
  if (!successorDates) {
    return 'ok';
  }
  if (!predecessorDates) {
    return 'unscheduled';
  }
  const order = compareDates(predecessorDates, successorDates);
  if (order === 0) {
    return 'tight';
  }
  return order > 0 ? 'late' : 'ok';
}

export const RISK_DESCRIPTIONS: Record<DependencyRisk, string> = {
  done: 'Predecessor done',
  late: 'Predecessor planned after its successor',
  tight: 'Planned in the same sprint period',
  unscheduled: 'Predecessor not scheduled yet',
  ok: 'Predecessor planned before',
};
