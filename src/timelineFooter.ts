/**
 * The footer of the Sprint timeline (Rules TIMELINE-25, TIMELINE-50): the asleep work items of the user, and the one
 * place that says what is being loaded. Pure, so no "vscode" import
 */
import type { TimelineModel, TimelineTeam } from './timelineTypes';

/** A row, as far as the loading status looks at it (a TimelineRow fits) */
interface LoadingRow {
  id: number;
  loading?: boolean;
  children?: readonly { kind: string; prId?: number; history?: string; detailsLoading?: boolean }[];
}

/** What the footer reads of the model */
export interface LoadingFacts {
  status: TimelineModel['status'];
  statesLoading: number;
  work: readonly LoadingRow[];
  finished: readonly LoadingRow[];
  movedOut: readonly LoadingRow[];
  reviews: readonly LoadingRow[];
  reviewed: readonly LoadingRow[];
  team?: {
    status: TimelineTeam['status'];
    pending: readonly { name: string }[];
    sections: readonly {
      rows: readonly LoadingRow[];
      finished: readonly LoadingRow[];
      movedOut: readonly LoadingRow[];
    }[];
  };
}

// Rule TIMELINE-25
/** The ids of the asleep work items (zZ, Rule TIMELINE-8: the card says it), once each, in the order of the cards */
export function asleepIdsOf(cards: readonly { id: number; asleep?: unknown }[]): number[] {
  return [...new Set(cards.filter((card) => card.asleep).map((card) => card.id))];
}

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`;

// Rule TIMELINE-50
/** The PRs whose events are being read: the rows of expanded work items (history, commits) and the reviewed PRs (threads) */
function pullRequestsLoading(model: LoadingFacts): number {
  const rows = [
    ...model.work,
    ...model.finished,
    ...model.movedOut,
    ...(model.team?.sections.flatMap((section) => [...section.rows, ...section.finished, ...section.movedOut]) ?? []),
  ];
  const ids = new Set<number>();
  for (const row of rows) {
    for (const child of row.children ?? []) {
      if (
        child.kind === 'pr' &&
        child.prId !== undefined &&
        (child.history === 'loading' || child.detailsLoading === true)
      ) {
        ids.add(child.prId);
      }
    }
  }
  for (const row of [...model.reviews, ...model.reviewed]) {
    if (row.loading) {
      ids.add(row.id);
    }
  }
  return ids.size;
}

// Rule TIMELINE-50
/**
 * The work items of the user are not loaded yet: the store is reading them and none is drawn (the PRs to review can be
 * there already). The work section then draws skeleton rows instead of "None of your work items is in the sprint"
 */
export const workItemsLoading = (model: Pick<LoadingFacts, 'status' | 'work' | 'finished' | 'movedOut'>): boolean =>
  model.status === 'loading' && !model.work.length && !model.finished.length && !model.movedOut.length;

// Rule TIMELINE-50
/**
 * What is being loaded, as one sentence for the footer ("Loading the work of 2 people (Piotr, Marta) and the PR events
 * of 3 PRs…"), or undefined when nothing is. The parts, in this order: the sprint, the people of the team, the PR
 * events, the state histories of the work items
 */
export function loadingText(model: LoadingFacts): string | undefined {
  const parts: string[] = [];
  if (model.status === 'loading') {
    // The PRs to review can be on screen already: then it is the work items that are missing
    parts.push(model.reviews.length || model.reviewed.length ? 'your work items' : 'the sprint');
  }
  const team = model.team;
  if (team?.status === 'loading') {
    const names = team.pending.map((person) => person.name);
    parts.push(
      names.length
        ? `the work of ${plural(names.length, 'person', 'people')} (${names.join(', ')})`
        : 'the work of the team'
    );
  }
  const pullRequests = pullRequestsLoading(model);
  if (pullRequests) {
    parts.push(`the PR events of ${plural(pullRequests, 'PR', 'PRs')}`);
  }
  if (model.statesLoading) {
    parts.push(`the state history of ${plural(model.statesLoading, 'work item', 'work items')}`);
  }
  return parts.length ? `Loading ${parts.join(' and ')}…` : undefined;
}

/** How many of the work items drawn (`wanted`) have their state history being read */
export const countLoading = (wanted: readonly { id: number }[], loading: ReadonlySet<number> | undefined): number =>
  loading ? wanted.filter((entry) => loading.has(entry.id)).length : 0;

// Rule TIMELINE-25
/** Whether the ASLEEP list can be said: not while the sprint, or the people of the team, are still being read */
export function asleepKnown(model: Pick<LoadingFacts, 'status' | 'team'>): boolean {
  return model.status === 'ready' && (model.team?.status ?? 'ready') === 'ready' && !model.team?.pending.length;
}
