import { describe, expect, it } from 'vitest';
import { ciRunGroups, ciTooltipParts, currentBranchState, escapeMarkdown, TooltipPart } from './ciTooltip';
import { countRunStates, RunModel } from './pipelines';

const NOW = new Date('2026-10-21T12:00:00Z');

const run = (id: number, state: RunModel['state'], pipeline = 'UI-PR'): RunModel => ({
  id,
  pipeline,
  state,
  url: `https://build/${String(id)}`,
});

const pr = (pullRequestId: number, branch: string, runModel: RunModel) => ({
  pullRequestId,
  title: `Title ${String(pullRequestId)}`,
  sourceRefName: `refs/heads/${branch}`,
  webUrl: `https://pr/${String(pullRequestId)}`,
  run: runModel,
});

const input = {
  pullRequestRuns: [
    pr(1, 'feature/one', run(10, 'succeeded')),
    pr(2, 'feature/two', run(20, 'failed')),
    pr(2, 'feature/two', run(21, 'succeeded', 'Lint')),
  ],
  mergeRuns: [
    {
      pullRequestId: 5,
      title: 'Merged *work*',
      webUrl: 'https://pr/5',
      targetBranch: 'develop',
      run: run(50, 'running'),
    },
  ],
  branchRuns: [
    { branch: 'exp/a', run: run(60, 'failed') },
    { branch: 'exp/a', run: run(61, 'succeeded', 'Docs') },
  ],
};

/** The tooltip as VS Code would get it, with the text parts marked */
const render = (parts: TooltipPart[]) =>
  parts.map((part) => (part.kind === 'md' ? part.value : `«${part.value}»`)).join('');

describe('ciRunGroups', () => {
  it('groups the runs by PR, then the merges, then the branches without a PR', () => {
    const groups = ciRunGroups(input);
    expect(groups.map((group) => [group.kind, group.runs.map((r) => r.id)])).toEqual([
      ['pullRequest', [10]],
      ['pullRequest', [20, 21]],
      ['merge', [50]],
      ['branch', [60, 61]],
    ]);
  });

  it('puts the PR of the checked out branch first and marks it', () => {
    // Rule STATUSBAR-CI-5
    const groups = ciRunGroups({ ...input, currentBranch: 'feature/two' });
    expect(
      groups.map((group) => (group.kind === 'pullRequest' ? [group.pullRequestId, group.current] : group.kind))
    ).toEqual([[2, true], [1, false], 'merge', 'branch']);
  });

  it('marks the branch without a PR that is checked out', () => {
    // Rule STATUSBAR-CI-6
    const groups = ciRunGroups({ ...input, currentBranch: 'exp/a' });
    expect(groups.at(-1)).toEqual(expect.objectContaining({ kind: 'branch', branch: 'exp/a', current: true }));
  });
});

describe('currentBranchState', () => {
  it('is the most severe state of the runs of the PR of the checked out branch', () => {
    // Rules STATUSBAR-CI-3, STATUSBAR-CI-9
    expect(currentBranchState(ciRunGroups({ ...input, currentBranch: 'feature/two' }))).toBe('failed');
    expect(currentBranchState(ciRunGroups({ ...input, currentBranch: 'feature/one' }))).toBe('succeeded');
  });

  it('falls back to the manual runs of the branch, never to the merges or other PRs', () => {
    expect(currentBranchState(ciRunGroups({ ...input, currentBranch: 'exp/a' }))).toBe('failed');
    expect(currentBranchState(ciRunGroups({ ...input, currentBranch: 'develop' }))).toBeUndefined();
    expect(currentBranchState(ciRunGroups(input))).toBeUndefined();
  });

  it('prefers the PR runs over manual runs of the same branch', () => {
    const groups = ciRunGroups({
      ...input,
      branchRuns: [{ branch: 'feature/one', run: run(80, 'failed') }],
      currentBranch: 'feature/one',
    });
    expect(currentBranchState(groups)).toBe('succeeded');
  });
});

