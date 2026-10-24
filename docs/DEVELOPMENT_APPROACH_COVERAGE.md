# Coverage of DEVELOPMENT_APPROACH.md

How each rule of the team's process document ([DEVELOPMENT_APPROACH.md](DEVELOPMENT_APPROACH.md), written by the architect) relates to the extension's rules ([RULES.md](RULES.md), [DECISIONS.md](DECISIONS.md#team-rules)). The goal is that **every rule of the document ends up covered** (implemented, or explicitly out of scope), so the deferred and pending ones are tracked here until they are done.

- Compared revision: **AB (2026-10-01)**. Review: 2026-10-24; the agreed rules were implemented the same day.
- Rule ids `DA-<n>` are stable (never reused or renumbered); a new rule of a later revision gets the next number.
- The extension also has rules of its own, which the document does not contain: [Extension-only rules](#extension-only-rules).

## Status legend

| Status | Meaning |
|---|---|
| ✅ Implemented | The extension enforces or supports it (rule IDs of RULES.md given) |
| 🛠 Planned | Agreed, to be implemented |
| ⏳ Waiting for the architect | A question is open (see [Questions for the architect](#questions-for-the-architect)) |
| 🕓 Later | Postponed by the team; review together with the architect's answers |
| ⏸ Release process | Only applies once a release branch is created and feature work stops. Deliberately not implemented yet; to do a few days before the release phase starts |
| 🔒 Azure DevOps policy | Already enforced by an Azure DevOps branch / team policy: nothing to do |
| 🚫 Ignored | Decided not to implement (reason given) |
| ⚠️ Doc mistake | The document is wrong here; the team rule is the one in the note |
| ❔ Not reviewed | Not discussed yet |
| ➖ Process | Not something a VS Code extension can check (meetings, planning, reporting) |

## Rules of the document

### Git: branches (§8.1)

| ID | Rule | § | Status | Extension / note |
|---|---|---|---|---|
| DA-1 | Feature branches are created from `develop` | 8.1.1 | ✅ | FLOW-BRANCH-5 |
| DA-2 | Branch names: hyphens between words, lowercase | 8.1.3 | ✅ | FLOW-BRANCH-4 (`slugify`). Team rule: **all** branch names are lowercase (the doc's `Hotfix-x` is a typo) |
| DA-3 | Work item ID in the branch name | 8.1.3 | ✅ | FLOW-BRANCH-4 |
| DA-4 | Feature branches: `feature/<area>/<id>-<name>` | 8.1.3 | ✅ | The doc's areas (`module`, `license`, …) are the backend team's; the UI team uses its own modules (`branches.modules`). Accepted as is |
| DA-5 | Fix branches: `anomaly/*` (doc) vs `bugfix/*` (extension; still in the July version of the doc) | 8.1.3 | ⏳ | `branches.typeByWorkItemType` (Bug → bugfix) |
| DA-6 | DevOps branches: `devops/<name>` (added in revision AB) | 8.1.3 | ✅ | FLOW-BRANCH-8: `devops/<id>-<name>` (the id names the work item) |
| DA-7 | Branch linked to its backlog item on creation | 8.1.3 | ✅ | FLOW-BRANCH-6 |
| DA-8 | `main`, `develop`, `develop-*`, `release-*`, `hotfix-*` are locked | 8.1.1, 8.1.3 | ✅ | DELETABLE-1, FLOW-DELETE-1: never offered nor deleted (lowercase) |
| DA-9 | Stacked branches allowed (several features merged into one branch) | 8.1.1–8.1.2 | ✅ | Base branch choice (FLOW-BRANCH-5), retarget (PR-WARN-10) |
| DA-10 | Before the PR, merge develop into the feature branch; conflicts resolved, tests and build pass | 8.1.2 | ✅ | MYPR-BEHIND-1, MYPR-ACT-7: "N commits behind develop" with **Restart merge** (Azure DevOps only reports conflicts at merge time or after a restart) |
| DA-11 | Release branches (`release-*`) from develop, merged to Main (Rebase and fast-forward) and back to Develop; version tags on Main | 8.1.1–8.1.2, 8.2.6 | ⏸ | Merge types are enforced by Azure DevOps policies (🔒) |
| DA-12 | Feature branches from a Release branch for release fixes | 8.1.2 Scenario 2 | ⏸ | |
| DA-13 | Hotfix branches from Main, merged to Main and Develop | 8.1.2 Scenario 3 | ⏸ | |

### Git: pull requests (§8.2, §10)

| ID | Rule | § | Status | Extension / note |
|---|---|---|---|---|
| DA-14 | Title `[<ids>] <feature>: <name>` | 8.2.1 | ✅ | FLOW-PR-6, PR-WARN-5. The doc's screenshots (`[1118] Command - create_app`) have no colon |
| DA-15 | Description says what was done | 8.2.1 | ✅ | PR-WARN-6 (presence only) |
| DA-16 | Two required reviewers | 8.2.1, 10 | ✅ | PR-WARN-7 (people, not groups) |
| DA-17 | Whole team as optional reviewers | 8.2.1 | 🔒 | A team policy adds the group to every published PR |
| DA-18 | Related backlog items linked | 8.2.1, 10 | ✅ | PR-WARN-8 |
| DA-19 | Checkpoint tag added to PRs | 8.2.1 | ⏸ | Part of the release process |
| DA-20 | Draft PR while work goes on, published when done | 8.2.2 | ✅ | FLOW-PR-7, FLOW-PUBLISH-* |
| DA-21 | PR template checklist (assumptions met, tests, build, docs, static analysis) | 8.2.2 | ❔ | |
| DA-22 | All comments resolved, required reviewers approve before completing | 8.2.3 | 🔒 | Branch policies; the extension shows them (PR-NEXT, PR-READY) |
| DA-23 | PR completed by its author | 8.2.3 | ✅ | MYPR-ACT-6, COMPLETE-PR-1..4: **Complete…** on own PRs ready to merge: squash, delete branch, Backlog Items → Done, Bugs → Ready to Test with "Integrated in Build" (never Done) |
| DA-24 | Squash merge for feature PRs | 8.2.5 | ✅ | PR-WARN-11 (auto-complete with another merge type); Complete… squashes |
| DA-25 | Associated work items completed on merge | 8.2.5 | ⚠️ | **Backlog Items only.** Bugs are never completed by developers: only testers, once the fix is confirmed (PR-WARN-3). Whether the extension should check the Backlog Item side: ❔ |
| DA-26 | Feature branch deleted after merge | 8.2.5 | ✅ | PR-WARN-4, DELETABLE-*, MYPR-OFFER |
| DA-27 | Merge commit message not changed | 8.2.5 | ❔ | |
| DA-28 | Reviews within the next working day | 10 | ✅ | REVIEW-URG-* (24 h of working time) |
| DA-29 | Required reviewers verify the acceptance criteria | 10 | ✅ | REVIEW-CARD-6 (link on the review card), REVIEW-AC-1 (panels open with the checkout) |
| DA-30 | Keep PRs small, branches short-lived; PR open duration is monitored | 10, 9.6 | ✅ | MYPR-CAUTION-1, MYPR-CAUTION-2 (5 working days, 30 files) |

### Backlog items and tasks (§7, §9.5, §10, §13)

| ID | Rule | § | Status | Extension / note |
|---|---|---|---|---|
| DA-31 | Title with a system-part prefix (`[Platform] …`, `[Platform UI] …`) | 7.1 | ✅ | COMPLETE-6 (`alerts.titlePrefixes`, the team extends it) |
| DA-32 | Description `[WHO] + [WHAT] + [WHY]`; UI mockups for UI items | 7.1 | 🕓 | |
| DA-33 | Acceptance criteria when known | 7.1 | ✅ | COMPLETE-3 (caution before completion) |
| DA-34 | Effort in story points on the scale 1, 2, 3, 5, 8, 13, 21 | 7.1 | ✅ | COMPLETE-4 (present), COMPLETE-5 (scale) |
| DA-35 | Effort in days | 7.1 | ✅ | COMPLETE-4 / ALERT-7 |
| DA-36 | TRS requirement reference as a comment; iteration `MVP R3`; state New on creation | 7.1 | ❔ | Items are created by Team Leads |
| DA-37 | Items from feedback use existing Epics; Team Lead consulted; classified as scope creep | 7.2, 9.5, 13.2 | 🕓 | Scope-creep classification postponed |
| DA-38 | Tasks created when work on an item starts | 9.5, 10 | ✅ | ALERT-12 |
| DA-39 | Status, tasks and effort updated daily | 10 | ✅ | REMIND-1 (`zZ Nd` badge before the title, `alerts.staleAfterWorkingDays`), REMIND-3 (the card pulses in orange); not an issue before completion |
| DA-40 | Unfinished items at sprint end explicitly split (remaining effort and reason) | 6, 9.5, 13.3 | 🚫 / 🕓 | Ignored: a reminder at sprint end was built and removed (obvious, the days left are already shown; not a completion issue). Later: the **Stretch** action itself (copy, effort split, tags), to be designed in its own discussion |
| DA-41 | Stretched items: `[Stretched]` title prefix and exactly one `stretch-*` tag | 13.3, 13.4 | ✅ / ⏳ | ALERT-13: at most one stretch tag. The prefix check is optional and off (`alerts.stretchTitlePrefix` empty): the team was not told about it and suffixes "Stretched" instead; asked to the architect |
| DA-42 | Effort lower than planned: do not reduce the estimate | 13.3.1 | ❔ | |
| DA-43 | Scope change: update description / acceptance criteria, justify in a comment | 13.3.4 | ❔ | |
| DA-44 | Blocked by missing requirements: `Requirements` tag | 12.4 | ✅ | COMPLETE-2 (`alerts.blockingTags`) |
| DA-45 | Answer copied into the item, then the `Requirements` tag removed | 12.2–12.4 | 🚫 | Answers come from Product Team meetings; the history cannot tell whether later changes are those answers |
| DA-46 | Park and switch when blocked (with the Team Lead), status and reason tracked | 9.4 | ❔ | Blocking tags shown (COMPLETE-2) |
| DA-47 | Build Notes comments added before marking complete | 10 | ✅ | PR-WARN-9, BUILDNOTES-*, FLOW-PR-5 (one file per feature) |
| DA-48 | Unit and functional tests included and passing; no "done" without tests | 10 | ❔ | CI runs and coverage are shown |
| DA-49 | Bugs: by default the whole fix in the Bug; Team Lead decides when and who fixes | 5, review comments | ❔ | |

### Process only (➖)

Principles (§5), Phase A: MRD, TRS, traceability matrix, release baseline (§6), planning horizon of 2–3 sprints, retrospectives every second sprint, no per-feature delivery dates, monthly goals, meeting discipline, monitoring tools, AI tools, backward compatibility and image version (§9), Team Lead responsibilities (§11), missing-requirements channels (§12.1–12.3), scope-creep reserve and reporting (§13.2), team health (§14), risks (§15), business reporting (§16), success criteria and rollout (§17–18), delivery dates (§3).

## Questions for the architect

| Topic | Rules | Asked |
|---|---|---|
| `anomaly/*` (revision AB) or `bugfix/*` (July version) for fix branches | DA-5 | 2026-10-24, waiting |
| Description `[WHO] + [WHAT] + [WHY]` and UI mockups: how strict, how to recognise a UI item | DA-32 | not yet (postponed) |
| Scope-creep classification: tag names per category of §13.1 | DA-37 | not yet (postponed) |
| Stretch title: `[Stretched]` prefix (rules 2–3) or a suffix (example 3, and what the team does: "Stretched" at the end) | DA-41 | 2026-10-24, waiting |
| Fix §8.2.5: Bugs must not be completed on merge (only testers complete them) | DA-25 | not yet (doc correction) |

## Extension-only rules

Rules the extension enforces that the document does not contain (added by the team): one PR task per PR (TASK-PR-\*, ALERT-3..5); only testers complete Bugs (PR-WARN-3); Done / Ready to Test with open tasks (ALERT-1); task branches and PRs also linked to the work item (ALERT-2, ALERT-8); duplicates planned and kept in sync with their original (ALERT-9, ALERT-10); "Integrated in Build" set when Ready to Test and cleared on reopen (ALERT-7, ALERT-11); completion with open predecessors agreed with their owners (COMPLETE-1); blocking tags other than `Requirements` (COMPLETE-2); build notes as one file per feature (BUILDNOTES-\*); develop must stay green (BASE-CI-\*); review wait counted from publication in working time (REVIEW-REQ-6); rejected / waiting-for-author PRs are never ready (PR-WARN-1, PR-WARN-2); retarget after a squash-merged base (PR-WARN-10).

## When a new revision of DEVELOPMENT_APPROACH.md arrives

1. Replace the reference copy (keep the conversion notes and the review comments format) and note the new revision and date at the top of this file.
2. Compare it with the previous revision (`git diff` of `docs/DEVELOPMENT_APPROACH.md`) and, for each changed rule, update its row here; new rules get new `DA-<n>` ids.
3. Check the impact on RULES.md / DECISIONS.md: a changed team rule means a changed `Rule <ID>` (row, code comment and test in the same change).
4. Look again at the ⏳, 🕓, ⏸ and ❔ rows: the new revision may answer them.
