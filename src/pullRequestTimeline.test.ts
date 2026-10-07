import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  formatTimelineDate,
  MAX_TIMELINE_EVENTS,
  publicationDate,
  publishedAt,
  TimelineSource,
} from './pullRequestTimeline';
import type { ThreadResponse } from './reviewThreads';

const author = { id: 'u', displayName: 'Daniel Zegarra EXT' };
const system = (
  id: number,
  publishedDate: string,
  type: string,
  content: string,
  properties: Record<string, unknown> = {}
): ThreadResponse => ({
  id,
  publishedDate,
  threadContext: null,
  properties: {
    CodeReviewThreadType: { $value: type },
    ...Object.fromEntries(Object.entries(properties).map(([key, $value]) => [key, { $value }])),
  },
  comments: [{ id: 1, author, content, commentType: 'system' }],
});
const text = (id: number, publishedDate: string, content: string, filePath?: string): ThreadResponse => ({
  id,
  publishedDate,
  status: 'active',
  threadContext: filePath ? { filePath } : null,
  properties: {},
  comments: [{ id: 1, author: { id: 'k', displayName: 'Szymon Kwasek EXT' }, content, commentType: 'text' }],
});
const policy = (id: number, publishedDate: string) =>
  system(id, publishedDate, 'PolicyStatusUpdate', 'Policy status has been updated', {
    CodeReviewPolicyType: 'fd2167ab-b0be-447a-8ec8-39368250530e',
  });

/** Utc, so the tests do not depend on the machine */
const utc = (iso: string) => formatTimelineDate(iso, 'UTC');

/** Threads of the PR 13713 (shortened): created as a draft on 2026-09-30T17:44Z, published on 2026-10-05T21:24Z */
const THREADS_13713: ThreadResponse[] = [
  system(133313, '2026-09-30T18:48:10Z', 'RefUpdate', 'The reference refs/heads/x was updated.', {
    CodeReviewRefNewCommitsCount: 1,
  }),
  system(133630, '2026-10-05T13:26:37Z', 'RefUpdate', 'The reference refs/heads/x was updated.', {
    CodeReviewRefNewCommitsCount: 3,
  }),
  policy(133702, '2026-10-05T21:24:39Z'),
  policy(133703, '2026-10-05T21:24:39Z'),
  system(133704, '2026-10-05T21:24:39Z', 'IsDraftUpdate', 'Daniel Zegarra EXT published the pull request.', {
    CodeReviewIsDraftNowSet: '0',
  }),
  system(133705, '2026-10-05T21:25:22Z', 'ReviewersUpdate', 'Daniel Zegarra EXT added Szymon Kwasek EXT as a reviewer'),
  system(133837, '2026-10-06T11:08:59Z', 'VoteUpdate', 'Szymon Kwasek EXT voted 10', { CodeReviewVoteResult: '10' }),
  system(134055, '2026-10-07T16:04:04Z', 'AutoCompleteUpdate', 'Daniel Zegarra EXT set auto-complete', {
    CodeReviewAutoCompleteNowSet: '1',
  }),
  system(134056, '2026-10-07T16:04:24Z', 'AutoCompleteUpdate', 'Daniel Zegarra EXT cancelled auto-complete', {
    CodeReviewAutoCompleteNowSet: '0',
  }),
];

const PR_13713: TimelineSource = {
  status: 'active',
  isDraft: false,
  creationDate: '2026-09-30T17:44:00Z',
  createdBy: author,
};

describe('formatTimelineDate', () => {
  it('is compact, 24 hours and in the given time zone', () => {
    expect(formatTimelineDate('2026-10-05T21:24:39Z', 'UTC')).toBe('Oct 5, 21:24');
    expect(formatTimelineDate('2026-10-05T21:24:39Z', 'Europe/Warsaw')).toBe('Oct 5, 23:24');
    expect(formatTimelineDate('2026-10-05T21:24:39Z', 'America/Lima')).toBe('Oct 5, 16:24');
    expect(formatTimelineDate('2026-01-09T00:05:00Z', 'UTC')).toBe('Jan 9, 00:05');
  });
});

