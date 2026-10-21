/** Groups of the CI runs of the status bar item and the Markdown of its tooltip. Pure, so no "vscode" import */
import {
  ciTooltipTitle,
  countRunStates,
  RunCount,
  RunModel,
  RunState,
  runStateLabel,
  shortBranchName,
  STATE_ICONS,
} from './pipelines';
import { runExtraLines, runLabel, testsUrl } from './runDetails';

export interface CiPullRequestRun {
  pullRequestId: number;
  title: string;
  /** E.g. "refs/heads/feature/x" */
  sourceRefName?: string;
  webUrl?: string;
  run: RunModel;
}

export interface CiMergeRun {
  pullRequestId: number;
  title: string;
  webUrl?: string;
  /** E.g. "develop" */
  targetBranch: string;
  run: RunModel;
}

export interface CiBranchRun {
  branch: string;
  run: RunModel;
}

export interface CiRunsInput {
  pullRequestRuns: CiPullRequestRun[];
  mergeRuns: CiMergeRun[];
  branchRuns: CiBranchRun[];
  /** Branch checked out in the window, without "refs/heads/" */
  currentBranch?: string;
}

/** The runs of one PR, of one merge or of one branch */
export type CiRunGroup =
  | { kind: 'pullRequest'; pullRequestId: number; title: string; webUrl?: string; current: boolean; runs: RunModel[] }
  | { kind: 'merge'; pullRequestId: number; title: string; webUrl?: string; targetBranch: string; runs: RunModel[] }
  | { kind: 'branch'; branch: string; current: boolean; runs: RunModel[] };

type PullRequestGroup = Extract<CiRunGroup, { kind: 'pullRequest' }>;

/** Entries grouped by key, in the order the keys first appear */
function groupBy<T>(entries: T[], key: (entry: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    groups.set(key(entry), [...(groups.get(key(entry)) ?? []), entry]);
  }
  return [...groups.values()];
}

/**
 * Rules STATUSBAR-CI-5..8: one group per PR (the PR of the checked out branch first), then the merges of the
 * user's PRs, then the branches with runs queued by hand
 */
export function ciRunGroups({ pullRequestRuns, mergeRuns, branchRuns, currentBranch }: CiRunsInput): CiRunGroup[] {
  const pullRequests = groupBy(pullRequestRuns, (entry) => String(entry.pullRequestId)).map(
    (entries): PullRequestGroup => {
      const [first] = entries;
      return {
        kind: 'pullRequest',
        pullRequestId: first.pullRequestId,
        title: first.title,
        webUrl: first.webUrl,
        current: !!currentBranch && !!first.sourceRefName && shortBranchName(first.sourceRefName) === currentBranch,
        runs: entries.map(({ run }) => run),
      };
    }
  );
  // Rule STATUSBAR-CI-5
  const ordered = [...pullRequests.filter((group) => group.current), ...pullRequests.filter((group) => !group.current)];
  // Rule STATUSBAR-CI-8
  const merges = groupBy(mergeRuns, (entry) => `${String(entry.pullRequestId)}\n${entry.targetBranch}`).map(
    (entries): CiRunGroup => {
      const [first] = entries;
      return {
        kind: 'merge',
        pullRequestId: first.pullRequestId,
        title: first.title,
        webUrl: first.webUrl,
        targetBranch: first.targetBranch,
        runs: entries.map(({ run }) => run),
      };
    }
  );
  // Rule STATUSBAR-CI-6
  const branches = groupBy(branchRuns, (entry) => entry.branch).map(
    (entries): CiRunGroup => ({
      kind: 'branch',
      branch: entries[0].branch,
      current: entries[0].branch === currentBranch,
      runs: entries.map(({ run }) => run),
    })
  );
  return [...ordered, ...merges, ...branches];
}

/**
 * State of the checked out branch: the most severe one of the runs of its PR or, without a PR, of its manual
 * runs (the merges do not count); undefined when it has no run. Rules STATUSBAR-CI-3, STATUSBAR-CI-9 colour the item with it
 */
export function currentBranchState(groups: CiRunGroup[]): RunState | undefined {
  const runsOf = (kind: 'branch' | 'pullRequest') =>
    groups.flatMap((group) => (group.kind === kind && group.current ? group.runs : []));
  const pullRequestRuns = runsOf('pullRequest');
  const runs = pullRequestRuns.length ? pullRequestRuns : runsOf('branch');
  return countRunStates(runs.map((run) => run.state)).at(0)?.state;
}

