/** Code coverage of CI runs: shaping, levels and texts. Pure, so no "vscode" import */

export interface FileCoverage {
  /** Repository-relative path, e.g. "packages/fui-admin/network/helpers/getWifiModeLabelFromRole.ts" */
  path: string;
  covered: number;
  total: number;
}

export interface CoverageSummary {
  /** Percentage of lines covered by the tests of the run, 0 to 100 */
  percent: number;
  covered: number;
  total: number;
  /**
   * Percentage points compared with the previous build of the same PR. Undefined when Azure DevOps
   * has no previous build to compare with
   */
  delta?: number;
  /** Files with lines not covered, the least covered first */
  files: FileCoverage[];
}

export interface CoverageThresholds {
  minimum: number;
  target: number;
  excellent: number;
}

export const DEFAULT_THRESHOLDS: CoverageThresholds = { minimum: 60, target: 80, excellent: 95 };

export type CoverageLevel = 'excellent' | 'fair' | 'good' | 'low';

/** Detailed statuses after which the coverage of a build does not change */
const FINAL_DETAILS = ['finalized', 'noModulesFound'];
/** Files kept per run: the popover only shows the worst ones */
const MAX_FILES = 40;
/** Files listed in the popover */
export const MAX_LISTED_FILES = 8;
const PERCENT = 100;
/** Changes smaller than this are not worth showing (the percent has one decimal) */
const MIN_DELTA = 0.05;

