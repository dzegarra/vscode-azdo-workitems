import { describe, expect, it } from 'vitest';
import { groupByPerson, shapeTeamItems, teamCompletedPullRequests, type TeamSnapshot } from './teamData';
import { historyRefsOf, type TimelineRow } from './sprintTimelineModel';
import { buildWholeTeamTimeline, rowNote, sectionSummary, type TeamTimelineInput } from './teamTimelineModel';
import { link, options, rawItem, rawPr, snapshot } from './teamTestData';
import { buildBoard } from './trackBoardModel';

const NOW = new Date(2026, 9, 22, 14, 0);
const ACTIVATED = 'Microsoft.VSTS.Common.ActivatedDate';
const links = (childIds: number[], ...prs: number[]) => ({
  ...rawItem(1).links,
  childIds,
  pullRequests: prs.map(link),
});
const d = (day: number, hour = 10) => new Date(2026, 9, day, hour).toISOString();

function build(snap: TeamSnapshot, overrides: Partial<TeamTimelineInput> = {}, showCompleted = true, scope = 'team') {
  const people = groupByPerson(shapeTeamItems(snap, { ...options, now: NOW }), snap);
  const board = buildBoard({
    status: 'ready',
    workItems: [],
    myPullRequests: [],
    reviews: [],
    reviewsStatus: 'ready',
    maxWaitHours: 24,
    iterations: [],
    kinds: ['backlog', 'bug'],
    showCompleted,
    now: NOW,
    look: 'theme',
    popoverDelay: 500,
  });
  return buildWholeTeamTimeline({
    now: NOW,
    workingDays: [1, 2, 3, 4, 5],
    maxWaitHours: 24,
    board,
    workItems: [],
    myPullRequests: [],
    reviews: [],
    sprint: { name: 'Sprint 1', startDate: '2026-10-12T00:00:00Z', finishDate: '2026-10-23T00:00:00Z' },
    base: { branch: 'develop', enabled: false, runs: [] },
    scope: scope === 'team' ? 'team' : 'mine',
    team: {
      status: 'ready',
      teamCount: 1,
      chosen: [{ id: 'ana', name: 'Ana Ruiz EXT' }],
      candidates: [{ id: 'ana', name: 'Ana Ruiz EXT' }],
      people,
      completed: teamCompletedPullRequests(snap),
      kinds: ['backlog', 'bug'],
      rules: { dueSoonHours: 6, maxWaitHours: 24, workingDays: [1, 2, 3, 4, 5] },
      waitedOn: new Map(),
      ownBadges: new Map(),
      ...overrides,
    },
  });
}

const person = (name: string, id: string) => ({ assignedTo: `${name} EXT`, assigneeId: id });

