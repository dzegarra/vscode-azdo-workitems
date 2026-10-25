import { describe, expect, it } from 'vitest';
import { groupByPerson, shapeTeamItems, type TeamSnapshot } from './teamData';
import { buildTeamBoard, type TeamBoardInput } from './teamBoardModel';
import { link, options, rawItem, rawPr, snapshot } from './teamTestData';
import type { BoardReviewCard } from './trackBoardModel';

const NOW = new Date('2026-10-22T12:00:00Z');

const passed = { id: 9, pipeline: 'CI', state: 'succeeded' as const, url: '' };

const links = (...prs: number[]) => ({ ...rawItem(1).links, pullRequests: prs.map(link) });

const reviewer = (name: string, vote = 0, isRequired = true) => ({
  id: name.toLowerCase(),
  displayName: name,
  vote,
  isRequired,
});

function input(snap: TeamSnapshot, overrides: Partial<TeamBoardInput> = {}): TeamBoardInput {
  return {
    status: 'ready',
    teams: [
      { name: 'Platform Team', badge: 'PLT' },
      { name: 'Interface Apps', badge: 'IA' },
    ],
    selected: ['Platform Team', 'Interface Apps'],
    people: groupByPerson(shapeTeamItems(snap, options), snap),
    own: { items: [], cards: [], collapsedIds: [], badges: new Map() },
    reviews: [],
    kinds: ['backlog', 'bug'],
    showCompleted: true,
    completed: [],
    since: 0,
    rules: { dueSoonHours: 6, maxWaitHours: 24, workingDays: [1, 2, 3, 4, 5] },
    waitedOn: new Map(),
    now: NOW,
    ...overrides,
  };
}

const reviewCard = (id: number, overrides: Partial<BoardReviewCard> = {}): BoardReviewCard => ({
  kind: 'review',
  id,
  column: 'review',
  title: 'r',
  header: `PR ${String(id)}`,
  author: 'Ana',
  isRequired: true,
  deadline: '5 h',
  urgency: 'fresh',
  elapsed: 0.2,
  ciRunning: false,
  why: { title: 'w', text: 't' },
  facts: [],
  hover: [],
  deadlineText: '',
  openPullRequest: { label: 'Open PR', message: { type: 'refresh' } },
  ...overrides,
});

