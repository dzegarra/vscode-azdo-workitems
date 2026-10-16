/**
 * Work items whose predecessors are not completed. Soft team rule: avoid starting a work item before its
 * predecessors are done, or agree it with their owners. It is a caution, never a block.
 * Pure, so no "vscode" import
 */
import { DependencyRisk, dependencyRisk, ScheduledIteration } from './schedule';
import { normalizeState } from './states';

export const DEFAULT_COMPLETED_STATES = ['Done', 'Ready to Test', 'Closed', 'Removed'];

// Rule DEP-1
/** True when the state is one of the completed states ("Ready-to-Test" matches "Ready to Test") */
export function isCompletedState(state: string, completedStates: string[] = DEFAULT_COMPLETED_STATES): boolean {
  const normalized = normalizeState(state);
  return completedStates.some((candidate) => normalizeState(candidate) === normalized);
}

export interface OpenPredecessor {
  id: number;
  title: string;
  type: string;
  state: string;
  assignedTo?: string;
  iterationName?: string;
  /** Undefined when the iteration schedule is not available */
  risk?: DependencyRisk;
}

export interface PredecessorSource {
  id: number;
  title: string;
  type: string;
  state: string;
  iterationPath: string;
  assignedTo?: string;
}

/** Worst first: planned after its successor, not scheduled, same iteration, planned before */
const RISK_ORDER: DependencyRisk[] = ['late', 'unscheduled', 'tight', 'ok', 'done'];

function riskRank(risk: DependencyRisk | undefined): number {
  return risk === undefined ? RISK_ORDER.length : RISK_ORDER.indexOf(risk);
}

/**
 * The predecessors that are not completed, the riskiest first (the ones planned in a later iteration than the
 * work item). Without the schedule the risk is unknown and they are sorted by ID
 */
export function openPredecessors(
  item: { iterationPath: string },
  predecessors: PredecessorSource[],
  completedStates: string[],
  schedule: ScheduledIteration[] | undefined
): OpenPredecessor[] {
  return predecessors
    .filter((predecessor) => !isCompletedState(predecessor.state, completedStates))
    .map((predecessor) => ({
      id: predecessor.id,
      title: predecessor.title,
      type: predecessor.type,
      state: predecessor.state,
      assignedTo: predecessor.assignedTo,
      iterationName:
        schedule?.find((iteration) => iteration.path === predecessor.iterationPath)?.name ??
        predecessor.iterationPath.split('\\').at(-1),
      // An open predecessor is never "done" for the risk, whatever the category of its state
      risk: schedule && dependencyRisk({ state: '', iterationPath: predecessor.iterationPath }, item, schedule),
    }))
    .sort((a, b) => riskRank(a.risk) - riskRank(b.risk) || a.id - b.id);
}

/** Values of the "Predecessors" filter */
export const OPEN_PREDECESSORS = 'Incomplete predecessors';
export const NONE_OPEN = 'Complete predecessors';

/** Hidden values saved with the first names of the chips */
const LEGACY_PREDECESSOR_STATES: Record<string, string> = {
  'Open predecessors': OPEN_PREDECESSORS,
  'None open': NONE_OPEN,
};

/** Maps hidden predecessor filter values saved with old names to the current ones (no duplicates) */
export function migratePredecessorStates(states: string[]): string[] {
  return [...new Set(states.map((state) => LEGACY_PREDECESSOR_STATES[state] ?? state))];
}

/** Value of the filter chip; undefined when the predecessors are unknown: the filter then never hides the item */
export function predecessorFilterValue(item: { openPredecessors?: unknown[] }): string | undefined {
  if (!item.openPredecessors) {
    return undefined;
  }
  return item.openPredecessors.length ? OPEN_PREDECESSORS : NONE_OPEN;
}
