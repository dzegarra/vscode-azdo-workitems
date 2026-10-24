import { describe, expect, it } from 'vitest';
import type { RequiredFieldsRule } from './alerts';
import {
  completionIssueCount,
  completionIssueLines,
  completionIssues,
  completionTitle,
  conventionIssues,
  isEmptyRichText,
  type CompletionInput,
} from './completionIssues';

const EFFORT = 'Microsoft.VSTS.Scheduling.Effort';
const DAYS = 'Custom.EffortInDays';
const AC = 'Microsoft.VSTS.Common.AcceptanceCriteria';

const requiredFields: RequiredFieldsRule[] = [
  {
    types: ['Product Backlog Item'],
    fields: [
      { name: 'Effort', referenceName: EFFORT },
      { name: 'Effort in days', referenceName: DAYS },
    ],
  },
];
const rules = { blockingTags: ['Blocked', 'Needs refinement'], requiredFields };

const complete: CompletionInput = {
  type: 'Product Backlog Item',
  state: 'Committed',
  tags: [],
  fields: { [AC]: '<div>Given when then</div>', [EFFORT]: 5, [DAYS]: 3 },
};

function input(overrides: Partial<CompletionInput> = {}, fields: Record<string, unknown> = {}): CompletionInput {
  return { ...complete, ...overrides, fields: { ...complete.fields, ...fields } };
}

describe('isEmptyRichText', () => {
  it('is empty without content once tags, non-breaking spaces and whitespace are removed', () => {
    for (const html of [undefined, null, '', '  ', '<div><br></div>', '<div>&nbsp;</div>', '<p> &nbsp; </p><br/>']) {
      expect(isEmptyRichText(html)).toBe(true);
    }
  });

  it('has content with text, even inside tags', () => {
    expect(isEmptyRichText('<div>Given a</div>')).toBe(false);
    expect(isEmptyRichText('plain')).toBe(false);
  });
});

describe('completionIssues', () => {
  it('finds nothing in a complete Backlog Item', () => {
    expect(completionIssues(input(), rules)).toEqual({ blockingTags: [], missingFields: [], conventions: [] });
  });

  it('finds the blocking tags alone, ignoring case and spaces, as written on the work item', () => {
    expect(completionIssues(input({ tags: [' blocked ', 'NEEDS REFINEMENT', 'Other'] }), rules)).toEqual({
      blockingTags: [' blocked ', 'NEEDS REFINEMENT'],
      missingFields: [],
      conventions: [],
    });
  });

  it('finds the empty Acceptance criteria alone', () => {
    expect(completionIssues(input({}, { [AC]: '<div><br></div>' }), rules).missingFields).toEqual([
      'Acceptance criteria',
    ]);
    expect(completionIssues(input({}, { [AC]: '<div>&nbsp;</div>' }), rules).missingFields).toEqual([
      'Acceptance criteria',
    ]);
    expect(completionIssues({ ...complete, fields: {} }, rules).missingFields).toEqual([
      'Acceptance criteria',
      'Effort',
      'Effort in days',
    ]);
  });

  it('finds each empty required field alone', () => {
    expect(completionIssues(input({}, { [EFFORT]: undefined }), rules).missingFields).toEqual(['Effort']);
    expect(completionIssues(input({}, { [DAYS]: '' }), rules).missingFields).toEqual(['Effort in days']);
  });

  it('combines tags and fields, each name once', () => {
    const duplicated = [...requiredFields, ...requiredFields];
    const issues = completionIssues(input({ tags: ['Blocked'] }, { [AC]: '', [EFFORT]: null }), {
      ...rules,
      requiredFields: duplicated,
    });
    expect(issues).toEqual({
      blockingTags: ['Blocked'],
      missingFields: ['Acceptance criteria', 'Effort'],
      conventions: [],
    });
  });

  it('applies the required fields only to the states of the rule', () => {
    const started: RequiredFieldsRule[] = [{ ...requiredFields[0], states: ['Committed'] }];
    expect(
      completionIssues(input({ state: 'Approved' }, { [EFFORT]: '' }), { ...rules, requiredFields: started })
    ).toMatchObject({ missingFields: [] });
    expect(
      completionIssues(input({ state: 'Committed' }, { [EFFORT]: '' }), { ...rules, requiredFields: started })
    ).toMatchObject({ missingFields: ['Effort'] });
  });

  it('checks the issues in every open state, not only the not started ones', () => {
    for (const state of ['New', 'Approved', 'Committed', 'In Progress']) {
      expect(completionIssues(input({ state, tags: ['Blocked'] }), rules).blockingTags).toEqual(['Blocked']);
    }
  });

  it('gives nothing for closed work items', () => {
    for (const state of ['Done', 'Removed', 'Closed']) {
      expect(completionIssues({ ...complete, state, tags: ['Blocked'], fields: {} }, rules)).toEqual({
        blockingTags: [],
        missingFields: [],
        conventions: [],
      });
    }
  });

  it('ignores Acceptance criteria and effort in Bugs, but not the tags', () => {
    expect(completionIssues({ type: 'Bug', state: 'Active', tags: ['Blocked'], fields: {} }, rules)).toEqual({
      blockingTags: ['Blocked'],
      missingFields: [],
      conventions: [],
    });
  });
});

