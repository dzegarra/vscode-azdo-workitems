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

Each work item is a card with:

- ID (opens the work item in Azure DevOps), type and state
- Title
- Parent / children: `3 children` when it is a parent; the parent ID when the parent is not in the list. Visible children (e.g. Tasks) are nested in the parent card
- Branch: the local branch (`local`, or `current` when checked out) or a branch that only exists in the remote (`remote`)
- Pull requests linked to the work item with their status: Draft, Waiting for review, Approved, Waiting for author, Rejected, Conflicts, Completed, Abandoned

Cards are sorted by state: Done, Ready to Test, Committed, In Progress, Approved, New, To Do (`azdoWorkItems.stateOrder`). Done and Ready to Test are shown in green, Committed and In Progress in blue.

Use the **Type**, **State** and **PR** chips to filter the cards (by default only Product Backlog Items and Bugs, hiding Done / Removed / Closed), and the search box to find them by ID, title or branch. The PR filter uses the main PR of each work item (the active one, or the most recent), or `No PR`.

Card actions:

- **Create branch**: pick the module, adjust the short name. The branch is created from `origin/develop`, checked out, published and linked to the work item's _Development_ section. Product Backlog Items and Bugs in New / Approved / To Do are moved to **Committed** (`azdoWorkItems.stateOnBranchCreated`).
- **State** (the coloured state of a card, a nested task or the details): pick the new state among the ones allowed for that work item type.
- **Add task** (Backlog Items and Bugs): creates a Task under the work item, in the same iteration and area and assigned to the same person. Tasks of a visible card are always nested in it, even when the `Task` type chip is off, so they can be managed (and their state changed) from there.
- **Open**: shows the details of the work item in an editor tab: description, acceptance criteria / repro steps, assignee, effort, tags, parent, children, branch and PRs, with the same actions.
- **Checkout**: switches to the work item branch (creating the local branch when it only exists in the remote).
- **Create PR** (when the branch has no active PR; also available from the command palette for the current branch): pick extra work items to link, the feature name and the description. The branch is pushed and the PR targets `develop`, optionally as draft.

Organization, project and repository are detected from the `origin` remote.

By default the view lists your work items in the current iteration of **every team you belong to**. Teams sharing the same sprint are merged; when your teams are in different sprints, the items are grouped by iteration. Use **Select Teams** in the view menu to limit the list to some teams (select none to go back to all of them). **Open Iteration Board** asks which team's board to open when there are several.

## Pull request notifications

The extension checks the pull requests you created (every 2 minutes by default) and shows a notification when:

- someone else **comments** on one of them (several comments in the same check are grouped),
- a reviewer **votes** (approved, approved with suggestions, waiting for the author, rejected),
- it is **merged**.

Your own comments and votes, system messages and vote resets are ignored. When more than 3 updates arrive at once, a single summary notification lists them. Updates that happened while VS Code was closed are notified when it starts. Run **Check My Pull Requests Now** from the command palette to check immediately.

## Settings

| Setting                                                   | Description                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `azdoWorkItems.branchModules`                             | Catalog of branch modules                                      |
| `azdoWorkItems.prFeatureNames`                            | Catalog of PR feature names                                    |
| `azdoWorkItems.moduleToFeature`                           | Feature name suggested for each branch module                  |
| `azdoWorkItems.branchTypeByWorkItemType`                  | Branch prefix per work item type (`Bug` → `bugfix`)            |
| `azdoWorkItems.baseBranch`                                | Base branch and PR target (`develop`)                          |
| `azdoWorkItems.filter.types`                              | Work item types shown (Type chips)                             |
| `azdoWorkItems.filter.hiddenPullRequestStates`            | PR states hidden (PR chips)                                    |
| `azdoWorkItems.stateOrder`                                | Order of the cards by state                                    |
| `azdoWorkItems.stateOnBranchCreated`                      | State set when a branch is created, per type                   |
| `azdoWorkItems.notifications.events`                      | PR events notified (`comments`, `vote`, `merged`); empty: none |
| `azdoWorkItems.notifications.pollIntervalSeconds`         | How often your PRs are checked (seconds, min. 30)              |
| `azdoWorkItems.filter.hiddenStates`                       | States hidden (State chips)                                    |
| `azdoWorkItems.teams`                                     | Teams whose current iteration is listed (empty: all my teams)  |
| `azdoWorkItems.linkBranchToWorkItem`                      | Publish and link new branches to the work item                 |
| `azdoWorkItems.organization` / `.project` / `.repository` | Override what is detected from the remote                      |

Modules and feature names added with **Add new…** are saved to the workspace settings (`.vscode/settings.json`), so they can be committed and shared.
