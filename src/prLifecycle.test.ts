import { describe, expect, it } from 'vitest';
import type { RunModel } from './pipelines';
import {
  pullRequestEvents,
  pullRequestPhases,
  pullRequestStations,
  stampText,
  type PrFacts,
  type StationSpan,
} from './prLifecycle';
import type { ThreadResponse } from './reviewThreads';

/** Local time, October 2026: the stamps of the tooltips are local */
const at = (day: number, hour = 12, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();
const iso = (day: number, hour = 12, minute = 0): string => new Date(at(day, hour, minute)).toISOString();

const system = (
  type: string,
  when: string,
  props: Record<string, string | number>,
  content = 'system'
): ThreadResponse => ({
  id: Math.floor(Math.random() * 1e9),
  publishedDate: when,
  properties: {
    CodeReviewThreadType: { $value: type },
    ...Object.fromEntries(Object.entries(props).map(([key, value]) => [key, { $value: value }])),
  },
  comments: [{ id: 1, author: { id: 'x', displayName: 'System' }, content, commentType: 'system' }],
});

const publish = (day: number, hour: number): ThreadResponse =>
  system('IsDraftUpdate', iso(day, hour), { CodeReviewIsDraftNowSet: '0' });
const backToDraft = (day: number, hour: number): ThreadResponse =>
  system('IsDraftUpdate', iso(day, hour), { CodeReviewIsDraftNowSet: '1' });
const push = (day: number, hour: number, minute = 0, count = 1): ThreadResponse =>
  system('RefUpdate', iso(day, hour, minute), { CodeReviewRefNewCommitsCount: count });
const reset = (day: number, hour: number): ThreadResponse => system('ResetMultipleVotes', iso(day, hour), {});
const autoComplete = (day: number, hour: number): ThreadResponse =>
  system('AutoCompleteUpdate', iso(day, hour), { CodeReviewAutoCompleteNowSet: '1' });
const reviewersAdded = (day: number, hour: number, minute: number): ThreadResponse =>
  system('ReviewersUpdate', iso(day, hour, minute), { CodeReviewReviewersUpdatedNumAdded: 1 });
const vote = (day: number, hour: number, voter: string, result: number): ThreadResponse => ({
  ...system('VoteUpdate', iso(day, hour), { CodeReviewVoteResult: String(result), CodeReviewVotedByIdentity: '1' }),
  identities: { '1': { id: voter, displayName: voter } },
});
const comment = (day: number, hour: number): ThreadResponse => ({
  id: Math.floor(Math.random() * 1e9),
  publishedDate: iso(day, hour),
  comments: [{ id: 1, author: { id: 'c', displayName: 'Carla' }, content: 'Why?', commentType: 'text' }],
});

const run = (
  id: number,
  start: number,
  finish: number | undefined,
  state: RunModel['state'] = 'succeeded',
  pipeline = 'PR pipeline'
): PrFacts['runs'] extends readonly (infer R)[] | undefined ? R : never => ({
  id,
  pipeline,
  state,
  startTime: new Date(start).toISOString(),
  ...(finish === undefined ? {} : { finishTime: new Date(finish).toISOString() }),
});

const reviewers = [
  { name: 'Ana', isRequired: true, isContainer: false },
  { name: 'Jonas', isRequired: true, isContainer: false },
];

const base: PrFacts = {
  id: 14021,
  created: at(14, 10),
  isDraft: false,
  author: 'Dev',
  reviewers,
  conflicts: false,
  now: at(22, 14),
};

const shape = (spans: readonly StationSpan[]): [string, number, number][] =>
  spans.map((span) => [span.kind === 'needsYou' ? `needsYou:${span.of ?? ''}` : span.kind, span.start, span.end]);

describe('stations of a PR, moment by moment (TIMELINE-16)', () => {
  const threads = [publish(14, 15), vote(15, 10, 'Ana', 10), vote(15, 12, 'Jonas', 10)];
  const runs = [run(1, at(14, 15, 0), at(14, 15, 30))];

  it('goes from the draft to CI to review to ready to be merged, up to the merge', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(15, 14),
      isDraft: false,
      threads,
      runs,
      runsComplete: true,
    });
    expect(shape(spans)).toEqual([
      ['pullRequest', at(14, 10), at(14, 15)],
      ['ci', at(14, 15), at(14, 15, 30)],
      ['review', at(14, 15, 30), at(15, 12)],
      ['ready', at(15, 12), at(15, 14)],
    ]);
    expect(spans.some((span) => span.approximate)).toBe(false);
  });

  it('keeps a PR created published out of the draft station', () => {
    const spans = pullRequestStations({ ...base, threads: [], runs: [], runsComplete: true, closed: at(15, 14) });
    expect(shape(spans)).toEqual([['review', at(14, 10), at(15, 14)]]);
  });

  it('keeps a draft a draft until now, and sends a published PR back to draft', () => {
    const draft = pullRequestStations({ ...base, isDraft: true, threads: [publish(15, 9), backToDraft(16, 9)] });
    expect(shape(draft)).toEqual([
      ['pullRequest', at(14, 10), at(15, 9)],
      ['review', at(15, 9), at(16, 9)],
      ['pullRequest', at(16, 9), at(22, 14)],
    ]);
  });

  it('is CI until the first green run of the latest commit; a push starts it again (TIMELINE-16)', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(16, 18),
      threads: [vote(15, 10, 'Ana', 10), vote(15, 11, 'Jonas', 10), push(15, 14)],
      runs: [run(1, at(14, 10, 1), at(14, 10, 20)), run(2, at(15, 14, 1), at(15, 14, 40))],
      runsComplete: true,
    });
    expect(shape(spans)).toEqual([
      ['ci', at(14, 10), at(14, 10, 20)],
      ['review', at(14, 10, 20), at(15, 11)],
      ['ready', at(15, 11), at(15, 14)],
      ['ci', at(15, 14), at(15, 14, 40)],
      ['ready', at(15, 14, 40), at(16, 18)],
    ]);
  });

  it('needs the user from the failure of a run, until the next push is green', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(17, 9),
      threads: [push(16, 10)],
      runs: [run(1, at(14, 10, 1), at(14, 10, 40), 'failed'), run(2, at(16, 10, 1), at(16, 10, 30))],
      runsComplete: true,
    });
    expect(shape(spans)).toEqual([
      ['ci', at(14, 10), at(14, 10, 40)],
      ['needsYou:ci', at(14, 10, 40), at(16, 10)],
      ['ci', at(16, 10), at(16, 10, 30)],
      ['review', at(16, 10, 30), at(17, 9)],
    ]);
    expect(spans[1].reason).toBe('CI failed');
  });

  it('counts the latest run of each pipeline: one red pipeline is enough', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(15, 9),
      threads: [],
      runs: [
        run(1, at(14, 10, 1), at(14, 10, 20), 'succeeded', 'Lint'),
        run(2, at(14, 10, 1), at(14, 10, 30), 'partial', 'Tests'),
      ],
      runsComplete: true,
    });
    expect(spans.map((span) => span.kind)).toEqual(['ci', 'needsYou']);
  });

  it('needs the user while a reviewer waits for the author, and goes on when they approve (TIMELINE-16)', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(17, 9),
      threads: [vote(15, 10, 'Ana', 10), vote(15, 11, 'Jonas', -5), vote(16, 9, 'Jonas', 10)],
      runsComplete: true,
      runs: [],
    });
    expect(shape(spans)).toEqual([
      ['review', at(14, 10), at(15, 11)],
      ['needsYou:review', at(15, 11), at(16, 9)],
      ['ready', at(16, 9), at(17, 9)],
    ]);
    expect(spans[1].reason).toBe('Jonas waits for the author');
  });

  it('says rejected for a reject, and a reset clears the votes', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(17, 9),
      threads: [vote(15, 10, 'Ana', 10), vote(15, 11, 'Jonas', 10), vote(15, 12, 'Ana', -10), reset(16, 9)],
      runsComplete: true,
      runs: [],
    });
    expect(spans.map((span) => [span.kind, span.reason])).toEqual([
      ['review', undefined],
      ['ready', undefined],
      ['needsYou', 'Ana rejected'],
      ['review', undefined],
    ]);
  });

  it('matches the names of the threads ("Ana EXT") with the reviewers and the author of the data ("Ana"): the author does not approve', () => {
    const spans = pullRequestStations({
      ...base,
      author: 'Dev',
      reviewers: [{ name: 'Ana', isRequired: false, isContainer: false }],
      closed: at(16, 9),
      // Nobody required voted: the votes of anybody but the author count, and the author is "Dev EXT" in the thread
      threads: [vote(15, 10, 'Dev EXT', 10), vote(15, 11, 'Ana EXT', 10)],
      runsComplete: true,
      runs: [],
    });
    expect(shape(spans)).toEqual([
      ['review', at(14, 10), at(15, 11)],
      ['ready', at(15, 11), at(16, 9)],
    ]);
  });

  it('does not count the votes of people who are not the required reviewers once they voted', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(16, 9),
      threads: [vote(15, 10, 'Ana', 10), vote(15, 11, 'Zoe', 10)],
      runsComplete: true,
      runs: [],
    });
    // Ana is required and voted; Zoe's vote is not one of the required reviewers'
    expect(spans.at(-1)?.kind).toBe('review');
  });

  it('does not know the CI of the past when only the latest runs are there: it is part of the review, approximate', () => {
    const spans = pullRequestStations({
      ...base,
      closed: at(16, 9),
      threads: [publish(14, 15), vote(15, 10, 'Ana', 10), vote(15, 11, 'Jonas', 10)],
      runs: [run(9, at(15, 12), at(15, 12, 30), 'failed')],
      runsComplete: false,
    });
    expect(shape(spans)).toEqual([
      ['pullRequest', at(14, 10), at(14, 15)],
      ['review', at(14, 15), at(15, 11)],
      ['ready', at(15, 11), at(16, 9)],
    ]);
    expect(spans[1].approximate).toBe(true);
  });
});

