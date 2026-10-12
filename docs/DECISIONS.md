# Decisions

Why the extension behaves the way it does. Each entry: the decision, and the reason (often a team rule or something learned about Azure DevOps). Add an entry when you make a choice someone could later "fix" without knowing why, and correct or remove the entries a change makes wrong — in the same change (developers and AI agents alike).

## Team rules

The extension enforces or supports these team rules; many features exist because of them.

| Rule                                                                                                                                       | Where the extension helps                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Branches are named `<feature\|bugfix>/<module>/<id>-<short-name>` (Backlog Item → `feature`, Bug → `bugfix`)                               | Create branch; branch ↔ work item detection (`src/naming.ts`)                               |
| PR titles follow `[<ids>] <Feature Name>: <description>`                                                                                   | Create PR; warning on published PRs                                                         |
| Every PR has a short description, at least 2 required reviewers (people, not groups) and a linked Backlog Item or Bug                      | Warnings on My Pull Requests cards                                                          |
| No PR waits for its reviewers more than 24 hours                                                                                           | "Waiting for your review" box, status bar, reminders, daily digest                          |
| Branches are deleted once their PR is merged                                                                                               | Delete branch on finished work items; warning when auto-complete does not delete the branch |
| Only testers complete Bugs                                                                                                                 | Red error when a Bug PR's auto-complete would complete the linked Bug                       |
| Changes testers should know about are explained in `build-notes/developer-notes.md`; PRs without such changes get the tag `no-build-notes` | Build notes warning, "Add tag" button, check in Create PR                                   |
| Starting a work item whose predecessors are not done should be agreed with their owners                                                    | Open predecessors on the cards, confirmation before starting, dependency map                |
| Alerts (Done with open tasks, missing PR task, blocking tags, empty required fields, Integrated in Build when Ready to Test)               | Alerts on the cards, banner, badge, status bar                                              |
| "Integrated in Build" of a Bug Ready to Test = last published `rmc.image.deploy` version + `+`                                             | Fill button and proposal when moving to Ready to Test                                       |

## Scope and data

- **Only the user's work items** ("Assigned to Me", "My Work Items"), in the **current iteration of every team the user belongs to** (`teams?$mine=true`), unless teams are selected. Teams sharing a sprint are merged; different sprints are grouped.
- **Tasks are never cards of their own** nor filter values: they are parts of their Backlog Item / Bug, always nested in its card (including tasks assigned to other developers, with their initials). Tasks are not shown in the dependency map and get no "Dependency map" button.
- **Filters apply to Backlog Items and Bugs only**; nested tasks are never filtered. Work items with alerts follow the filters unless `filter.alwaysShowAlerts` (default off: the banner says how many are hidden and "Show only these" reveals them).
- **Several branches per work item**: named after it, Development links, source branches of its active PRs. The **main branch** (checked out, else named after it, else the link) drives the card's buttons; each other branch of this repository has its own Checkout. Finished work items list only their main branch and other _local_ branches, because remote refs and links outlive deleted branches.
- **Branch existence is asked to Azure DevOps** (`refs?filter=`), not trusted from local `origin/*` refs or Development links, which stay after a branch is deleted.
- **PRs / branches of other repositories** are shown dimmed; only this repository's PRs decide whether "Create PR" is offered.
- **Fixed-by links**: a Bug is "fixed by" a Backlog Item when the Backlog Item is its **predecessor** (some Bugs are really missing features). The reverse direction is just a dependency.
- **Startup waits for the git extension.** The built-in git extension announces a repository before its state is loaded: on a cold start `state.remotes` is empty for a while, so the organization / project / repository could not be detected and every first load failed until the next poll (about 2 minutes). `WorkItemsStore.whenRepositoryReady()` (`src/repositoryGate.ts`, decision in the pure `src/repositoryReadiness.ts`) resolves when the git API is `initialized` and the repository has remotes, or at once when `totalflowx.organization/project/repository` are all set. It gives up after 30 s so a repository that really has no `origin` still gets the clear error. During the wait the sidebar shows "Loading…" and nothing records or shows an error. The store loads, the pollers, the status bar, the Work Item Details panel and the dependency map await it before `resolveContext`, and so do the commands (the `command()` helper of `src/extension.ts`), so running one in the first seconds after a cold start waits instead of failing.

## Reviews and pull requests

