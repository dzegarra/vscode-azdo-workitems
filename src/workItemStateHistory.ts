/**
 * The states a work item went through, for its row on the Sprint timeline (Rules TIMELINE-35, TIMELINE-36): read from
 * its updates (`wit/workItems/{id}/updates`, one request per work item, kept by its revision), or guessed from the
 * dates the work item already carries until they arrive. Pure, so no "vscode" import
 */
import { stateCategory } from './states';

/** One update of a work item as the API gives it: only what the timeline reads */
export interface WorkItemUpdate {
  rev?: number;
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown } | undefined>;
}

/** A change of state: when, and to which state */
export interface StateChange {
  at: number;
  state: string;
}

export type StateKind = 'approved' | 'committed' | 'done' | 'inReview' | 'new' | 'reopened';

/** A state over time; `approximate`: guessed from the dates of the work item (its history is not read yet) */
export interface StateSpan {
  kind: StateKind;
  /** The name of the state ("Ready to Test"), "In review" for the derived one */
  text: string;
  start: number;
  end: number;
  approximate?: boolean;
  /** In review is not a state of Azure DevOps: it is drawn dashed (STATE-10) */
  derived?: boolean;
}

const at = (value: unknown): number | undefined => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? undefined : ms;
};

// Rule TIMELINE-35
/**
 * The changes of state of a work item, oldest first, from its updates: each update that sets `System.State` (the
 * first one creates the work item in its first state), at its `System.ChangedDate`
 */
export function stateChanges(updates: readonly WorkItemUpdate[]): StateChange[] {
  return updates.flatMap((update) => {
    const state = update.fields?.['System.State']?.newValue;
    const when = at(update.fields?.['System.ChangedDate']?.newValue);
    return typeof state === 'string' && when !== undefined ? [{ at: when, state }] : [];
  });
}

// Rule TIMELINE-35
/** The kind of a state: its colour on the row. Ready to Test is the finish line of a Bug: drawn as Done */
export function stateKind(state: string): StateKind {
  const name = state.toLowerCase();
  if (name === 'new') {
    return 'new';
  }
  if (name === 'reopened') {
    return 'reopened';
  }
  if (name === 'approved') {
    return 'approved';
  }
  switch (stateCategory(state)) {
    case 'done':
    case 'removed':
      return 'done';
    case 'proposed':
      return 'approved';
    case 'in-progress':
      return 'committed';
  }
}

export interface StateSpanInput {
  /** The changes of state read; undefined: not read yet (the spans are guessed from the dates) */
  changes?: readonly StateChange[];
  /** The state now and the dates of the work item */
  state: string;
  dates?: { activated?: string; stateChanged?: string; created?: string };
  /** When the first PR of the work item left draft (or was created published): In review starts there (TIMELINE-36) */
  firstPublished?: number;
  now: number;
}

/** Splits a Committed span at the publication of the first PR: from there on it is the derived In review */
function withInReview(spans: StateSpan[], published: number | undefined): StateSpan[] {
  if (published === undefined) {
    return spans;
  }
  return spans.flatMap((span) => {
    if (span.kind !== 'committed' || published >= span.end) {
      return [span];
    }
    const review: StateSpan = {
      ...span,
      kind: 'inReview',
      text: 'In review',
      start: Math.max(span.start, published),
      derived: true,
    };
    return published <= span.start ? [review] : [{ ...span, end: published }, review];
  });
}

// Rules TIMELINE-35, TIMELINE-36
/**
 * The states of the work item over time, oldest first: each state from its change to the next one; the last one up
 * to now, or, for a finished work item, a mark (the span ends where it finished). In review is approximated in the
 * past by the publication of the first PR while Committed (it is derived from the tasks now, STATE-10). Without the
 * history: the state now since its last change (`StateChangeDate`, exact), and before it Committed from the activation
 * (approximate)
 */
export function stateSpans(input: StateSpanInput): StateSpan[] {
  const { now } = input;
  const finished = stateCategory(input.state) === 'done' || stateCategory(input.state) === 'removed';
  let spans: StateSpan[];
  if (input.changes?.length) {
    const changes = [...input.changes].sort((a, b) => a.at - b.at);
    spans = changes.flatMap((change, index) => {
      const next = changes.at(index + 1);
      const kind = stateKind(change.state);
      if (!next && (kind === 'done' || finished)) {
        return [];
      }
      const end = next?.at ?? now;
      return end > change.at ? [{ kind, text: change.state, start: change.at, end }] : [];
    });
  } else {
    const changed = at(input.dates?.stateChanged);
    const activated = at(input.dates?.activated);
    const guessed: StateSpan[] = [];
    if (activated !== undefined && changed !== undefined && activated < changed) {
      guessed.push({ kind: 'committed', text: 'Committed', start: activated, end: changed, approximate: true });
    }
    if (!finished) {
      const from = changed ?? activated ?? at(input.dates?.created);
      if (from !== undefined && from < now) {
        guessed.push({
          kind: stateKind(input.state),
          text: input.state,
          start: from,
          end: now,
          approximate: changed === undefined,
        });
      }
    }
    spans = guessed;
  }
  return withInReview(spans, input.firstPublished);
}

/** Where a work item finished: its last change to a finished state (from the history), else `StateChangeDate` */
export function finishedAt(input: Pick<StateSpanInput, 'changes' | 'dates' | 'state'>): number | undefined {
  if (!['done', 'removed'].includes(stateCategory(input.state))) {
    return undefined;
  }
  const last = input.changes?.length ? [...input.changes].sort((a, b) => a.at - b.at).at(-1) : undefined;
  return last?.at ?? at(input.dates?.stateChanged);
}