describe('what is not known yet is approximate and refined later (TIMELINE-16, TIMELINE-28)', () => {
  it('draws a merged PR without threads as one review span up to the merge, approximate', () => {
    const spans = pullRequestStations({ ...base, closed: at(16, 9) });
    expect(spans).toEqual([
      expect.objectContaining({ kind: 'review', start: at(14, 10), end: at(16, 9), approximate: true }),
    ]);
  });

  it('knows the draft split and the moment it was ready from the stamps of the list', () => {
    const spans = pullRequestStations({ ...base, closed: at(16, 9), published: at(14, 15), readySince: at(15, 16) });
    expect(shape(spans)).toEqual([
      ['pullRequest', at(14, 10), at(14, 15)],
      ['review', at(14, 15), at(15, 16)],
      ['ready', at(15, 16), at(16, 9)],
    ]);
    expect(spans.slice(1).every((span) => span.approximate)).toBe(true);
  });

  it('follows the board for an open PR: needs you since the failure, approximate when since is not known', () => {
    const since = pullRequestStations({
      ...base,
      published: at(14, 15),
      current: { kind: 'needsYou', of: 'ci', reason: 'CI: 2 tests failed', since: at(20, 11) },
    });
    expect(shape(since).slice(-2)).toEqual([
      ['review', at(14, 15), at(20, 11)],
      ['needsYou:ci', at(20, 11), at(22, 14)],
    ]);
    const unknown = pullRequestStations({ ...base, current: { kind: 'ready' } });
    expect(unknown.at(-1)).toMatchObject({ kind: 'ready', start: at(14, 10), approximate: true });
  });

  it('lets the board win when the history disagrees: the two tabs never disagree', () => {
    const spans = pullRequestStations({
      ...base,
      threads: [vote(15, 10, 'Ana', 10), vote(15, 11, 'Jonas', 10)],
      runsComplete: true,
      runs: [],
      current: { kind: 'review', since: at(21, 9) },
    });
    expect(shape(spans)).toEqual([
      ['review', at(14, 10), at(15, 11)],
      ['ready', at(15, 11), at(21, 9)],
      ['review', at(21, 9), at(22, 14)],
    ]);
  });

  it('keeps a draft as the station of a draft PR whatever the board says', () => {
    const spans = pullRequestStations({ ...base, isDraft: true, current: { kind: 'pullRequest' } });
    expect(shape(spans)).toEqual([['pullRequest', at(14, 10), at(22, 14)]]);
  });
});

