import { describe, expect, it } from 'vitest';
import { DetailsData, renderDetailsBody } from './detailsHtml';

const details = (type: string): DetailsData => ({
  id: 1,
  title: 'Title',
  type,
  state: 'In Progress',
  fields: {},
  children: [],
  predecessors: [],
  successors: [],
});

describe('details actions', () => {
  it('offers the dependency map, except for Tasks (they are not shown in it)', () => {
    expect(renderDetailsBody(details('Bug'))).toContain('data-action="openDependencyMap"');
    expect(renderDetailsBody(details('Product Backlog Item'))).toContain('data-action="openDependencyMap"');
    expect(renderDetailsBody(details('Task'))).not.toContain('data-action="openDependencyMap"');
  });
});