/** Thresholds as they are in the settings; invalid or inconsistent values fall back to the defaults, in order */
export function normalizeThresholds(raw: Partial<CoverageThresholds>): CoverageThresholds {
  const valid = (value: number | undefined, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(PERCENT, Math.max(0, value)) : fallback;
  const minimum = valid(raw.minimum, DEFAULT_THRESHOLDS.minimum);
  const target = Math.max(minimum, valid(raw.target, DEFAULT_THRESHOLDS.target));
  const excellent = Math.max(target, valid(raw.excellent, DEFAULT_THRESHOLDS.excellent));
  return { minimum, target, excellent };
}

/** Below the minimum: low (red); below the target: fair (orange); from the target: good (green); excellent (gold) */
export function coverageLevel(percent: number, thresholds: CoverageThresholds): CoverageLevel {
  if (percent < thresholds.minimum) {
    return 'low';
  }
  if (percent < thresholds.target) {
    return 'fair';
  }
  return percent < thresholds.excellent ? 'good' : 'excellent';
}

/** "87%". Rounded down: 94.8% is not "95%", which would be a level above the one it has */
export function formatPercent(percent: number): string {
  return `${Math.floor(percent)}%`;
}

export interface DeltaText {
  text: string;
  direction: 'down' | 'up';
}

/** "▲ +3.2%" or "▼ 1.1%"; undefined when there is nothing to compare with or nothing changed */
export function formatDelta(delta: number | undefined): DeltaText | undefined {
  if (delta === undefined || !Number.isFinite(delta) || Math.abs(delta) < MIN_DELTA) {
    return undefined;
  }
  const value = Math.abs(delta).toFixed(1);
  return delta > 0 ? { text: `▲ +${value}%`, direction: 'up' } : { text: `▼ ${value}%`, direction: 'down' };
}

export function filePercent(file: Pick<FileCoverage, 'covered' | 'total'>): number {
  return file.total ? (file.covered / file.total) * PERCENT : PERCENT;
}

/** Least covered first; among equals, the one with more lines left uncovered */
function byWorstFirst(a: FileCoverage, b: FileCoverage): number {
  return filePercent(a) - filePercent(b) || b.total - b.covered - (a.total - a.covered) || a.path.localeCompare(b.path);
}

/** Files under the target, worst first */
export function filesBelowTarget(files: FileCoverage[], target: number, limit = MAX_LISTED_FILES): FileCoverage[] {
  return files
    .filter((file) => file.total > 0 && filePercent(file) < target)
    .sort(byWorstFirst)
    .slice(0, limit);
}

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** The last `depth` segments of a path: "config/props.ts" */
function tail(path: string, depth: number): string {
  return path.split('/').slice(-depth).join('/');
}

/** The names to list: folders are added to the files with the same name, until they differ */
export function listedNames(files: Pick<FileCoverage, 'path'>[]): string[] {
  const depths = files.map(() => 1);
  const maxDepth = Math.max(1, ...files.map((file) => file.path.split('/').length));
  for (let depth = 1; depth < maxDepth; depth += 1) {
    const names = files.map((file, i) => tail(file.path, depths[i]));
    files.forEach((_, i) => {
      if (names.filter((name) => name === names[i]).length > 1) {
        depths[i] += 1;
      }
    });
  }
  return files.map((file, i) => tail(file.path, depths[i]));
}

/** "40% (6/15 lines)" */
export function describeFileStats(file: FileCoverage): string {
  return `${formatPercent(filePercent(file))} (${file.covered}/${file.total} lines)`;
}

/** "ReadOnlyField.tsx 40% (6/15 lines)" */
export function describeFile(file: FileCoverage): string {
  return `${fileName(file.path)} ${describeFileStats(file)}`;
}

/** "coverage 87% ▲ +3.2%" */
export function describeCoverage(coverage: CoverageSummary): string {
  const delta = formatDelta(coverage.delta);
  return ['coverage', formatPercent(coverage.percent), delta?.text].filter(Boolean).join(' ');
}

/**
 * A repository path from the webview that is safe to join to the repository root:
 * relative, without "." / ".." segments. Undefined otherwise
 */
export function safeRelativePath(path: string): string | undefined {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalized.split('/');
  if (!normalized || /^[a-z]:/i.test(normalized) || segments.some((s) => s === '..' || s === '.' || s === '')) {
    return undefined;
  }
  return normalized;
}

/* ---------- Azure DevOps payloads ---------- */

/** Response of GET vstmr…/testresults/codecoverage?buildId=… */
export interface RawCoverageSummary {
  status?: string;
  coverageDetailedSummaryStatus?: string;
  coverageData?: {
    coverageStats?: { label: string; covered: number; total: number; delta?: number; isDeltaAvailable?: boolean }[];
  }[];
}

/** Response of GET …/test/codecoverage?buildId=…&flags=7 */
export interface RawCoverageFiles {
  value?: {
    modules?: { name: string; statistics?: Record<string, number | undefined> }[];
  }[];
}

export interface ShapedCoverage {
  /** Undefined: the build has no coverage (no modules found, or still being processed) */
  coverage?: CoverageSummary;
  /** Azure DevOps finished processing it: the answer will not change, so it can be cached */
  final: boolean;
}

function shapeFiles(raw: RawCoverageFiles | undefined): FileCoverage[] {
  const files = (raw?.value ?? [])
    .flatMap((entry) => entry.modules ?? [])
    .map(({ name, statistics = {} }) => {
      const covered = statistics.linesCovered ?? 0;
      return {
        path: name.replace(/^\/+/, ''),
        covered,
        total: covered + (statistics.linesNotCovered ?? 0) + (statistics.linesPartiallyCovered ?? 0),
      };
    })
    .filter((file) => file.total > file.covered);
  return files.sort(byWorstFirst).slice(0, MAX_FILES);
}

/** Lines coverage of a build from the two Azure DevOps responses; the files are optional */
export function shapeCoverage(summary: RawCoverageSummary, files?: RawCoverageFiles): ShapedCoverage {
  const detailed = summary.coverageDetailedSummaryStatus;
  const final = summary.status === 'finalized' && (detailed === undefined || FINAL_DETAILS.includes(detailed));
  const stats = (summary.coverageData ?? []).flatMap((data) => data.coverageStats ?? []);
  const lines = stats.find((stat) => stat.label === 'Lines') ?? stats.at(0);
  if (!lines || !lines.total) {
    return { final };
  }
  return {
    final,
    coverage: {
      percent: Math.round((lines.covered / lines.total) * PERCENT * 10) / 10,
      covered: lines.covered,
      total: lines.total,
      delta: lines.isDeltaAvailable ? lines.delta : undefined,
      files: shapeFiles(files),
    },
  };
}
