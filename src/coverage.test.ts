import { describe, expect, it } from 'vitest';
import {
  coverageLevel,
  CoverageSummary,
  DEFAULT_THRESHOLDS,
  describeCoverage,
  describeFile,
  FileCoverage,
  filesBelowTarget,
  formatDelta,
  formatPercent,
  listedNames,
  normalizeThresholds,
  safeRelativePath,
  shapeCoverage,
} from './coverage';

const file = (path: string, covered: number, total: number): FileCoverage => ({ path, covered, total });

describe('coverageLevel', () => {
  it.each([
    [0, 'low'],
    [59.9, 'low'],
    [60, 'fair'],
    [79.9, 'fair'],
    [80, 'good'],
    [94.9, 'good'],
    [95, 'excellent'],
    [100, 'excellent'],
  ] as const)('%s%% is %s with the default thresholds', (percent, level) => {
    expect(coverageLevel(percent, DEFAULT_THRESHOLDS)).toBe(level);
  });

  it('follows custom thresholds', () => {
    expect(coverageLevel(70, { minimum: 50, target: 70, excellent: 90 })).toBe('good');
  });
});

describe('normalizeThresholds', () => {
  it('uses the defaults for missing or invalid values', () => {
    expect(normalizeThresholds({})).toEqual(DEFAULT_THRESHOLDS);
    expect(normalizeThresholds({ minimum: Number.NaN })).toEqual(DEFAULT_THRESHOLDS);
  });

  it('keeps minimum <= target <= excellent', () => {
    expect(normalizeThresholds({ minimum: 90, target: 50, excellent: 10 })).toEqual({
      minimum: 90,
      target: 90,
      excellent: 90,
    });
  });
});

describe('formatPercent', () => {
  it('rounds down, so a level is never shown above the one reached', () => {
    expect(formatPercent(87.4)).toBe('87%');
    expect(formatPercent(94.8)).toBe('94%');
    expect(formatPercent(99.7)).toBe('99%');
    expect(formatPercent(100)).toBe('100%');
  });
});

describe('formatDelta', () => {
  it('marks an increase as up', () => {
    expect(formatDelta(3.2)).toEqual({ text: '▲ +3.2%', direction: 'up' });
  });

  it('marks a decrease as down, without a minus sign or a colour of blame', () => {
    expect(formatDelta(-1.14)).toEqual({ text: '▼ 1.1%', direction: 'down' });
  });

  it('says nothing when there is nothing to compare or nothing changed', () => {
    expect(formatDelta(undefined)).toBeUndefined();
    expect(formatDelta(0)).toBeUndefined();
    expect(formatDelta(0.04)).toBeUndefined();
    expect(formatDelta(Number.NaN)).toBeUndefined();
  });
});

describe('filesBelowTarget', () => {
  const files = [
    file('a/Good.tsx', 18, 20),
    file('a/ReadOnlyField.tsx', 6, 15),
    file('a/Bad.ts', 1, 10),
    file('a/Big.ts', 10, 40),
    file('a/Empty.ts', 0, 0),
    file('a/Exactly.ts', 8, 10),
  ];

  it('lists the files under the target, the least covered first', () => {
    expect(filesBelowTarget(files, 80).map((f) => f.path)).toEqual(['a/Bad.ts', 'a/Big.ts', 'a/ReadOnlyField.tsx']);
  });

  it('puts first the file with more lines left among the same percentage', () => {
    const tied = [file('a/small.ts', 5, 10), file('a/large.ts', 50, 100)];
    expect(filesBelowTarget(tied, 80).map((f) => f.path)).toEqual(['a/large.ts', 'a/small.ts']);
  });

  it('limits the list', () => {
    const many = Array.from({ length: 12 }, (_, i) => file(`f${i}.ts`, i, 20));
    expect(filesBelowTarget(many, 80)).toHaveLength(8);
    expect(filesBelowTarget(many, 80, 3)).toHaveLength(3);
    expect(filesBelowTarget(many, 80)[0].path).toBe('f0.ts');
  });
});

