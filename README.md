# Azure DevOps: My Work Items (VS Code extension)

Brings the Azure DevOps work of the current sprint into VS Code: your Backlog Items and Bugs, their tasks, branches, pull requests and CI runs, and the problems the team agreed to avoid.

![Screenshot](./screenshot.jpg)

## Features

- **[Your work items](#usage)**: the Backlog Items and Bugs assigned to you in the current iteration of all your teams, as cards with their priority, severity, state, parent, branch and pull requests. Filter them by type, state, PR state and priority, or search them.
- **[Branches and pull requests](#usage)** that follow the team conventions:
  - Branches: `<feature|bugfix>/<module>/<id>-<short-name>`, e.g. `feature/fui-admin/5641-network-restart-button`. Creating one links it to the work item and moves it to Committed.
  - PR titles: `[<ids>] <Feature Name>: <description>`, e.g. `[123,554] FUI Administration: Show the network configuration`.
- **[Current work item](#work-item-of-the-current-branch)** in the status bar, also when you check out a colleague's branch to review it.
- **[My pull requests](#my-pull-requests)** in the sidebar: reviewers and votes, unresolved comments, conflicts, CI, auto-complete, and the next step before the merge, from the branch policies.
- **[Two layouts](#layouts)**: compact rows (default) or large cards.
- **[Work item editing](#usage)**: change states, add tasks, and see the full details (description, acceptance criteria, effort, tags, parent, children) in an editor tab.
- **[Alerts](#alerts)** for the work items that break the team rules (Done with open tasks, missing PR task, blocking tags, empty required fields…), in the cards, the view badge and the status bar. **[Integrated in Build](#integrated-in-build)** can be filled in one click from the last release of the deploy image.
- **[Dependencies](#dependencies)**: predecessors and successors in the details, and an interactive map by iteration that highlights the risky ones.
- **[CI pipelines](#ci-pipelines)**: live state of the runs validating your pull requests, in the cards and the status bar, with a notification when they finish.
- **[Pull request notifications](#pull-request-notifications)** when your PRs get comments or votes, or are merged.
- **[Reviews](#pull-requests-waiting-for-my-review)**: the PRs waiting for your review at the top of the sidebar and in the status bar, with the time left before the 24 hours run out, orange when due soon and red when overdue, one-click checkout of their branch, plus notifications, reminders, a daily digest, and notifications when your review comments are answered or resolved.

## Install

```sh
npx nx run vscode-azdo-workitems:package
code --install-extension tools/vscode-azdo-workitems/vscode-azdo-workitems-0.1.0.vsix
```

To debug it, run the launch configuration **Run Azure Work Items Extension** (F5).

## Usage

Open the **Azure Work Items** container in the activity bar: its **Assigned to Me** view (the list under the **My Work Items** heading) lists only the work items assigned to you (the line under the search box and the view title tell from which sprints and teams). The first time, VS Code asks you to sign in with your Microsoft account.

Each work item is a card with:

- ID (opens the work item in Azure DevOps), **Priority** (`P1`–`P4`) and, for Bugs, **Severity** (`S1 Critical` … `S4 Low`), coloured from red (most urgent) to grey; the type is shown by the icon. And the state
- Title
- Parent: ID and title of the parent (click it to see its details), unless the card is nested in its parent's card. Children (e.g. Tasks) are nested at the bottom of the parent card
- Branch: the local branch (`local`, or `current` when checked out) or a branch that only exists in the remote (`remote`)
- Pull requests linked to the work item with their status: Draft, In review, Approved, Waiting for author, Rejected, Conflicts, Completed, Abandoned

Cards are sorted by state: Done, Ready to Test, Committed, In Progress, Approved, New, To Do (`azdoWorkItems.stateOrder`). Done and Ready to Test are shown in green, Committed and In Progress in blue.

Within each state, cards are sorted by priority, then severity. Use the **Type**, **State**, **PR** and **Priority** chips to filter the cards (coloured like the cards; the hidden values are grey and dashed) (by default only Product Backlog Items and Bugs, hiding Done / Removed / Closed), and the search box to find them by ID, title or branch. The PR filter uses the main PR of each work item (the active one, or the most recent), or `No PR`.

### Layouts

The cards come in two layouts, switched with the **Compact / Large** buttons next to the **My Work Items** title (`azdoWorkItems.layout`):

- **Compact** (default): two lines per work item. The first one has the type, ID, title and state; the second one only the signals that apply: priority / severity, branch (`current`, or `not deleted` for finished work items), main PR state, CI state of the main PR, task progress (`☑ 2/3`) and alerts (`⚠ 2`). Hover a signal for details. Click a row to expand it into the large card, with its buttons and tasks; click its header to fold it back.
- **Large**: the full cards described below.

### Tasks

The tasks of a card are folded under a `Tasks 2/3` line with a progress bar: Done tasks out of all the tasks, without the Removed ones. Click it to show them. A card whose alerts are about its tasks shows them unfolded. The **Expand all tasks** / **Collapse all tasks** buttons next to the **My Work Items** title fold or unfold every card.

Card actions:

- **Create branch**: pick the module, adjust the short name. The branch is created from `origin/develop`, checked out, published and linked to the work item's _Development_ section. Product Backlog Items and Bugs in New / Approved / To Do are moved to **Committed** (`azdoWorkItems.stateOnBranchCreated`).
- **State** (the coloured state of a card, a nested task or the details): pick the new state among the ones allowed for that work item type.
- **Add task** (Backlog Items and Bugs): creates a Task under the work item, in the same iteration and area and assigned to the same person. Tasks are never shown as cards of their own nor in the filters: they are always nested in the card of their Backlog Item / Bug, where they can be managed (and their state changed).
- **Open**: shows the details of the work item in an editor tab: description, acceptance criteria / repro steps (with their images), assignee, effort, tags, parent, children, branch and PRs, with the same actions. When the description links to Figma, **Figma design** opens it in the [Figma extension for VS Code](https://marketplace.visualstudio.com/items?itemName=figma.figma-vscode-extension) if it is installed, or in the browser; the button next to it always opens the browser. The Figma extension opens the file but not the linked frame; the browser opens the exact frame. Prototypes, FigJam and Figma Make links open in the browser.
- **Checkout**: switches to the work item branch (creating the local branch when it only exists in the remote). See [Worktrees](#worktrees) for checking it out without touching your current changes.
- **Delete branch** (Done, Ready to Test and other finished work items): the team deletes the branches once their PR is merged, so finished work items get no **Create branch**, **Checkout** or **Create PR**. When their branch still exists, it is shown as _not deleted_ and **Delete branch** deletes it in Azure DevOps and locally, after a confirmation telling what is deleted (and warning about commits that were not pushed). When the branch is checked out, VS Code switches to `develop` first. It is not offered while a PR is still active on the branch. Whether the branch exists is asked to Azure DevOps: the links of the work item and the local `origin/…` refs remain after a branch is deleted. Also in the command palette: **Delete Branch of a Finished Work Item**.
- **Create PR** (when the branch has no active PR; also available from the command palette for the current branch): pick extra work items to link, the feature name and the description. The branch is pushed and the PR targets `develop`, optionally as draft.

Organization, project and repository are detected from the `origin` remote.

By default the view lists your work items in the current iteration of **every team you belong to**. Teams sharing the same sprint are merged; when your teams are in different sprints, the items are grouped by iteration. Each group can be collapsed (click its name) to keep open only the iterations you are interested in; a collapsed group still shows how many work items it has and how many need attention. Use **Select Teams** in the view menu to limit the list to some teams (select none to go back to all of them). **Open Iteration Board** asks which team's board to open when there are several.

## My pull requests

The **My Pull Requests** box, above your work items, lists the pull requests you created, in all the repositories of the project: the active ones (drafts included; **Hide drafts** in its header, or `azdoWorkItems.myPullRequests.showDrafts`) and, faded, the ones completed in the last 24 hours. Each card shows:

- the PR, its status, the target branch when it is not `develop`, and its linked work items (click one to see its details);
- how long it has been published (since its creation for drafts). Hover it, or focus it with the keyboard, to see the history of the PR: creation, publication, pushes, reviewers added, votes, comments, auto-complete, completion;
- the reviewers with their votes (required ones marked);
- unresolved comments, conflicts, CI runs (only when the PR has some) and an **Auto-complete** pill;
- warnings when auto-complete will **not delete the branch** (team rule: branches are deleted after merging), and, in red, when it will **complete a linked Bug**: "Auto-complete shouldn't complete the linked Bug: Only testers have that prerogative.";
- on published PRs, warnings when they break the team rules: a title not following `[<IDs>] <Feature Name>: <description>`, no description, fewer than 2 required reviewers (people, not groups; `azdoWorkItems.myPullRequests.minimumRequiredReviewers`), or no Backlog Item / Bug linked;
- **Next**: what still blocks the merge, from the blocking branch policies of the PR, e.g. `1 more approval needed · Choose an allowed merge strategy`, or `Ready to merge` / `Will complete automatically`.

PRs that nothing stops from being merged (published, every blocking policy satisfied, approvals included, no conflicts and no warnings) are highlighted in green (**Ready to merge**). When a PR breaks a rule that only someone else may act on (e.g. auto-complete would complete a Bug), its **Next** line is red with a warning icon, even when it says _Will complete automatically_.

Buttons: **Open PR**, **Checkout** (PRs of the repository open in VS Code) and **Publish** for drafts (after a confirmation: reviewers are notified). PRs are checked every 2 minutes (`azdoWorkItems.myPullRequests.pollIntervalSeconds`, or the refresh button of the box). The box and the _Waiting for your review_ one can be collapsed.

## Worktrees

Every **Checkout** (work items, PRs to review, My Pull Requests, details) can open the branch in a [git worktree](https://git-scm.com/docs/git-worktree) instead, so you do not have to stash your changes:

- When you have uncommitted changes, **Checkout** asks: **Open in a worktree** (recommended), **Stash and checkout**, **Checkout anyway** or Cancel. Without changes it checks out right away.
- The **▾** next to Checkout always offers **Checkout here** and **Open in a worktree**.
- Worktrees are created next to the repository, in `<repository>.worktrees/<branch>` (e.g. `User_Interface.worktrees/feature/fui-admin/5641-network-restart-button`), and open in a new window. The `.env.local` files (at the root and in `apps/*`, `packages/*`, `tools/*`) are copied into it, and the new window runs `npm ci` in a terminal.
- A branch that already has a worktree shows a **worktree** pill, and its button becomes **Open worktree**; its **▾** also offers **Remove worktree**.
- **Remove Worktrees…** (view menu or command palette) lists all the worktrees of the repository, to remove several at once. Removing a worktree keeps its branch; a worktree with uncommitted changes is only removed after confirming that they will be lost, and locked ones are skipped. Close the VS Code window of a worktree before removing it.
- **Delete branch** also removes the worktree of the branch (asking first when it has uncommitted changes).

`azdoWorkItems.checkout.mode` sets what **Checkout** does: `ask` (default), `branch` (always in place) or `worktree` (always in a worktree).

## Work items you are working on

The work items of the checked-out branch are highlighted: a tinted card with an accent border and a **● Working on** badge (in compact rows too). You may work on several at once:

- **Worktrees**: the work items of branches checked out in other worktrees are marked **⧉ In worktree**, in a lighter purple style (`azdoWorkItems.workingOn.showWorktrees`).
- **Linked work items**: besides the work item whose ID is in the branch name, the ones linked to the PR of the branch or to the branch itself (Development links) are highlighted too (`azdoWorkItems.workingOn.includeLinkedWorkItems`).
- **Never hidden**: they ignore the State / PR / Priority filters and stay visible in a collapsed iteration group; the Type filter and the search still apply (`azdoWorkItems.workingOn.ignoreFilters`).
- **Working on section**: they are moved to a section at the top of the list, this window's first (`azdoWorkItems.workingOn.section`).

Turn any of these settings off to keep only the highlight. The status bar item of the current work item has **Show in sidebar**, which scrolls to its card and makes it flash.

## Work item of the current branch

The status bar shows the work item of the checked out branch, e.g. `66280 Access point label shows the SSID`. Click it to see its details. The work item is found by the number in the branch name (`feature/<module>/<id>-<name>`); branches of colleagues that do not follow the convention exactly, like `feature/MA/60800_unit_config`, work too. Nothing is shown when the branch has no work item (`develop`, `release/…`).

When the work item is **not assigned to you**, e.g. you checked out a colleague's branch to review a PR, it is shown with an eye icon and the name of the **owner of the branch** (the person who created it in Azure DevOps): `60800 Update Unit Configuration… · Borislav Surovi EXT`. Hover it to see who the work item is assigned to, its state and the branch. When the branch was not pushed yet, the person the work item is assigned to is named instead.

It can be turned off with `azdoWorkItems.statusBar.currentWorkItem`.

## Alerts

Backlog Items and Bugs with problems the team agreed to avoid are flagged in red, with the list of problems in their card. A banner at the top of the view counts them (**Show only these** hides the rest), the view icon shows a badge and the status bar shows them even when the view is closed.

The filters apply to work items with alerts too: when they hide some, the banner tells how many ("2 work items need attention (1 hidden by filters)"), and **Show only these** shows every work item with alerts, whatever the State, PR and Priority filters. To always show them instead, turn on `azdoWorkItems.filter.alwaysShowAlerts`.

| Problem                                                                                                                      | Applies to             |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Done / Ready to Test with tasks not done                                                                                     | Backlog Items and Bugs |
| Has a PR (not abandoned) but no PR task                                                                                      | Backlog Items and Bugs |
| The PR is published (active, not draft) but the PR task is not In Progress                                                   | Backlog Items and Bugs |
| The PR is completed but the PR task is not Done                                                                              | Backlog Items and Bugs |
| Started while tagged Needs refinement, Requirements, UX feedback required, Missing REST API, Blocked or PT Feedback Required | Backlog Items and Bugs |
| Effort or Effort in days is empty                                                                                            | Backlog Items          |
| Integrated in Build is empty while Ready to Test                                                                             | Bugs                   |

The PR task is the task whose title contains "PR" or "Pull Request". **Fix** next to an alert about a single task opens its state picker. Tags, required fields, the work item types and the PR task pattern can be changed in the `azdoWorkItems.alerts.*` settings.

### Integrated in Build

When a Bug is Ready to Test, "Integrated in Build" must tell testers in which release the fix ships: the version of the **last published** `rmc.image.deploy` package (feed `bison_deployimage_rmc`) followed by `+` (the release after that one), e.g. `0.24.63+`.

- **Fill** next to the "Integrated in Build is empty" alert looks the version up and proposes the value, ready to confirm or edit.
- Moving a Bug to Ready to Test with the state picker of the extension proposes it right away when the field is empty (Escape skips it).

The feed, package, suffix, field and states can be changed in the `azdoWorkItems.integrationBuild.*` settings. Fields can be named as in the work item form ("Integrated in Build"), as in the API ("Integration Build") or by reference name.

## Dependencies

Starting a work item whose predecessors are not completed should be avoided (unless agreed with whoever works on them). The cards make it visible:

- **`⛓ N open predecessors`** (amber): hover or focus it to see each predecessor, its state, **who it is assigned to** (to agree with them) and its iteration, the riskiest first (planned after this one, not scheduled, same iteration). Click one to see its details, or open the dependency map.
- **`✓ ready to start`** (green): New / Approved / To Do work items with no open predecessors.
- The **Deps** filter row (**Incomplete predecessors** / **Complete predecessors**) shows or hides each group.
- Moving a work item to a started state, or creating its branch, asks first when it has open predecessors: **Start anyway**, **Open dependency map** or Cancel (`azdoWorkItems.dependencies.confirmBeforeStart`).

A predecessor is completed when it is Done, Ready to Test, Closed or Removed (`azdoWorkItems.dependencies.completedStates`).

The details of a work item list its **Predecessors** (work items it depends on) and **Successors** (work items that depend on it), with the iteration each one is planned in. A warning is shown when a predecessor is planned in a later iteration than its successor, in the same iteration, or not scheduled at all.

**Open Dependency Map** (view toolbar, or the _Dependency map_ button of the details) shows the dependencies of your work items in the current iterations:

- One column per iteration, ordered by date; the current iteration is highlighted and unscheduled work items go last.
- Arrows go from the predecessor to the successor, coloured by risk: red when the predecessor is planned after its successor, orange when both are in the same iteration or the predecessor is not scheduled, blue when it is planned before, grey (dashed) when it is done.
- Your work items have a blue border. Hover a work item to highlight its direct dependencies; click it to highlight its whole chain (everything it depends on and everything that depends on it); double-click or **Open** to see its details.
- **+N** loads the dependencies of a work item not shown yet. **Hide done** hides finished work items; Ctrl + wheel or the buttons zoom; drag the background to move around.

## CI pipelines

Next to the state of each active pull request, the card shows the last run of each pipeline validating it (the builds of `refs/pull/<id>/merge`): queued, running with its elapsed time, succeeded, failed or canceled. Clicking a run opens it in Azure DevOps.

The runs of the PRs of your work items and of all your pull requests are followed. While a run is queued or running, only the runs are refreshed every 15 seconds (`azdoWorkItems.pipelines.pollIntervalSeconds`); when none is, new runs (re-runs, new pushes) are looked for every minute (`azdoWorkItems.pipelines.idlePollIntervalSeconds`, 0 to turn it off). A notification tells you when a run finishes (`azdoWorkItems.pipelines.notifyOnFinish`).

The status bar summarizes the runs of your pull requests even when the view is closed, e.g. `$(rocket) ✗ 1  ↻ 1  ✓ 2` (red when a run failed). Hover it to see each run with its PR, pipeline and duration; click it to pick a run and open it (`azdoWorkItems.pipelines.showInStatusBar`).

### Why a run failed

A failed run tells why: **N tests failed** (hover it for the failing tests and their error; click it to open the **Tests** tab of the run), or **Failed at <step>** when another step failed (lint, build, PR title…). Steps that only publish results are not taken as the cause.

### Code coverage

Successful runs show how many tests ran and the coverage of the code tested by the run (the PR pipeline runs the tests affected by the PR), e.g. `95 tests · 87% ▲ +3.2%`:

- coloured by level: red below 60%, orange below 80%, green from 80%, gold with a trophy from 95% (`azdoWorkItems.coverage.minimum` / `.target` / `.excellent`);
- `▲` in green when the coverage went up since the previous run of the PR; a decrease is shown without red;
- hover (or focus) it to see the files below the target, least covered first; click one to open it and add the missing tests;
- your **personal best** and your **streak** of PRs at or above the target are kept, and celebrated in the notification when a run of your PRs ends ("PR 13713 passed: 95 tests, coverage 100% 🏆 · New personal best!").

When a run fails, the notification says why ("PR 13770 failed: 1 test failed (Other User Without Changes Sees Snackbar)").

## Pull request notifications

The extension checks the pull requests you created (every 2 minutes by default) and shows a notification when:

- someone else **comments** on one of them: a new comment on a file or on the PR, or a reply (to one of your comments or in another thread). Several comments in the same check are grouped;
- a comment is **reopened** (it was resolved, won't fix, closed or by design, and is active again);
- a person **joins or leaves the required reviewers** (added, removed, declined, made required or optional), saying who did it, e.g. "Szymon Kwasek EXT added themselves as a required reviewer of PR 13571";
- a reviewer **votes** (approved, approved with suggestions, waiting for the author, rejected);
- it is **merged**.

Notifications about comments have **Open Comment**, which opens the PR at that thread. Choose the events with `azdoWorkItems.notifications.events` (`comments`, `reopened`, `reviewers`, `vote`, `merged`).

Your own comments, votes and reviewer changes, system messages and vote resets are ignored. When more than 3 updates arrive at once, a single summary notification lists them. Updates that happened while VS Code was closed are notified when it starts. Run **Check My Pull Requests Now** from the command palette to check immediately.

## Pull requests waiting for my review

No PR should wait for its reviewers more than 24 hours. The extension makes sure you do not miss the PRs where you are a **required reviewer** and have not voted yet.

**In the sidebar**, a section at the top of _Assigned to Me_ lists them, most urgent first. Each card shows the time left before the 24 hours run out ("18 h left", "5 h left", "overdue by 3 h"), the PR, its author, and a bar that fills as the time runs out. Each card also shows what you need to review it: the PR status, the target branch when it is not `develop`, the linked work items (click one to see its details), the reviewers and their votes (you first), unresolved comments, conflicts, CI runs (failed tests, coverage), auto-complete and how many files changed. Hover the time left to see the history of the PR. It also tells you:

- **Your approval completes it**, in green, when your vote is the last approval the PR needs;
- **Auto-complete is set: your approval may merge it right away**, or the red error when auto-complete would complete a linked Bug (only testers complete Bugs);
- how many of **your comments are still open**, and whether someone replied since your last comment;
- **N team rules not met — remind the author** (title, description, required reviewers, linked Backlog Item / Bug; hover it for the list).

Click the title to open the PR in Azure DevOps, or **Checkout** to review it locally: the branch of the PR is fetched and checked out (and pulled when your local copy of it is behind). **Checkout** is also offered by the notifications, and by **Check Out a Pull Request Waiting for My Review** in the command palette. It is only available for the PRs of the repository open in VS Code.

| Colour | When                                                                       |
| ------ | -------------------------------------------------------------------------- |
| Blue   | Time left                                                                  |
| Orange | Due soon: less than 6 hours left (`azdoWorkItems.reviews.dueSoonHours`)    |
| Red    | Overdue: waiting more than 24 hours (`azdoWorkItems.reviews.maxWaitHours`) |

The section takes the colour of the most urgent PR and counts the overdue and due soon ones. It can be collapsed; it opens again when a new PR arrives. The badge of the activity bar icon counts these PRs, together with the work items that need attention.

**In the status bar**, e.g. `2 to review · 4 h left` (the time left of the most urgent PR), in yellow when one is due soon and in red when one is overdue. Hover it to see each PR; click it to show the list (`azdoWorkItems.reviews.showInStatusBar`).

**Notifications** (`azdoWorkItems.reviews.notifications`):

- when you are added as reviewer of a PR (or a draft you review is published),
- when a PR is due soon,
- when a PR is overdue, and again every 4 hours while it stays overdue (`azdoWorkItems.reviews.remindOverdueEveryHours`, 0: only once),
- when someone **replies** to a comment you started on a PR you review, or **resolves** it (Resolved, Won't fix, Closed, By design). **Open Comment** opens the thread in the PR. PRs completed or abandoned with comments of yours still open are checked one last time, since authors often resolve the comments right before completing the PR,
- a daily digest the first time VS Code checks each day ("3 pull requests are waiting for your review: 1 overdue, 1 due soon"), instead of the other notifications of that check.

Requests received while VS Code was closed are notified when it starts.

Once you vote (approve, approve with suggestions, wait for author or reject) or decline, the PR leaves the list. Drafts and your own PRs are not listed. The waiting time counts from the publication of the PR: its creation or, when it was created as a draft, the moment it was published. PRs are checked every 2 minutes (`azdoWorkItems.reviews.pollIntervalSeconds`, the refresh button of the section, or **Check Pull Requests Waiting for My Review**). Set `azdoWorkItems.reviews.includeOptional` to also list the PRs where you are an optional reviewer.

Only the PRs where you are a reviewer yourself are listed: when a group (e.g. a team) is the reviewer, the PR shows up once you are added to it, or once you vote for the group.

## Settings

| Setting                                                   | Description                                                    |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `azdoWorkItems.branchModules`                             | Catalog of branch modules                                      |
| `azdoWorkItems.prFeatureNames`                            | Catalog of PR feature names                                    |
| `azdoWorkItems.moduleToFeature`                           | Feature name suggested for each branch module                  |
| `azdoWorkItems.branchTypeByWorkItemType`                  | Branch prefix per work item type (`Bug` → `bugfix`)            |
| `azdoWorkItems.baseBranch`                                | Base branch and PR target (`develop`)                          |
| `azdoWorkItems.filter.types`                              | Work item types shown (Type chips)                             |
| `azdoWorkItems.filter.hiddenPriorities`                   | Priorities hidden (Priority chips)                             |
| `azdoWorkItems.filter.alwaysShowAlerts`                   | Show work items with alerts whatever the filters (off)         |
| `azdoWorkItems.filter.hiddenPullRequestStates`            | PR states hidden (PR chips)                                    |
| `azdoWorkItems.stateOrder`                                | Order of the cards by state                                    |
| `azdoWorkItems.stateOnBranchCreated`                      | State set when a branch is created, per type                   |
| `azdoWorkItems.notifications.events`                      | PR events notified (`comments`, `vote`, `merged`); empty: none |
| `azdoWorkItems.notifications.pollIntervalSeconds`         | How often your PRs are checked (seconds, min. 30)              |
| `azdoWorkItems.filter.hiddenStates`                       | States hidden (State chips)                                    |
| `azdoWorkItems.teams`                                     | Teams whose current iteration is listed (empty: all my teams)  |
| `azdoWorkItems.linkBranchToWorkItem`                      | Publish and link new branches to the work item                 |
| `azdoWorkItems.organization` / `.project` / `.repository` | Override what is detected from the remote                      |
| `azdoWorkItems.alerts.*`                                  | Alert rules: tags, required fields, types, PR task pattern     |
| `azdoWorkItems.integrationBuild.*`                        | Feed, package and suffix used to fill Integrated in Build      |
| `azdoWorkItems.layout`                                    | Layout of the cards: `compact` (default) or `large`            |
| `azdoWorkItems.myPullRequests.*`                          | My pull requests: show drafts, refresh interval                |
| `azdoWorkItems.statusBar.currentWorkItem`                 | Show the work item of the current branch in the status bar     |
| `azdoWorkItems.dependencies.*`                            | Completed states of predecessors, confirmation before starting |
| `azdoWorkItems.coverage.*`                                | Coverage levels: minimum (60), target (80), excellent (95)     |
| `azdoWorkItems.pipelines.*`                               | CI runs: refresh interval, notifications, status bar           |
| `azdoWorkItems.reviews.*`                                 | PRs to review: maximum wait, due soon, reminders, status bar   |

Modules and feature names added with **Add new…** are saved to the workspace settings (`.vscode/settings.json`), so they can be committed and shared.
