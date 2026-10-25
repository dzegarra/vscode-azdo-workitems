/**
 * The state bar of the Work Item Details panel (redesign): the states a Backlog Item or a Bug goes through, which
 * one it is in, and the moves a developer does not make. Pure, so no "vscode" import
 */
import { normalizeState } from './states';

export interface StateStep {
  /** State to move to (matched with the states of the type by name, STATE-1); undefined: display only */
  state?: string;
  label: string;
  status: 'current' | 'next' | 'past';
  /** Why the developer does not make this move: the step is shown, not clickable */
  locked?: string;
  /** Short note next to the label, e.g. "your finish line" */
  note?: string;
  /** Shown only, not a state of Azure DevOps (In review, STATE-10) */
  derived?: boolean;
}

const isType = (type: string, name: string): boolean => normalizeState(type) === normalizeState(name);
const sameState = (a: string, b: string): boolean => normalizeState(a) === normalizeState(b);

const BUG_FLOW = ['New', 'Approved', 'Committed', 'Ready to Test', 'Done'];
const BACKLOG_FLOW = ['New', 'Approved', 'Committed', 'Done'];
const REOPENED = 'ReOpened';
const REMOVED = 'Removed';
const IN_REVIEW = 'In review';

export const TESTERS_ONLY = 'Only testers move a Bug to Done';

// Rule STEPS-4
/** A move the team leaves to the testers: a Bug to Done (developers stop at Ready to Test) */
export function isTesterOnlyMove(type: string, state: string): boolean {
  return isType(type, 'Bug') && sameState(state, 'Done');
}

function statusOf(index: number, current: number): StateStep['status'] {
  if (index === current) {
    return 'current';
  }
  return index < current ? 'past' : 'next';
}

// Rules STEPS-1..5
/**
 * The steps of the state bar; undefined for the other types, or a state outside the flow (the panel then shows the
 * state button alone)
 */
export function stateSteps(type: string, state: string, displayState?: string): StateStep[] | undefined {
  const bug = isType(type, 'Bug');
  if (!bug && !isType(type, 'Product Backlog Item')) {
    return undefined;
  }
  // Rule STEPS-2: a reopened Bug sits in the Approved slot and goes on to Committed
  const reopened = bug && sameState(state, REOPENED);
  const flow = (bug ? BUG_FLOW : BACKLOG_FLOW).map((name) => (reopened && name === 'Approved' ? REOPENED : name));
  // Rule STEPS-3: Removed only when the work item is in it
  const removed = sameState(state, REMOVED);
  const states = removed ? [...flow, REMOVED] : flow;
  const current = states.findIndex((name) => sameState(name, state));
  if (current === -1) {
    return undefined;
  }
  const steps: StateStep[] = states.map((name, index) => ({
    state: name,
    label: name,
    status: removed && name !== REMOVED ? 'next' : statusOf(index, current),
  }));
  for (const step of steps) {
    if (step.status !== 'current' && step.state && isTesterOnlyMove(type, step.state)) {
      // Rule STEPS-4
      step.locked = TESTERS_ONLY;
      step.note = 'testers only';
    }
    if (bug && step.state && sameState(step.state, 'Ready to Test') && step.status !== 'past') {
      step.note = 'your finish line';
    }
  }
  // Rule STEPS-5: In review is shown next to Committed, display only (STATE-10)
  if (!bug && displayState && sameState(displayState, IN_REVIEW)) {
    const committed = steps.findIndex((step) => step.state === 'Committed');
    steps.splice(committed + 1, 0, { label: IN_REVIEW, status: 'current', note: 'shown, not set', derived: true });
  }
  return steps;
}
