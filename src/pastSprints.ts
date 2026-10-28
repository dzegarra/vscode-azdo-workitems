/**
 * The sprints before the current one on the Sprint timeline (Rules TIMELINE-40, TIMELINE-41): which iterations they
 * are for each team, the moment their work is read as of, and how their rows are drawn (history: no buttons). Pure, so
 * no "vscode" import
 */
import type { ScheduledIteration } from './schedule';
import type { SprintIteration } from './sprintTitle';
import { sprintTitle } from './sprintTitle';
import type { TimelineChild, TimelineRow } from './timelineTypes';

/** How many sprints back the switch goes */
export const PAST_SPRINTS = 4;

/** A current iteration of the user's teams */
export interface CurrentIteration extends SprintIteration {
  path: string;
}

/** A sprint of the switch: 0 is the current one, 1 the one before… */
export interface SprintChoice {
  offset: number;
  /** "Sprint 121", or its dates when the teams' numbers differ */
  title: string;
  iterations: CurrentIteration[];
}

const day = (date: string | undefined): string => date?.slice(0, 10) ?? '';

/** "Platform Sprint 122" → "Platform Sprint": the series of a team */
const series = (name: string): string => name.replace(/\s*\d+\s*$/, '');

const parentOf = (path: string): string => path.split('\\').slice(0, -1).join('\\');

/** The iteration whose dates are the axis: the one that ends first (as the board header) */
export function axisIteration<T extends SprintIteration>(iterations: readonly T[]): T | undefined {
  return [...iterations]
    .filter((iteration) => iteration.finishDate !== undefined)
    .sort((a, b) => day(a.finishDate).localeCompare(day(b.finishDate)))
    .at(0);
}

// Rule TIMELINE-40
/**
 * The current sprint and the ones before it, at most PAST_SPRINTS: for each team, the iterations of the schedule of the
 * same series (same parent path and same name without its number) that started before its current one, latest first.
 * A sprint back is the k-th previous iteration of every team that has one; its title is the one the teams share
 */
export function sprintChoices(
  current: readonly CurrentIteration[],
  schedule: readonly ScheduledIteration[] | undefined
): SprintChoice[] {
  const choices: SprintChoice[] = [
    { offset: 0, title: sprintTitle(current, undefined).title, iterations: [...current] },
  ];
  if (!schedule) {
    return choices;
  }
  const before = current.map((iteration) =>
    schedule
      .filter(
        (candidate) =>
          candidate.path !== iteration.path &&
          parentOf(candidate.path) === parentOf(iteration.path) &&
          series(candidate.name) === series(iteration.name) &&
          candidate.start !== undefined &&
          candidate.finish !== undefined &&
          day(candidate.start) < day(iteration.startDate ?? '9999')
      )
      .sort((a, b) => day(b.start).localeCompare(day(a.start)))
      .map(
        (candidate): CurrentIteration => ({
          name: candidate.name,
          path: candidate.path,
          teams: iteration.teams,
          startDate: candidate.start,
          finishDate: candidate.finish,
        })
      )
  );
  for (let offset = 1; offset <= PAST_SPRINTS; offset += 1) {
    const iterations = before.flatMap((list) => {
      const found = list.at(offset - 1);
      return found ? [found] : [];
    });
    // Teams that share an iteration list it once
    const unique = [...new Map(iterations.map((iteration) => [iteration.path, iteration])).values()];
    if (!unique.length) {
      break;
    }
    choices.push({ offset, title: sprintTitle(unique, axisIteration(unique)).title, iterations: unique });
  }
  return choices;
}

// Rule TIMELINE-41
/** The moment a past sprint is read as of: the end of its last day (the latest finish of its teams), UTC */
export function asOfMoment(iterations: readonly SprintIteration[]): string | undefined {
  const last = iterations
    .map((iteration) => day(iteration.finishDate))
    .filter(Boolean)
    .sort()
    .at(-1);
  return last ? `${last}T23:59:59Z` : undefined;
}

/** "ended Mon 26 Oct" for the header of a past sprint */
export function endedText(finishDate: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(finishDate ?? '');
  if (!match) {
    return undefined;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return `ended ${date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })}`;
}

const historyChild = (child: TimelineChild): TimelineChild => {
  switch (child.kind) {
    case 'pr':
    case 'task':
      return { ...child, action: undefined };
    case 'placeholder':
      return child;
  }
};

// Rule TIMELINE-41
/** A row of a past sprint is history: no button, no popover, no "needs you" */
export function historyRow(row: TimelineRow): TimelineRow {
  return {
    ...row,
    action: undefined,
    popover: undefined,
    // What a work item needs now says nothing about a sprint that is over
    note: row.note?.tone === 'needsYou' ? undefined : row.note,
    defaultExpanded: false,
    children: row.children?.map(historyChild),
  };
}
