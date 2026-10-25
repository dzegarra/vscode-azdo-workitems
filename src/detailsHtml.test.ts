import { describe, expect, it } from 'vitest';
import { DetailsData, initials, renderDetailsBody } from './detailsHtml';

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

describe('details layout', () => {
  const bug = (): DetailsData => ({
    ...details('Bug'),
    type: 'Bug',
    state: 'Approved',
    parent: { id: 9, title: 'The feature', type: 'Feature', state: 'Active' },
    fields: {
      'System.Tags': 'Blocked; MVP3',
      'System.AssignedTo': { displayName: 'Ana Ruiz' },
      'System.IterationPath': 'P\\R\\Sprint 1',
    },
  });

  it('writes the breadcrumb, the tags and the assignee in the header, and no separate Parent section', () => {
    const html = renderDetailsBody(bug());
    expect(html).toContain('<span class="crumb-type">Feature</span>');
    expect(html).toContain('<span class="crumb-id">1</span>');
    expect(html).toContain('<span class="where">· Sprint 1 · Ana Ruiz</span>');
    expect(html).toContain('>MVP3</span>');
    expect(html).not.toContain('<h2><span>Parent');
  });

  it('marks the blocking tags', () => {
    const data = {
      ...bug(),
      card: {
        blockingTags: ['blocked'],
        pullRequests: [],
        branches: [],
        state: 'Approved',
        alerts: [],
      } as unknown as DetailsData['card'],
    };
    expect(renderDetailsBody(data)).toContain('pill tag-blocking" title="Blocking tag">Blocked</span>');
  });

  it('explains the states of each type, and In review only when it is shown', () => {
    expect(renderDetailsBody(bug())).toContain('Only testers move a Bug to Done');
    const pbi = { ...details('Product Backlog Item'), state: 'Committed' };
    expect(renderDetailsBody(pbi)).toContain('The developer completes it.');
    expect(renderDetailsBody(pbi)).not.toContain('In review is derived');
    expect(renderDetailsBody({ ...pbi, displayState: 'In review' })).toContain('In review is derived');
    expect(renderDetailsBody(details('Task'))).not.toContain('state-help');
  });

  it('lists the tasks of a Bug or Backlog Item with their progress, and the children of other types', () => {
    const tasks = [
      { id: 5, title: 'Write it', type: 'Task', state: 'Done', assignedTo: 'Ana Ruiz' },
      { id: 6, title: 'Test it', type: 'Task', state: 'To Do' },
    ];
    const html = renderDetailsBody({ ...bug(), children: tasks });
    expect(html).toContain('Tasks · 2');
    expect(html).toContain('seg-done');
    expect(html).toContain('>AR</span>');
    expect(html).toContain('data-action="addTask"');
    expect(renderDetailsBody(bug())).toContain('No tasks yet. Create PR adds the PR task');
    expect(renderDetailsBody({ ...details('Feature'), children: tasks })).toContain('Children (2)');
  });

  it('shows the integration build of a Bug, muted when empty, and the link to Azure DevOps', () => {
    expect(renderDetailsBody(bug())).toContain('<dt>Integrated in Build</dt><dd class="muted">empty</dd>');
    const built = { ...bug(), fields: { 'Microsoft.VSTS.Build.IntegrationBuild': '0.24.63' } };
    expect(renderDetailsBody(built)).toContain('<dd>0.24.63</dd>');
    expect(renderDetailsBody(details('Task'))).not.toContain('Integrated in Build');
    expect(renderDetailsBody(bug())).toContain('data-action="openWorkItem"');
  });

  it('takes the initials of a name', () => {
    expect(initials('Ana Ruiz')).toBe('AR');
    expect(initials('Jonas')).toBe('J');
    expect(initials('ana maria ruiz')).toBe('AM');
  });
});