describe('buildWholeTeamTimeline', () => {
  it('keeps the user first, then the people by name, each with read-only rows (TIMELINE-21, TIMELINE-23)', () => {
    const snap = snapshot({
      items: [
        rawItem(1, { links: links([], 10), ...person('Zed Zebra', 'zed') }),
        rawItem(2, { links: links([], 11), ...person('Ana Ruiz', 'ana') }),
      ],
      pullRequests: [rawPr(10), rawPr(11)],
    });
    const model = build(snap);
    expect(model.team?.sections.map((s) => s.name)).toEqual(['You', 'Ana Ruiz', 'Zed Zebra']);
    const ana = model.team?.sections.at(1);
    expect(ana?.rows.every((row) => row.readOnly && !row.action && !row.popover)).toBe(true);
    expect(ana?.meta).toContain('1 open');
    expect(model.team?.openItems).toBe(2);
  });

  it('shows only the user with a hint when nobody is chosen (TIMELINE-21)', () => {
    const model = build(snapshot(), { chosen: [], people: [] });
    expect(model.team?.noPeople).toBe(true);
    expect(model.team?.sections.map((s) => s.you)).toEqual([true]);
  });

  it('does not add a team to the "mine" scope', () => {
    expect(build(snapshot(), {}, true, 'mine').team).toBeUndefined();
  });

  it('has one read-only row for a work item with several PRs, whose children are the PRs (TIMELINE-16)', () => {
    const snap = snapshot({
      items: [rawItem(5, { links: links([], 20, 21), ...person('Ana Ruiz', 'ana') })],
      pullRequests: [rawPr(20), rawPr(21)],
    });
    const rows = build(snap).team?.sections.at(1)?.rows ?? [];
    expect(rows.map((row) => row.key)).toEqual(['5:pr:21']);
    expect(rows[0].children?.map((child) => child.key).sort()).toEqual(['pr:5:20', 'pr:5:21']);
    expect(rows.every((row) => row.readOnly)).toBe(true);
  });

  it('draws merged PRs within the axis, whatever the Completed chip of the board (TIMELINE-17, TIMELINE-19)', () => {
    const snap = snapshot({
      items: [rawItem(6, { links: links([], 30), ...person('Ana Ruiz', 'ana') })],
      pullRequests: [
        rawPr(30, { status: 'completed', closedDate: d(20), creationDate: d(14) }),
        rawPr(31, { creationDate: d(21) }),
      ],
    });
    const mergedOf = (rows: TimelineRow[]) =>
      rows.flatMap((row) => row.children ?? []).filter((child) => child.kind === 'pr' && child.merged !== undefined);
    const withMerged = build(snap).team?.sections.at(1)?.rows ?? [];
    expect(mergedOf(withMerged)).toHaveLength(1);
    const boardOff = build(snap, {}, false).team?.sections.at(1)?.rows ?? [];
    expect(mergedOf(boardOff)).toHaveLength(1);
  });

  it('puts the finished work items of a person apart (TIMELINE-19)', () => {
    const snap = snapshot({
      items: [
        rawItem(7, { state: 'Done', ...person('Ana Ruiz', 'ana') }),
        rawItem(8, { ...person('Ana Ruiz', 'ana') }),
      ],
    });
    const section = build(snap).team?.sections.at(1);
    expect(section?.finished.map((row) => row.id)).toEqual([7]);
    expect(
      build(snap, {}, false)
        .team?.sections.at(1)
        ?.finished.map((row) => row.id)
    ).toEqual([7]);
  });

  it('starts the coding of a PR of another person at the activation of its task, with no request (TIMELINE-24)', () => {
    const snap = snapshot({
      items: [rawItem(9, { links: links([90], 40), ...person('Ana Ruiz', 'ana') })],
      children: [rawItem(90, { type: 'Task', state: 'Active', links: links([], 40), fields: { [ACTIVATED]: d(15) } })],
      pullRequests: [rawPr(40, { creationDate: d(20) })],
    });
    const model = build(snap);
    const child = model.team?.sections
      .at(1)
      ?.rows.at(0)
      ?.children?.find((candidate) => candidate.kind === 'pr');
    const implementation =
      child?.kind === 'pr' ? child.segments.find((segment) => segment.kind === 'implementation') : undefined;
    expect(implementation?.tip).toContain('task 90');
    expect(model.firstCommitsWanted).toEqual([]);
  });

  it('has expandable rows for the others, collapsed, read-only, whose PRs open in the browser (TIMELINE-23, TEAM-8)', () => {
    const snap = snapshot({
      items: [rawItem(12, { links: links([], 50), ...person('Ana Ruiz', 'ana') })],
      pullRequests: [rawPr(50, { creationDate: d(20) })],
    });
    const row = build(snap).team?.sections.at(1)?.rows.at(0);
    expect(row).toMatchObject({ readOnly: true, expandable: true, defaultExpanded: false, action: undefined });
    const child = row?.children?.find((candidate) => candidate.kind === 'pr');
    expect(child?.kind === 'pr' && child.open.type).toBe('openTeamPullRequest');
    expect(child?.kind === 'pr' && child.action).toBeFalsy();
    expect(child?.kind === 'pr' && child.historyRef).toMatchObject({ id: 50, closed: false });
  });

  it('asks the history of the PRs of the rows of others only for the ones that are expanded (TEAM-8)', () => {
    const snap = snapshot({
      items: [rawItem(12, { links: links([], 50), ...person('Ana Ruiz', 'ana') })],
      pullRequests: [rawPr(50, { creationDate: d(20) })],
    });
    const model = build(snap);
    expect(historyRefsOf(model, new Set())).toEqual([]);
    expect(historyRefsOf(model, new Set([12])).map((ref) => ref.id)).toEqual([50]);
  });

  it('lists the asleep items with their owner (TIMELINE-25)', () => {
    const snap = snapshot({
      items: [rawItem(11, { fields: { 'System.ChangedDate': d(1) }, ...person('Piotr Lis', 'piotr') })],
    });
    expect(build(snap).team?.asleep).toEqual([{ id: 11, owner: 'Piotr' }]);
  });
});

describe('sectionSummary', () => {
  const facts = {
    you: false,
    first: 'Jonas',
    needYou: 0,
    asleep: 0,
    chain: [],
    yourReviews: 0,
    overdueReviews: 0,
    inReview: 0,
  };
  it('says what to know about a person (TIMELINE-25)', () => {
    expect(sectionSummary({ ...facts, you: true, needYou: 2, asleep: 1 })).toBe('2 need you · 1 asleep');
    expect(sectionSummary({ ...facts, inReview: 1 })).toBe('waiting on reviewers');
    expect(sectionSummary({ ...facts, chain: [66280] })).toBe('your #66280 waits on Jonas');
    expect(sectionSummary({ ...facts, overdueReviews: 1, inReview: 1 })).toBe("Jonas's PR waits on overdue reviews");
    expect(sectionSummary({ ...facts })).toBe('');
  });
});

describe('rowNote', () => {
  it('prefers the review of the user over a late reviewer (TIMELINE-23)', () => {
    const note = rowNote([
      { kind: 'otherReview', text: "Ana's review -1 h", tone: 'broken', title: '' },
      { kind: 'review', text: 'your review 5 h', tone: 'needsYou', title: '' },
    ]);
    expect(note).toEqual({ text: 'your review 5 h', tone: 'dueSoon' });
    expect(rowNote([])).toBeUndefined();
  });
});
