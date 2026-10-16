/** What the compact work item rows show under the title. Pure, so no "vscode" import */
import { completionIssueCount, completionIssueLines } from './completionIssues';
import { fixesBugsText, fixLinksTooltip } from './fixLinks';
import { pullRequestTooltip } from './pullRequestModel';
import type { RunModel, RunState } from './pipelines';
import { runTooltip } from './runDetails';
import { severityLevel, severityName } from './priority';
import { isClosedState } from './states';
import { branchTooltip } from './workItemBranches';
import { taskCounts, taskProgress, taskProgressTooltip, type TaskCount } from './taskProgress';
import type { WorkItemModel } from './viewModel';
import { workingOnBadge } from './workingOn';

export type SignalKind =
  | 'alerts'
  | 'branch'
  | 'ci'
  | 'completion'
  | 'fixedBy'
  | 'fixesBugs'
  | 'priority'
  | 'pullRequest'
  | 'severity'
  | 'tasks'
  | 'workingOn';

export interface CompactSignal {
  kind: SignalKind;
  /** Short text next to the icon. Empty: icon only */
  label: string;
  /** Full information */
  title: string;
  /**
   * Colour: "urgency-N" / "urgency-none" (priority, severity), a branch or PR tone, the run state (ci),
   * "neutral" or "approved" (tasks), "rejected" (alerts), "caution" (completion issues),
   * "working-here" / "working-worktree" (working on), "bug" (fixes bugs, red) / "backlog" (fixed by, blue)
   */
  tone: string;
  /** The PR (or the branches) is in another repository: shown dimmed */
  otherRepository?: boolean;
  /** Tasks only: the numbers of the label with their state category, so each one gets the colour of its state */
  counts?: TaskCount[];
}

/** Worst state first: the one run that matters most stands for the rest. Canceled runs say nothing useful */
const CI_PRECEDENCE: RunState[] = ['failed', 'partial', 'running', 'queued', 'succeeded'];

/** The state of the run that matters most; undefined when there is none (or all were canceled) */
export function worstRunState(runs: Pick<RunModel, 'state'>[]): RunState | undefined {
  return CI_PRECEDENCE.find((candidate) => runs.some((run) => run.state === candidate));
}

function urgencySignals(item: WorkItemModel): CompactSignal[] {
  const signals: CompactSignal[] = [];
  if (item.priority) {
    signals.push({
      kind: 'priority',
      label: `P${item.priority}`,
      title: `${item.type} · Priority ${item.priority}`,
      tone: `urgency-${item.priority}`,
    });
  }
  if (item.severity) {
    const level = severityLevel(item.severity);
    signals.push({
      kind: 'severity',
      label: level ? `S${level}` : severityName(item.severity),
      title: `Severity ${item.severity}`,
      tone: `urgency-${level ?? 'none'}`,
    });
  }
  return signals;
}

// Rule SIGNAL-3
/** What keeps the work item from being completed (open predecessors, blocking tags, empty fields): a caution, not an alert */
function completionSignal(item: WorkItemModel): CompactSignal | undefined {
  const count = completionIssueCount(item);
  return count
    ? {
        kind: 'completion',
        label: String(count),
        title: `Cannot be completed yet: ${completionIssueLines(item).join(' · ')}`,
        tone: 'caution',
      }
    : undefined;
}

/** Backlog Item: the bugs it fixes (count). Bug: the Backlog Item that fixes it (its ID, or the count when several) */
function fixLinkSignal(item: WorkItemModel): CompactSignal | undefined {
  if (item.fixesBugs?.length) {
    const text = fixesBugsText(item.fixesBugs.length);
    return {
      kind: 'fixesBugs',
      label: String(item.fixesBugs.length),
      title: fixLinksTooltip(text, item.fixesBugs),
      tone: 'bug',
    };
  }
  if (item.fixedBy?.length) {
    const [first] = item.fixedBy;
    return {
      kind: 'fixedBy',
      label: item.fixedBy.length === 1 ? String(first.id) : String(item.fixedBy.length),
      title: fixLinksTooltip('Fixed by', item.fixedBy),
      tone: 'backlog',
    };
  }
  return undefined;
}

