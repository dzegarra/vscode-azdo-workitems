# Azure DevOps Work Items (VS Code extension)

Lists the Azure DevOps work items assigned to you in the current iteration and creates branches and pull requests that follow the team conventions.

- Branches: `<feature|bugfix>/<module>/<id>-<short-name>` — e.g. `feature/fui-admin/5641-network-restart-button`
- PR titles: `[<ids>] <Feature Name>: <description>` — e.g. `[123,554] FUI Administration: Show the network configuration`

## Install

```sh
npm run azdo-workitems:package
code --install-extension tools/vscode-azdo-workitems/vscode-azdo-workitems-0.1.0.vsix
```

To debug it, run the launch configuration **Run Azure Work Items Extension** (F5).

## Usage

Open the **Azure Work Items** view in the activity bar. The first time, VS Code asks you to sign in with your Microsoft account.

- **Create Branch** (branch icon on a work item): pick the module, adjust the short name. The branch is created from `origin/develop`, checked out, published and linked to the work item's _Development_ section.
- **Create Pull Request** (on a work item with a local branch, or from the command palette for the current branch): pick extra work items to link, the feature name and the description. The branch is pushed and the PR targets `develop`, optionally as draft.

Organization, project and repository are detected from the `origin` remote.

By default the view lists your work items in the current iteration of **every team you belong to**. Teams sharing the same sprint are merged; when your teams are in different sprints, the items are grouped by iteration. Use **Select Teams** in the view menu to limit the list to some teams (select none to go back to all of them). **Open Iteration Board** asks which team's board to open when there are several.

## Settings

| Setting                                                   | Description                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `azdoWorkItems.branchModules`                             | Catalog of branch modules                                     |
| `azdoWorkItems.prFeatureNames`                            | Catalog of PR feature names                                   |
| `azdoWorkItems.moduleToFeature`                           | Feature name suggested for each branch module                 |
| `azdoWorkItems.branchTypeByWorkItemType`                  | Branch prefix per work item type (`Bug` → `bugfix`)           |
| `azdoWorkItems.baseBranch`                                | Base branch and PR target (`develop`)                         |
| `azdoWorkItems.excludedStates`                            | States hidden from the list                                   |
| `azdoWorkItems.teams`                                     | Teams whose current iteration is listed (empty: all my teams) |
| `azdoWorkItems.linkBranchToWorkItem`                      | Publish and link new branches to the work item                |
| `azdoWorkItems.organization` / `.project` / `.repository` | Override what is detected from the remote                     |

Modules and feature names added with **Add new…** are saved to the workspace settings (`.vscode/settings.json`), so they can be committed and shared.
