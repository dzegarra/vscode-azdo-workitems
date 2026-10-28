/**
 * The sprint title of the Track board and the Sprint timeline: what the current iterations of the user's teams share.
 * Pure, so no "vscode" import
 */

export interface SprintIteration {
  name: string;
  teams?: readonly string[];
  startDate?: string;
  finishDate?: string;
}

/** The "N teams" chip next to the title: its hover or focus lists each team with its full iteration name */
export interface SprintTeams {
  /** "4 teams", "4 teams · 1 with other dates" */
  text: string;
  /** "Platform · Platform Sprint 122 · 14 Oct – 27 Oct", one line per team; "(other dates)" at the end of the others */
  lines: string[];
}

export interface SprintTitle {
  /** "Sprint 122"; the dates when the numbers differ; the name of the iteration when it has no number */
  title: string;
  teams?: SprintTeams;
}

const SPRINT_NUMBER = /Sprint\s*(\d+)\s*$/i;

/** "14 Oct" of a date of an iteration (midnight UTC of the day) */
export function iterationDateText(date: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  return match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
    : undefined;
}

/** "14 Oct – 27 Oct", undefined when a date is missing */
export function iterationDates(iteration: Pick<SprintIteration, 'finishDate' | 'startDate'>): string | undefined {
  const start = iterationDateText(iteration.startDate);
  const finish = iterationDateText(iteration.finishDate);
  return start && finish ? `${start} – ${finish}` : undefined;
}

const sameDates = (a: SprintIteration, b: SprintIteration): boolean =>
  a.startDate?.slice(0, 10) === b.startDate?.slice(0, 10) && a.finishDate?.slice(0, 10) === b.finishDate?.slice(0, 10);

// Rule SPRINT-TITLE-1
/**
 * The title: each iteration name loses its team name and keeps its trailing "Sprint <n>". The same number for every
 * team: "Sprint 122"; different numbers: the dates of `axis` (the sprint that ends first, the one the views draw).
 * Several teams: the chip "N teams", "· M with other dates" when some team is not on the dates of `axis`
 */
export function sprintTitle(iterations: readonly SprintIteration[], axis: SprintIteration | undefined): SprintTitle {
  const first = axis ?? iterations.at(0);
  if (!first) {
    return { title: 'Sprint' };
  }
  const numbers = new Set(iterations.map((iteration) => SPRINT_NUMBER.exec(iteration.name)?.[1]));
  const [number] = [...numbers];
  let title = first.name;
  if (numbers.size === 1 && number !== undefined) {
    title = `Sprint ${number}`;
  } else if (numbers.size > 1) {
    title = iterationDates(first) ?? first.name;
  }
  const rows = iterations.flatMap((iteration) =>
    (iteration.teams?.length ? iteration.teams : ['']).map((team) => ({ team, iteration }))
  );
  if (rows.length < 2) {
    return { title };
  }
  const other = rows.filter((row) => !sameDates(row.iteration, first)).length;
  return {
    title,
    teams: {
      text: `${String(rows.length)} teams${other ? ` · ${String(other)} with other dates` : ''}`,
      lines: rows.map(({ team, iteration }) =>
        [team, iteration.name, iterationDates(iteration), sameDates(iteration, first) ? '' : '(other dates)']
          .filter(Boolean)
          .join(' · ')
      ),
    },
  };
}
