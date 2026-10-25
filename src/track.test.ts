import { describe, expect, it } from 'vitest';
import type { RunModel } from './pipelines';
import {
  currentStation,
  tasksOf,
  trackPullRequest,
  workItemTrack,
  type TrackItem,
  type TrackPullRequest,
} from './track';
import type { BranchModel, PullRequestModel } from './viewModel';
import type { WorkItemAlert } from './alerts';

const branch: BranchModel = { name: 'feature/x/1-a', location: 'local', isCurrent: false, otherRepository: false };
const run = (state: RunModel['state']): RunModel => ({ id: 1, pipeline: 'PR', state, url: 'https://run' });

function pr(overrides: Partial<PullRequestModel> = {}): PullRequestModel {
  return {
    id: 10,
    title: 'PR',
    status: 'In review',
    tone: 'review',
    url: 'https://pr/10',
    isActive: true,
    runs: [],
    repository: 'User_Interface',
    otherRepository: false,
    ...overrides,
  };
}

function item(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    type: 'Product Backlog Item',
    state: 'Committed',
    branches: [branch],
    pullRequests: [],
    alerts: [],
    ...overrides,
  };
}

function mine(overrides: Partial<TrackPullRequest> = {}): TrackPullRequest {
  return {
    id: 10,
    isDraft: false,
    isCompleted: false,
    readyToMerge: false,
    autoComplete: false,
    canComplete: false,
    warnings: [],
    ...overrides,
  };
}

const states = (track: ReturnType<typeof workItemTrack>): string[] => track.map((station) => station.state);

describe('trackPullRequest', () => {
  it('follows the first PR of the open repository', () => {
    // Rule TRACK-1
    const other = pr({ id: 1, otherRepository: true });
    const here = pr({ id: 2 });
    expect(trackPullRequest({ pullRequests: [other, here] })?.id).toBe(2);
    expect(trackPullRequest({ pullRequests: [other] })?.id).toBe(1);
    expect(trackPullRequest({ pullRequests: [] })).toBeUndefined();
  });
});

describe('workItemTrack', () => {
  it('has six stations, Ready to Test last for Bugs', () => {
    expect(workItemTrack(item()).map((station) => station.label)).toEqual([
      'Branch',
      'Pull request',
      'CI',
      'Review',
      'Ready to be merged',
      'Done',
    ]);
    // Rule TRACK-7
    expect(workItemTrack(item({ type: 'Bug' })).at(-1)?.label).toBe('Ready to Test');
  });

  it('passes the branch station once there is a branch or a PR', () => {
    // Rule TRACK-2
    expect(workItemTrack(item({ branches: [] })).at(0)?.state).toBe('pending');
    expect(workItemTrack(item()).at(0)?.state).toBe('done');
    expect(workItemTrack(item({ branches: [], pullRequests: [pr()] })).at(0)?.state).toBe('done');
  });

  it('makes a draft the active station, with no CI nor review yet', () => {
    // Rules TRACK-3, TRACK-4, TRACK-5
    const track = workItemTrack(item({ pullRequests: [pr({ tone: 'draft', runs: [run('failed')] })] }));
    expect(states(track)).toEqual(['done', 'active', 'pending', 'pending', 'pending', 'pending']);
    expect(currentStation(track)?.id).toBe('pullRequest');
  });

  it('makes a failed run the author move and a running one in flight', () => {
    // Rule TRACK-4
    expect(workItemTrack(item({ pullRequests: [pr({ runs: [run('succeeded'), run('failed')] })] }))[2]).toMatchObject({
      state: 'needsYou',
      detail: 'failed',
    });
    expect(workItemTrack(item({ pullRequests: [pr({ runs: [run('running')] })] }))[2].state).toBe('active');
    expect(workItemTrack(item({ pullRequests: [pr({ runs: [run('succeeded')] })] }))[2].state).toBe('done');
  });

  it('lets the review go on while CI runs, and gives feedback back to the author', () => {
    // Rule TRACK-5
    expect(workItemTrack(item({ pullRequests: [pr({ runs: [run('running')] })] }))[3].state).toBe('active');
    expect(workItemTrack(item({ pullRequests: [pr({ tone: 'waiting' })] }))[3].state).toBe('needsYou');
    expect(workItemTrack(item({ pullRequests: [pr({ tone: 'rejected' })] }))[3].state).toBe('needsYou');
    expect(workItemTrack(item({ pullRequests: [pr({ tone: 'approved' })] }))[3].state).toBe('done');
  });

  it('is ready to be merged only when nothing stops the merge', () => {
    // Rule TRACK-6
    const withPr = item({ pullRequests: [pr({ runs: [run('succeeded')] })] });
    expect(workItemTrack(withPr, mine())[4].state).toBe('pending');
    expect(workItemTrack(withPr, mine({ readyToMerge: true, canComplete: true }))[4]).toMatchObject({
      state: 'needsYou',
      detail: 'complete it',
    });
    expect(workItemTrack(withPr, mine({ readyToMerge: true, autoComplete: true }))[4].state).toBe('active');
    const merge = {
      text: 'Auto-complete will not delete the branch',
      severity: 'warning' as const,
      concern: 'merge' as const,
    };
    expect(workItemTrack(withPr, mine({ warnings: [merge] }))[4].state).toBe('broken');
    // Someone else's PR: what My Pull Requests knows does not apply
    expect(workItemTrack(withPr, mine({ id: 99, readyToMerge: true }))[4].state).toBe('pending');
  });

  it('lights the station each warning is about', () => {
    // Rules TRACK-3, TRACK-6
    const withPr = item({ pullRequests: [pr()] });
    const title = { text: 'The title does not follow…', severity: 'warning' as const, concern: 'pullRequest' as const };
    const feedback = { text: 'Jonas is waiting for you', severity: 'warning' as const, concern: 'feedback' as const };
    expect(states(workItemTrack(withPr, mine({ warnings: [title] })))).toEqual([
      'done',
      'broken',
      'pending',
      'active',
      'pending',
      'pending',
    ]);
    // A warning without concern is about the PR itself
    expect(workItemTrack(withPr, mine({ warnings: [{ text: 'x', severity: 'warning' }] }))[1].state).toBe('broken');
    // Feedback is the review station's (the tone of the PR), not the PR's nor the merge's
    expect(states(workItemTrack(withPr, mine({ warnings: [feedback] })))[1]).toBe('done');
    expect(states(workItemTrack(withPr, mine({ warnings: [feedback] })))[4]).toBe('pending');
  });

  it('marks a merged PR as passed and asks to finish the work item', () => {
    // Rules TRACK-6, TRACK-7
    const merged = item({ pullRequests: [pr({ tone: 'completed', isActive: false })] });
    expect(states(workItemTrack(merged))).toEqual(['done', 'done', 'done', 'done', 'done', 'needsYou']);
    expect(workItemTrack({ ...merged, state: 'Done' }).at(-1)?.state).toBe('done');
  });

  it('breaks the last station of a finished work item with alerts', () => {
    // Rule TRACK-7
    const alert: WorkItemAlert = { rule: 'tasksNotDone', message: 'Ready to Test with tasks not done' };
    const track = workItemTrack(item({ type: 'Bug', state: 'Ready to Test', alerts: [alert] }));
    expect(track.at(-1)?.state).toBe('broken');
    expect(currentStation(track)?.id).toBe('done');
  });

  it('shows nothing reached for a removed work item', () => {
    // Rule TRACK-8
    const track = workItemTrack(item({ state: 'Removed', pullRequests: [pr()] }));
    expect(states(track)).toEqual(Array<string>(6).fill('pending'));
  });
});

