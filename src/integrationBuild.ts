/**
 * "Integrated in Build" of Bugs ready to test: the version of the last release of the deploy image,
 * followed by "+" (the fix ships in the release after that one). Pure, so no "vscode" import
 */

export interface PackageVersion {
  version: string;
  publishDate?: string;
  isLatest?: boolean;
  isDeleted?: boolean;
}

/** Version of the last published package. Deleted versions are skipped */
export function lastPublishedVersion(versions: PackageVersion[]): string | undefined {
  const available = versions.filter((version) => !version.isDeleted);
  const byDate = available
    .filter((version) => version.publishDate)
    .sort((a, b) => (b.publishDate ?? '').localeCompare(a.publishDate ?? ''));
  return (byDate.at(0) ?? available.find((version) => version.isLatest) ?? available.at(0))?.version;
}

/** "2026.10.3" → "2026.10.3+" */
export function integrationBuildValue(version: string, suffix: string): string {
  const trimmed = version.trim();
  return suffix && trimmed.endsWith(suffix) ? trimmed : `${trimmed}${suffix}`;
}