describe('buildTeamBoard', () => {
  const snap = snapshot({
    items: [
      // In review since the 20th at 08:00: far over the 24 working hours
      rawItem(1, { links: links(100) }),
      rawItem(2, { links: links(101), assignedTo: 'Zed Zebra', assigneeId: 'zed' }),
      rawItem(3, { state: 'Done', assignedTo: 'Zed Zebra', assigneeId: 'zed' }),
      rawItem(4, { assignedTo: undefined, assigneeId: undefined, type: 'Bug' }),
      rawItem(5, { links: { ...links(102, 103) }, assignedTo: 'Zed Zebra', assigneeId: 'zed' }),
    ],
    pullRequests: [
      rawPr(100, { reviewers: [reviewer('Jonas'), reviewer('Kim', 10)] }),
      rawPr(101, { reviewers: [reviewer('Jonas', -5)] }),
      rawPr(102),
      rawPr(103, { isDraft: true }),
    ],
    runs: new Map([
      [100, [passed]],
      [101, [{ ...passed, state: 'failed' as const }]],
      [102, [passed]],
    ]),
  });

  it('makes one lane per person: You first, the others by name, the unassigned last', () => {
    const model = buildTeamBoard(input(snap));
    expect(model.lanes.map((lane) => lane.name)).toEqual(['You', 'Ana Ruiz', 'Zed Zebra', 'Unassigned']);
    expect(model.lanes[0].you).toBe(true);
    expect(model.people).toBe(3);
    expect(model.workItems).toBe(5);
  });

  it('places the cards by station and marks approvals, who waits and CI', () => {
    const model = buildTeamBoard(input(snap));
    const ana = model.lanes.find((lane) => lane.name === 'Ana Ruiz');
    const review = ana?.cards.find((card) => card.id === 1);
    expect(review?.column).toBe('review');
    expect(review?.markers.map((marker) => marker.text)).toContain('1/2');
    const zed = model.lanes.find((lane) => lane.name === 'Zed Zebra');
    const ci = zed?.cards.find((card) => card.id === 2);
    expect(ci?.markers.map((marker) => marker.kind)).toContain('ci');
  });

  it('splits a work item with several open PRs into one card per PR, for everybody', () => {
    const model = buildTeamBoard(input(snap));
    const zed = model.lanes.find((lane) => lane.name === 'Zed Zebra');
    const cards = zed?.cards.filter((card) => card.id === 5) ?? [];
    expect(cards.map((card) => card.part).sort()).toEqual(['PR 102', 'PR 103']);
    expect(cards[0].siblings).toHaveLength(1);
  });

  it('marks the review the user owes and the late review of somebody else', () => {
    const own = buildTeamBoard(input(snap, { reviews: [reviewCard(100, { deadline: '-3 h', urgency: 'overdue' })] }));
    const mineMarker = own.lanes
      .find((lane) => lane.name === 'Ana Ruiz')
      ?.cards.find((card) => card.id === 1)
      ?.markers.find((marker) => marker.kind === 'review');
    expect(mineMarker?.text).toBe('your review -3 h');
    expect(own.looseReviews).toEqual([]);
    expect(own.columns.find((column) => column.id === 'review')?.overdue).toBe(1);

    const others = buildTeamBoard(input(snap));
    const marker = others.lanes
      .find((lane) => lane.name === 'Ana Ruiz')
      ?.cards.find((card) => card.id === 1)
      ?.markers.find((candidate) => candidate.kind === 'otherReview');
    expect(marker?.text).toMatch(/^Jonas's review -\d/);
    expect(marker?.tone).toBe('broken');
  });

  it('keeps the reviews that no card shows as loose reviews of the user', () => {
    const model = buildTeamBoard(input(snap, { reviews: [reviewCard(999)] }));
    expect(model.looseReviews).toEqual([999]);
    expect(model.columns.find((column) => column.id === 'review')?.count).toBeGreaterThanOrEqual(1);
  });

  it('marks a work item the work of the user waits for', () => {
    const model = buildTeamBoard(input(snap, { waitedOn: new Map([[1, [66280]]]) }));
    const card = model.lanes.find((lane) => lane.name === 'Ana Ruiz')?.cards.find((c) => c.id === 1);
    expect(card?.markers.find((marker) => marker.kind === 'chain')?.text).toContain('#66280');
    expect(card?.needsYou).toBe(true);
  });

  it('folds the finished work items of each lane into one card when Completed is off', () => {
    const on = buildTeamBoard(input(snap));
    const off = buildTeamBoard(input(snap, { showCompleted: false }));
    const zedOn = on.lanes.find((lane) => lane.name === 'Zed Zebra');
    const zedOff = off.lanes.find((lane) => lane.name === 'Zed Zebra');
    expect(zedOn?.cards.some((card) => card.id === 3)).toBe(true);
    expect(zedOff?.cards.some((card) => card.id === 3)).toBe(false);
    expect(zedOff?.collapsedIds).toEqual([3]);
  });

  it('shows the team badge only when several teams are shown', () => {
    const several = buildTeamBoard(input(snap));
    const one = buildTeamBoard(input(snap, { selected: ['Platform Team'] }));
    expect(several.lanes.flatMap((lane) => lane.cards).every((card) => card.team === 'PLT')).toBe(true);
    expect(one.lanes.flatMap((lane) => lane.cards).every((card) => card.team === undefined)).toBe(true);
  });

  it('filters by type and hides the lanes without cards', () => {
    const model = buildTeamBoard(input(snap, { kinds: ['bug'] }));
    expect(model.lanes.map((lane) => lane.name)).toEqual(['You', 'Unassigned']);
  });

  it('draws the cards of others calm: orange is for what the user owes', () => {
    const model = buildTeamBoard(input(snap));
    const zed = model.lanes.find((lane) => lane.name === 'Zed Zebra');
    expect(zed?.cards.find((card) => card.id === 2)?.tone).not.toBe('needsYou');
    const mine = buildTeamBoard(input(snap, { reviews: [reviewCard(100)] }));
    expect(mine.lanes.find((lane) => lane.name === 'Ana Ruiz')?.cards.find((card) => card.id === 1)?.tone).toBe(
      'needsYou'
    );
  });

  it('does not count the unassigned as a person nor in the load', () => {
    const model = buildTeamBoard(input(snap));
    expect(model.people).toBe(3);
    expect(model.insights.find((insight) => insight.kind === 'load')?.text).not.toContain('Unassigned');
  });

  it('takes the initials of the user lane from their name', () => {
    expect(buildTeamBoard(input(snap, { youName: 'Daniel Zegarra' })).lanes[0].initials).toBe('DZ');
  });

  it('tells the teams chosen', () => {
    const model = buildTeamBoard(input(snap, { selected: ['Interface Apps'] }));
    expect(model.teamsLabel).toBe('Teams 1 of 2');
    expect(model.teams.map((team) => team.selected)).toEqual([false, true]);
  });

  it('writes the insights: the bottleneck, the items without update and the load', () => {
    const many = snapshot({
      items: Array.from({ length: 4 }, (_, index) => rawItem(10 + index, { links: links(200 + index) })),
      pullRequests: Array.from({ length: 4 }, (_, index) => rawPr(200 + index, { reviewers: [reviewer('Jonas')] })),
      runs: new Map([200, 201, 202, 203].map((id) => [id, [passed]])),
    });
    const model = buildTeamBoard(input(many));
    const text = (kind: string) => model.insights.find((insight) => insight.kind === kind)?.text;
    expect(text('flow')).toMatch(/^Review is the bottleneck: 4 PRs, 4 overdue/);
    expect(text('asleep')).toBe('Every item in progress was updated');
    expect(text('load')).toBe('Ana Ruiz 4 (1)');
    const asleep = snapshot({
      items: [rawItem(1, { fields: { 'System.ChangedDate': '2026-10-01T08:00:00Z' } })],
    });
    expect(buildTeamBoard(input(asleep)).insights.find((insight) => insight.kind === 'asleep')?.text).toBe(
      '1 item without update'
    );
  });

  it('does not ask for more than it shows: a view without data is an empty lane of the user', () => {
    const model = buildTeamBoard(input(snapshot(), { status: 'loading', people: [] }));
    expect(model.lanes.map((lane) => lane.name)).toEqual(['You']);
    expect(model.status).toBe('loading');
  });
});
