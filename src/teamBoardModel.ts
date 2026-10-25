/**
 * The whole-team view of the Track board (redesign phase 7a): one swimlane per person, the same six columns, the
 * cards of everybody's work items built by the board's own code (trackBoardModel.boardCards), read-only for the
 * others. The Sprint timeline (7b) draws the same people and cards. Pure, so no "vscode" import
 */
import { describeTimeLeft, timeLeftMs, type ReviewRules } from './reviewRequests';
import { peopleLabel, pickerRows, type PickedPerson } from './teamPeople';
import { avatarColour, initials } from './teamView';
import type { TeamItem, TeamPerson, TeamPullRequestInfo } from './teamData';
import {
  boardCards,
  boardItems,
  COLUMN_ORDER,
  shortDeadline,
  type BoardColumnId,
  type BoardFact,
  type BoardKind,
  type BoardReviewCard,
  type BoardStation,
  type BoardWorkCard,
  type BoardWhy,
  type CardTone,
  type MergedPullRequest,
} from './trackBoardModel';
import type { MyPullRequestModel } from './myPullRequests';
import type { WorkItemModel } from './viewModel';

export type MarkerTone = 'broken' | 'needsYou' | 'normal' | 'passed';

/** A small sign on a card: "CI ✕", "1/2", "Jonas waits", "your review 5 h" */
export interface TeamMarker {
  kind: 'approvals' | 'chain' | 'ci' | 'draft' | 'otherReview' | 'review' | 'waits';
  text: string;
  tone: MarkerTone;
  title: string;
}

/** The compact card of the whole-team board; also the row of a person's section of the Sprint timeline */
export interface TeamCard {
  key: string;
  /** The work item */
  id: number;
  column: BoardColumnId;
  /** "#66280" */
  idText: string;
  /** "PR 14021" for the card of a PR of a split work item, "✓ PR 14021" for a merged one */
  part?: string;
  title: string;
  itemKind: 'backlog' | 'bug';
  tone: CardTone;
  status?: BoardWorkCard['status'];
  tag?: string;
  note?: string;
  /** Badge of its team, shown when several teams are selected */
  team?: string;
  asleep?: { days: number; text: string };
  merged: boolean;
  markers: TeamMarker[];
  /** The PR a click opens in the browser (a PR card); else the click opens the Work Item Details panel */
  prUrl?: string;
  prId?: number;
  track: BoardStation[];
  hover: BoardFact[];
  why: BoardWhy;
  /** The user has something to do here: their review, or their own work waiting on it */
  needsYou: boolean;
  /** Keys of the other cards of the same work item (BOARD-14) */
  siblings: string[];
}

export interface TeamLane {
  key: string;
  name: string;
  initials: string;
  /** 0 to 5: the class of the avatar colour */
  colour: number;
  you: boolean;
  /** "7 items · 3 teams · 3 need you" */
  summary: string;
  /** The compact cards (for "You": only the items the board of the user does not have) */
  cards: TeamCard[];
  /** Finished work items folded into one dashed card (Completed off, BOARD-25) */
  collapsedIds: number[];
}

export interface TeamColumn {
  id: BoardColumnId;
  /** Cards of every lane (the folded finished work items count one each) */
  count: number;
  /** Cards whose review is overdue: "6 · 2 overdue" */
  overdue: number;
}

export interface TeamInsight {
  kind: 'asleep' | 'flow' | 'load';
  label: string;
  text: string;
}

/** The picker behind the People button: the chosen people first, then the candidates (the filter is typed in the page) */
export interface PeoplePicker {
  /** "People 3" */
  label: string;
  selected: PickedPerson[];
  candidates: PickedPerson[];
  /** The members of the teams are still being read */
  loading: boolean;
}

export interface TeamBoardModel {
  status: 'error' | 'loading' | 'ready';
  error?: string;
  /** The teams whose sprints are read */
  teamCount: number;
  picker: PeoplePicker;
  /** Rule TEAM-1: nobody is chosen yet: the lane of the user and a hint */
  noPeople: boolean;
  /** Several teams are shown: the cards carry their team badge */
  showBadges: boolean;
  people: number;
  workItems: number;
  columns: TeamColumn[];
  lanes: TeamLane[];
  /** Ids of the PRs to review that are no card of the lanes (no work item of the teams links them) */
  looseReviews: number[];
  insights: TeamInsight[];
}

