/** What the compact work item rows show under the title. Pure, so no "vscode" import */
import { isReadyToStart } from './predecessors';
import { pullRequestTooltip } from './pullRequestModel';
import { RunState } from './pipelines';
import { runTooltip } from './runDetails';
import { severityLevel, severityName } from './priority';
import { isFinishedState } from './states';
import { branchTooltip } from './workItemBranches';
import { taskProgress } from './taskProgress';
import type { WorkItemModel } from './viewModel';
import { workingOnBadge } from './workingOn';

export type SignalKind =
  | 'alerts'
  | 'branch'
  | 'ci'
  | 'predecessors'
  | 'priority'
  | 'pullRequest'
  | 'ready'
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
   * "neutral" or "approved" (tasks), "rejected" (alerts), "caution" (open predecessors), "approved" (ready to start),
   * "working-here" / "working-worktree" (working on)
   */
  tone: string;
  /** The PR (or the branches) is in another repository: shown dimmed */
  otherRepository?: boolean;
}

/** Worst state first: the one run that matters most stands for the rest. Canceled runs say nothing useful */
const CI_PRECEDENCE: RunState[] = ['failed', 'partial', 'running', 'queued', 'succeeded'];

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

/** Open predecessors: a caution, not an alert. Ready to start: not started and nothing open before it */
function predecessorSignal(item: WorkItemModel): CompactSignal | undefined {
  const count = item.openPredecessors?.length ?? 0;
  if (count) {
    return {
      kind: 'predecessors',
      label: String(count),
      title: `${count} open predecessor${count === 1 ? '' : 's'}: agree with their owners before starting`,
      tone: 'caution',
    };
  }
  return isReadyToStart(item)
    ? { kind: 'ready', label: 'ready', title: 'Ready to start: no open predecessors', tone: 'approved' }
    : undefined;
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

function branchSignal(item: WorkItemModel): CompactSignal | undefined {
  if (!isFinishedState(item.state) && item.branches.length > 1) {
    return severalBranchesSignal(item);
  }
  if (!item.branch) {
    // Only branches of other repositories
    const [other] = item.branches;
    return other && !isFinishedState(item.state)
      ? { kind: 'branch', label: '', title: branchTooltip(other), tone: 'remote', otherRepository: true }
      : undefined;
  }
  if (isFinishedState(item.state)) {
    // Once the branch is deleted nothing is left to tell
    return item.leftoverBranch
      ? {
          kind: 'branch',
          label: 'not deleted',
          title: `${item.branch}: the PR is merged, the branch should be deleted`,
          tone: 'leftover',
        }
      : undefined;
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
  const state = CI_PRECEDENCE.find((candidate) => pr.runs.some((run) => run.state === candidate));
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

/**
 * Signals of a work item, in the order they are shown: working on, priority, severity, predecessors, branch, PR, CI of the PR, tasks, alerts.
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
  const predecessors = predecessorSignal(item);
  if (predecessors) {
    signals.push(predecessors);
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
  const { done, total } = taskProgress(children);
  if (total) {
    signals.push({
      kind: 'tasks',
      label: `${done}/${total}`,
      title: `${done} of ${total} tasks done`,
      tone: done === total ? 'approved' : 'neutral',
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
