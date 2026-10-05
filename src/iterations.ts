export interface Iteration {
  id: string;
  name: string;
  path: string;
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

function wiqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** WIQL query of the work items assigned to the signed-in user in any of the given iterations */
export function buildMyWorkItemsQuery(iterationPaths: string[], excludedStates: string[]): string {
  const stateFilter = excludedStates.length
    ? ` AND [System.State] NOT IN (${excludedStates.map(wiqlString).join(', ')})`
    : '';
  return [
    'SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me',
    `AND [System.IterationPath] IN (${iterationPaths.map(wiqlString).join(', ')})${stateFilter}`,
    'ORDER BY [System.WorkItemType], [System.Id]',
  ].join(' ');
}
