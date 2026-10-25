import { describe, expect, it } from 'vitest';
import { isTesterOnlyMove, stateSteps, TESTERS_ONLY } from './stateSteps';

const labels = (steps: ReturnType<typeof stateSteps>) => steps?.map((step) => `${step.label}:${step.status}`);

describe('stateSteps', () => {
  it('walks a Bug to Ready to Test, the developer finish line, with Done left to the testers', () => {
    // Rules STEPS-1, STEPS-4
    const steps = stateSteps('Bug', 'Approved');
    expect(labels(steps)).toEqual([
      'New:past',
      'Approved:current',
      'Committed:next',
      'Ready to Test:next',
      'Done:next',
    ]);
    expect(steps?.find((step) => step.label === 'Ready to Test')?.note).toBe('your finish line');
    expect(steps?.at(-1)).toMatchObject({ locked: TESTERS_ONLY, note: 'testers only' });
  });

  it('matches the states by name, whatever their spelling', () => {
    // Rule STEPS-1
    expect(labels(stateSteps('Bug', 'Ready-to-Test'))?.at(3)).toBe('Ready to Test:current');
  });

  it('shows ReOpened in the Approved slot of a reopened Bug', () => {
    // Rule STEPS-2
    expect(labels(stateSteps('Bug', 'ReOpened'))).toEqual([
      'New:past',
      'ReOpened:current',
      'Committed:next',
      'Ready to Test:next',
      'Done:next',
    ]);
  });

  it('shows Removed only when the work item is in it', () => {
    // Rule STEPS-3
    expect(labels(stateSteps('Product Backlog Item', 'Committed'))).toEqual([
      'New:past',
      'Approved:past',
      'Committed:current',
      'Done:next',
    ]);
    expect(labels(stateSteps('Product Backlog Item', 'Removed'))?.at(-1)).toBe('Removed:current');
  });

  it('adds the derived In review after Committed, display only', () => {
    // Rule STEPS-5
    const steps = stateSteps('Product Backlog Item', 'Committed', 'In review');
    expect(steps?.at(3)).toEqual({ label: 'In review', status: 'current', note: 'shown, not set', derived: true });
  });

  it('leaves the other types and unknown states to the state button', () => {
    expect(stateSteps('Task', 'In Progress')).toBeUndefined();
    expect(stateSteps('Bug', 'Closed')).toBeUndefined();
  });
});

describe('isTesterOnlyMove', () => {
  it('is a Bug moved to Done', () => {
    // Rule STEPS-4
    expect(isTesterOnlyMove('Bug', 'Done')).toBe(true);
    expect(isTesterOnlyMove('Bug', 'Ready to Test')).toBe(false);
    expect(isTesterOnlyMove('Product Backlog Item', 'Done')).toBe(false);
  });
});
