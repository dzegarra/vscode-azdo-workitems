import { describe, expect, it } from 'vitest';
import {
  CommentSnapshot,
  commentThreadId,
  describeEvent,
  detectEvents,
  PullRequestSnapshot,
  ReviewerSnapshot,
  ReviewerUpdate,
  StoredSnapshot,
  toStored,
} from './pullRequestEvents';

const ME = 'me';
const comment = (key: string, authorId = 'ana', content = 'Could you rename this?'): CommentSnapshot => ({
  key,
  threadId: Number(key.split(':')[0]),
  authorId,
  author: authorId === 'ana' ? 'Ana' : 'Bob',
  content,
  threadStarterId: 'ana',
  startsThread: key.endsWith(':1'),
});
const pr = (overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot => ({
  id: 13720,
  title: '[66280] FUI Administration: Access point label',
  status: 'active',
  url: 'https://pr',
  reviewers: [{ id: 'ana', name: 'Ana', vote: 0, required: false, declined: false }],
  reviewerUpdates: [],
  reviewerUpdateIds: [],
  threads: [],
  comments: [comment('1:1')],
  ...overrides,
});

describe('detectEvents', () => {
  const previous: StoredSnapshot = toStored([pr()], {});

  it('only records a baseline for PRs not seen before', () => {
    expect(detectEvents({}, [pr({ comments: [comment('1:1'), comment('1:2')] })], ME)).toEqual([]);
  });

  it('detects new comments from other people, grouped per PR', () => {
    const current = pr({ comments: [comment('1:1'), comment('1:2'), comment('2:1', 'bob'), comment('2:2', ME)] });
    const events = detectEvents(previous, [current], ME);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'comments', comments: [{ key: '1:2' }, { key: '2:1' }] });
    expect(describeEvent(events[0])).toBe(
      '2 new comments on PR 13720 (Ana, Bob): [66280] FUI Administration: Access point label'
    );
  });

  it('detects votes of other people, but not resets nor my own votes', () => {
    const current = pr({
      reviewers: [
        { id: 'ana', name: 'Ana', vote: 10, required: false, declined: false },
        { id: ME, name: 'Me', vote: 10, required: false, declined: false },
      ],
    });
    const events = detectEvents(previous, [current], ME);
    expect(events.map(describeEvent)).toEqual([
      'Ana approved PR 13720: [66280] FUI Administration: Access point label',
    ]);
    const reset = toStored([current], previous);
    expect(
      detectEvents(
        reset,
        [pr({ reviewers: [{ id: 'ana', name: 'Ana', vote: 0, required: false, declined: false }] })],
        ME
      )
    ).toEqual([]);
  });

  it('detects merged PRs', () => {
    const events = detectEvents(previous, [pr({ status: 'completed', comments: undefined })], ME);
    expect(events.map(describeEvent)).toEqual(['PR 13720 was merged: [66280] FUI Administration: Access point label']);
  });

  it('describes a single comment with an excerpt', () => {
    const long = `Please ${'very '.repeat(30)}long comment`;
    const [event] = detectEvents(previous, [pr({ comments: [comment('1:1'), comment('3:2', 'bob', long)] })], ME);
    expect(describeEvent(event)).toMatch(/^Bob replied in a comment on PR 13720: "Please very .*…"$/);
  });

  it('keeps the known comments when the threads were not fetched', () => {
    const stored = toStored([pr({ status: 'completed', comments: undefined })], previous);
    expect(stored[13720]?.commentKeys).toEqual(['1:1']);
  });
});

const fileComment = (overrides: Partial<CommentSnapshot>): CommentSnapshot => ({
  ...comment('5:1', 'bob', 'Use a constant'),
  filePath: '/packages/admin/src/Header.tsx',
  threadStarterId: 'bob',
  ...overrides,
});

describe('comment wording', () => {
  const previous = toStored([pr()], {});
  const describeNew = (added: CommentSnapshot) =>
    detectEvents(previous, [pr({ comments: [comment('1:1'), added] })], ME).map(describeEvent);

  it('tells apart a new thread, a reply to my comment and a reply elsewhere', () => {
    expect(describeNew(fileComment({}))).toEqual(['Bob left a comment on Header.tsx in PR 13720: "Use a constant"']);
    expect(describeNew(fileComment({ filePath: undefined }))).toEqual([
      'Bob left a comment on PR 13720: "Use a constant"',
    ]);
    const reply = fileComment({ key: '5:2', startsThread: false, threadStarterId: ME });
    expect(describeNew(reply)).toEqual(['Bob replied to your comment on PR 13720 (Header.tsx): "Use a constant"']);
    expect(describeNew({ ...reply, threadStarterId: 'ana' })).toEqual([
      'Bob replied in a comment on PR 13720 (Header.tsx): "Use a constant"',
    ]);
    expect(describeNew({ ...reply, threadStarterId: 'ana', filePath: undefined })).toEqual([
      'Bob replied in a comment on PR 13720: "Use a constant"',
    ]);
  });

  it('opens the thread of the latest comment of a grouped event', () => {
    const [event] = detectEvents(
      previous,
      [pr({ comments: [comment('1:1'), comment('2:1', 'bob'), comment('7:1', 'ana'), comment('2:2', 'bob')] })],
      ME
    );
    expect(commentThreadId(event)).toBe(2);
    expect(commentThreadId({ kind: 'merged', pullRequest: pr() })).toBeUndefined();
  });
});