/** Titles of the sections of the tooltip and of the picker */
export const MERGE_SECTION = 'AFTER MERGE';
export const BRANCH_SECTION = 'RUNS WITHOUT A PULL REQUEST';
export const CURRENT_BRANCH_LABEL = 'Current branch';

/** A piece of the tooltip: Markdown, or text to escape */
export interface TooltipPart {
  kind: 'md' | 'text';
  value: string;
}

const md = (value: string): TooltipPart => ({ kind: 'md', value });
const text = (value: string): TooltipPart => ({ kind: 'text', value });

/** Leading spaces would make a code block: non-breaking spaces indent the lines of a block */
const INDENT = '&nbsp;'.repeat(4);
const LINE_BREAK = '  \n';
const SEPARATOR = '\n\n---\n\n';

/** Escapes the characters that Markdown would interpret, e.g. in the text of a link */
export function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

const link = (label: string, url: string | undefined) =>
  url ? `[${escapeMarkdown(label)}](${url})` : escapeMarkdown(label);

/** "❌ Pipeline · **[2 tests failed](tests url)**" and its failed tests or coverage below */
function runLines(run: RunModel, now: Date): TooltipPart[] {
  const label = runLabel(run, now);
  return [
    md(`${INDENT}${STATE_ICONS[run.state]} `),
    text(run.pipeline),
    md(` · **${link(label.text, label.opensTests ? testsUrl(run.url) : run.url)}**${LINE_BREAK}`),
    ...runExtraLines(run).flatMap((line) => [md(INDENT.repeat(2)), text(line.trimEnd()), md(LINE_BREAK)]),
  ];
}

const currentMark = md(`$(star-full) **${CURRENT_BRANCH_LABEL}**${LINE_BREAK}`);

function groupHeader(group: CiRunGroup): TooltipPart[] {
  switch (group.kind) {
    case 'pullRequest':
      return [
        ...(group.current ? [currentMark] : []),
        md(`$(git-pull-request) **${link(`PR ${String(group.pullRequestId)}`, group.webUrl)}**`),
        ...(group.title ? [md(' · '), text(group.title)] : []),
        md(LINE_BREAK),
      ];
    case 'merge':
      return [
        md(`$(git-merge) **${link(`PR ${String(group.pullRequestId)}`, group.webUrl)}** merged into `),
        text(group.targetBranch),
        ...(group.title ? [md(' · '), text(group.title)] : []),
        md(LINE_BREAK),
      ];
    case 'branch':
      return [...(group.current ? [currentMark] : []), md('$(git-branch) '), text(group.branch), md(LINE_BREAK)];
  }
}

const sectionOf = (group: CiRunGroup): string | undefined => {
  switch (group.kind) {
    case 'pullRequest':
      return undefined;
    case 'merge':
      return MERGE_SECTION;
    case 'branch':
      return BRANCH_SECTION;
  }
};

/**
 * Rule STATUSBAR-CI-7: the tooltip of the CI item: the totals, then one block per group with its header first and
 * its runs indented below, separated by a rule; the merges and the runs without a PR under their own section title
 */
export function ciTooltipParts(groups: CiRunGroup[], counts: RunCount[], now: Date): TooltipPart[] {
  const current = currentBranchState(groups);
  const parts: TooltipPart[] = [
    md('**'),
    text(ciTooltipTitle(counts)),
    md(`**${LINE_BREAK}`),
    // What the colour of the item says
    text(`Current branch: ${current ? `${STATE_ICONS[current]} ${runStateLabel(current)}` : 'no CI runs'}`),
  ];
  let section: string | undefined;
  for (const group of groups) {
    // Rule STATUSBAR-CI-7
    parts.push(md(SEPARATOR));
    const next = sectionOf(group);
    if (next && next !== section) {
      parts.push(md(`**${next}**\n\n`));
    }
    section = next;
    parts.push(...groupHeader(group), ...group.runs.flatMap((run) => runLines(run, now)));
  }
  parts.push(md(`${SEPARATOR}_Click to open a run_`));
  return parts;
}