export interface TeamBoardInput {
  status: TeamBoardModel['status'];
  error?: string;
  /** The teams whose sprints are read */
  selected: readonly string[];
  /** The people chosen (setting) and the ones the picker offers besides them */
  chosen: readonly PickedPerson[];
  candidates: readonly PickedPerson[];
  membersLoading?: boolean;
  people: TeamPerson[];
  /** The board of the user: its work items (see boardItems) and the cards already built for them */
  own: { items: WorkItemModel[]; cards: BoardWorkCard[]; collapsedIds: number[]; badges: ReadonlyMap<number, string> };
  /** The PRs the user must review, as the board has them */
  reviews: BoardReviewCard[];
  kinds: BoardKind[];
  showCompleted: boolean;
  completed: readonly MergedPullRequest[];
  since: number;
  rules: Pick<ReviewRules, 'dueSoonHours' | 'maxWaitHours' | 'workingDays'>;
  /** Predecessor id -> the user's work items waiting for it */
  waitedOn: ReadonlyMap<number, number[]>;
  now: Date;
  /** Name of the user, for the initials of their lane */
  youName?: string;
}

const MS_PER_HOUR = 3_600_000;

const firstName = (name: string): string => name.split(' ').at(0) ?? name;

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

// Rule BOARD-28
/** The PR a card stands for: the one of a PR card, else the one the card opens */
function cardPullRequestId(card: BoardWorkCard): number | undefined {
  if (card.prId !== undefined) {
    return card.prId;
  }
  if (card.merged) {
    return card.merged.prId;
  }
  const message = card.openPullRequest?.message;
  return message?.type === 'openPullRequest' ? message.pullRequestId : undefined;
}

/** Approvals of the required reviewers: "1/2"; undefined without required reviewers */
function approvals(info: TeamPullRequestInfo): TeamMarker | undefined {
  const required = info.reviewers.filter((reviewer) => reviewer.isRequired && !reviewer.isContainer);
  if (!required.length) {
    return undefined;
  }
  const done = required.filter((reviewer) => reviewer.vote === 'approved').length;
  return {
    kind: 'approvals',
    text: `${String(done)}/${String(required.length)}`,
    tone: done === required.length ? 'passed' : 'normal',
    title: `${plural(done, 'approval')} of ${String(required.length)} required`,
  };
}

/** A reviewer who sent the PR back: "Jonas waits" */
function waits(info: TeamPullRequestInfo): TeamMarker | undefined {
  const sentBack = info.reviewers.find((reviewer) => reviewer.vote === 'waiting' || reviewer.vote === 'rejected');
  return sentBack
    ? {
        kind: 'waits',
        text: `${firstName(sentBack.name)} ${sentBack.vote === 'waiting' ? 'waits' : 'rejected'}`,
        tone: 'needsYou',
        title: `${sentBack.name} ${sentBack.vote === 'waiting' ? 'waits for the author' : 'rejected the PR'}`,
      }
    : undefined;
}

// Rule BOARD-29
/**
 * A reviewer of somebody else's PR who has not voted and is late or about to be: "Ana's review -1 h". The wait starts
 * when the PR was published (TEAM-6). Optional reviewers and groups do not count
 */
function otherReview(
  info: TeamPullRequestInfo,
  rules: TeamBoardInput['rules'],
  now: Date
): { marker: TeamMarker; overdue: boolean } | undefined {
  const pending = info.reviewers.find(
    (reviewer) => reviewer.isRequired && !reviewer.isContainer && !reviewer.isMe && reviewer.vote === 'none'
  );
  if (!pending) {
    return undefined;
  }
  const left = timeLeftMs({ publishedAt: info.publishedAt }, now, rules);
  if (left > rules.dueSoonHours * MS_PER_HOUR) {
    return undefined;
  }
  const overdue = left <= 0;
  const text = describeTimeLeft({ publishedAt: info.publishedAt }, now, rules);
  return {
    overdue,
    marker: {
      kind: 'otherReview',
      text: `${firstName(pending.name)}'s review ${shortDeadline(text.replace(' left', ''))}`,
      tone: overdue ? 'broken' : 'needsYou',
      title: `${pending.name} has not reviewed it yet (${text})`,
    },
  };
}

function partText(card: BoardWorkCard): string | undefined {
  if (card.merged) {
    return `✓ PR ${String(card.merged.prId)}`;
  }
  return card.part === 'pr' && card.prId !== undefined ? `PR ${String(card.prId)}` : undefined;
}

interface CardContext {
  item: TeamItem | undefined;
  input: TeamBoardInput;
  badge: string | undefined;
}

