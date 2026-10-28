/**
 * Which work items were in a past sprint, from their history (Rules TIMELINE-43, TIMELINE-44): every work item that had
 * one of the sprint's iteration paths while it was assigned to one of the people shown, at some moment between the start
 * of the sprint and its end, whether it was planned before or added while it ran. For each: when it joined (after the
 * start), when it left and for where (before the end), and where it went after the end. Pure, so no "vscode" import
 */
import type { WorkItemUpdate } from './workItemStateHistory';

/** Where a work item went: an iteration ("Sprint 124", "MVP R3" with `sprint` false) or a person */
export interface MembershipTarget {
  kind: 'iteration' | 'person';
  name: string;
  /** An iteration that is a sprint (its name ends with "Sprint <n>") */
  sprint: boolean;
}

export interface SprintMembership {
  /** It joined the sprint after it started (planned later, or assigned later) */
  enteredAt?: number;
  /** It left before the sprint ended: when, and for where */
  left?: { at: number; to: MembershipTarget };
  /** It was in the sprint at its end and moved to another iteration afterwards: the first one */
  next?: MembershipTarget;
}

interface Revision {
  at: number;
  path?: string;
  assignee?: string;
  assigneeName?: string;
}

const when = (value: unknown): number | undefined => {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? undefined : ms;
};

/** `System.AssignedTo` of an update: an identity (`id`, `displayName`), or nothing when unassigned */
function identity(value: unknown): { id?: string; name?: string } {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const { id, displayName } = value as { id?: unknown; displayName?: unknown };
  return {
    id: typeof id === 'string' ? id : undefined,
    name: typeof displayName === 'string' ? displayName : undefined,
  };
}

/** The iteration path and the assignee after each update, oldest first */
export function revisions(updates: readonly WorkItemUpdate[]): Revision[] {
  const result: Revision[] = [];
  let current: Omit<Revision, 'at'> = {};
  for (const update of updates) {
    const fields = update.fields ?? {};
    const at = when(fields['System.ChangedDate']?.newValue);
    const path = fields['System.IterationPath'];
    const assigned = fields['System.AssignedTo'];
    if (at === undefined || (!path && !assigned)) {
      continue;
    }
    const person = assigned ? identity(assigned.newValue) : undefined;
    current = {
      path: path && typeof path.newValue === 'string' ? path.newValue : current.path,
      assignee: person ? person.id : current.assignee,
      assigneeName: person ? person.name : current.assigneeName,
    };
    result.push({ at, ...current });
  }
  return result;
}

/** "…\MVP R3\Platform Sprint 124" → "Sprint 124"; "…\MVP R3" → "MVP R3", not a sprint */
export function iterationTarget(path: string): MembershipTarget {
  const last = path.split('\\').at(-1) ?? path;
  const sprint = /Sprint \d+$/i.exec(last);
  return { kind: 'iteration', name: sprint ? sprint[0] : last, sprint: !!sprint };
}

// Rules TIMELINE-43, TIMELINE-44
/**
 * Was the work item in the sprint, from its updates: in one of `paths` and assigned to one of `people` (identity ids)
 * at some moment of [start, end). Undefined when it never was (planned there only before the sprint started, or after
 * it ended)
 */
export function sprintMembership(
  updates: readonly WorkItemUpdate[],
  sprint: { paths: ReadonlySet<string>; people: ReadonlySet<string>; start: number; end: number }
): SprintMembership | undefined {
  const list = revisions(updates);
  const inside = (revision: Revision): boolean =>
    revision.path !== undefined &&
    sprint.paths.has(revision.path) &&
    revision.assignee !== undefined &&
    sprint.people.has(revision.assignee);
  // The moments it was in: [from, to) of each revision that is in, cut to the sprint
  const spans = list.flatMap((revision, index) => {
    const from = Math.max(revision.at, sprint.start);
    const to = Math.min(list.at(index + 1)?.at ?? Number.POSITIVE_INFINITY, sprint.end);
    return inside(revision) && to > from ? [{ from, to, index }] : [];
  });
  const first = spans.at(0);
  const last = spans.at(-1);
  if (!first || !last) {
    return undefined;
  }
  const membership: SprintMembership = first.from > sprint.start ? { enteredAt: first.from } : {};
  if (last.to < sprint.end) {
    // It left: the revision after the last one in says where it went
    const after = list.at(last.index + 1);
    if (after) {
      const movedAway = after.path !== undefined && !sprint.paths.has(after.path);
      membership.left = {
        at: after.at,
        to: movedAway
          ? iterationTarget(after.path ?? '')
          : { kind: 'person', name: after.assigneeName ?? 'nobody', sprint: false },
      };
    }
    return membership;
  }
  // In at the end: the first iteration it went to afterwards
  const startPath = list[last.index].path;
  const moved = list
    .slice(last.index + 1)
    .find((revision) => revision.path !== undefined && revision.path !== startPath);
  if (moved?.path !== undefined) {
    membership.next = iterationTarget(moved.path);
  }
  return membership;
}
