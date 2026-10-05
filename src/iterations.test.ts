import { describe, expect, it } from 'vitest';
import { buildMyWorkItemsQuery, mergeTeamIterations } from './iterations';

const sprint1 = { id: '1', name: 'Sprint 1', path: 'Flow\\Sprint 1' };
const sprint2 = { id: '2', name: 'Sprint 2', path: 'Flow\\Sprint 2' };

describe('mergeTeamIterations', () => {
  it('groups the teams sharing the same iteration', () => {
    expect(
      mergeTeamIterations([
        { team: 'FUI', iteration: sprint1 },
        { team: 'PMUI', iteration: sprint2 },
        { team: 'Platform', iteration: sprint1 },
      ])
    ).toEqual([
      { iteration: sprint1, teams: ['FUI', 'Platform'] },
      { iteration: sprint2, teams: ['PMUI'] },
    ]);
  });

  it('ignores teams without a current iteration', () => {
    expect(mergeTeamIterations([{ team: 'Old team', iteration: undefined }])).toEqual([]);
  });
});

describe('buildMyWorkItemsQuery', () => {
  it('queries the work items assigned to me in all the iterations', () => {
    expect(buildMyWorkItemsQuery([sprint1.path, "Flow\\Sprint 'X'"])).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.IterationPath] IN ('Flow\\Sprint 1', 'Flow\\Sprint ''X''') ORDER BY [System.WorkItemType], [System.Id]"
    );
  });
});
