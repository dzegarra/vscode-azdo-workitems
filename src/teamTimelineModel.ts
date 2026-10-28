/**
 * The Whole team Sprint timeline (redesign phase 7b): one section per person under the axis of the timeline, built from
 * the same cards as the Whole team Track board (teamBoardModel.ts) and drawn by the timeline's own row builders
 * (sprintTimelineModel.ts), so the rows of everybody follow the same rules: stations by work item, expandable
 * to its PRs, tags, Completed on/off, the zZ span. The rows of the others are read-only. Pure, so no "vscode" import
 */
import { isFinishedState } from './states';
import type { ReviewRules } from './reviewRequests';
import {
  axisOf,
  buildSprintTimeline,
  rowsOfCards,
  withAfterSprint,
  type RowContext,
  type TimelineInput,
  type TimelineModel,
  type TimelineRow,
  type TimelineSection,
  type TimelineTeam,
} from './sprintTimelineModel';
import { toTeamCard, type TeamCard, type TeamMarker } from './teamBoardModel';
import type { TeamPerson } from './teamData';
import { peopleLabel, pickerRows, type PickedPerson } from './teamPeople';
import { avatarColour, initials, shortPersonName } from './teamView';
import type { CompletedPullRequestInfo } from './completedPullRequests';
import { boardCards, boardItems, type BoardKind, type BoardWorkCard } from './trackBoardModel';