describe('listedNames', () => {
  it('adds folders only to the files with the same name, until they differ', () => {
    expect(
      listedNames([
        { path: 'a/config/props.ts' },
        { path: 'b/config/props.ts' },
        { path: 'a/Other.ts' },
        { path: 'x.ts' },
      ])
    ).toEqual(['a/config/props.ts', 'b/config/props.ts', 'Other.ts', 'x.ts']);
    expect(listedNames([{ path: 'p/a/config/props.ts' }, { path: 'p/b/config/props.ts' }])).toEqual([
      'a/config/props.ts',
      'b/config/props.ts',
    ]);
  });
});

describe('describeFile', () => {
  it('shows the name, the percentage and the lines', () => {
    expect(describeFile(file('packages/ui/ReadOnlyField.tsx', 6, 15))).toBe('ReadOnlyField.tsx 40% (6/15 lines)');
  });
});

describe('describeCoverage', () => {
  it('adds the delta when there is one', () => {
    const coverage: CoverageSummary = { percent: 87, covered: 87, total: 100, delta: 3.2, files: [] };
    expect(describeCoverage(coverage)).toBe('coverage 87% ▲ +3.2%');
    expect(describeCoverage({ ...coverage, delta: undefined })).toBe('coverage 87%');
  });
});

describe('safeRelativePath', () => {
  it('accepts repository paths', () => {
    expect(safeRelativePath('packages/a/b.ts')).toBe('packages/a/b.ts');
    expect(safeRelativePath('/packages/a/b.ts')).toBe('packages/a/b.ts');
  });

  it('rejects what could leave the repository', () => {
    expect(safeRelativePath('../secret')).toBeUndefined();
    expect(safeRelativePath('a/../../b')).toBeUndefined();
    expect(safeRelativePath('C:/Windows/x')).toBeUndefined();
    expect(safeRelativePath('')).toBeUndefined();
  });
});

describe('shapeCoverage', () => {
  const summary = (overrides = {}) => ({
    status: 'finalized',
    coverageDetailedSummaryStatus: 'finalized',
    coverageData: [{ coverageStats: [{ label: 'Lines', covered: 12, total: 16, delta: 2.5, isDeltaAvailable: true }] }],
    ...overrides,
  });
  const files = {
    value: [
      {
        modules: [
          { name: '/packages/a/Full.ts', statistics: { linesCovered: 8 } },
          { name: '/packages/a/Half.ts', statistics: { linesCovered: 4, linesNotCovered: 4 } },
        ],
      },
    ],
  };

  it('computes the percentage and keeps the files with lines not covered', () => {
    const { coverage, final } = shapeCoverage(summary(), files);
    expect(final).toBe(true);
    expect(coverage).toEqual({
      percent: 75,
      covered: 12,
      total: 16,
      delta: 2.5,
      files: [{ path: 'packages/a/Half.ts', covered: 4, total: 8 }],
    });
  });

  it('ignores the delta when Azure DevOps has none to compare with', () => {
    const raw = summary({
      coverageData: [{ coverageStats: [{ label: 'Lines', covered: 1, total: 2, delta: 0, isDeltaAvailable: false }] }],
    });
    expect(shapeCoverage(raw).coverage?.delta).toBeUndefined();
  });

  it('is not final while Azure DevOps processes it', () => {
    expect(shapeCoverage(summary({ status: 'inProgress' }), files).final).toBe(false);
  });

  it('has no coverage when no modules were found', () => {
    expect(
      shapeCoverage({ status: 'finalized', coverageDetailedSummaryStatus: 'noModulesFound', coverageData: [] })
    ).toEqual({ final: true });
  });

  it('counts partially covered lines as not covered', () => {
    const partial = {
      value: [{ modules: [{ name: '/x.ts', statistics: { linesCovered: 2, linesPartiallyCovered: 2 } }] }],
    };
    expect(shapeCoverage(summary(), partial).coverage?.files).toEqual([{ path: 'x.ts', covered: 2, total: 4 }]);
  });
});
