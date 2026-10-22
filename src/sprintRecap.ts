/**
 * The sprint recap ("Sprint wrap-up"): the user's sprint in numbers, from the fun journal (src/funJournal.ts) and the
 * work items of the list. Only what the extension saw counts: it says so on the page. Pure, so no "vscode" import
 */
import { escapeHtml } from './html';
import type { FunJournal, JournalMerge } from './funJournal';
import { greenStreak } from './greenStreak';
import { formatAge } from './myPullRequests';
import { isInSprint } from './sprintCountdown';
import { isFinishedState } from './states';

export interface RecapSprint {
  name: string;
  startDate?: string;
  finishDate?: string;
}

export interface RecapInput {
  sprint: RecapSprint;
  journal: FunJournal;
  /** The work items of the list in this sprint (the user's) */
  workItems: { type: string; state: string }[];
}

export interface RecapMerge {
  id: number;
  title: string;
  /** Publication to merge, e.g. "1 d 4 h"; undefined when the publication date is unknown */
  took?: string;
}

export interface SprintRecap {
  title: string;
  merged: RecapMerge[];
  /** The quickest from publication to merge */
  fastestMerge?: RecapMerge;
  /** The one that took longest */
  longestMerge?: RecapMerge;
  opened: number;
  reviewed: number;
  /** "Net giver" line: reviews compared with the PRs opened */
  karma?: string;
  ci: { total: number; green: number; bestStreak: number };
  fastestApproval?: { pullRequestId: number; by: string; minutes: number };
  workItems: { done: number; total: number };
  /** The fun lines at the top */
  highlights: string[];
}

function durationMs(merge: JournalMerge): number | undefined {
  const start = Date.parse(merge.publishedAt ?? '');
  const end = Date.parse(merge.mergedAt);
  return Number.isNaN(start) || Number.isNaN(end) || end < start ? undefined : end - start;
}

// Rule FUN-KARMA-1
/** Reviews given compared with the PRs opened. Private to the user: never compared with anybody */
export function reviewKarma(reviewed: number, opened: number): string | undefined {
  if (!reviewed && !opened) {
    return undefined;
  }
  if (reviewed > opened) {
    return `🤝 Net giver: you reviewed ${String(reviewed)} and opened ${String(opened)}.`;
  }
  if (reviewed === opened) {
    return `⚖️ Perfect balance: ${String(reviewed)} reviewed, ${String(opened)} opened.`;
  }
  return `🙏 You opened ${String(opened)} and reviewed ${String(reviewed)}: your teammates covered for you.`;
}

function plural(count: number, word: string): string {
  return `${String(count)} ${word}${count === 1 ? '' : 's'}`;
}

function highlights(recap: Omit<SprintRecap, 'highlights' | 'title'>): string[] {
  const lines: string[] = [];
  if (recap.merged.length) {
    lines.push(`🚀 ${plural(recap.merged.length, 'pull request')} shipped`);
  }
  if (recap.workItems.done) {
    lines.push(`✅ ${String(recap.workItems.done)} of ${plural(recap.workItems.total, 'work item')} done`);
  }
  if (recap.ci.total) {
    const rate = Math.round((recap.ci.green / recap.ci.total) * 100);
    lines.push(`${rate === 100 ? '💯' : '🟢'} ${String(rate)}% of your CI runs green`);
  }
  if (recap.ci.bestStreak >= 3) {
    lines.push(`🔥 Best green streak: ${String(recap.ci.bestStreak)} runs`);
  }
  if (recap.fastestApproval) {
    lines.push(`⚡ Fastest first approval: ${String(recap.fastestApproval.minutes)} min`);
  }
  return lines.length ? lines : ['🌱 A quiet sprint: the extension did not see much of it'];
}