describe('phases of the PR row (TIMELINE-17)', () => {
  const facts: PrFacts = {
    ...base,
    closed: at(16, 9),
    threads: [
      publish(14, 15),
      push(15, 9),
      vote(15, 10, 'Ana', 10),
      vote(15, 11, 'Jonas', -5),
      vote(15, 18, 'Jonas', 10),
    ],
    runs: [run(1, at(14, 15, 1), at(14, 15, 30), 'failed'), run(2, at(15, 9, 1), at(15, 9, 30))],
    runsComplete: true,
    implementation: { at: at(13, 9), approximate: false, detail: 'implementation since the first commit, We 13' },
  };

  it('is implementation, draft, review (CI and needs you included) and ready to merge', () => {
    const phases = pullRequestPhases(facts, pullRequestStations(facts));
    expect(phases.map((phase) => [phase.kind, phase.start, phase.end])).toEqual([
      ['implementation', at(13, 9), at(14, 10)],
      ['draft', at(14, 10), at(14, 15)],
      ['review', at(14, 15), at(15, 18)],
      ['ready', at(15, 18), at(16, 9)],
    ]);
    expect(phases[0].detail).toContain('first commit');
  });

  it('has no implementation phase without a start before the creation', () => {
    const phases = pullRequestPhases({ ...facts, implementation: undefined }, pullRequestStations(facts));
    expect(phases[0].kind).toBe('draft');
  });

  it('marks an approximate implementation start', () => {
    const phases = pullRequestPhases(
      {
        ...facts,
        implementation: {
          at: at(12, 9),
          approximate: true,
          detail: 'implementation since the work item was activated, approximate',
        },
      },
      []
    );
    expect(phases[0]).toMatchObject({ kind: 'implementation', approximate: true });
  });
});