describe('currentStation', () => {
  it('points at what needs the user before what is merely next', () => {
    // Rule TRACK-9
    const track = workItemTrack(item({ pullRequests: [pr({ runs: [run('running')], tone: 'waiting' })] }));
    expect(currentStation(track)?.id).toBe('review');
    expect(currentStation(workItemTrack(item()))?.id).toBe('pullRequest');
  });
});

describe('merged PR with work left', () => {
  const merged = pr({ tone: 'completed', isActive: false });
  const last = (track: ReturnType<typeof workItemTrack>) => track.at(-1);

  it('keeps Done pending while a task is open', () => {
    // Rule TRACK-7
    const track = workItemTrack(item({ pullRequests: [merged] }), undefined, [{ state: 'To Do' }, { state: 'Done' }]);
    expect(last(track)).toMatchObject({ state: 'pending', detail: 'PR merged · 1 task open' });
    const two = workItemTrack(item({ pullRequests: [merged] }), undefined, [
      { state: 'To Do' },
      { state: 'In Progress' },
    ]);
    expect(last(two)?.detail).toBe('PR merged · 2 tasks open');
  });

  it('keeps Done pending while the state is not started', () => {
    // Rule TRACK-7
    const track = workItemTrack(item({ state: 'Approved', pullRequests: [merged] }));
    expect(last(track)).toMatchObject({ state: 'pending', detail: 'PR merged · Approved' });
  });

  it('is the move of the user when the work is started and the tasks are done or removed', () => {
    // Rule TRACK-7
    const track = workItemTrack(item({ pullRequests: [merged] }), undefined, [{ state: 'Done' }, { state: 'Removed' }]);
    expect(last(track)).toMatchObject({ state: 'needsYou', detail: 'PR merged, move it to Done' });
  });

  it('collects the tasks of the list and the other tasks', () => {
    // Rule TRACK-7
    const tasks = tasksOf({ id: 1, otherTasks: [{ state: 'To Do' } as never] }, [
      { parentId: 1, state: 'Done', type: 'Task' },
      { parentId: 2, state: 'Done', type: 'Task' },
      { parentId: 1, state: 'Done', type: 'Bug' },
    ]);
    expect(tasks).toHaveLength(2);
  });
});
