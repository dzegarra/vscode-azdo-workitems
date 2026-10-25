import { describe, expect, it } from 'vitest';
import { beforeCompletion, type ChecklistInput } from './beforeCompletion';

const item = (overrides: Partial<ChecklistInput> = {}): ChecklistInput => ({
  state: 'Committed',
  alerts: [],
  ...overrides,
});

describe('beforeCompletion', () => {
  it('lists the alerts first, then what to agree or fill', () => {
    // Rules BEFORE-1, BEFORE-2
    const checks = beforeCompletion(
      item({
        alerts: [{ rule: 'noTasks', message: 'Work started but no task' }],
        openPredecessors: [
          {
            id: 66301,
            title: 'Save flow',
            type: 'Product Backlog Item',
            state: 'Committed',
            assignedTo: 'Jonas Berg',
            iterationName: 'Sprint 122',
          },
        ],
        blockingTags: ['Blocked'],
        missingFields: ['Effort in days'],
        conventions: ['Effort 4 is not on the scale 1, 2, 3, 5, 8, 13, 21'],
      })
    );
    expect(checks).toEqual([
      { severity: 'broken', text: 'Work started but no task' },
      {
        severity: 'caution',
        text: 'Predecessor #66301 is Committed: agree with Jonas Berg (Sprint 122)',
        relatedId: 66301,
      },
      { severity: 'caution', text: 'Tag Blocked is set: remove it once it no longer applies' },
      { severity: 'caution', text: 'Effort in days is empty' },
      { severity: 'caution', text: 'Effort 4 is not on the scale 1, 2, 3, 5, 8, 13, 21' },
    ]);
  });

  it('is empty for a closed work item', () => {
    // Rule BEFORE-3
    expect(beforeCompletion(item({ state: 'Done', alerts: [{ rule: 'tasksNotDone', message: 'x' }] }))).toEqual([]);
  });
});