/** What the Whole team timeline needs besides the user's own timeline (Rule TIMELINE-21) */
export interface TeamTimelineInput {
  status: TimelineTeam['status'];
  error?: string;
  /** The teams whose sprints are read */
  teamCount: number;
  /** The people chosen (setting) and the ones the picker offers besides them */
  chosen: readonly PickedPerson[];
  candidates: readonly PickedPerson[];
  membersLoading?: boolean;
  /** The people with work in the snapshot (the user first) */
  people: TeamPerson[];
  /** The PRs of the snapshot that were merged (Rule TIMELINE-22) */
  completed: readonly CompletedPullRequestInfo[];
  kinds: BoardKind[];
  rules: Pick<ReviewRules, 'dueSoonHours' | 'maxWaitHours' | 'workingDays'>;
  /** Predecessor id -> the user's work items waiting for it */
  waitedOn: ReadonlyMap<number, number[]>;
  /** Badge of the team of each of the user's own work items (several teams) */
  ownBadges: ReadonlyMap<number, string>;
  /** Name of the user, for the initials of their section */
  youName?: string;
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

const firstName = (name: string): string => shortPersonName(name).split(' ').at(0) ?? name;

export interface SectionFacts {
  you: boolean;
  /** First name of the person */
  first: string;
  /** Cards that need the user (the user's own: the board's count) */
  needYou: number;
  asleep: number;
  /** The user's work items that wait for this person's */
  chain: number[];
  /** PRs of this person the user has to review */
  yourReviews: number;
  /** PRs of this person with a required reviewer who is late */
  overdueReviews: number;
  /** PRs of this person in the Review station */
  inReview: number;
}

// Rule TIMELINE-25
/** The short sentence in the lane of a person's header: what to know before reading their rows */
export function sectionSummary(facts: SectionFacts): string {
  if (facts.you) {
    return (
      [facts.needYou ? `${String(facts.needYou)} need you` : '', facts.asleep ? `${String(facts.asleep)} asleep` : '']
        .filter(Boolean)
        .join(' · ') || 'nothing waits on you'
    );
  }
  const waiting = facts.chain.map((id) => `#${String(id)}`).join(', ');
  const reviews = (): string => {
    if (facts.overdueReviews) {
      return `${facts.first}'s PR waits on overdue reviews`;
    }
    return facts.inReview ? 'waiting on reviewers' : '';
  };
  return [
    facts.chain.length ? `your ${waiting} ${facts.chain.length === 1 ? 'waits' : 'wait'} on ${facts.first}` : '',
    facts.yourReviews ? `${plural(facts.yourReviews, 'review')} for you` : '',
    reviews(),
    facts.asleep ? `${String(facts.asleep)} asleep` : '',
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}

const NOTE_ORDER: TeamMarker['kind'][] = ['review', 'otherReview', 'waits', 'chain'];

// Rule TIMELINE-23
/** The text after the bar of a row of another person: the user's review, a late reviewer, who waits */
export function rowNote(markers: readonly TeamMarker[]): TimelineRow['note'] {
  const marker = NOTE_ORDER.flatMap((kind) => markers.filter((candidate) => candidate.kind === kind)).at(0);
  if (!marker) {
    return undefined;
  }
  let tone: NonNullable<TimelineRow['note']>['tone'] = 'fresh';
  if (marker.tone === 'broken') {
    tone = 'overdue';
  } else if (marker.tone === 'needsYou') {
    tone = 'dueSoon';
  }
  return { text: marker.text, tone };
}

/** The row as the others' sections show it: read-only, no button, no popover (Rule TIMELINE-23) */
const readOnlyRow = (row: TimelineRow, note: TimelineRow['note']): TimelineRow => ({
  ...row,
  action: undefined,
  popover: undefined,
  readOnly: true,
  ...(note && !row.note ? { note } : {}),
});

interface PersonRows {
  work: TimelineRow[];
  finished: TimelineRow[];
  cards: BoardWorkCard[];
  teamCards: { card: TeamCard; overdue: boolean }[];
}

// Rules TIMELINE-22..24
/** The rows of one person: their cards as the Track board builds them, drawn with the timeline's row builders */
function personRows(
  person: TeamPerson,
  base: {
    input: TimelineInput;
    team: TeamTimelineInput;
    days: RowContext['days'];
    sprintEnd: number;
    now: number;
    statesWanted: Map<number, string>;
    commitsWanted: Map<number, { key: string; repositoryId?: string }>;
  }
): PersonRows {
  const { input, team, days, sprintEnd, now, statesWanted, commitsWanted } = base;
  const models = person.items.map((item) => item.model);
  const items = boardItems(models, team.kinds);
  const axisStart = days[0].startMs;
  // The merged PRs are rows of their work item when it is expanded (TIMELINE-17), not cards: the board's merged cards are left out
  const { cards } = boardCards({
    items,
    workItems: models,
    myPullRequests: [],
    queue: [],
    // Rule TIMELINE-19: the timeline always draws the finished work items
    showCompleted: true,
    completed: [],
    since: 0,
  });
  const marked = { reviews: input.board.reviews, rules: team.rules, now: input.now, waitedOn: team.waitedOn };
  const teamCards = cards.map((card) =>
    toTeamCard(card, { item: person.items.find((item) => item.model.id === card.id), input: marked, badge: undefined })
  );
  const context: RowContext = {
    input: {
      ...input,
      workItems: models,
      myPullRequests: [],
      completedPullRequests: team.completed,
      firstCommits: undefined,
    },
    team: { pullRequests: new Map(person.items.flatMap((item) => item.pullRequests).map((pr) => [pr.id, pr])) },
    days,
    axisStart,
    now,
    firstCommitsWanted: new Set(),
    statesWanted,
    commitsWanted,
  };
  const rows = rowsOfCards(cards, context);
  const noteOf = (row: TimelineRow): TimelineRow['note'] => {
    const found = teamCards.find(({ card }) => card.key === row.boardKey);
    return found && rowNote(found.card.markers);
  };
  return {
    work: rows.work.map((row) => readOnlyRow(withAfterSprint(row, sprintEnd), noteOf(row))),
    finished: rows.finished.map((row) => readOnlyRow(withAfterSprint(row, sprintEnd), noteOf(row))),
    cards,
    teamCards,
  };
}

const distinct = (ids: readonly number[]): number[] => [...new Set(ids)];

// Rules TIMELINE-21..25
/**
 * The Sprint timeline of the user, with (scope "team") one section per person chosen under it. The user's section keeps
 * the rows, buttons and popovers of the "mine" timeline (`work`, `finished`, `reviews`); the others' are the same
 * rows, read-only. Without people chosen only the user's section is shown, with a hint
 */
export function buildWholeTeamTimeline(input: TimelineInput): TimelineModel {
  const model = buildSprintTimeline(input);
  const team = input.team;
  if (input.scope !== 'team' || !team) {
    return model;
  }
  const { days, sprintEnd } = axisOf(input);
  const showBadges = team.teamCount > 1;
  const you = team.people.find((person) => person.you);
  const others = team.people.filter((person) => !person.you);
  const now = input.now.getTime();
  const statesWanted = new Map<number, string>();
  const commitsWanted = new Map<number, { key: string; repositoryId?: string }>();
  const build = (person: TeamPerson): PersonRows & { person: TeamPerson } =>
    days.length
      ? { ...personRows(person, { input, team, days, sprintEnd, now, statesWanted, commitsWanted }), person }
      : { work: [], finished: [], cards: [], teamCards: [], person };
  const asleep: TimelineTeam['asleep'] = [];

  // The user's own work (the rows are the model's)
  const ownItems = boardItems(input.workItems, team.kinds).filter((item) => !isFinishedState(item.state));
  const ownIds = distinct(ownItems.map((item) => item.id));
  const youRows = you ? build(you) : undefined;
  const youBadges = new Set(ownIds.map((id) => team.ownBadges.get(id)).filter((badge): badge is string => !!badge));
  const youCards = input.board.work;
  const youAsleep = distinct(youCards.filter((card) => card.asleep).map((card) => card.id));
  asleep.push(...youAsleep.map((id) => ({ id, owner: 'you' })));
  const extraIds = distinct((youRows?.cards ?? []).map((card) => card.id));
  const youName = team.youName ?? 'You';
  const youSection: TimelineSection = {
    key: 'you',
    name: 'You',
    initials: initials(youName),
    colour: avatarColour(youName),
    you: true,
    meta: [
      `${String(ownIds.length + extraIds.length)} open`,
      showBadges && youBadges.size ? [...youBadges].join(' ') : '',
    ]
      .filter(Boolean)
      .join(' · '),
    summary: sectionSummary({
      you: true,
      first: 'you',
      needYou: youCards.filter((card) => card.tone === 'needsYou' || card.tone === 'ship' || card.verb).length,
      asleep: youAsleep.length,
      chain: [],
      yourReviews: 0,
      overdueReviews: 0,
      inReview: 0,
    }),
    rows: youRows?.work ?? [],
    finished: youRows?.finished ?? [],
  };

  // The others
  let openItems = ownIds.length + extraIds.length;
  const sections = others.flatMap((person): TimelineSection[] => {
    const built = build(person);
    if (!built.work.length && !built.finished.length) {
      return [];
    }
    const first = firstName(person.name);
    const open = person.items.filter(
      (item) => !isFinishedState(item.model.state) && boardItems([item.model], team.kinds).length
    );
    const badges = new Set(open.map((item) => item.team).filter((badge): badge is string => !!badge));
    const cards = built.teamCards.map(({ card }) => card);
    const asleepIds = distinct(built.cards.filter((card) => card.asleep).map((card) => card.id));
    asleep.push(...asleepIds.map((id) => ({ id, owner: first })));
    openItems += open.length;
    return [
      {
        key: person.key,
        name: shortPersonName(person.name),
        initials: initials(person.name),
        colour: avatarColour(shortPersonName(person.name)),
        you: false,
        meta: [`${String(open.length)} open`, showBadges && badges.size ? [...badges].join(' ') : '']
          .filter(Boolean)
          .join(' · '),
        summary: sectionSummary({
          you: false,
          first,
          needYou: 0,
          asleep: asleepIds.length,
          chain: distinct(
            built.cards.filter((card) => card.primary).flatMap((card) => team.waitedOn.get(card.id) ?? [])
          ),
          yourReviews: cards.filter((card) => card.markers.some((marker) => marker.kind === 'review')).length,
          overdueReviews: cards.filter((card) =>
            card.markers.some((marker) => marker.kind === 'otherReview' && marker.tone === 'broken')
          ).length,
          inReview: cards.filter((card) => card.column === 'review' && !card.merged).length,
        }),
        rows: built.work,
        finished: built.finished,
      },
    ];
  });
  return {
    ...model,
    statesWanted: [
      ...model.statesWanted,
      ...[...statesWanted]
        .filter(([id]) => !model.statesWanted.some((entry) => entry.id === id))
        .map(([id, key]) => ({ id, key })),
    ],
    commitsWanted: [
      ...model.commitsWanted,
      ...[...commitsWanted]
        .filter(([id]) => !model.commitsWanted.some((entry) => entry.id === id))
        .map(([id, wanted]) => ({ id, ...wanted })),
    ],
    team: {
      status: team.status,
      error: team.error,
      picker: {
        label: peopleLabel(team.chosen.length),
        ...pickerRows(team.chosen, team.candidates),
        loading: team.membersLoading === true,
      },
      noPeople: team.chosen.length === 0,
      teamCount: team.teamCount,
      sections: [youSection, ...sections],
      openItems,
      asleep,
    },
  };
}
