import { describe, expect, it } from 'vitest';
import { snapshotThreads } from './pullRequestThreadSnapshots';
import { ThreadResponse } from './reviewThreads';

const author = (id: string) => ({ id, displayName: id.toUpperCase() });
const identities = {
  '1': { id: 'ana', displayName: 'Ana' },
  '2': { id: 'szymon', displayName: 'Szymon' },
  '3': { id: 'team', displayName: '[Project]\\Team', isContainer: true },
};
const prop = (value: string) => ({ $value: value });
const system = (id: number, properties: Record<string, string>, content: string): ThreadResponse => ({
  id,
  publishedDate: '2026-09-11T15:35:10Z',
  properties: {
    CodeReviewThreadType: prop('ReviewersUpdate'),
    ...Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [`CodeReviewReviewersUpdated${key}`, prop(value)])
    ),
  },
  identities,
  comments: [{ id: 1, author: author('tfs'), content, commentType: 'system' }],
});

describe('snapshotThreads', () => {
  it('flattens text comments with thread id, file, starter and whether they start the thread', () => {
    const { comments, threads } = snapshotThreads([
      {
        id: 7,
        status: 'fixed',
        publishedDate: '',
        threadContext: { filePath: '/src/a.ts' },
        comments: [
          { id: 1, author: author('bob'), content: 'Rename', commentType: 'text' },
          { id: 2, author: author('ana'), content: 'Done', commentType: 'text' },
          { id: 3, author: author('ana'), content: 'gone', commentType: 'text', isDeleted: true },
        ],
      },
      { id: 8, publishedDate: '', comments: [{ id: 1, author: author('tfs'), content: 'x', commentType: 'system' }] },
    ]);
    expect(comments).toEqual([
      expect.objectContaining({
        key: '7:1',
        threadId: 7,
        filePath: '/src/a.ts',
        threadStarterId: 'bob',
        startsThread: true,
      }),
      expect.objectContaining({ key: '7:2', threadStarterId: 'bob', startsThread: false }),
    ]);
    expect(threads).toEqual([{ id: 7, status: 'fixed', filePath: '/src/a.ts', firstContent: 'Rename' }]);
  });

  it('reads the ReviewersUpdate threads', () => {
    const { reviewerUpdates, reviewerUpdateIds } = snapshotThreads([
      system(1, { ByIdentity: '1', AddedIdentity: '2' }, 'Ana added Szymon as a reviewer'),
      system(2, { ByIdentity: '2', AddedIdentity: '2' }, 'Szymon joined as a reviewer'),
      system(
        3,
        { ByIdentity: '1', ChangedIdentity: '2', ChangedToRequired: 'True' },
        'Ana made Szymon a required reviewer'
      ),
      system(4, { ByIdentity: '1', ChangedIdentity: '2', ChangedToRequired: 'False' }, 'x'),
      system(5, { ByIdentity: '1', RemovedIdentity: '2' }, 'Ana removed Szymon from the reviewers'),
      system(6, { ByIdentity: '2', RemovedIdentity: '2' }, 'Szymon declined to review'),
      system(7, { ByIdentity: '2', RemovedIdentity: '2' }, 'Szymon removed themselves'),
      system(8, { ByIdentity: '1', AddedIdentity: '3' }, 'Ana added the team as a reviewer'),
    ]);
    expect(reviewerUpdateIds).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(reviewerUpdates.map(({ threadId, kind, actor, target }) => [threadId, kind, actor?.id, target.id])).toEqual([
      [1, 'added', 'ana', 'szymon'],
      [2, 'added', 'szymon', 'szymon'],
      [3, 'required', 'ana', 'szymon'],
      [4, 'optional', 'ana', 'szymon'],
      [5, 'removed', 'ana', 'szymon'],
      [6, 'declined', 'szymon', 'szymon'],
      [7, 'removed', 'szymon', 'szymon'],
    ]);
  });
});