describe('reopened threads', () => {
  const thread = (status: string) => ({ id: 1, status, filePath: '/src/Header.tsx', firstContent: 'Rename this' });
  const before = (status: string) => toStored([pr({ threads: [thread(status)] })], {});

  it('detects a closed thread that is active again, with the author of a new comment', () => {
    const [event, ...rest] = detectEvents(
      before('fixed'),
      [pr({ threads: [thread('active')], comments: [comment('1:1'), comment('1:2', 'bob', 'Still wrong')] })],
      ME
    );
    expect(rest).toEqual([]);
    expect(describeEvent(event)).toBe('Bob reopened a comment on PR 13720 (Header.tsx): "Rename this"');
    expect(commentThreadId(event)).toBe(1);
  });

  it('detects it without new comments, and for every closed status', () => {
    for (const status of ['fixed', 'wontFix', 'closed', 'byDesign']) {
      const events = detectEvents(
        before(status),
        [pr({ threads: [{ ...thread('pending'), filePath: undefined }] })],
        ME
      );
      expect(events.map(describeEvent)).toEqual(['A comment on PR 13720 was reopened: "Rename this"']);
    }
  });

  it('ignores open to open, closed to closed, new threads and my own reopening', () => {
    expect(detectEvents(before('active'), [pr({ threads: [thread('active')] })], ME)).toEqual([]);
    expect(detectEvents(before('fixed'), [pr({ threads: [thread('closed')] })], ME)).toEqual([]);
    expect(detectEvents(before('fixed'), [pr({ threads: [{ ...thread('active'), id: 9 }] })], ME)).toEqual([]);
    const mine = pr({ threads: [thread('active')], comments: [comment('1:1'), comment('1:2', ME)] });
    expect(detectEvents(before('fixed'), [mine], ME)).toEqual([]);
  });

  it('does not notify the comments of the reopened thread again, but those of other threads', () => {
    const current = pr({
      threads: [thread('active')],
      comments: [comment('1:1'), comment('1:2', 'bob'), comment('2:1', 'bob')],
    });
    const events = detectEvents(before('fixed'), [current], ME);
    expect(events.map((event) => event.kind)).toEqual(['reopened', 'comments']);
    expect(events[1]).toMatchObject({ comments: [{ key: '2:1' }] });
  });
});