describe('publication date', () => {
  it('is the last time the PR left draft', () => {
    expect(publicationDate(THREADS_13713)).toBe('2026-10-05T21:24:39Z');
    const again = [
      ...THREADS_13713,
      system(1, '2026-10-06T00:00:00Z', 'IsDraftUpdate', 'x marked the pull request as a draft', {
        CodeReviewIsDraftNowSet: '1',
      }),
      system(2, '2026-10-06T08:00:00Z', 'IsDraftUpdate', 'x published the pull request.', {
        CodeReviewIsDraftNowSet: '0',
      }),
    ];
    expect(publicationDate(again)).toBe('2026-10-06T08:00:00Z');
  });

  it('falls back to the creation for the PRs that were never a draft or without threads', () => {
    expect(publicationDate([])).toBeUndefined();
    expect(publicationDate(undefined)).toBeUndefined();
    expect(publishedAt(PR_13713, [])).toBe('2026-09-30T17:44:00Z');
    expect(publishedAt(PR_13713, undefined)).toBe('2026-09-30T17:44:00Z');
    expect(publishedAt(PR_13713, THREADS_13713)).toBe('2026-10-05T21:24:39Z');
  });
});

describe('buildTimeline', () => {
  it('tells the story of a PR created as a draft, oldest first, skipping the policy updates', () => {
    const { events, earlier } = buildTimeline(PR_13713, THREADS_13713, utc);
    expect(earlier).toBe(0);
    expect(events.map((event) => `${event.when} ${event.text}`)).toEqual([
      'Sep 30, 17:44 Daniel Zegarra EXT created the pull request as a draft',
      'Sep 30, 18:48 1 new commit pushed',
      'Oct 5, 13:26 3 new commits pushed',
      'Oct 5, 21:24 Daniel Zegarra EXT published the pull request',
      'Oct 5, 21:25 Daniel Zegarra EXT added Szymon Kwasek EXT as a reviewer',
      'Oct 6, 11:08 Szymon Kwasek EXT approved',
      'Oct 7, 16:04 Daniel Zegarra EXT set auto-complete',
      'Oct 7, 16:04 Daniel Zegarra EXT cancelled auto-complete',
    ]);
  });

  it('says "as a draft" only when the first draft update is a publication (or the PR is a draft without updates)', () => {
    const created = (pr: Partial<TimelineSource>, threads: ThreadResponse[]) =>
      buildTimeline({ ...PR_13713, ...pr }, threads, utc).events[0].text;
    expect(created({}, [])).toBe('Daniel Zegarra EXT created the pull request');
    expect(created({ isDraft: true }, [])).toBe('Daniel Zegarra EXT created the pull request as a draft');
    const toDraft = system(1, '2026-10-01T00:00:00Z', 'IsDraftUpdate', 'x marked as draft', {
      CodeReviewIsDraftNowSet: '1',
    });
    const publish = system(2, '2026-10-02T00:00:00Z', 'IsDraftUpdate', 'x published', { CodeReviewIsDraftNowSet: '0' });
    expect(created({}, [toDraft, publish])).toBe('Daniel Zegarra EXT created the pull request');
    expect(created({}, [publish])).toBe('Daniel Zegarra EXT created the pull request as a draft');
    expect(buildTimeline({ ...PR_13713, createdBy: {} }, [], utc).events[0].text).toBe('Pull request created');
  });

  it('describes votes, resets, pushes and the PR status', () => {
    const vote = (result: string, name = 'Kamil') =>
      system(1, '2026-10-01T10:00:00Z', 'VoteUpdate', `${name} voted ${result}`, { CodeReviewVoteResult: result });
    const lines = (threads: ThreadResponse[]) =>
      buildTimeline(PR_13713, threads, utc)
        .events.slice(1)
        .map((e) => e.text);
    expect(lines([vote('10'), vote('5'), vote('0'), vote('-5'), vote('-10')])).toEqual([
      'Kamil approved',
      'Kamil approved with suggestions',
      'Kamil reset the vote',
      'Kamil is waiting for the author',
      'Kamil rejected',
    ]);
    expect(lines([system(1, '2026-10-01T10:00:00Z', 'VoteUpdate', '')])).toEqual(['A vote was cast']);
    expect(
      lines([
        system(
          1,
          '2026-10-01T10:00:00Z',
          'ResetMultipleVotes',
          'Votes of A and B were reset: Pull request marked as draft'
        ),
        system(2, '2026-10-01T11:00:00Z', 'RefUpdate', 'The reference x was updated.'),
        system(3, '2026-10-01T12:00:00Z', 'ReviewersUpdate', 'A joined as a reviewer'),
      ])
    ).toEqual([
      'Votes of A and B were reset: Pull request marked as draft',
      'The branch was updated',
      'A joined as a reviewer',
    ]);
  });

  it('lists the comments written by people with the file and an excerpt, not the system threads it does not know', () => {
    const long = 'word '.repeat(40);
    const { events } = buildTimeline(
      PR_13713,
      [
        text(1, '2026-10-01T10:00:00Z', 'This small change\nwill be needed by !13765'),
        text(2, '2026-10-01T11:00:00Z', long, '/packages/fui-admin/system-info/SystemInfoWifi.tsx'),
        system(3, '2026-10-01T12:00:00Z', 'SomethingNew', 'Something new happened'),
        {
          ...text(4, '2026-10-01T13:00:00Z', 'deleted'),
          comments: [{ ...text(4, '', 'x').comments![0], isDeleted: true }],
        },
      ],
      utc
    );
    expect(events.slice(1).map((event) => event.text)).toEqual([
      'Szymon Kwasek EXT commented: “This small change will be needed by !13765”',
      `Szymon Kwasek EXT commented on SystemInfoWifi.tsx: “${long.trim().slice(0, 69)}…”`,
    ]);
  });

  it('ends a completed PR with its completion, once', () => {
    const completed: TimelineSource = { ...PR_13713, status: 'completed', closedDate: '2026-10-07T20:00:00Z' };
    expect(buildTimeline(completed, [], utc).events.at(-1)).toEqual({
      when: 'Oct 7, 20:00',
      text: 'Pull request completed',
    });
    const status = system(
      9,
      '2026-10-07T20:00:01Z',
      'StatusUpdate',
      'Daniel Zegarra EXT updated the pull request status to Completed',
      {
        CodeReviewStatus: 'Completed',
      }
    );
    const { events } = buildTimeline(completed, [status], utc);
    expect(events.map((event) => event.text)).toEqual([
      'Daniel Zegarra EXT created the pull request',
      'Daniel Zegarra EXT updated the pull request status to Completed',
    ]);
  });

  it('gives only the creation when the threads could not be read', () => {
    expect(buildTimeline(PR_13713, undefined, utc)).toEqual({
      events: [{ when: 'Sep 30, 17:44', text: 'Daniel Zegarra EXT created the pull request' }],
      earlier: 0,
    });
  });

  it('keeps the latest events and counts the earlier ones', () => {
    const pushes = Array.from({ length: 25 }, (_, index) =>
      system(index, `2026-10-${String(index + 1).padStart(2, '0')}T10:30:00Z`, 'RefUpdate', 'updated', {
        CodeReviewRefNewCommitsCount: index + 1,
      })
    );
    const { events, earlier } = buildTimeline(PR_13713, pushes.reverse(), utc);
    expect(events).toHaveLength(MAX_TIMELINE_EVENTS);
    expect(earlier).toBe(6);
    expect(events[0].text).toBe('6 new commits pushed');
    expect(events.at(-1)?.text).toBe('25 new commits pushed');
  });
});
