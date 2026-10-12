# Totalflow X devtools for Azure Devops (VS Code extension)

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
- **[Alerts](#alerts)** for the work items that break the team rules (Done with open tasks, missing PR task, blocking tags, empty required fields…), in the cards, the activity bar badge and the status bar. **[Integrated in Build](#integrated-in-build)** can be filled in one click from the last release of the deploy image.
- **[Dependencies](#dependencies)**: predecessors and successors in the Work Item Details panel, and an interactive map by iteration that highlights the risky ones.
- **[CI pipelines](#ci-pipelines)**: live state of the runs validating your pull requests, in the cards and the status bar, with a notification when they finish.
- **[Pull request notifications](#pull-request-notifications)** when your PRs get comments or votes, or are merged.
- **[Reviews](#pull-requests-waiting-for-my-review)**: the PRs waiting for your review at the top of the sidebar and in the status bar, with the time left before the 24 hours run out, orange when due soon and red when overdue, one-click checkout of their branch, plus notifications, reminders, a daily digest, and notifications when your review comments are answered or resolved.

## Install

```sh
npx nx run vscode-azdo-workitems:package
code --install-extension tools/vscode-azdo-workitems/vscode-azdo-workitems-0.1.0.vsix
```

To debug it, run the launch configuration **Run Totalflow X Extension** (F5).

## Usage

Open the **Totalflow X** container in the activity bar: its **Assigned to Me** view (the list under the **My Work Items** heading) lists only the work items assigned to you (the line under the search box and the view title tell from which sprints and teams). The first time, VS Code asks you to sign in with your Microsoft account.

Each work item is a card with:

- ID (opens the work item in Azure DevOps), **Priority** (`P1`–`P4`) and, for Bugs, **Severity** (`S1 Critical` … `S4 Low`), coloured from red (most urgent) to grey; the type is shown by the icon. And the state
- Title
- Parent: ID and title of the parent (click it to open its Work Item Details panel), unless the card is nested in its parent's card. Children (e.g. Tasks) are nested at the bottom of the parent card
- Branches: every branch of the work item: the ones named after it (`local`, `current` when checked out, or `remote` when it only exists in the remote), the ones linked in its Development section (`linked`) and the source branches of its active PRs. The branches of other repositories are faded and in italics (hover them to see the repository). With several branches, each one of this repository has its own **Checkout ▾** (or **Open worktree ▾**); the card's buttons act on the main one
- Bugs fixed by a Backlog Item (the Backlog Item is a predecessor of the Bug): the Backlog Item shows **Fixes N bugs** with their IDs, and the Bug shows **Fixed by** the Backlog Item with its state (click an ID to open its Work Item Details panel; done ones are faded). The Work Item Details panel marks these links in its Predecessors / Successors lists
- Pull requests linked to the work item with their status (the PRs of other repositories are faded and in italics; hover them to see the repository). Only the PRs of this repository decide whether **Create PR** is offered: Draft, In review, Approved, Waiting for author, Rejected, Conflicts, Completed, Abandoned

Cards are sorted by state: Done, Ready to Test, Committed, In Progress, Approved, New, To Do (`totalflowx.stateOrder`). Done and Ready to Test are shown in green, Committed and In Progress in blue.

Within each state, cards are sorted by priority, then severity. The filter chips are folded by default: the funnel button next to the search box shows them (its badge counts the values hidden by the filters, and the "hidden by filters" note at the end of the list opens them too). Use the **Type**, **State**, **PR** and **Priority** chips to filter the cards (coloured like the cards; the hidden values are grey and dashed) (by default only Product Backlog Items and Bugs, hiding Done / Removed / Closed), and the search box to find them by ID, title or branch. The PR filter uses the main PR of each work item (the active one, or the most recent), or `No PR`.

### Layouts

The cards come in two layouts, switched with the **Compact / Large** buttons next to the **My Work Items** title (`totalflowx.layout`):

- **Compact** (default): two lines per work item. The first one has the type, ID, title and state; the second one only the signals that apply: priority / severity, branch (`current`, or `not deleted` for finished work items), main PR state, CI state of the main PR, task progress (`☑ 2/3`) and alerts (`⚠ 2`). Hover a signal for details. Click a row to expand it into the large card, with its buttons and tasks; click its header to fold it back.
- **Large**: the full cards described below.

### Tasks

The tasks of a card are folded under a `Tasks 2/3` line with a progress bar: Done tasks out of all the tasks, without the Removed ones. Tasks assigned to other developers are listed too, with their initials. Each task shows an icon per branch linked to it, before its PR icons: highlighted when it is the checked out branch, blue when it is local, grey when it is only in Azure DevOps, dimmed when it was **deleted** (Development links outlive branches, so existence is asked to Azure DevOps and cached for 10 minutes) or is in **another repository**. Hover or focus it for its name, state (`checked out`, `local and remote`, `remote only`, `local only`, `deleted`), repository and the PR of that branch; click one that exists in this repository to get **Checkout here** / **Open in a worktree** (up to 3, then `+N`). Each task also shows an icon per pull request linked to it, coloured by its state (up to 3, then `+N`): hover or focus it to see the PR, its state, repository (flagged when it is not the one open in VS Code), author, target branch, reviewers and CI; click it to open the PR. Click it to show them. A card whose alerts are about its tasks shows them unfolded. The **Expand all tasks** / **Collapse all tasks** buttons next to the **My Work Items** title fold or unfold every card.

Card actions:

- **Create branch**: pick the module, adjust the short name. The branch is created from `origin/develop` (without switching to it; the module picker has a first row **Base: origin/develop · change…** to start from another branch instead, see below), published and linked to the work item's _Development_ section; then a notification offers to **Checkout** it or **Open in a worktree** (or just stay where you are). Product Backlog Items and Bugs in New / Approved / To Do are moved to **Committed** (`totalflowx.stateOnBranchCreated`).
- **State** (the coloured state of a card, a nested task or the Work Item Details panel): pick the new state among the ones allowed for that work item type.
- **Add task** (Backlog Items and Bugs): creates a Task under the work item, in the same iteration and area and assigned to the same person. Tasks are never shown as cards of their own nor in the filters: they are always nested in the card of their Backlog Item / Bug, where they can be managed (and their state changed).
- **Details**: opens the **Work Item Details panel** (an editor tab, one per work item): description, acceptance criteria / repro steps (with their images), assignee, effort, tags, parent, children, branch and PRs, with the same actions. When the description links to Figma, **Figma design** opens it in the [Figma extension for VS Code](https://marketplace.visualstudio.com/items?itemName=figma.figma-vscode-extension) if it is installed, or in the browser; the button next to it always opens the browser. The Figma extension opens the file but not the linked frame; the browser opens the exact frame. Prototypes, FigJam and Figma Make links open in the browser.
- **Checkout**: switches to the work item branch (creating the local branch when it only exists in the remote). See [Worktrees](#worktrees) for checking it out without touching your current changes.
- **Base branch** (optional): the first row of the module picker shows the base. Picking it lists `origin/develop` (team default), the remote branches of the work item with the status of their PR (a completed PR gets a warning icon: its changes are probably already in `develop`) and **Other branch…** (all remote branches, filterable); Esc keeps the previous base. The branch starts from `origin/<base>`, also when created from a task. A base other than the default is remembered in the local git config of the repository (`branch.<name>.totalflowxBase`, per machine; nothing is sent to Azure DevOps).
- **Delete branch** (Done, Ready to Test and other finished work items): the team deletes the branches once their PR is merged, so finished work items get no **Create branch**, **Checkout** or **Create PR**. When their branch still exists, it is shown as _not deleted_ and **Delete branch** deletes it in Azure DevOps and locally, after a confirmation telling what is deleted (and warning about commits that were not pushed). When the branch is checked out, VS Code switches to `develop` first. It is not offered while a PR is still active on the branch. Whether the branch exists is asked to Azure DevOps: the links of the work item and the local `origin/…` refs remain after a branch is deleted. Also in the command palette: **Delete Branch of a Finished Work Item**.
- **Create PR** (when the branch has no active PR; also available from the command palette for the current branch): pick extra work items to link (the ones already using the same branch are pre-selected), the feature name and the description. The branch is pushed and the PR targets `develop`, optionally as draft. When the branch was created from another base (see **Base branch**) and that branch still exists with no completed PR, it asks whether to target it or `develop`; the placeholder of the draft question shows `branch → target`. Then **PR task** asks what stands for "this PR is in review" (Backlog Items and Bugs have no such state): **Create task "PR: <description>"** under the work item (default), reuse an open task of the work item that has no active PR (e.g. "PID update"), or **No PR task**. The task is linked to the PR (not part of its title) and moves to **In Progress** when the PR is created published; a draft leaves it as it is. If the task cannot be created or moved, a warning says so and the PR is created anyway.
- **Create PR from a task**: the task rows of the cards have a dashed PR icon with a **+** when the task is open and has no active PR (not offered for finished work items). It creates the PR of the parent work item with that task as its PR task (the "PR task" question is skipped). Source branch: the branches linked to the task come first; among them (or among the branches of the work item when the task has none) the current one if it is one, else the only one in this repository, else you pick one; with none, it asks you to create a branch first.
- **Create branch from a task**: the task rows also have a dashed branch icon with a **+** when the task is open, has no linked branch and its work item is not finished. It runs **Create branch** for the parent work item (same predecessors check and module picker) but the branch is named `<feature|bugfix>/<module>/<parent id>-<task name>` (the short name is proposed from the task title), several branches per work item being expected. The branch is linked to the task as well as to the parent, so the task knows its branch, and the task moves to **In Progress** when it was not started (the parent moves as usual).
- **Publish** (a draft PR of My Pull Requests) also moves the PR's open tasks to **In Progress**; PRs published elsewhere are covered by the alert and its **Fix** button.

Organization, project and repository are detected from the `origin` remote.

By default the view lists your work items in the current iteration of **every team you belong to**. Teams sharing the same sprint are merged; when your teams are in different sprints, the items are grouped by iteration. Each group can be collapsed (click its name) to keep open only the iterations you are interested in; a collapsed group still shows how many work items it has and how many need attention. Use **Select Teams** in the view menu to limit the list to some teams (select none to go back to all of them). **Open Iteration Board** asks which team's board to open when there are several.

## My pull requests

The **My Pull Requests** box, above your work items, lists the pull requests you created, in all the repositories of the project: the active ones (drafts included; **Hide drafts** in its header, or `totalflowx.myPullRequests.showDrafts`) and, faded, the ones completed in the chosen period (last 24 hours by default). Each card shows:

- the PR, its status, the target branch when it is not `develop`, and its linked work items (click one to open its Work Item Details panel);
- how long it has been published, counting working days only like the reviewers' time (since its creation, in calendar time, for drafts). Hover it, or focus it with the keyboard, to see the history of the PR: creation, publication, pushes, reviewers added, votes, comments, auto-complete, completion;
- the reviewers with their votes (required ones marked);
- unresolved comments, conflicts, CI runs (only when the PR has some) and an **Auto-complete** pill;
- warnings when auto-complete will **not delete the branch** (team rule: branches are deleted after merging), and, in red, when it will **complete a linked Bug**: "Auto-complete shouldn't complete the linked Bug: Only testers have that prerogative.";
- on active PRs that target a branch other than `develop`, a warning when that branch no longer exists or its PR (yours) was completed, with a **Retarget to develop** button (after a confirmation: the branch may need a rebase because the base was probably squash-merged). It uses the PRs already polled; no extra requests
- on published PRs, warnings when they break the team rules: a title not following `[<IDs>] <Feature Name>: <description>`, no description, fewer than 2 required reviewers (people, not groups; `totalflowx.myPullRequests.minimumRequiredReviewers`), or no Backlog Item / Bug linked;
- **Next**: what still blocks the merge, from the blocking branch policies of the PR, e.g. `1 more approval needed · Choose an allowed merge strategy`, or `Ready to merge` / `Will complete automatically`.

**Build notes**: changes testers should know about must be explained in `build-notes/developer-notes.md`; a PR without such changes must be tagged `no-build-notes` instead. A published PR of this repository that does neither gets a warning, with an **Add tag no-build-notes** button (after a confirmation). The tag comes with the PR list at no cost, and whether the PR changes the file takes one request per PR, repeated only after a new push. **Create PR** checks it too, with local git: when the branch does not change the file, it asks whether it has changes for testers, and either opens the file so you can write the notes or creates the PR with the tag (`totalflowx.buildNotes.*`).

PRs that nothing stops from being merged (published, every blocking policy satisfied, approvals included, no conflicts and no warnings) are highlighted in green (**Ready to merge**). When a PR breaks a rule that only someone else may act on (e.g. auto-complete would complete a Bug), its **Next** line is red with a warning icon, even when it says _Will complete automatically_.

Completed PRs also show how long they took and where the time went. The row says "completed 3 h ago · took 1 d 6 h" (working days only, creation to completion; `totalflowx.reviews.workingDays`). The expanded card draws a **mini timeline**: a bar with rounded ends and one coloured band per phase (**Draft** grey, **In review** blue, **Waiting for author** orange, **Ready to merge** green), dots for the events (published, pushes, approvals, "waiting for the author", rejections, auto-complete), the creation and completion dates at both ends and a legend with each phase and its duration. Hover a band or a dot for the dates or the event. With at least two completed PRs listed, the box header summarises them, e.g. "Completed PRs: median 1 d 2 h, mostly waiting for review". It is computed from the comments already fetched: no extra requests.

The selector in the box options (**Completed: hidden / 24 h / 7 days / 30 days**, saved in `totalflowx.myPullRequests.completedPeriod`) sets how far back the completed PRs are listed; the latest 50 completed PRs are fetched. When hidden, the box says how many were completed in the last 24 hours.

Both PR boxes have their own layout button: **compact** rows (2 lines: PR, title and state; then the main signals) by default, or the **large** cards; click a compact row to unfold it (`totalflowx.reviews.layout`, `totalflowx.myPullRequests.layout`).

Buttons: **Open PR**, **Checkout** (PRs of the repository open in VS Code) and **Publish** for drafts (after a confirmation: reviewers are notified). PRs are checked every 2 minutes (`totalflowx.myPullRequests.pollIntervalSeconds`, or the refresh button of the box). The box and the _Waiting for your review_ one can be collapsed.

## Worktrees

Every **Checkout** (work items, PRs to review, My Pull Requests, details) can open the branch in a [git worktree](https://git-scm.com/docs/git-worktree) instead, so you do not have to stash your changes:

- When you have uncommitted changes, **Checkout** asks: **Open in a worktree** (recommended), **Stash and checkout**, **Checkout anyway** or Cancel. Without changes it checks out right away.
- The **▾** next to Checkout always offers **Checkout here** and **Open in a worktree**.
- Worktrees are created next to the repository, in `<repository>.worktrees/<branch>` (e.g. `User_Interface.worktrees/feature/fui-admin/5641-network-restart-button`), and open in a new window. The `.env.local` files (at the root and in `apps/*`, `packages/*`, `tools/*`) are copied into it, and the new window runs `npm ci` in a terminal.
- A branch that already has a worktree shows a **worktree** pill, and its button becomes **Open worktree**; its **▾** also offers **Remove worktree**.
- **Remove Worktrees…** (view menu or command palette) lists all the worktrees of the repository, to remove several at once. Removing a worktree keeps its branch; a worktree with uncommitted changes is only removed after confirming that they will be lost, and locked ones are skipped. Close the VS Code window of a worktree before removing it.
- **Delete branch** also removes the worktree of the branch (asking first when it has uncommitted changes).

`totalflowx.checkout.mode` sets what **Checkout** does: `ask` (default), `branch` (always in place) or `worktree` (always in a worktree).

## Work items you are working on

The work items of the checked-out branch are highlighted: a tinted card with an accent border and a **● Working on** badge (in compact rows too). You may work on several at once:

- **Worktrees**: the work items of branches checked out in other worktrees are marked **⧉ In worktree**, in a lighter purple style (`totalflowx.workingOn.showWorktrees`).
- **Linked work items**: besides the work item whose ID is in the branch name, the ones linked to the PR of the branch or to the branch itself (Development links) are highlighted too (`totalflowx.workingOn.includeLinkedWorkItems`).
- **Never hidden**: they ignore the State / PR / Priority filters and stay visible in a collapsed iteration group; the Type filter and the search still apply (`totalflowx.workingOn.ignoreFilters`).
- **Working on section**: they are moved to a section at the top of the list, this window's first (`totalflowx.workingOn.section`).

Turn any of these settings off to keep only the highlight. The status bar item of the current work item has **Show in sidebar**, which scrolls to its card and makes it flash.

## Work item of the current branch

The status bar shows the work item of the checked out branch, e.g. `66280 Access point label shows the SSID`. Click it to open its Work Item Details panel. The work item is found by the number in the branch name (`feature/<module>/<id>-<name>`); branches of colleagues that do not follow the convention exactly, like `feature/MA/60800_unit_config`, work too. Nothing is shown when the branch has no work item (`develop`, `release/…`).

When the work item is **not assigned to you**, e.g. you checked out a colleague's branch to review a PR, it is shown with an eye icon and the name of the **owner of the branch** (the person who created it in Azure DevOps): `60800 Update Unit Configuration… · Borislav Surovi EXT`. Hover it to see who the work item is assigned to, its state and the branch. When the branch was not pushed yet, the person the work item is assigned to is named instead.

It can be turned off with `totalflowx.statusBar.currentWorkItem`.

## Summary view

Below **Assigned to Me** (collapsed by default) the **Summary** view lists what needs your attention, one row per kind and only when there is something: work items that need attention, pull requests waiting for your review (with how many are overdue / due soon), your pull requests with warnings, your pull requests ready to merge, and failed CI runs. Click a row to show the main list. When nothing needs attention it says so.

The Summary view also carries the **badge of the Totalflow X icon** in the activity bar (work items that need attention + pull requests waiting for your review), so the number shows from the moment VS Code starts, without opening the sidebar.

## Alerts

Backlog Items and Bugs with problems the team agreed to avoid are flagged in red, with the list of problems in their card. A banner at the top of the view counts them (**Show only these** hides the rest), the activity bar icon shows a badge (see the [Summary view](#summary-view)) and the status bar shows them even when the view is closed.

The filters apply to work items with alerts too: when they hide some, the banner tells how many ("2 work items need attention (1 hidden by filters)"), and **Show only these** shows every work item with alerts, whatever the State, PR and Priority filters. To always show them instead, turn on `totalflowx.filter.alwaysShowAlerts`.

| Problem                                                                                                                      | Applies to             |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Done / Ready to Test with tasks not done                                                                                     | Backlog Items and Bugs |
| A published PR (not abandoned) has no PR task (each PR has its own, linked to it)                                            | Backlog Items and Bugs |
| The PR is published (active, not draft) but the PR task is not In Progress                                                   | Backlog Items and Bugs |
| The PR is completed but the PR task is not Done                                                                              | Backlog Items and Bugs |
| Started while tagged Needs refinement, Requirements, UX feedback required, Missing REST API, Blocked or PT Feedback Required | Backlog Items and Bugs |
| Effort or Effort in days is empty                                                                                            | Backlog Items          |
| Integrated in Build is empty while Ready to Test                                                                             | Bugs                   |

The PR task of a PR is the child task linked to that PR, whatever its title (completed PRs without a task are not reported: they are history; drafts are not checked). Only for PRs without any linked task, an unlinked task whose title contains "PR" or "Pull Request" is used, once (work items from before the tasks were linked). **Fix** next to an alert about a single task opens its state picker. Tags, required fields, the work item types and the PR task pattern can be changed in the `totalflowx.alerts.*` settings.

### Integrated in Build

When a Bug is Ready to Test, "Integrated in Build" must tell testers in which release the fix ships: the version of the **last published** `rmc.image.deploy` package (feed `bison_deployimage_rmc`) followed by `+` (the release after that one), e.g. `0.24.63+`.

- **Fill** next to the "Integrated in Build is empty" alert looks the version up and proposes the value, ready to confirm or edit.
- Moving a Bug to Ready to Test with the state picker of the extension proposes it right away when the field is empty (Escape skips it).

The feed, package, suffix, field and states can be changed in the `totalflowx.integrationBuild.*` settings. Fields can be named as in the work item form ("Integrated in Build"), as in the API ("Integration Build") or by reference name.

## Dependencies

Starting a work item whose predecessors are not completed should be avoided (unless agreed with whoever works on them). The cards make it visible:

- **`⛓ N open predecessors`** (amber): hover or focus it to see each predecessor, its state, **who it is assigned to** (to agree with them) and its iteration, the riskiest first (planned after this one, not scheduled, same iteration). Click one to open its Work Item Details panel, or open the dependency map.
- **`✓ ready to start`** (green): New / Approved / To Do work items with no open predecessors.
- The **Deps** filter row (**Incomplete predecessors** / **Complete predecessors**) shows or hides each group.
- Moving a work item to a started state, or creating its branch, asks first when it has open predecessors: **Start anyway**, **Open dependency map** or Cancel (`totalflowx.dependencies.confirmBeforeStart`).

A predecessor is completed when it is Done, Ready to Test, Closed or Removed (`totalflowx.dependencies.completedStates`).

The details of a work item list its **Predecessors** (work items it depends on) and **Successors** (work items that depend on it), with the iteration each one is planned in. A warning is shown when a predecessor is planned in a later sprint period than its successor, in the same sprint period, or not scheduled in a sprint yet.

**Open Dependency Map** (view toolbar, or the _Dependency map_ button of the Work Item Details panel; not for Tasks) shows the dependencies of your work items in the current iterations:

- Iterations are read as `<Project>\<Release>\<Sprint>` (e.g. `Flow Digital Architecture\MVP R3\Platform Sprint 122`).
- One column per **sprint period** (sprints with the same dates, e.g. Sprint 122 · Sep 30 – Oct 13), ordered by date; the current one is highlighted. The sprints of each team are stacked inside it (Interface Apps Sprint 122, Platform Sprint 122…), always in the same team order.
- Work items still in the release (e.g. `…\MVP R3`) are in the release's own column, **not scheduled in a sprint yet**, after its sprints. Work items directly in the project (not planned in any release) are not shown; the toolbar tells how many. Tasks are never shown: they are part of their Backlog Item / Bug.
- Arrows go from the predecessor to the successor, coloured by risk: red when the predecessor is planned in a later sprint period than its successor, orange when both are in the same sprint period (even in different teams) or the predecessor is not scheduled in a sprint yet, blue when it is planned before, grey (dashed) when it is done.
- Your work items have a blue border. Hover a work item to highlight its direct dependencies; click it to highlight its whole chain (everything it depends on and everything that depends on it); double-click or **Details** to open its Work Item Details panel.
- Every card shows its **priority** (P1 critical … P4 very low) with the same pills as the sidebar. **P1 cards still to do glow in red** from behind: a soft red halo around an otherwise normal card (finished ones keep only their pill); a P1 work item of yours keeps its blue border. When two work items are otherwise equally placed, the higher priority goes first.
- Done work items are always shown.
- Toolbar options (remembered): **Sort by state** groups the work items of each sprint by state, active work first (In Progress / Committed / Active, then not started, then Ready to Test / Done / Closed, then Removed); **Hide bugs** hides the Bugs and their arrows (the work item the map was opened for always stays; a work item left without any other dependency follows the next option); **Show work items without dependencies** places them in their sprint too (hidden otherwise).
- Inside each sprint the work items are ordered to keep the arrows as straight as possible: each card goes to the average height of what it is linked to, sweeping the map back and forth.
- Opened from the view toolbar, the map scrolls to the current sprint; opened from a Work Item Details panel, it selects that work item and scrolls to it.
- **+N** loads the dependencies of a work item not shown yet. Ctrl + wheel or the buttons zoom; drag the background to move around.

## CI pipelines

Next to the state of each active pull request, the card shows the last run of each pipeline validating it (the builds of `refs/pull/<id>/merge`): queued, running with its elapsed time, succeeded, failed or canceled. Clicking a run opens it in Azure DevOps.

The runs of the PRs of your work items and of all your pull requests are followed. While a run is queued or running, only the runs are refreshed every 15 seconds (`totalflowx.pipelines.pollIntervalSeconds`); when none is, new runs (re-runs, new pushes) are looked for every minute (`totalflowx.pipelines.idlePollIntervalSeconds`, 0 to turn it off). A notification tells you when a run finishes (`totalflowx.pipelines.notifyOnFinish`).

The status bar summarizes the runs of your pull requests even when the view is closed, e.g. `$(rocket) ✗ 1  ↻ 1  ✓ 2` (red when a run failed). Hover it to see each run with its PR, pipeline and duration; click it to pick a run and open it (`totalflowx.pipelines.showInStatusBar`).

### Why a run failed

A failed run tells why: **N tests failed** (hover it for the failing tests and their error; click it to open the **Tests** tab of the run), or **Failed at <step>** when another step failed (lint, build, PR title…). Steps that only publish results are not taken as the cause.

### Code coverage

Successful runs show how many tests ran and the coverage of the code tested by the run (the PR pipeline runs the tests affected by the PR), e.g. `95 tests · 87% ▲ +3.2%`:

- coloured by level: red below 60%, orange below 80%, green from 80%, gold with a trophy from 95% (`totalflowx.coverage.minimum` / `.target` / `.excellent`);
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
- it is **merged**: a second notification offers to set its open PR tasks to **Done** (**Set Done** / **Open task**; `taskDone` in the events setting). Not automatic: you may have more to do in the task.

Notifications about comments have **Open Comment**, which opens the PR at that thread. Choose the events with `totalflowx.notifications.events` (`comments`, `reopened`, `reviewers`, `vote`, `merged`, `taskDone`).

Your own comments, votes and reviewer changes, system messages and vote resets are ignored. When more than 3 updates arrive at once, a single summary notification lists them. Updates that happened while VS Code was closed are notified when it starts. Run **Check My Pull Requests Now** from the command palette to check immediately.

## Pull requests waiting for my review

No PR should wait for its reviewers more than 24 hours **of working time**: only working days count (Monday to Friday by default, `totalflowx.reviews.workingDays`; all 24 hours of a working day count), so a PR published on Friday at 15:00 is due on Monday at 15:00. Days off and public holidays are not taken into account. The extension makes sure you do not miss the PRs where you are a **required reviewer** and have not voted yet.

**In the sidebar**, a section at the top of _Assigned to Me_ lists them, most urgent first. Each card shows the time left before the 24 hours run out ("18 h left", "5 h left", "overdue by 3 h"), the PR, its author, and a labelled bar of the time waited out of the limit with the due time (`⏱ 19 h of 24 h · due today 14:30`). The last 6 hours are marked on the bar, which turns orange when the PR is due soon and red with stripes once it is overdue; a card pulses once when it changes level. Each card also shows what you need to review it: the PR status, the target branch when it is not `develop`, the linked work items (click one to open its Work Item Details panel), the reviewers and their votes (you first), unresolved comments, conflicts, CI runs (failed tests, coverage), auto-complete and how many files changed. Hover the time left to see the history of the PR. It also tells you:

- **Your approval completes it**, in green, when your vote is the last approval the PR needs;
- **Auto-complete is set: your approval may merge it right away**, or the red error when auto-complete would complete a linked Bug (only testers complete Bugs);
- how many of **your comments are still open**, and whether someone replied since your last comment;
- **N team rules not met — remind the author** (title, description, required reviewers, linked Backlog Item / Bug; hover it for the list).

Click the title to open the PR in Azure DevOps, or **Checkout** to review it locally: the branch of the PR is fetched and checked out (and pulled when your local copy of it is behind). **Checkout** is also offered by the notifications, and by **Check Out a Pull Request Waiting for My Review** in the command palette. It is only available for the PRs of the repository open in VS Code.

| Colour | When                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------- |
| Blue   | Time left                                                                                                                 |
| Orange | Due soon: less than 6 hours left (`totalflowx.reviews.dueSoonHours`)                                                      |
| Red    | Overdue: waiting more than 24 hours of working time (`totalflowx.reviews.maxWaitHours`, `totalflowx.reviews.workingDays`) |

The section takes the colour of the most urgent PR and counts the overdue and due soon ones. It can be collapsed; it opens again when a new PR arrives. The badge of the activity bar icon (carried by the [Summary view](#summary-view)) counts these PRs, together with the work items that need attention.

**In the status bar**, e.g. `2 to review · 4 h left` (the time left of the most urgent PR), in yellow when one is due soon and in red when one is overdue. Hover it to see each PR; click it to show the list (`totalflowx.reviews.showInStatusBar`).

**Notifications** (`totalflowx.reviews.notifications`):

- when you are added as reviewer of a PR (or a draft you review is published),
- when a PR is due soon,
- when a PR is overdue, and again every 4 hours while it stays overdue (`totalflowx.reviews.remindOverdueEveryHours`, 0: only once),
- when someone **replies** to a comment you started on a PR you review, or **resolves** it (Resolved, Won't fix, Closed, By design). **Open Comment** opens the thread in the PR. PRs completed or abandoned with comments of yours still open are checked one last time, since authors often resolve the comments right before completing the PR,
- a daily digest the first time VS Code checks each day ("3 pull requests are waiting for your review: 1 overdue, 1 due soon"), instead of the other notifications of that check.

Requests received while VS Code was closed are notified when it starts.

Once you vote (approve, approve with suggestions, wait for author or reject) or decline, the PR leaves the list. Drafts and your own PRs are not listed. The waiting time counts from the publication of the PR: its creation or, when it was created as a draft, the moment it was published. PRs are checked every 2 minutes (`totalflowx.reviews.pollIntervalSeconds`, the refresh button of the section, or **Check Pull Requests Waiting for My Review**). **Show optional (N)** in the box (or `totalflowx.reviews.includeOptional`) also lists the PRs where you are an optional reviewer: they come after the required ones, below an "Optional" separator, faded, with an **Optional** badge (required ones have a solid **Required** badge). The overdue / due soon counters only count required reviews.

Only the PRs where you are a reviewer yourself are listed: when a group (e.g. a team) is the reviewer, the PR shows up once you are added to it, or once you vote for the group.

## Diagnostics

- **Show Azure DevOps Usage** (command palette) opens a report of the requests made to Azure DevOps since the extension started and in the last hour: requests per feature (sidebar, CI runs, My Pull Requests, Waiting for your review, PR notifications, dependency map, Work Item Details panel, status bar, commands), requests per minute (averages, busiest minute, the last 15 minutes), and errors and throttling (by status, the last errors, throttled responses with Azure DevOps' rate-limit headers).
- **Show Request Log** opens the **Totalflow X** output channel. With `totalflowx.diagnostics.logRequests` on, it logs one line per request: time, method, status, duration, feature and URL (never headers, tokens or bodies). Off by default; the counters of the report cost nothing noticeable either way.

## Settings

| Setting                                                | Description                                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `totalflowx.branchModules`                             | Catalog of branch modules                                                   |
| `totalflowx.prFeatureNames`                            | Catalog of PR feature names                                                 |
| `totalflowx.moduleToFeature`                           | Feature name suggested for each branch module                               |
| `totalflowx.branchTypeByWorkItemType`                  | Branch prefix per work item type (`Bug` → `bugfix`)                         |
| `totalflowx.baseBranch`                                | Base branch and PR target (`develop`)                                       |
| `totalflowx.filter.types`                              | Work item types shown (Type chips)                                          |
| `totalflowx.filter.hiddenPriorities`                   | Priorities hidden (Priority chips)                                          |
| `totalflowx.filter.alwaysShowAlerts`                   | Show work items with alerts whatever the filters (off)                      |
| `totalflowx.filter.hiddenPullRequestStates`            | PR states hidden (PR chips)                                                 |
| `totalflowx.stateOrder`                                | Order of the cards by state                                                 |
| `totalflowx.stateOnBranchCreated`                      | State set when a branch is created, per type                                |
| `totalflowx.notifications.events`                      | PR events notified (`comments`, `vote`, `merged`, `taskDone`…); empty: none |
| `totalflowx.notifications.pollIntervalSeconds`         | How often your PRs are checked (seconds, min. 30)                           |
| `totalflowx.filter.hiddenStates`                       | States hidden (State chips)                                                 |
| `totalflowx.teams`                                     | Teams whose current iteration is listed (empty: all my teams)               |
| `totalflowx.linkBranchToWorkItem`                      | Publish and link new branches to the work item                              |
| `totalflowx.organization` / `.project` / `.repository` | Override what is detected from the remote                                   |
| `totalflowx.alerts.*`                                  | Alert rules: tags, required fields, types, PR task pattern                  |
| `totalflowx.integrationBuild.*`                        | Feed, package and suffix used to fill Integrated in Build                   |
| `totalflowx.layout`                                    | Layout of the cards: `compact` (default) or `large`                         |
| `totalflowx.myPullRequests.*`                          | My pull requests: show drafts, refresh interval                             |
| `totalflowx.statusBar.currentWorkItem`                 | Show the work item of the current branch in the status bar                  |
| `totalflowx.dependencies.*`                            | Completed states of predecessors, confirmation before starting              |
| `totalflowx.coverage.*`                                | Coverage levels: minimum (60), target (80), excellent (95)                  |
| `totalflowx.pipelines.*`                               | CI runs: refresh interval, notifications, status bar                        |
| `totalflowx.reviews.*`                                 | PRs to review: maximum wait, due soon, reminders, status bar                |

Modules and feature names added with **Add new…** are saved to the workspace settings (`.vscode/settings.json`), so they can be committed and shared.

## Contributing

Start with [AGENTS.md](AGENTS.md) (architecture, conventions, how to verify a change, safety rules), then [docs/DECISIONS.md](docs/DECISIONS.md) (why things are the way they are, including the team rules) and [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md) (what we learned about the Azure DevOps API). They are written for developers and AI agents alike.