/** Several branches: their count, and the list of them in the tooltip */
function severalBranchesSignal(item: WorkItemModel): CompactSignal {
  const location = item.isCurrentBranch ? 'current' : item.branchLocation ?? 'remote';
  return {
    kind: 'branch',
    label: String(item.branches.length),
    title: `${item.branches.length} branches\n${item.branches
      .map((branch) => `${branchTooltip(branch)}${branch.worktree ? ' · worktree' : ''}`)
      .join('\n')}`,
    tone: location,
    otherRepository: item.branches.every((branch) => branch.otherRepository),
  };
}

// Rules SIGNAL-BRANCH-1..6
function branchSignal(item: WorkItemModel): CompactSignal | undefined {
  const deletable = item.deletableBranches ?? [];
  if (deletable.length && (isClosedState(item.state) || (item.branch && deletable.includes(item.branch)))) {
    // The PR was completed and the branch is still there: whatever the state of the work item
    return {
      kind: 'branch',
      label: 'not deleted',
      title: `${deletable.join(', ')}: the PR is merged, the branch should be deleted`,
      tone: 'leftover',
    };
  }
  if (!isClosedState(item.state) && item.branches.length > 1) {
    return severalBranchesSignal(item);
  }
  if (!item.branch) {
    // Only branches of other repositories
    const [other] = item.branches;
    return other && !isClosedState(item.state)
      ? { kind: 'branch', label: '', title: branchTooltip(other), tone: 'remote', otherRepository: true }
      : undefined;
  }
  if (isClosedState(item.state)) {
    // Once the branch is deleted nothing is left to tell
    return undefined;
  }
  if (item.isCurrentBranch) {
    return { kind: 'branch', label: 'current', title: `${item.branch}: checked out`, tone: 'current' };
  }
  const location = item.branchLocation ?? 'remote';
  return { kind: 'branch', label: '', title: `${item.branch} (${location})`, tone: location };
}

function ciSignal(item: WorkItemModel, now: Date): CompactSignal | undefined {
  const pr = item.pullRequests.at(0);
  if (!pr?.isActive || !pr.runs.length) {
    return undefined;
  }
  const state = worstRunState(pr.runs);
  if (!state) {
    return undefined;
  }
  return {
    kind: 'ci',
    label: '',
    title: pr.runs.map((run) => runTooltip(run, now)).join('\n'),
    tone: state,
  };
}

// Rules SIGNAL-1..10
/**
 * Signals of a work item, in the order they are shown: working on, priority, severity, predecessors, fix links, branch, PR, CI of the PR, tasks, alerts.
 * Each one only when it applies. `children` are the tasks of the work item
 */
export function compactSignals(
  item: WorkItemModel,
  children: Pick<WorkItemModel, 'state'>[] = [],
  now = new Date()
): CompactSignal[] {
  const signals: CompactSignal[] = [];
  if (item.workingOn) {
    const badge = workingOnBadge(item.workingOn, item.worktree);
    signals.push({ kind: 'workingOn', label: badge.label, title: badge.title, tone: `working-${item.workingOn}` });
  }
  signals.push(...urgencySignals(item));
  const completion = completionSignal(item);
  if (completion) {
    signals.push(completion);
  }
  const fix = fixLinkSignal(item);
  if (fix) {
    signals.push(fix);
  }
  const branch = branchSignal(item);
  if (branch) {
    signals.push(branch);
  }
  const pr = item.pullRequests.at(0);
  if (pr) {
    signals.push({
      kind: 'pullRequest',
      label: pr.status,
      title: pr.otherRepository ? pullRequestTooltip(pr) : `PR ${pr.id}: ${pr.title}`,
      tone: pr.tone,
      otherRepository: pr.otherRepository,
    });
  }
  const ci = ciSignal(item, now);
  if (ci) {
    signals.push(ci);
  }
  const progress = taskProgress(children);
  if (progress.total) {
    const { toDo, inProgress, done } = progress;
    signals.push({
      kind: 'tasks',
      label: `${toDo}/${inProgress}/${done}`,
      counts: taskCounts(progress),
      title: `${taskProgressTooltip(progress)} (to do/in progress/done)`,
      tone: done === progress.total ? 'approved' : 'neutral',
    });
  }
  if (item.alerts.length) {
    signals.push({
      kind: 'alerts',
      label: String(item.alerts.length),
      title: item.alerts.map((alert) => alert.message).join('\n'),
      tone: 'rejected',
    });
  }
  return signals;
}
