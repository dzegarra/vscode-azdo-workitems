# Totalflow X devtools for Azure DevOps — guide for developers and AI agents

VS Code extension (ID `abb-totalflowx.vscode-azdo-workitems`, display name "Totalflow X devtools for Azure Devops") that brings the team's Azure DevOps work into the editor: work items of the current sprints, branches, pull requests, reviews, CI runs, dependencies, and the team rules (alerts, warnings).

- What it does, for users: [README.md](README.md).
- Why things are the way they are: [docs/DECISIONS.md](docs/DECISIONS.md). **Read it before changing behaviour.**
- The exact decision rules (which states are shown, which actions are unlocked), with stable IDs: [docs/RULES.md](docs/RULES.md).
- What we learned about the Azure DevOps REST API (verified on our organization): [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md).
- The team's own process document: [docs/DEVELOPMENT_APPROACH.md](docs/DEVELOPMENT_APPROACH.md). It is a reference copy: do not edit its content.

## Context

- Organization `ABB-PAMA-BVL`, project `Flow Digital Architecture`, main repository `User_Interface` (others exist, e.g. `Common_Translations`, `Communication-Interface`). Organization / project / repository are detected from the `origin` remote; settings can override them.
- The team works in Scrum, 2-week sprints, several teams in parallel (Platform, Measurement Apps, Interface Apps, Automation Apps, UX…). Iterations are `<Project>\<Release>\<Sprint>`, e.g. `Flow Digital Architecture\MVP R3\Platform Sprint 122`.
- Team rules enforced by the extension are listed in [docs/DECISIONS.md](docs/DECISIONS.md#team-rules).
- The team rules come partly from [docs/DEVELOPMENT_APPROACH.md](docs/DEVELOPMENT_APPROACH.md) (the architect's document, new revisions every few months) and partly from the team. [docs/DEVELOPMENT_APPROACH_COVERAGE.md](docs/DEVELOPMENT_APPROACH_COVERAGE.md) maps every rule of that document (`DA-<n>`) to the extension's rules (RULES.md IDs) with its status: implemented, planned, waiting for the architect, later, release process, ignored. Keep it current when a rule is implemented or changed, and follow its last section when a new revision of the document arrives.
- The **release and hotfix procedures** of that document (release branches, merges to Main, tags, hotfix branches, the Checkpoint tag) are **deferred on purpose**: ignore them until the release phase starts (see the note under the table in [docs/DECISIONS.md](docs/DECISIONS.md#team-rules)).
- The project lives in its own repository; it was extracted (with its history) from the `User_Interface` Nx monorepo, where it was `tools/vscode-azdo-workitems`.

## Commands

From the repository root:

```sh
npm run check     # typecheck, test, build, lint: must pass with 0 lint problems
npm run package   # builds vscode-azdo-workitems-0.1.0.vsix
npm run reinstall # package, then uninstall + install it in VS Code (scripts/reinstall-extension.mjs)
npm run format    # prettier on src and media
```

- Scripts (`package.json`): `build` (esbuild, 5 bundles: `dist/extension.js` for Node, `dist/webview.js` for the sidebar, `dist/dependencies.js` for the dependency map, `dist/board.js` for the Track board, `dist/timeline.js` for the Sprint timeline), `watch`, `typecheck` (`tsc --noEmit`), `test` (vitest, `vitest.config.mts`), `package` (`vsce package --no-dependencies …`), `lint` (ESLint, `eslint.config.mjs`: `typescript-eslint` strict type-checked rules plus the conventions below; import resolution is left to `tsc`, formatting to Prettier), `format` (Prettier, `.prettierrc`).
- Debug: launch configuration **Run Azure Work Items Extension** (F5) in `.vscode/launch.json` (builds first via the `npm: build` task).
- Install: `code --install-extension vscode-azdo-workitems-0.1.0.vsix`, then reload the window. `npm run reinstall` does rebuild + uninstall + install in one go (it does not run `npm run check`).

## Architecture

```
src/extension.ts          activation: creates the store, watchers, views, status bar items; registers commands
src/repositoryGate.ts     startup gate (whenRepositoryReady on the store): await it before resolveContext in anything that can run at startup
src/azdoClient.ts         REST client (fetch + bearer token from the VS Code Microsoft sign-in, src/auth.ts)
src/requestRecorder.ts    the ONLY place that calls fetch: records every request (src/requestStats.ts, src/diagnostics.ts)
src/requestContext.ts     AsyncLocalStorage "feature" attribution of requests (withFeature)
docs/RULES.md             decision tables of every rule (IDs referenced by `// Rule <ID>` comments; src/rulesDoc.test.ts)
src/track.ts               pure (redesign): the six stations of a work item (Branch → PR → CI → Review → Ready to be merged → Done), Rules TRACK-*
src/look.ts                pure (redesign): totalflowx.appearance.look, theme or Totalflow look (media/fonts.css + media/fonts/, OFL), Rule LOOK-1
src/sidebarTabs.ts         pure (redesign): the Now / Work / PRs tabs of the sidebar, their counts and the tab a Summary row opens, Rules TABS-*
src/stateSteps.ts          pure (redesign): the state bar of the details panel (flows of Bugs / Backlog Items, testers-only Done), Rules STEPS-*
src/beforeCompletion.ts    pure (redesign): the "Before completion" checklist of the details panel (alerts + COMPLETE cautions), Rules BEFORE-*
src/trackHtml.ts           pure (redesign): HTML of the track, shared by the sidebar and the details panel
src/stationNotes.ts        pure (redesign): note lines under each station of the details panel's six-column track (presentation only)
src/nowQueue.ts            pure (redesign): the "Needs you" queue under five verbs (review, unblock, fix, ship, clean), Rules NOW-*
src/pullRequestTasks.ts    pure rules of the PR tasks (reusable tasks, which move on publish / completion, branch of a task row)
src/taskMenu.ts            pure: the pill of a task row (branches + PRs) and the sections of the picker behind it
src/checkoutMenu.ts        pure: items of the picker behind the ... of a Checkout button, and of the branch rows (src/branchMenu.ts)
src/actionMenu.ts          pure: types of the picker sections / items and their codicon + colour (actionMenuIcon)
src/actionRequests.ts      pure: title + sections of each trigger of the sidebar (task pill, branch row, Checkout ...), the `showActions` message
src/actionPicker.ts        pure: sections -> picker entries (separators, icons) and the allowlist that validates what a chosen item may run
src/actionPickerUi.ts      the native QuickPick of those entries (the only vscode-facing part); the details panel's ... use it too
src/deletableBranches.ts   pure: when a branch is offered for deletion (completed PR, still exists, no active PR); texts of the delete flows
src/worktreeHygiene.ts     pure: origins of the worktrees, why one is stale / idle / in use, the once-only notification baseline;
                           rows of the Worktrees view and of the cleanup pickers: src/worktreeRows.ts
src/worktreeTracker.ts     records the origins (store.onDidCreateWorktree), classifies on every change (no request), notifies; view: src/worktreesView.ts
src/worktreeStatusBar.ts   status bar "main" / "worktree" of this window (pure: windowWorktree, worktreeStatusBarView in src/worktrees.ts)
src/workItemsStore.ts     work items of the current sprints + branches, PRs, CI runs, alerts, dependencies, worktrees
src/*Watcher.ts           pollers: reviewRequestsWatcher (PRs to review), myPullRequestsWatcher (my PRs),
                          pipelineWatcher (CI runs, via src/runsPolling.ts), pullRequestNotifier (events on my PRs)
src/baseBranchAlert.ts    alarm of a broken base branch (status bar, modal, sound, banner buttons, "I am on it" acknowledgements); pure rules and texts: src/baseBranchHealth.ts
src/pullRequestTaskStarter.ts  after each load, moves the tasks of my published PRs to In Progress (rule in src/pullRequestTasks.ts)
src/pullRequestCompletion.ts   pure: what Complete… of My Pull Requests does to the work items (Bugs never Done); flow in src/commands/completePullRequest.ts
src/workItemReminders.ts       pure: reminders of the completion caution (not updated daily, sprint ending)
src/statusBarOrder.ts     pure: priorities that fix the order of the status bar items, text of the "N to fix" item, Rules STATUSBAR-ORDER-1, STATUSBAR-FIX-1
src/summaryView.ts        native "Summary" tree view; owns the activity bar badge (rows/badge logic, pure: src/summaryRows.ts)
src/funJournalStore.ts    fun journal in the global state (pure recorders: src/funJournal.ts); fun texts: src/celebrations.ts,
                          src/greenStreak.ts, src/sprintCountdown.ts; sprint wrap-up: src/sprintRecap.ts (pure) + src/sprintRecapPanel.ts
src/trackBoard.ts         Track board panel (one editor tab, redraws on store / PR / review events, no request of its own); pure model: src/trackBoardModel.ts (Rules BOARD-*)
src/sharedMessages.ts     the buttons the sidebar and the Track board share (PR, review and work item actions): both views run them here
src/workItemsView.ts      sidebar webview provider: builds the ViewModel (src/viewModel.ts) and handles messages
src/webview/main.ts       sidebar webview (cards, PR boxes, filters); src/webview/dependencies.ts: dependency map; src/webview/board.ts: Track board (media/board.css); src/webview/timeline.ts: Sprint timeline (media/timeline.css)
src/codingStart.ts        pure: where coding starts on the Sprint timeline (setting appearance.timelineCodingStart, Rule TIMELINE-20), first commit of a PR (parsing, cache rules)
src/teamView.ts           pure (phase 7): whole-team scope (globalState key), teams read, team badges, initials, avatar colours, Rule TEAM-1
src/teamPeople.ts         pure: the people of the Whole team view (setting `totalflowx.teamView.people`), picker rows, filter, query identities, Rules TEAM-1, TEAM-2
src/concurrency.ts        pure: mapLimit, at most 6 requests in flight in any one-request-per-item fan-out (Rule TEAM-7)
src/teamData.ts           pure: raw team snapshot -> WorkItemModel per work item, lanes per person (groupByPerson), cache keys, attempt key, Rules TEAM-5..8
src/teamBoardModel.ts     pure: the whole-team Track board (lanes, compact cards, markers, insights), Rules BOARD-26..30; the Sprint timeline (7b) reuses people + cards
src/teamWorkStore.ts      fetches the team data (feature `teamView`, only when a visible tab is in Whole team, attempt key, caches); onDidChange redraws the board
src/teamTimelineModel.ts  pure: Whole team Sprint timeline (a section per person, read-only rows, summaries), Rules TIMELINE-21..26
src/webview/peoplePicker.ts  the scope switch and People picker shared by the board and timeline webviews (Rules TEAM-1, TIMELINE-21)
src/sprintTimeline.ts     Sprint timeline panel (editor tab, dist/timeline.js, media/timeline.css; webview: src/webview/timeline.ts): one row per work item by station, expandable to its PRs (Rules TIMELINE-*);
                          requests: the planned work of the next sprint, the first commits and, only for the rows the user expanded, the history of their PRs (src/pullRequestHistory.ts)
src/sprintTimelineModel.ts pure: reviews, base branch, planned rows, header, `buildSprintTimeline`; types in src/timelineTypes.ts, axis in src/timelineAxis.ts, spans in src/timelineSpans.ts
src/timelineRows.ts       pure: the work item row (stations over time) and what it expands to (PR rows, tasks, placeholder); src/teamTimelineModel.ts: the same for the other people, read-only
src/prLifecycle.ts        pure: station of a PR moment by moment, its phases and its events from threads + CI runs (reuses src/pullRequestPhases.ts); src/workItemStations.ts: the station of a work item from its PRs
src/completedPullRequests.ts pure: the merged PRs the timeline draws (from the list My Pull Requests reads)
src/prHistoryCache.ts     pure: what to read for the PRs of the expanded rows and when again (immutable keys); src/timelineExpansion.ts: default / remembered expansion, Collapse all
src/workItemDetails.ts    Work Item Details panel (one editor tab per work item); HTML in src/detailsHtml.ts
src/dependencyMap.ts      dependency map panel; graph/layout in src/dependencyGraph.ts, iteration model in src/schedule.ts
src/commands/*.ts         user flows (create branch / PR, checkout + worktrees, delete branch, publish, retarget, …); base branch rules: src/baseBranch.ts (pure)
src/*StatusBar.ts         status bar items (CI runs, reviews, my PRs that need me, current work item); texts/colours are pure: ciStatusText (src/pipelines.ts), CI tooltip (src/ciTooltip.ts), src/myPullRequestsAttention.ts
media/*.css               styles of the webviews (webview.css shared by the sidebar and the details panel); fonts.css declares the bundled fonts of the Totalflow look (webviews that use it need `font-src ${webview.cspSource}`)
```

- **Pure modules** (no `vscode` import) hold the logic and have a `*.test.ts` next to them: naming, alerts, reviews, PR shaping (`myPullRequests.ts`, `reviewCard.ts`, `prCompactSignals.ts`), timeline, coverage, runs, worktrees, schedule/graph, build notes, branches, working-on, fix links, duplicates… The `vscode`-facing files are thin wrappers. Keep it that way: new logic goes into a pure module with tests.
- The webviews receive a serialisable model (`ViewModel`, `DependencyMapUpdate`) and post back typed messages (`WebviewMessage`); the extension does all Azure DevOps and git work.
- State: settings (`totalflowx.*`, user-level for personal choices like filters/layouts), `context.globalState` (notification baselines, coverage records — keys are internal, some keep the old `azdoWorkItems.` prefix on purpose), webview `getState/setState` (UI-only: collapsed boxes, expanded cards).

## Conventions (follow them; reviews check them)

- **Strict webview CSP**: no inline `style="…"`, no inline event handlers. Dynamic sizes/positions are set through CSSOM after rendering (`data-box` + `applyBoxes`, `sizeReviewBars`, `data-elapsed`/`data-progress`). `src/webview/csp.test.ts` fails on inline styles. The details panel allows `'unsafe-inline'` styles and `img-src https: data:` only because it embeds work item rich text.
- **Pure logic + tests**: vitest; in new test files import `describe/it/expect/vi` explicitly from `vitest` (globals will be disabled).
- **Lint rules that bite** (all errors, no warnings: fix them, do not disable them): `no-use-before-define` (define functions before using them), switch exhaustiveness, no nested ternaries, `eqeqeq`, no `any` leaking out (`no-unsafe-*`), no unnecessary conditions, numbers/booleans only in template literals. `tsconfig` has no `noUncheckedIndexedAccess`, so `const [first] = list` is typed as always defined: write `list.at(0)` (or `.at(-1)`) when the array can be empty. Unused names must start with `_`. Test files may use `expect.any(...)` matchers and `!`.
- **Naming**: settings and commands are `totalflowx.*` (declare them in `package.json`; read them through `SECTION` in `src/config.ts`); command category "Totalflow X". A new setting goes into the right category of `contributes.configuration` (an array of categories, see [docs/DECISIONS.md](docs/DECISIONS.md#ui-choices)) with an `order` and a key prefixed like its neighbours (`workItems.*`, `branches.*`, `myPullRequests.*`…), and into the matching table of the README; personal choices get `"scope": "application"`, team settings keep the default scope. User-facing name of the per-work-item tab: **Work Item Details panel**.
- **Requests**: always through `AzdoClient` → `recordedFetch`. Wrap new entry points (pollers, panels, commands) in `withFeature(...)` so the usage report attributes them. Keep the request budget low (batch, cache by immutable keys such as build id or last pushed commit; never poll faster than needed).
- **Theme-friendly colours**: use VS Code theme variables and the tokens of `media/webview.css`; check dark and light. Solid pills with fixed colour pairs (priority, due soon) are deliberate for contrast.
- **Documentation**: user-visible changes update [README.md](README.md); decisions with a "why" go to [docs/DECISIONS.md](docs/DECISIONS.md); new API findings to [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md).

## Verifying changes

1. `typecheck,test,build,lint` (above) and `package`.
2. **Rendering**: the webviews can be rendered without VS Code. Build, then load `dist/webview.js` (or `dist/dependencies.js`) and `media/*.css` in a static HTML page with the same CSP meta, a stub of `acquireVsCodeApi` (records `postMessage`), CSS variables for the VS Code theme tokens, and a script that posts a `{ type: 'state', model }` (or `{ type: 'graph', graph }`) message. Drive it with Playwright (not a dependency of this repo: use `npx playwright`) in dark and light, at 260–340 px for the sidebar, and look at the screenshots.
3. **Real data, read-only**: `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798 --url "<GET url>"` (the Azure DevOps resource id), or an Azure DevOps MCP server's read tools. Bundle the pure modules with esbuild into a small Node script to run them on real responses.
4. Things that need a real VS Code (dialogs, QuickPicks, notifications, status bar, git API calls, new windows) must be tried with F5 or the installed `.vsix` before calling a feature done.

## Keeping these documents current

These files are the project's memory: conversations with AI agents are not shared, so anything not written here is lost. **Agents and developers must update them as part of the same change**, not later:

- [README.md](README.md): every user-visible change (features, settings, commands, texts).
- [docs/DECISIONS.md](docs/DECISIONS.md): every decision with a "why" (a team rule, a trade-off, something that looks like a bug but is intended). Correct or remove entries that the change makes wrong.
- [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md): every new or corrected fact about the API (endpoints, versions, quirks), only once verified.
- [docs/RULES.md](docs/RULES.md): every change to a decision rule (states shown, actions unlocked, thresholds): update its row, its `// Rule <ID>` comment and a test in the same change. `src/rulesDoc.test.ts` enforces that the IDs in the code and in the document match.
- This file (AGENTS.md): when the architecture, commands, conventions, verification steps or safety rules change, or when a convention turns out to be missing.

Before finishing a task, check that these files still describe the code; say in the summary of the change which ones were updated.

## Safety rules (for humans and agents)

- When testing, **never write to Azure DevOps** (no POST/PATCH/PUT/DELETE): only GET requests. Write paths (publish PR, add tag, delete branch, update work items) are tested with stubs.
- **Never create/delete branches, worktrees or stashes, never push, in the real repository** while testing git flows: use a throwaway repository (bare origin + clone) in a temp folder.
- Never print, log or store tokens; the request log records only method, shortened URL, status, duration, feature and rate-limit headers.
- Do not commit unless asked; end commit messages with the reason of the change.