function toTeamCard(card: BoardWorkCard, { item, input, badge }: CardContext): { card: TeamCard; overdue: boolean } {
  const prId = cardPullRequestId(card);
  const info = item?.pullRequests.find((candidate) => candidate.id === prId);
  const markers: TeamMarker[] = [];
  let overdue = false;
  let needsYou = false;
  if (card.column === 'ci' && card.status?.tone === 'broken') {
    markers.push({ kind: 'ci', text: 'CI ✕', tone: 'broken', title: card.status.text });
  }
  if (!card.merged && info && !info.isDraft) {
    const inReview = card.column === 'review' || card.column === 'ready';
    const approved = inReview ? approvals(info) : undefined;
    const sentBack = inReview ? waits(info) : undefined;
    if (approved) {
      markers.push(approved);
    }
    if (sentBack) {
      markers.push(sentBack);
    }
    const mine = input.reviews.find((review) => review.id === prId);
    if (mine) {
      overdue = mine.urgency === 'overdue';
      needsYou = true;
      markers.push({
        kind: 'review',
        text: `your review ${mine.deadline}`,
        tone: mine.urgency === 'overdue' ? 'broken' : 'needsYou',
        title: `You have to review it (${mine.deadlineText})`,
      });
    } else if (card.column === 'review') {
      const other = otherReview(info, input.rules, input.now);
      if (other) {
        overdue = other.overdue;
        markers.push(other.marker);
      }
    }
  }
  const waiting = card.primary ? input.waitedOn.get(card.id) : undefined;
  if (waiting?.length) {
    needsYou = true;
    markers.push({
      kind: 'chain',
      text: `⛓ your ${waiting.map((id) => `#${String(id)}`).join(', ')} waits on it`,
      tone: 'needsYou',
      title: 'Your work waits for this work item',
    });
  }
  const bug = card.itemKind === 'bug';
  // Rule BOARD-28: orange means the user owes something; the cards of others are calm unless it is about the user
  const tone: CardTone = card.tone === 'needsYou' || card.tone === 'ship' ? 'neutral' : card.tone;
  return {
    overdue,
    card: {
      key: card.key,
      id: card.id,
      column: card.column,
      idText: `#${String(card.id)}`,
      part: partText(card),
      title: card.title,
      itemKind: bug ? 'bug' : 'backlog',
      tone: needsYou ? 'needsYou' : tone,
      status: card.status?.tone === 'needsYou' ? { ...card.status, tone: 'normal' } : card.status,
      tag: card.tag,
      note: card.note,
      team: badge || undefined,
      asleep: card.asleep,
      merged: card.merged !== undefined,
      markers,
      prUrl: card.part === 'pr' || card.merged || card.part === undefined ? info?.url : undefined,
      prId,
      track: card.track,
      hover: card.hover,
      why: card.why,
      needsYou,
      siblings: card.siblings,
    },
  };
}

/** Marks the other cards of the same work item as related (BOARD-14), as the board of the user does */
function withSiblings(cards: BoardWorkCard[]): BoardWorkCard[] {
  return cards.map((card) => ({
    ...card,
    siblings: cards.filter((other) => other.id === card.id && other.key !== card.key).map((other) => other.key),
  }));
}

function laneSummary(items: number, teams: number, needYou: number, showTeams: boolean): string {
  return [plural(items, 'item'), showTeams ? plural(teams, 'team') : '', needYou ? `${String(needYou)} need you` : '']
    .filter(Boolean)
    .join(' · ');
}

// Rule BOARD-30
/** FLOW: the station where the work piles up, with the PRs late in it */
function flowInsight(columns: TeamColumn[]): TeamInsight {
  const stations = columns.filter((column) => column.id === 'ci' || column.id === 'review' || column.id === 'ready');
  const worst = [...stations].sort((a, b) => b.overdue - a.overdue || b.count - a.count).at(0);
  const names: Record<BoardColumnId, string> = {
    toStart: 'To start',
    branch: 'Branch',
    ci: 'CI',
    review: 'Review',
    ready: 'Ready to be merged',
    done: 'Done',
  };
  if (!worst || worst.count < 3) {
    return { kind: 'flow', label: 'FLOW', text: 'No bottleneck: few cards wait in CI, Review or Ready to be merged' };
  }
  const late = worst.overdue ? `, ${String(worst.overdue)} overdue` : '';
  return {
    kind: 'flow',
    label: 'FLOW',
    text: `${names[worst.id]} is the bottleneck: ${plural(worst.count, worst.id === 'ready' ? 'item' : 'PR')}${late}`,
  };
}

