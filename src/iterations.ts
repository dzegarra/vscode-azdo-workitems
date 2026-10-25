export interface Iteration {
  id: string;
  name: string;
  path: string;
  /** Midnight UTC of the first and last days of the sprint, e.g. "2026-10-27T00:00:00Z"; missing when not planned */
  attributes?: { startDate?: string; finishDate?: string };
}

/** Current iteration shared by one or more teams */
export interface TeamIteration {
  iteration: Iteration;
  teams: string[];
}

/** Groups the current iteration of each team, since several teams often share the same sprint */
export function mergeTeamIterations(entries: { team: string; iteration: Iteration | undefined }[]): TeamIteration[] {
  const byPath = new Map<string, TeamIteration>();
  for (const { team, iteration } of entries) {
    if (!iteration) {
      continue;
    }
    const existing = byPath.get(iteration.path);
    if (existing) {
      existing.teams.push(team);
    } else {
      byPath.set(iteration.path, { iteration, teams: [team] });
    }
  }
  return [...byPath.values()];
}

export function wiqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** WIQL query of the work items assigned to the signed-in user in any of the given iterations */
export function buildMyWorkItemsQuery(iterationPaths: string[]): string {
  return [
    'SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me',
    `AND [System.IterationPath] IN (${iterationPaths.map(wiqlString).join(', ')})`,
    'ORDER BY [System.WorkItemType], [System.Id]',
  ].join(' ');
}

// Rule TEAM-2
/**
 * WIQL query of the Backlog Items and Bugs (not Removed) of every given iteration, whoever they are assigned to:
 * one query for all the selected teams. The tasks come later, as the children of these work items
 */
export function buildTeamWorkItemsQuery(iterationPaths: string[]): string {
  return [
    "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] IN ('Product Backlog Item', 'Bug')",
    "AND [System.State] <> 'Removed'",
    `AND [System.IterationPath] IN (${iterationPaths.map(wiqlString).join(', ')})`,
    'ORDER BY [System.Id]',
  ].join(' ');
}