describe('conventions of the Backlog Items (Rules COMPLETE-5, COMPLETE-6)', () => {
  const conventions = {
    effortScale: [1, 2, 3, 5, 8, 13, 21],
    titlePrefixes: ['[Platform]', '[Platform UI]', '[PMUI]', '[FUI]'],
  };

  it('finds story points off the scale', () => {
    expect(conventionIssues({ ...complete, title: '[PMUI] x', fields: { [EFFORT]: 4 } }, conventions)).toEqual([
      'Effort 4 is not on the scale 1, 2, 3, 5, 8, 13, 21',
    ]);
    expect(conventionIssues({ ...complete, title: '[PMUI] x', fields: { [EFFORT]: 13 } }, conventions)).toEqual([]);
    // An empty Effort is the required fields' business
    expect(conventionIssues({ ...complete, title: '[PMUI] x', fields: {} }, conventions)).toEqual([]);
  });

  it('finds a title without one of the prefixes, brackets included', () => {
    expect(conventionIssues({ ...complete, title: 'Platform UI: Filtering for Tags' }, conventions)).toEqual([
      'Title without a team prefix ([Platform], [Platform UI], [PMUI]…)',
    ]);
    expect(conventionIssues({ ...complete, title: ' [Platform UI] Filtering for Tags' }, conventions)).toEqual([]);
  });

  it('checks Backlog Items only, and nothing with empty lists or an unknown title', () => {
    expect(conventionIssues({ ...complete, type: 'Bug', title: 'x', fields: { [EFFORT]: 4 } }, conventions)).toEqual(
      []
    );
    expect(conventionIssues({ ...complete, title: 'x', fields: { [EFFORT]: 4 } }, {})).toEqual([]);
    expect(conventionIssues({ ...complete, fields: { [EFFORT]: 5 } }, conventions)).toEqual([]);
  });

  it('does not say "cannot be completed" with only conventions', () => {
    expect(completionTitle({ conventions: ['Effort 4 is not on the scale'] })).toBe(
      'Before completion: Effort 4 is not on the scale'
    );
    expect(completionTitle({ blockingTags: ['Blocked'], conventions: ['Effort 4'] })).toBe(
      'Cannot be completed yet: Tagged Blocked · Effort 4'
    );
  });

  it('counts the conventions in the caution', () => {
    const item = { conventions: ['Effort 4 is not on the scale', 'Title without a team prefix'] };
    expect(completionIssueCount(item)).toBe(2);
    expect(completionIssueLines(item)).toEqual(['Effort 4 is not on the scale', 'Title without a team prefix']);
  });
});

describe('completionIssueCount', () => {
  it('adds the open predecessors, the tags and the missing fields', () => {
    expect(completionIssueCount({})).toBe(0);
    expect(completionIssueCount({ openPredecessors: [], blockingTags: [], missingFields: [] })).toBe(0);
    expect(completionIssueCount({ openPredecessors: [{}, {}] })).toBe(2);
    expect(completionIssueCount({ blockingTags: ['Blocked'] })).toBe(1);
    expect(completionIssueCount({ missingFields: ['Effort', 'Effort in days'] })).toBe(2);
    expect(completionIssueCount({ openPredecessors: [{}], blockingTags: ['Blocked'], missingFields: ['Effort'] })).toBe(
      3
    );
  });

  it('still counts the tags and fields when the predecessors are unknown', () => {
    expect(
      completionIssueCount({ openPredecessors: undefined, blockingTags: ['Blocked'], missingFields: ['Effort'] })
    ).toBe(2);
  });
});

describe('completionIssueLines', () => {
  it('has one line per kind of issue', () => {
    expect(
      completionIssueLines({ openPredecessors: [{}], blockingTags: ['Blocked', 'PT'], missingFields: ['Effort'] })
    ).toEqual(['1 open predecessor', 'Tagged Blocked, PT', 'Missing Effort']);
    expect(completionIssueLines({ openPredecessors: [{}, {}] })).toEqual(['2 open predecessors']);
    expect(completionIssueLines({})).toEqual([]);
  });
});