// Rules FUN-RECAP-1..2
/** The recap of one sprint: only the journal entries whose date falls in the sprint */
export function sprintRecap({ sprint, journal, workItems }: RecapInput): SprintRecap {
  const inSprint = (date: string) => isInSprint(date, sprint.startDate, sprint.finishDate);
  const merged = journal.merged
    .filter((merge) => inSprint(merge.mergedAt))
    .map((merge) => {
      const ms = durationMs(merge);
      return { merge: { id: merge.id, title: merge.title, took: ms === undefined ? undefined : formatAge(ms) }, ms };
    });
  const timed = merged.filter((entry) => entry.ms !== undefined).sort((a, b) => (a.ms ?? 0) - (b.ms ?? 0));
  const runs = journal.runs.filter((run) => inSprint(run.at));
  // The reviews are dated when first seen, the opened PRs by their creation: PRs created before the journal started
  // (before the first review it saw) would make the first recap unfair
  const journalStart =
    journal.reviewed
      .map((entry) => entry.at)
      .sort()
      .at(0) ?? '';
  const opened = journal.opened.filter((entry) => inSprint(entry.at) && entry.at >= journalStart).length;
  const reviewed = journal.reviewed.filter((entry) => inSprint(entry.at)).length;
  const fastestApproval = journal.approvals
    .flatMap(({ minutes, ...approval }) =>
      minutes !== undefined && inSprint(approval.at) ? [{ ...approval, minutes }] : []
    )
    .sort((a, b) => a.minutes - b.minutes)
    .at(0);
  const recap = {
    merged: merged.map((entry) => entry.merge),
    fastestMerge: timed.at(0)?.merge,
    longestMerge: timed.length > 1 ? timed.at(-1)?.merge : undefined,
    opened,
    reviewed,
    karma: reviewKarma(reviewed, opened),
    ci: { total: runs.length, green: runs.filter((run) => run.ok).length, bestStreak: greenStreak(runs).best },
    fastestApproval: fastestApproval && {
      pullRequestId: fastestApproval.pullRequestId,
      by: fastestApproval.by,
      minutes: fastestApproval.minutes,
    },
    workItems: { done: workItems.filter((item) => isFinishedState(item.state)).length, total: workItems.length },
  };
  return { title: `${sprint.name} wrap-up`, ...recap, highlights: highlights(recap) };
}

function stat(value: string, label: string): string {
  return `<div class="stat"><span class="value">${escapeHtml(value)}</span><span class="label">${escapeHtml(
    label
  )}</span></div>`;
}

function mergeLine(merge: RecapMerge): string {
  const took = merge.took ? ` <span class="muted">· ${escapeHtml(merge.took)}</span>` : '';
  return `<li><strong>PR ${String(merge.id)}</strong> ${escapeHtml(merge.title)}${took}</li>`;
}

/** The body of the recap panel: static HTML, no scripts */
export function renderRecapBody(recap: SprintRecap): string {
  const rate = recap.ci.total ? `${String(Math.round((recap.ci.green / recap.ci.total) * 100))}%` : '–';
  const records = [
    recap.fastestMerge && `⏱️ Quickest merge: PR ${String(recap.fastestMerge.id)} in ${recap.fastestMerge.took ?? '?'}`,
    recap.longestMerge && `🐢 Longest ride: PR ${String(recap.longestMerge.id)} in ${recap.longestMerge.took ?? '?'}`,
    recap.fastestApproval &&
      `⚡ Fastest first approval: ${String(recap.fastestApproval.minutes)} min by ${
        recap.fastestApproval.by
      } (PR ${String(recap.fastestApproval.pullRequestId)})`,
    recap.karma,
  ].filter((line): line is string => !!line);
  return `<main class="recap">
  <h1>🎉 ${escapeHtml(recap.title)}</h1>
  <ul class="highlights">${recap.highlights.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
  <section class="stats">
    ${stat(String(recap.merged.length), 'PRs merged')}
    ${stat(String(recap.opened), 'PRs opened')}
    ${stat(String(recap.reviewed), 'PRs reviewed')}
    ${stat(`${String(recap.workItems.done)}/${String(recap.workItems.total)}`, 'work items done')}
    ${stat(rate, 'CI runs green')}
    ${stat(String(recap.ci.bestStreak), 'best green streak')}
  </section>
  ${
    records.length
      ? `<h2>Records</h2><ul class="records">${records.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
      : ''
  }
  ${recap.merged.length ? `<h2>Shipped</h2><ul class="merged">${recap.merged.map(mergeLine).join('')}</ul>` : ''}
  <p class="muted note">Only what this extension saw counts, since you installed this version. Nothing here is shared: it stays on your machine.</p>
</main>`;
}
