# Architecture — file map

Where things live. Read the part you need; the always-loaded rules are in [AGENTS.md](../AGENTS.md). Keep this map current when files are added, renamed or change role.

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
src/sprintTitle.ts        pure: the sprint title the teams share and the "N teams" chip of the Track board and the timeline (Rule SPRINT-TITLE-1); markup: src/webview/sprintTeams.ts
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
                          requests: the first commits and, only for the rows the user expanded, the history of their PRs (src/pullRequestHistory.ts);
                          row style per view: src/timelineDensity.ts (pure, Rule TIMELINE-32); past sprints: src/pastSprints.ts (pure, Rules TIMELINE-40, TIMELINE-41)
                          which work items were in a past sprint and where they went, from their updates: src/sprintMembership.ts (pure, Rules TIMELINE-43, TIMELINE-44)
                          view options of the header (switches, grouping, dimming): src/timelineView.ts (pure, Rules TIMELINE-45, TIMELINE-46)
src/sprintTimelineModel.ts pure: reviews, base branch, planned rows, header, `buildSprintTimeline`; types in src/timelineTypes.ts, axis in src/timelineAxis.ts, spans in src/timelineSpans.ts
src/timelineRows.ts       pure: the work item row (stations over time) and what it expands to (PR rows, tasks, placeholder); src/teamTimelineModel.ts: the same for the other people, read-only
src/workItemStateHistory.ts pure: the states of a work item row (from `wit/workItems/{id}/updates`), In review approximated, Rules TIMELINE-35, TIMELINE-36
src/reviewedTimeline.ts   pure: "REVIEWED BY YOU" rows (first vote of the user from the threads), Rule TIMELINE-37
src/keyedReads.ts         one read per id kept by an immutable key (6 in flight, failures retried after 10 min): state histories, reviewed threads, commits of the PRs hovered (Rule TIMELINE-39)
src/teamPlans.ts          pure: areas + selected sprints of the project teams, which teams lack the sprint of a work item, Rule ALERT-14 (read by AzdoClient.getTeamPlans, cached 1 h)
src/prLifecycle.ts        pure: station of a PR moment by moment, its phases and its events from threads + CI runs (reuses src/pullRequestPhases.ts); src/workItemStations.ts: the station of a work item from its PRs
src/completedPullRequests.ts pure: the merged PRs the timeline draws (from the list My Pull Requests reads)
src/prHistoryCache.ts     pure: what to read for the PRs of the expanded rows and when again (immutable keys); src/timelineExpansion.ts: default / remembered expansion, Collapse all
src/workItemDetails.ts    Work Item Details panel (one editor tab per work item); HTML in src/detailsHtml.ts
src/dependencyMap.ts      dependency map panel; graph/layout in src/dependencyGraph.ts, iteration model in src/schedule.ts
src/commands/*.ts         user flows (create branch / PR, checkout + worktrees, delete branch, publish, retarget, …); base branch rules: src/baseBranch.ts (pure)
src/*StatusBar.ts         status bar items (CI runs, reviews, my PRs that need me, current work item); texts/colours are pure: ciStatusText (src/pipelines.ts), CI tooltip (src/ciTooltip.ts), src/myPullRequestsAttention.ts
media/*.css               styles of the webviews (webview.css shared by the sidebar and the details panel); fonts.css declares the bundled fonts of the Totalflow look (webviews that use it need `font-src ${webview.cspSource}`)
```