describe('reviewer changes', () => {
  const ana = { id: 'ana', name: 'Ana' };
  const szymon = { id: 'szymon', name: 'Szymon' };
  const me = { id: ME, name: 'Me' };
  const reviewer = (person: { id: string; name: string }, required = true, declined = false): ReviewerSnapshot => ({
    ...person,
    vote: 0,
    required,
    declined,
  });
  const update = (threadId: number, kind: ReviewerUpdate['kind'], actor: ReviewerUpdate['actor'], target = szymon) => ({
    threadId,
    kind,
    actor,
    target,
  });
  const base = pr({
    reviewers: [reviewer(ana)],
    reviewerUpdates: [update(1, 'added', ana, ana)],
    reviewerUpdateIds: [1],
  });
  const previous = toStored([base], {});
  const describe1 = (current: Partial<PullRequestSnapshot>, snapshot: StoredSnapshot = previous) =>
    detectEvents(snapshot, [{ ...base, ...current }], ME).map(describeEvent);
  const title = '[66280] FUI Administration: Access point label';

  it('describes each kind of change made by a thread', () => {
    const withUpdate = (kind: ReviewerUpdate['kind'], actor: ReviewerUpdate['actor'], required = true) => ({
      reviewers: [reviewer(ana), reviewer(szymon, required)],
      reviewerUpdates: [...(base.reviewerUpdates ?? []), update(2, kind, actor)],
      reviewerUpdateIds: [1, 2],
    });
    expect(describe1(withUpdate('added', szymon))).toEqual([
      `Szymon added themselves as a required reviewer of PR 13720: ${title}`,
    ]);
    expect(describe1(withUpdate('added', ana))).toEqual([
      `Ana added Szymon as a required reviewer of PR 13720: ${title}`,
    ]);
    expect(describe1({ ...withUpdate('removed', szymon), reviewers: [reviewer(ana)] })).toEqual([
      `Szymon removed themselves as a reviewer of PR 13720: ${title}`,
    ]);
    expect(describe1({ ...withUpdate('removed', ana), reviewers: [reviewer(ana)] })).toEqual([
      `Ana removed Szymon as a reviewer of PR 13720: ${title}`,
    ]);
    expect(describe1(withUpdate('declined', szymon))).toEqual([`Szymon declined to review PR 13720: ${title}`]);
    expect(describe1(withUpdate('required', ana))).toEqual([
      `Szymon is now a required reviewer of PR 13720 (changed by Ana): ${title}`,
    ]);
    expect(describe1(withUpdate('optional', ana, false))).toEqual([
      `Szymon is now an optional reviewer of PR 13720 (changed by Ana): ${title}`,
    ]);
  });

  it('ignores my own changes, optional additions and group updates', () => {
    const mine = {
      reviewers: [reviewer(ana), reviewer(szymon)],
      reviewerUpdates: [update(2, 'added', me)],
      reviewerUpdateIds: [1, 2],
    };
    expect(describe1(mine)).toEqual([]);
    const optional = {
      ...mine,
      reviewers: [reviewer(ana), reviewer(szymon, false)],
      reviewerUpdates: [update(2, 'added', ana)],
    };
    expect(describe1(optional)).toEqual([]);
    // A group update has an id but no parsed change
    expect(describe1({ reviewerUpdateIds: [1, 2] })).toEqual([]);
  });

  it('notifies a thread only once', () => {
    const current = {
      reviewers: [reviewer(ana), reviewer(szymon)],
      reviewerUpdates: [update(2, 'added', ana)],
      reviewerUpdateIds: [1, 2],
    };
    expect(describe1(current)).toHaveLength(1);
    expect(describe1(current, toStored([{ ...base, ...current }], {}))).toEqual([]);
  });

  it('groups several changes of a PR in one event, added then required is one change', () => {
    const current = {
      reviewers: [reviewer(ana), reviewer(szymon)],
      reviewerUpdates: [update(2, 'added', ana), update(3, 'required', ana), update(4, 'removed', ana, ana)],
      reviewerUpdateIds: [1, 2, 3, 4],
    };
    const events = detectEvents(previous, [{ ...base, ...current }], ME);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'reviewers', changes: [{ kind: 'added' }, { kind: 'removed' }] });
    expect(describeEvent(events[0])).toBe(`2 reviewer changes on PR 13720: ${title}`);
  });

  it('falls back to the reviewer list when no thread explains the change', () => {
    expect(describe1({ reviewers: [reviewer(ana), reviewer(szymon)] })).toEqual([
      `Szymon is now a required reviewer of PR 13720: ${title}`,
    ]);
    expect(describe1({ reviewers: [reviewer(ana), reviewer(szymon, false)] })).toEqual([]);
    expect(describe1({ reviewers: [] })).toEqual([]);
    const later = toStored([{ ...base, reviewers: [reviewer(ana, false), reviewer(szymon, false)] }], {});
    expect(
      describe1({ reviewers: [reviewer(ana, true), reviewer(szymon, false)], reviewerUpdates: [] }, later)
    ).toEqual([`Ana is now a required reviewer of PR 13720: ${title}`]);
    expect(describe1({ reviewers: [reviewer(ana, false), reviewer(szymon, false, true)] }, later)).toEqual([
      `Szymon declined to review PR 13720: ${title}`,
    ]);
    expect(describe1({ reviewers: [reviewer(ana, false)] }, later)).toEqual([
      `Szymon is no longer a reviewer of PR 13720: ${title}`,
    ]);
  });
});

describe('snapshot stored by an older version', () => {
  it('only establishes a baseline for reviewers and reopened threads', () => {
    const old: StoredSnapshot = { 13720: { status: 'active', votes: {}, commentKeys: ['1:1'] } };
    const current = pr({
      reviewers: [{ id: 'szymon', name: 'Szymon', vote: 0, required: true, declined: true }],
      reviewerUpdates: [{ threadId: 2, kind: 'added', target: { id: 'szymon', name: 'Szymon' } }],
      reviewerUpdateIds: [2],
      threads: [{ id: 1, status: 'active', firstContent: 'Rename this' }],
    });
    expect(detectEvents(old, [current], ME)).toEqual([]);
    const stored = toStored([current], old);
    expect(stored[13720]).toMatchObject({ reviewerUpdateIds: [2], threadStatuses: { 1: 'active' } });
  });

  it('keeps the stored data of PRs whose threads were not fetched', () => {
    const stored = toStored(
      [
        pr({
          status: 'completed',
          comments: undefined,
          threads: undefined,
          reviewerUpdates: undefined,
          reviewerUpdateIds: undefined,
        }),
      ],
      toStored([pr({ reviewerUpdateIds: [4], threads: [{ id: 1, status: 'fixed', firstContent: '' }] })], {})
    );
    expect(stored[13720]).toMatchObject({ reviewerUpdateIds: [4], threadStatuses: { 1: 'fixed' } });
  });
});