describe('ciTooltipParts', () => {
  const tooltip = (currentBranch?: string) => {
    const groups = ciRunGroups({ ...input, currentBranch });
    const counts = countRunStates(groups.flatMap((group) => group.runs.map((r) => r.state)));
    return ciTooltipParts(groups, counts, NOW);
  };

  it('shows one block per PR, header first and its runs below, separated by a rule', () => {
    // Rule STATUSBAR-CI-7
    const text = render(tooltip('feature/two'));
    expect(text).toContain('**«CI runs: 2 failed · 1 running · 3 succeeded»**  \n«Current branch: ❌ failed»');
    const current = text.indexOf('$(star-full) **Current branch**');
    const header = text.indexOf('$(git-pull-request) **[PR 2](https://pr/2)** · «Title 2»');
    const firstRun = text.indexOf('❌ «UI-PR»');
    const other = text.indexOf('**[PR 1](https://pr/1)**');
    expect(current).toBeGreaterThan(0);
    expect(header).toBeGreaterThan(current);
    expect(firstRun).toBeGreaterThan(header);
    expect(other).toBeGreaterThan(firstRun);
    // A blank line before the rule: without it the line above would become a heading
    expect(text.split('\n\n---\n\n')).toHaveLength(6);
    expect(text).toMatch(/_Click to open a run_$/);
  });

  it('indents the runs without leading spaces (they would make a code block)', () => {
    const text = render(tooltip());
    expect(text).toContain('&nbsp;&nbsp;&nbsp;&nbsp;✅ «Lint» · **[Succeeded](https://build/21)**');
    expect(text.split('\n').some((line) => line.startsWith('    '))).toBe(false);
  });

  it('keeps the error of a failed test indented under its test', () => {
    const failed: RunModel = {
      ...run(70, 'failed'),
      tests: { total: 9, failed: 1, failedTests: [{ title: 'Saves', file: 'save.spec.ts', error: 'Expected 1' }] },
    };
    const groups = ciRunGroups({ pullRequestRuns: [pr(7, 'x', failed)], mergeRuns: [], branchRuns: [] });
    const text = render(ciTooltipParts(groups, countRunStates(['failed']), NOW));
    expect(text).toContain('**[1 test failed](https://build/70?view=ms.vss-test-web.build-test-results-tab)**');
    expect(text).toContain('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;«• Saves (save.spec.ts)»');
    // appendText turns these spaces into non-breaking ones
    expect(text).toContain('&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;«    Expected 1»');
  });

  it('lists the merges and the runs without a PR under their own titles, last', () => {
    // Rules STATUSBAR-CI-6, STATUSBAR-CI-8
    const text = render(tooltip());
    const merges = text.indexOf('**AFTER MERGE**');
    const branches = text.indexOf('**RUNS WITHOUT A PULL REQUEST**');
    expect(merges).toBeGreaterThan(text.indexOf('PR 2'));
    expect(text).toContain('$(git-merge) **[PR 5](https://pr/5)** merged into «develop» · «Merged *work*»');
    expect(branches).toBeGreaterThan(merges);
    expect(text.slice(branches)).toContain('$(git-branch) «exp/a»');
    expect(text.indexOf('**RUNS WITHOUT A PULL REQUEST**', branches + 1)).toBe(-1);
  });

  it('says when the checked out branch has no runs', () => {
    expect(render(tooltip('develop'))).toContain('«Current branch: no CI runs»');
  });

  it('leaves out the sections without runs', () => {
    const groups = ciRunGroups({ ...input, mergeRuns: [], branchRuns: [] });
    const text = render(ciTooltipParts(groups, countRunStates(['succeeded']), NOW));
    expect(text).not.toContain('AFTER MERGE');
    expect(text).not.toContain('RUNS WITHOUT A PULL REQUEST');
  });

  it('keeps titles and test names as text, so they are escaped', () => {
    const parts = tooltip();
    expect(parts).toContainEqual({ kind: 'text', value: 'Merged *work*' });
    expect(parts.filter((part) => part.kind === 'md').some((part) => part.value.includes('Title'))).toBe(false);
  });
});

describe('escapeMarkdown', () => {
  it('escapes the link text', () => {
    expect(escapeMarkdown('Failed at [lint]')).toBe('Failed at \\[lint\\]');
  });
});