- **Waiting time counts from the publication** of the PR (last time it left draft, from the `IsDraftUpdate` system thread), not its creation: reviewers are not asked to review drafts.
- **Required reviewers first**; optional reviews are listed only on demand. The overdue/due-soon counters count required reviews only (the 24 h rule is about them). Optional reviews are **tracked even while hidden**, so switching them on does not flood notifications (trade-off: an optional PR that became overdue while hidden does not notify at that moment).
- **"Ready to merge" (green) means nothing stops the merge**: published, every blocking policy satisfied (approvals included), no conflicts, no warnings. Waiting for approvals is not green.
- **"Next" line** is computed from the PR's **blocking branch policy evaluations**, not guessed.
- **Rule warnings only on published PRs** (drafts are work in progress). The Bug auto-complete rule is an _error_ (red): only testers may complete Bugs; when present, even "Will complete automatically" is shown in red.
- **Reviewer/vote notifications ignore the user's own actions**; reviewer changes are attributed from the `ReviewersUpdate` system threads.
- **Checkout of a PR / branch never silently carries changes**: with uncommitted changes it asks (worktree / stash / anyway). "Create branch" creates without switching, then proposes Checkout or a worktree.
- **Worktrees** go to `<repo>.worktrees/<branch>` (the layout the team already used), copy `.env.local` files, open in a new window that runs `npm ci` once (marker in the worktree's private git dir, never in the working tree).

## CI, coverage and requests

- **CI runs are followed for the PRs of the user's work items and all the user's PRs**; fast polling (15 s) only while a run is active, otherwise an idle check (60 s) to discover re-runs/new pushes. A failed fetch keeps the last known runs.
- **Coverage is the coverage of the code tested by the PR's run** (the PR pipeline runs the affected tests). Shown to motivate: levels (60/80/95), positive deltas celebrated, decreases neutral (no blame), files below target to open, personal best and streak (only the user's own PRs, one entry per PR). No team ranking (it would push people to game the number).
- **Request budget**: tags come with the PR list (0 requests); "PR changed the build notes file" = 1 diff request per PR per push (cached by last pushed commit); branch existence, repository names, work item types are cached. The usage report and request log exist to keep this honest.

## Dependency map

- **Iterations are `<Project>\<Release>\<Sprint>`**: depth 1 = limbo (ignored, counted in a note), depth 2 = release container ("not scheduled in a sprint yet" column after its sprints), depth ≥ 3 = sprint.
- **Columns are sprint periods** (same start/finish dates), with one lane per team sprint, always in the same team order; different date ranges get their own columns. Do not compare iterations by the container's dates (a release starts long before its sprints).
- **Risk**: done → grey; predecessor in a release or limbo → "not scheduled yet"; same sprint period (even different teams) → tight; later period → late; earlier → ok. The same rule drives the cards' open-predecessor warnings and the Work Item Details panel.
- "Hide done" keeps the user's own work items and the focused one; work items without dependencies are shown on demand.

## UI choices

- Compact layout is the default for work items and both PR boxes; a compact row unfolds into the full card in place.
- Boxes (Waiting for your review, My Pull Requests) look like framed panels, deliberately different from the iteration group headers.
- **The activity bar badge lives on the native "Summary" tree view, not on the webview view.** VS Code creates (resolves) a webview view only when it is first shown, so on a cold start there is no `WebviewView` to set `badge` on until the user opens the sidebar. A `TreeView` made with `createTreeView` at activation exists immediately, so `src/summaryView.ts` sets its badge (work items with alerts + PRs waiting for review, `src/summaryRows.ts`) at startup and on every change of the store and the watchers. The webview view must not set a badge too: the container would show a double count. Whether the badge of a _collapsed_ tree view reaches the container icon must be confirmed in a real VS Code.
- The PR history popover lists the latest events first.
- Figma links open in the Figma VS Code extension when installed, but it does not select the linked frame (limitation of that extension, v0.4.7); the browser button opens the exact frame.

## Naming and identity

- Namespace `totalflowx.*` for settings, commands, views; display name "Totalflow X devtools for Azure Devops". The **extension ID stays `abb-totalflowx.vscode-azdo-workitems`** so installed state (globalState) survives renames; the coverage records keep their old storage key `azdoWorkItems.coverageRecords:` for the same reason.
- The per-work-item tab is the **Work Item Details panel**; its button on cards is "Details".