describe('events along the PR row (TIMELINE-27)', () => {
  const facts: PrFacts = {
    ...base,
    threads: [
      publish(14, 15),
      push(15, 9, 0, 2),
      reviewersAdded(14, 16, 0),
      reviewersAdded(14, 16, 3),
      reviewersAdded(15, 8, 0),
      vote(15, 10, 'Ana Ruiz', 10),
      vote(16, 10, 'Jonas Berg', -5),
      vote(16, 11, 'Mia Lopez', -10),
      autoComplete(16, 12),
      comment(15, 9),
      comment(15, 17),
      comment(16, 9),
    ],
    runs: [
      run(1, at(14, 15, 1), at(14, 15, 30), 'succeeded'),
      run(2, at(15, 9, 1), at(15, 9, 40), 'failed'),
      run(3, at(16, 12, 1), undefined, 'running'),
      run(4, at(16, 13), at(16, 13, 5), 'canceled'),
    ],
    runsComplete: true,
    conflicts: true,
  };
  const events = pullRequestEvents(facts);

  it('has the pushes, the CI runs (not the canceled ones), the votes, the reviewers added, the auto-complete', () => {
    const count = (kind: string): number => events.filter((event) => event.kind === kind).length;
    expect(count('push')).toBe(1);
    expect(count('ci')).toBe(3);
    expect(count('approve')).toBe(1);
    expect(count('wait')).toBe(1);
    expect(count('reject')).toBe(1);
    expect(count('autoComplete')).toBe(1);
    expect(events.map((event) => event.at)).toEqual([...events.map((event) => event.at)].sort((a, b) => a - b));
  });

  it('has a marker per reviewer added, a count for those the thread does not name (TIMELINE-39)', () => {
    const added = events.filter((event) => event.kind === 'reviewers');
    expect(added.map((event) => event.text)).toEqual(['+1', '+1', '+1']);
  });

  it('draws a reviewer made required with their initials, none when made optional (TIMELINE-27)', () => {
    const changed = (hour: number, toRequired: string): ThreadResponse => ({
      ...system('ReviewersUpdate', iso(15, hour), {
        CodeReviewReviewersUpdatedNumAdded: 0,
        CodeReviewReviewersUpdatedNumChanged: 1,
        CodeReviewReviewersUpdatedChangedIdentity: '2',
        CodeReviewReviewersUpdatedChangedToRequired: toRequired,
      }),
      identities: { '2': { id: 'p', displayName: 'Pia Klein' } },
    });
    const marks = (threads: ThreadResponse[]) =>
      pullRequestEvents({ ...facts, threads }).filter((event) => event.kind === 'reviewers');
    expect(marks([changed(9, 'True')])).toMatchObject([
      {
        text: 'PK',
        at: at(15, 9),
        lines: [`Pia Klein was made a required reviewer · ${stampText(at(15, 9))}`],
      },
    ]);
    expect(marks([changed(9, 'False')])).toEqual([]);
  });

  it('has a dot per comment thread, not one per day (TIMELINE-39)', () => {
    expect(events.filter((event) => event.kind === 'comments')).toHaveLength(3);
  });

  it('draws the commits once read, those before the PR too (TIMELINE-39)', () => {
    const withCommits = pullRequestEvents({ ...facts, commits: [at(10, 9), at(15, 8)] });
    expect(withCommits.filter((event) => event.kind === 'commit').map((event) => event.at)).toEqual([
      at(10, 9),
      at(15, 8),
    ]);
  });

  it('says who, when and what in the tooltip of a vote, with the approvals so far', () => {
    const approve = events.find((event) => event.kind === 'approve');
    expect(approve).toMatchObject({ text: 'AR', title: 'APPROVED · PR 14021' });
    expect(approve?.lines).toEqual([`Ana Ruiz approved · ${stampText(at(15, 10))}`, '1 of 2 required approvals']);
  });

  it('draws the CI runs by how they ended; a run that has not finished is dashed (running)', () => {
    const ci = events.filter((event) => event.kind === 'ci');
    expect(ci.map((event) => [event.tone, event.text])).toEqual([
      ['pass', '✓'],
      ['fail', '✕'],
      ['running', ''],
    ]);
  });

  it('has a conflicts mark at now, only for a PR that is open (past conflicts are not recorded)', () => {
    expect(events.at(-1)).toMatchObject({ kind: 'conflicts', at: facts.now });
    expect(pullRequestEvents({ ...facts, closed: at(18, 9) }).some((event) => event.kind === 'conflicts')).toBe(false);
  });

  it('has only the runs of the list, and no thread events, until the history is read', () => {
    const early = pullRequestEvents({ ...facts, threads: undefined, runsComplete: false });
    expect(new Set(early.map((event) => event.kind))).toEqual(new Set(['ci', 'conflicts']));
  });
});
