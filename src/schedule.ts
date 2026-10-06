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
 * Orders the given iteration paths by start date. Iterations without dates (e.g. the project backlog)
 * go last; paths not found in the schedule are treated as not scheduled
 */
export function orderIterations(paths: string[], schedule: ScheduledIteration[]): ScheduledIteration[] {
  const byPath = new Map(schedule.map((iteration) => [iteration.path, iteration]));
  return [...new Set(paths)]
    .map((path) => byPath.get(path) ?? { path, name: path.split('\\').at(-1) ?? path })
    .sort((a, b) => {
      if (a.start && b.start) {
        return a.start.localeCompare(b.start);
      }
      return Number(!a.start) - Number(!b.start) || a.path.localeCompare(b.path);
    });
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
 * - late: the predecessor is planned in a later iteration than its successor
 * - tight: both are planned in the same iteration
 * - unscheduled: the successor is planned but the predecessor is not
 * - ok: the predecessor is planned before its successor (or the successor is not planned)
 */
export type DependencyRisk = 'done' | 'late' | 'ok' | 'tight' | 'unscheduled';

export function dependencyRisk(
  predecessor: { state: string; iterationPath: string },
  successor: { iterationPath: string },
  schedule: ScheduledIteration[]
): DependencyRisk {
  if (['done', 'removed'].includes(stateCategory(predecessor.state))) {
    return 'done';
  }
  const start = (path: string) => schedule.find((iteration) => iteration.path === path)?.start;
  const predecessorStart = start(predecessor.iterationPath);
  const successorStart = start(successor.iterationPath);
  if (!successorStart) {
    return 'ok';
  }
  if (!predecessorStart) {
    return 'unscheduled';
  }
  if (predecessor.iterationPath === successor.iterationPath) {
    return 'tight';
  }
  return predecessorStart > successorStart ? 'late' : 'ok';
}

export const RISK_DESCRIPTIONS: Record<DependencyRisk, string> = {
  done: 'Predecessor done',
  late: 'Predecessor planned after its successor',
  tight: 'Planned in the same iteration',
  unscheduled: 'Predecessor not scheduled',
  ok: 'Predecessor planned before',
};
