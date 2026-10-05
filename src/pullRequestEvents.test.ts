import { describe, expect, it } from 'vitest';
import { describeEvent, detectEvents, PullRequestSnapshot, StoredSnapshot, toStored } from './pullRequestEvents';

const ME = 'me';
const comment = (key: string, authorId = 'ana', content = 'Could you rename this?') => ({
  key,
  authorId,
  author: authorId === 'ana' ? 'Ana' : 'Bob',
  content,
});
const pr = (overrides: Partial<PullRequestSnapshot> = {}): PullRequestSnapshot => ({
  id: 13720,
  title: '[66280] FUI Administration: Access point label',
  status: 'active',
  url: 'https://pr',
  reviewers: [{ id: 'ana', name: 'Ana', vote: 0 }],
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
        { id: 'ana', name: 'Ana', vote: 10 },
        { id: ME, name: 'Me', vote: 10 },
      ],
    });
    const events = detectEvents(previous, [current], ME);
    expect(events.map(describeEvent)).toEqual([
      'Ana approved PR 13720: [66280] FUI Administration: Access point label',
    ]);
    const reset = toStored([current], previous);
    expect(detectEvents(reset, [pr({ reviewers: [{ id: 'ana', name: 'Ana', vote: 0 }] })], ME)).toEqual([]);
  });

  it('detects merged PRs', () => {
    const events = detectEvents(previous, [pr({ status: 'completed', comments: undefined })], ME);
    expect(events.map(describeEvent)).toEqual(['PR 13720 was merged: [66280] FUI Administration: Access point label']);
  });

  it('describes a single comment with an excerpt', () => {
    const long = `Please ${'very '.repeat(30)}long comment`;
    const [event] = detectEvents(previous, [pr({ comments: [comment('1:1'), comment('3:1', 'bob', long)] })], ME);
    expect(describeEvent(event)).toMatch(/^Bob commented on PR 13720: "Please very .*…"$/);
  });

  it('keeps the known comments when the threads were not fetched', () => {
    const stored = toStored([pr({ status: 'completed', comments: undefined })], previous);
    expect(stored[13720]?.commentKeys).toEqual(['1:1']);
  });
});
