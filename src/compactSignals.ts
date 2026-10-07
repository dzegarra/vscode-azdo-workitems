/** What the compact work item rows show under the title. Pure, so no "vscode" import */
import { describeRun, RunState } from './pipelines';
import { severityLevel, severityName } from './priority';
import { isFinishedState } from './states';
import { taskProgress } from './taskProgress';
import type { WorkItemModel } from './viewModel';

export type SignalKind = 'alerts' | 'branch' | 'ci' | 'priority' | 'pullRequest' | 'severity' | 'tasks';

export interface CompactSignal {
  kind: SignalKind;
  /** Short text next to the icon. Empty: icon only */
  label: string;
  /** Full information */
  title: string;
  /**
   * Colour: "urgency-N" / "urgency-none" (priority, severity), a branch or PR tone, the run state (ci),
   * "neutral" or "approved" (tasks), "rejected" (alerts)
   */
  tone: string;
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

function branchSignal(item: WorkItemModel): CompactSignal | undefined {
  if (!item.branch) {
    return undefined;
  }
  if (isFinishedState(item.state)) {
    // Once the branch is deleted nothing is left to tell
    return item.leftoverBranch
      ? {
          kind: 'branch',
          label: 'not deleted',
          title: `${item.branch}: the PR is merged, the branch should be deleted`,
          tone: 'waiting',
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
    title: pr.runs.map((run) => `${run.pipeline}: ${describeRun(run, now)}`).join('\n'),
    tone: state,
  };
}

/**
 * Signals of a work item, in the order they are shown: priority, severity, branch, PR, CI of the PR, tasks, alerts.
 * Each one only when it applies. `children` are the tasks of the work item
 */
export function compactSignals(
  item: WorkItemModel,
  children: Pick<WorkItemModel, 'state'>[] = [],
  now = new Date()
): CompactSignal[] {
  const signals = urgencySignals(item);
  const branch = branchSignal(item);
  if (branch) {
    signals.push(branch);
  }
  const pr = item.pullRequests.at(0);
  if (pr) {
    signals.push({ kind: 'pullRequest', label: pr.status, title: `PR ${pr.id}: ${pr.title}`, tone: pr.tone });
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
