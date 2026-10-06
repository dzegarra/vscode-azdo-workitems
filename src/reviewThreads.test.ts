import { describe, expect, it } from 'vitest';
import {
  describeObservationEvent,
  detectObservationEvents,
  hasOpenObservations,
  myObservations,
  ThreadResponse,
  threadUrl,
  toStoredObservations,
} from './reviewThreads';

const ME = 'me';
const pullRequest = {
  id: 13662,
  title: 'Unit preset',
  url: 'https://dev.azure.com/org/project/_git/repo/pullrequest/13662',
  repositoryId: 'repo',
};

const comment = (id: number, author: string, content: string, extra = {}) => ({
  id,
  author: { id: author, displayName: author === ME ? 'Me' : 'Krzysztof' },
  content,
  commentType: 'text',
  ...extra,
});

// Like thread 133151 of PR 13662: my comment on a file, answered by the author
function thread(status: string, comments: ThreadResponse['comments'], id = 133151): ThreadResponse {
  return {
    id,
    status,
    publishedDate: '2026-09-29T21:20:11Z',
    threadContext: { filePath: '/apps/fui-e2e/tests/fui-application/fui-create-app.spec.ts' },
    comments,
  };
}

const mine = comment(1, ME, 'This test is verifying the Unit Preset field is rendered');

describe('my observations', () => {
  it('keeps the text threads I started, without deleted comments', () => {
    const threads: ThreadResponse[] = [
      thread('active', [
        mine,
        comment(2, 'kk', 'this is what i wanted to verify'),
        comment(3, 'kk', 'x', { isDeleted: true }),
      ]),
      thread('active', [comment(1, 'kk', 'Not mine')], 2),
      thread('active', [comment(1, ME, '', { isDeleted: true })], 3),
      { id: 4, publishedDate: '', properties: {}, comments: [comment(1, ME, 'Published', { commentType: 'system' })] },
    ];
    const observations = myObservations(threads, ME);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ threadId: 133151, status: 'active', content: mine.content });
    expect(observations[0].comments.map((c) => c.id)).toEqual([1, 2]);
  });
});

describe('observation events', () => {
  const before = toStoredObservations(pullRequest, myObservations([thread('active', [mine])], ME));

  it('only establishes a baseline for a PR seen for the first time', () => {
    const observations = myObservations([thread('fixed', [mine, comment(2, 'kk', 'Done')])], ME);
    expect(detectObservationEvents(undefined, pullRequest, observations, ME)).toEqual([]);
  });

  it('notifies replies of other people, not mine', () => {
    const observations = myObservations(
      [thread('active', [mine, comment(2, ME, 'btw'), comment(3, 'kk', 'this is what i wanted to verify')])],
      ME
    );
    const events = detectObservationEvents(before, pullRequest, observations, ME);
    expect(events.map((e) => [e.kind, e.replies.map((r) => r.id)])).toEqual([['replied', [3]]]);
    expect(describeObservationEvent(events[0])).toBe(
      'Krzysztof replied to your comment on PR 13662 (fui-create-app.spec.ts): "this is what i wanted to verify"'
    );
    const stored = toStoredObservations(pullRequest, observations);
    expect(detectObservationEvents(stored, pullRequest, observations, ME)).toEqual([]);
  });

  it('notifies a resolution once, with the replies that came with it', () => {
    const resolved = myObservations(
      [thread('fixed', [mine, comment(2, 'kk', 'o but title is wrong I will change this')])],
      ME
    );
    const events = detectObservationEvents(before, pullRequest, resolved, ME);
    expect(events.map((e) => e.kind)).toEqual(['resolved']);
    expect(describeObservationEvent(events[0])).toBe(
      'Your comment on PR 13662 (fui-create-app.spec.ts) was marked Resolved: Krzysztof: "o but title is wrong I will change this"'
    );
    const wontFix = myObservations([thread('wontFix', [mine])], ME);
    expect(describeObservationEvent(detectObservationEvents(before, pullRequest, wontFix, ME)[0])).toBe(
      `Your comment on PR 13662 (fui-create-app.spec.ts) was marked Won't fix: "${mine.content}"`
    );
    const stored = toStoredObservations(pullRequest, resolved);
    expect(detectObservationEvents(stored, pullRequest, resolved, ME)).toEqual([]);
    // Reopened: nothing to tell
    expect(detectObservationEvents(stored, pullRequest, myObservations([thread('active', [mine])], ME), ME)).toEqual(
      []
    );
  });

  it('notifies replies to a thread started after the PR was first seen', () => {
    const observations = myObservations([thread('active', [mine, comment(2, 'kk', 'Agreed')], 99)], ME);
    expect(detectObservationEvents(before, pullRequest, observations, ME).map((e) => e.kind)).toEqual(['replied']);
  });

  it('keeps checking PRs with open observations, and links to the thread', () => {
    expect(hasOpenObservations(before)).toBe(true);
    expect(hasOpenObservations(toStoredObservations(pullRequest, myObservations([thread('fixed', [mine])], ME)))).toBe(
      false
    );
    expect(threadUrl(pullRequest.url, 133151)).toBe(`${pullRequest.url}?discussionId=133151`);
  });
});