/** The lanes and the numbers of the whole-team board */
export function buildTeamBoard(input: TeamBoardInput): TeamBoardModel {
  const showBadges = input.selected.length > 1;
  const everyone = input.people.filter((person) => !person.you);
  const you = input.people.find((person) => person.you);
  // The queue is empty: the verbs are the user's own and only their own cards have them
  const lanePeople: { person: TeamPerson; ownCards?: BoardWorkCard[] }[] = [
    { person: you ?? { key: 'you', name: 'You', you: true, items: [] } },
    ...everyone.map((person) => ({ person })),
  ];
  const overdueByColumn = new Map<BoardColumnId, number>();
  const matchedReviews = new Set<number>();
  const asleepIds = new Set<number>();
  const load: { name: string; items: number; teams: number }[] = [];
  const lanes: TeamLane[] = lanePeople.map(({ person }) => {
    const models = person.items.map((item) => item.model);
    const visible = boardItems(models, input.kinds);
    const { cards, collapsedIds } = boardCards({
      items: visible,
      workItems: models,
      myPullRequests: [] as MyPullRequestModel[],
      queue: [],
      showCompleted: input.showCompleted,
      completed: input.completed,
      since: input.since,
    });
    const cardsWithSiblings = withSiblings(cards);
    const teamCards = cardsWithSiblings.map((card) => {
      const item = person.items.find((candidate) => candidate.model.id === card.id);
      const built = toTeamCard(card, { item, input, badge: showBadges ? item?.team : undefined });
      if (built.overdue) {
        overdueByColumn.set(built.card.column, (overdueByColumn.get(built.card.column) ?? 0) + 1);
      }
      if (built.card.markers.some((marker) => marker.kind === 'review') && built.card.prId !== undefined) {
        matchedReviews.add(built.card.prId);
      }
      if (card.asleep) {
        asleepIds.add(card.id);
      }
      return built.card;
    });
    const distinct = new Set([...visible.map((item) => item.id)]);
    const badges = new Set<string>(
      person.items
        .filter((item) => distinct.has(item.model.id))
        .map((item) => item.team)
        .filter((badge): badge is string => !!badge)
    );
    let items = distinct.size;
    let teams = badges.size;
    let needYou = teamCards.filter((card) => card.needsYou).length;
    if (person.you) {
      const ownIds = new Set(input.own.items.map((item) => item.id));
      items += ownIds.size;
      input.own.items.forEach((item) => {
        const badge = input.own.badges.get(item.id);
        if (badge) {
          badges.add(badge);
        }
      });
      teams = badges.size;
      needYou += input.own.cards.filter((card) => card.tone === 'needsYou' || card.tone === 'ship' || card.verb).length;
      input.own.cards.forEach((card) => {
        if (card.asleep) {
          asleepIds.add(card.id);
        }
      });
    }
    load.push({ name: person.you ? 'You' : person.name, items, teams });
    return {
      key: person.key,
      name: person.you ? 'You' : person.name,
      initials: initials(person.you ? input.youName ?? person.name : person.name),
      colour: avatarColour(person.name),
      you: person.you,
      summary: laneSummary(items, teams, needYou, showBadges || teams > 1),
      cards: teamCards,
      collapsedIds,
    };
  });
  const looseReviews = input.reviews.filter((review) => !matchedReviews.has(review.id)).map((review) => review.id);
  const visibleLanes = lanes.filter((lane) => lane.you || lane.cards.length || lane.collapsedIds.length);
  const columns: TeamColumn[] = COLUMN_ORDER.map((id) => ({
    id,
    count:
      input.own.cards.filter((card) => card.column === id).length +
      (id === 'done' ? input.own.collapsedIds.length : 0) +
      visibleLanes.reduce(
        (sum, lane) =>
          sum + lane.cards.filter((card) => card.column === id).length + (id === 'done' ? lane.collapsedIds.length : 0),
        0
      ) +
      input.reviews.filter((review) => review.column === id && looseReviews.includes(review.id)).length,
    overdue:
      (overdueByColumn.get(id) ?? 0) +
      input.reviews.filter(
        (review) => review.column === id && looseReviews.includes(review.id) && review.urgency === 'overdue'
      ).length,
  }));
  const asleep = asleepIds.size;
  const insights: TeamInsight[] = [
    flowInsight(columns),
    {
      kind: 'asleep',
      label: 'ASLEEP',
      text: asleep ? `${plural(asleep, 'item')} without update` : 'Every item in progress was updated',
    },
    {
      kind: 'load',
      label: 'LOAD',
      text: [...load]
        .filter((entry) => entry.items > 0)
        .sort((a, b) => b.items - a.items)
        .slice(0, 6)
        .map((entry) => `${entry.name} ${String(entry.items)}${showBadges ? ` (${String(entry.teams)})` : ''}`)
        .join(' · '),
    },
  ];
  const distinctItems = new Set([
    ...input.own.items.map((item) => item.id),
    ...visibleLanes.flatMap((lane) => lane.cards.map((card) => card.id)),
    ...visibleLanes.flatMap((lane) => lane.collapsedIds),
  ]);
  return {
    status: input.status,
    error: input.error,
    teamCount: input.selected.length,
    picker: {
      label: peopleLabel(input.chosen.length),
      ...pickerRows(input.chosen, input.candidates),
      loading: input.membersLoading === true,
    },
    noPeople: input.chosen.length === 0,
    showBadges,
    people: visibleLanes.length,
    workItems: distinctItems.size,
    columns,
    lanes: visibleLanes,
    looseReviews,
    insights,
  };
}
