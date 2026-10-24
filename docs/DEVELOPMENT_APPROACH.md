# Release 3 Development Approach

*Operating Playbook for Teams and Team Leads*

> (prepared 2026-06-12 by the document owner, status Approved, security level Internal, rev. AB of 2026-10-01; file last modified 2026-10-24).
> The text is kept as written, typos included; only the layout was converted. Section numbers are added in the headings because the
> The figures (git diagrams, Azure DevOps screenshots) are replaced by text versions marked *Figure (text version)*; screenshots that added nothing to the text were dropped. The reviewers'
> comments of the Word file are kept as footnotes at the end, with the names of the people redacted (replaced by roles or labels) ([Review comments](#review-comments-in-the-document)): some of them
> clarify the rules. Remarks added during the conversion are marked **[Conversion note]**.
>
> This is the team's source document. The rules implemented by the extension are in [RULES.md](RULES.md) and
> [DECISIONS.md](DECISIONS.md#team-rules); they were partly based on this document and partly added on our own.

## 1. Purpose and Basic Description

This document defines the operating approach for ProductName X(TM) Release 3. It explains:

- How we plan and execute work.
- What is expected from developers and team leads.
- How we keep delivery predictable and visible.
- What changes from previous releases and why.

This is a high-level guide. It does not define implementation details for any team. It applies universally across all teams in the project.

## 2. Audience

- Platform Team
- Measurement Applications Team
- Automation Applications Team
- Interface Applications Team
- UI contributors within development teams (UI Team)
- Product Team
- UX Team
- Dev Test Team
- System Test Team
- Management

## 3. Release 3 Delivery Dates

The table below provides the Feature Complete dates for the teams based on the current backlog size:

| **Team** | **Completion Date** |
|---|---|
| Platform | 3/22/2027 |
| Automation | 1/25/2027 |
| Interfaces | 1/18/2027 |
| Measurement | 11/16/2026 |

## 4. Context: Release 3 Is Different

Releases 1 and 2 (MVP1 and MVP2) were engineering releases distributed to trusted customers. Release 3 is the first sellable release. The bar for quality, predictability, and discipline is higher.

Following Release 2 retrospective and project-wide review, we identified issues in planning, execution tracking, team communication, and delivery discipline. The changes described below directly address those issues.

## 5. Principles

When in doubt, refer to these principles. They define the expected mindset for all team members in Release 3.

1. **Deliver first, refine later.** The primary job is closing backlog items. Working code with tests is the goal. Perfection is not required — "good enough" ships.
1. **Burn story points every sprint.** Progress is measured by completed work. If you are not closing items, something needs to change. Raise it with your Team Lead.
1. **Do what was asked — nothing more.** The scope of a backlog item is the scope of the work. Additional ideas, refactoring, or improvements require Team Lead approval before starting.
1. **Simple beats clever.** Use well-known patterns. Write code others can understand and maintain. Custom architecture is not a sign of quality — it is a risk.
1. **Blocked means switch, not wait.** If you cannot move forward, inform the Team Lead and move to the next ready item. Do not spend days thinking about a problem that requires external input.
1. **Bugs are prioritized, not chased.** When you find a bug, report it. The Team Lead decides when and by whom it gets fixed. Do not interrupt your current work to fix bugs unless instructed.
1. **Ask early, not late.** If something is unclear — scope, design, priority — ask immediately. Spending days on the wrong interpretation is more expensive than a five-minute conversation.
1. **Track your work honestly.** Backlog state must reflect reality at all times. If effort changes, talk with the team lead. If work is incomplete, stretch it properly. No hidden work, no silent delays.

## 6. Release Model Overview

Release 3 uses two connected phases.

**Phase A — Definition and Planning (Waterfall-like)**

- Product Team creates MRDs (Marketing Requirements Documents) per feature.
- MRDs are reviewed and approved by development, test, and management.
- UX begins mockup work in parallel with TRS creation.
- Developers and Team Leads write TRS (Technical Requirement Specifications) with unique requirement IDs.
- Developers and Team Leads create a Traceability Matrix that maps MRD requirements to TRS requirements.
- Developers, Team Leads and the Procut Teams review and approve TRS and Traceability Matrix.
- Backlog items (Epics, Features, Items) are created from approved TRS requirements.
- Backlog items are estimated using story points per the Execution Model.
- Historical velocity and planned scope-creep reserve are used to forecast the delivery date.
- Management approves the release baseline and target date.

*Note: Development of well-understood features may start before all approvals are finalized.*

**Phase B — Sprint Execution (Agile)**

- Teams plan in detail only 2–3 sprints ahead.
- Teams prioritize work that is ready now, aiming to deliver complete features as early as possible.
- If blocked by a dependency, developers park the work and switch to another ready item (after consultation with the Team Lead).
- Standard flow: branch → development → test → PR → review → merge.
- Finished items are closed at sprint end. Unfinished items are explicitly split with remaining effort and reason.
- Demo/review feedback is accepted as controlled scope input.
- Retrospective takes place every second sprint.[^c11][^c12]

## 7. Creating Backlog Items

### 7.1. From TRS Documents

When TRS documents are approved, break down requirements into backlog items using the structure below.

**Step 1-Identify an Epic**

An Epic represents a significant portion of work that:

- Can be broken down into one or more Features.
- Will take more than a single sprint to deliver.

Examples: *Tag Library [Release 3], Save and Restore [Release 3], Trend and Batch Application [Release 3].*

**Step 2-Identify a Feature**

A Feature is a chunk of work within an Epic that:

- Focuses on a distinct portion of the work.
- Represents testable, value-adding functionality.

Examples: *Tag User Defined Structure [Release 3], Tag Array [Release 3], LDAP [Release 3].*

**Step 3-Create Backlog Items**

Create one or more Backlog Items per TRS requirement. A single Backlog Item may cover multiple requirements if they are closely related.

| **Field** | **Rule** |
|---|---|
| **Title** | Short, informative, newspaper headline-style. Use a prefix to identify the part of the system. Examples: *[Platform] Dashboard Layout Persistence*, *[Platform] Hybrid Authentication Strategy*, *[Platform UI] Filtering for Tags*. |
| **Description** | Standard format: [WHO] + [WHAT] + [WHY].<br>Additional details, like technical description, can be included but are not necessary. UI Mockups are necessary for the UI backlog items. |
| **Acceptance Criteria** | Add if known. May be left empty if a design step is required first. |
| **Effort (Story Points)** | Use the scale: 1, 2, 3, 5, 8, 13, 21. Estimate based on comparable past items. Assign a challenging estimate — do not add buffer, this is handled at team level. |
| **Effort In Days** | Provide an estimate in days alongside story points. |
| **Requirement Reference** | Add the TRS requirement number and title as a comment. |
| **Iteration** | Set to Flow Digital Architecture\MVP R3. |
| **State** | Leave set to *New*. |

**Step 4-Update Traceability Matrix**

After creating Backlog Items from TRS requirements, update the Traceability Matrix to map TRS requirements to the corresponding Backlog Items.

### 7.2. From Feedback, Refinement, and Investigations

Backlog items created after the TRS stage — resulting from demo feedback, customer input, refinement, or technical investigations — follow the same rules as above with these differences:

- **Use existing Epics**. Do not create new Epics. New Features may be added under existing Epics if necessary.
- **Traceability Matrix does not need to be updated**. These items are outside the original TRS scope.
- **Team Lead consultation is required** before creating any new item (refer to the Scope Creep Policy).
- **Tag appropriately**. These items are scope creep and must be classified per the categories in the Scope Creep Policy.

## 8. Git Strategies

We are continuing to follow the already established practices and rules when working with the code repository.

### 8.1. Branching Strategy

#### 8.1.1. Overview

In short:

- Feature branches are created from the Develop branch.
- Feature branches are merged to the Develop branch when work is done - **Squash Merge Type**
- A Release branch is created from the Develop branch when all features for the release are implemented.
- When a release is approved, the Release branch is merged to the Main [^c20][^c21]branch, and a new tag is created - **Merge (no fast forward) Merge Type**

**[Conversion note]** The figures of the scenarios below and section 8.2.6 say that the Release branch is merged to Main (and Main back to Develop) with **Rebase and fast-forward**, not "Merge (no fast forward)" as written here.

Different types[^c22][^c23] of branches can exist in our approach:

| Type | Description | Comment |
|---|---|---|
| Main | This is the main branch. It holds the current **Production Ready** code (**current release**). Multiple tags point to different officially released versions of the source code. | The branch is protected (Locked). Merge only through a merge request. |
| Release-x | This branch type represents the **Feature Ready** state of the source code before it is released (**next release**). It is a parking spot that allows for finishing release activities while still being able to work on the future release at the same time on the Develop branch. | The branch is protected (Locked). Merge only through a merge request. |
| Develop | This branch holds **the current state of the work** done for the next or future release. From the develop branch feature, branches are created. Feature branches are merged into the Develop branch after the work is done. | The branch is protected (Locked). Merge only through a merge request. |
| Feature-x | This branch type is used to work on a feature (single feature or multiple that are being done simultaneously). The feature should be merged to develop when work is done, but it is also acceptable to merge multiple feature branches into one "stacked" branch before merging everything to develop. |  |
| Hotfix-x/ | This type of branch is used when a bug fix is required to be done after the source code is officially released. | The branch is protected (Locked). Merge only through a merge request. |

##### Locked Branches

When a branch is Locked, push cannot be done for a dev machine.

*Figure (text version):* in the Azure DevOps branch list, `develop` (Default), `main` and `release-1.0` show a lock icon.

#### 8.1.2. Scenarios

##### Scenario-1: Multiple feature branches are used during the Sprint

This is the most common scenario we will handle every Sprint. Each User Story taken into the Sprint should have a separate Feature branch. However, this is not a strong requirement, and sometimes, it is much easier to have a single branch handle a few short User Stories.

After work on the Feature-x branch is done, the branch must be merged into the Develop branch. The following rules should be applied:

- Before merging the Feature-x branch to the Develop branch (with a PR), first, the Develop branch must be merged into the Feture-x branch.  At this point, all possible conflicts must be resolved, Unit Tests should be run, and the source code has to build without errors.
- As the Develop branch is locked (merge from the dev machine is blocked), a Pull Request (Merge Request) should be created using the Azure DevOps portal. This request must be approved by at least one other team member.
- Feature branches can be stacked on one "stacked" branch before merging with the Develop branch (risky as if issues are found caused by one of the stories existing on the stacked branch, nothing can be merged)

In the figures of the scenarios below, `A -> B` is a merge of A into B and *PR* marks a Pull Request commit.

*Figure (text version):*

```text
Main     o──────────────────────────────────────► o ─► o [TAG v1.0] ─┐
Release                                 ┌► o ─► o ┘                  │
Develop  o ─────► PR ───────────► PR ───┴─────────────────────────► o ─► o
Feature 1   └► o ─► o ┘            ▲
Feature 2   └► o ─► o ─► o ──► o ──┘
                             ▲ develop merged into Feature 2 first
```

- Feature branches are created from Develop.
- Feature -> Develop: **Squash** (one PR commit on Develop).
- Develop -> Feature (to update it before its PR): **any merge type**.
- Release is **created from** Develop.
- Release -> Main: **Rebase and Fast Forward**; the tag (v1.0) is put on Main.
- Main -> Develop afterwards: **Rebase and Fast Forward**.

*Figure (text version):* the same, with a third Feature branch:

- Feature 3 -> Feature 2: **any merge type**; Feature 2 becomes a *stacked branch*.
- Develop -> Feature 2: **any merge type**.
- Stacked branch (Feature 2) -> Develop: **Squash**.
- Release and Main as above (Rebase and Fast Forward).

##### Scenario-2: A Feature Ready state is achieved for the next release, and at the same time, work is started on features for the future release.

This scenario is common when a new official version of the source code is about to be released. New features will not be added to the source code (Feature Ready state), but additional release activities may be needed (fixes, docs, 3rd party package updates).

In this case, a new branch for the next release x is created from the current state of the Develop branch. If additional release activities are required, they will be performed on the feature branches created from the Release-x branch. Develop branch can switch its focus to a future release. After approval for release is obtained, the Release-x branch is merged to both the Main branch (a new tag is created to point to the new version) and the Develop branch.

*Figure (text version):*

- Release is **created from** Develop; Develop keeps receiving Feature PRs (Squash) for the future release.
- A Feature branch is **created from the Release** branch (release fixes, docs, package updates).
- That Feature -> Release: **Squash** (PR commit on Release).
- Release -> Main: **Rebase and Fast Forward**.
- Main -> Develop: **Rebase and Fast Forward**.

##### Scenario-3: A bug was found after release and must be fixed.

This scenario is rare, but in case a bug fix for released code is required, it should be handled by creating a Hotfix branch (Patch branch) where necessary code changes should be made. After the work is done, the Hotfix branch must be merged into both the Main branch (a new tag is created to point to the new version) and the Develop branch.

*Figure (text version):*

- Main has tag v1.0. A Hotfix branch is **created from** Main.
- A Feature branch is **created from** Hotfix; Feature -> Hotfix: **Squash** (PR commit on Hotfix).
- Hotfix -> Main: **Rebase and Fast Forward** (the figure's label says "Release branch"); new tag **v1.1** on Main.
- Main -> Develop: **Rebase and Fast Forward**.

#### 8.1.3. Branch Naming Convention

##### Overview

The branch naming convention is used to organize and standardize the naming of repository branches depending on their purpose.

Allowed branch names and examples:

Hyphens (-) must be used to separate words.

- `main`
  - *Note: There should be one, and only one, main branch*
- `develop*`
  - `develop`
  - `develop-bug-test`
  - `develop-new-repo-structure`
  - *Note: Additional develop branches may only exist under special circumstances*
- `feature /[module|license|system|persistent|nonpersistent|communication|adaptercpp|adaptercpp|admin|docs|stacked]/*`
  - `feature/module/1118-create-app`
  - `feature/license/3432-license-check`
  - `feature/stacked/create-and-delete-app`
  - *Note: The ID of a user story should always be added to the branch name when story exists in the backlog*
- `anomaly/*`
  - `anomaly/mem-leak-fix`
  - `anomaly/3211-missing-object-property`
  - *Note: This is a kind of feature branch*
- `devops/*`
  - `devops/build-scripts-update`
  - `devops/added-config`
  - *Note: This is a kind of feature branch*
- `release-*`
  - `release-1`
  - `release-1.0`
  - `release-1.1`

**[Conversion note]** The list above says `adaptercpp|adaptercpp` (as in the Word file); the regular expression below says `adapterjs|adaptercpp`.

##### Regular expression

```regex
^(((develop*)|(feature\/(module|license|system|persistent|nonpersistent|communication|adapterjs|adaptercpp|admin|docs|stacked)\/)|(anomaly\/)|(devops\/))[a-z0-9]+(-([a-z0-9]+))*$)|((release\-)[0-9]+(\.([0-9]+))*)|(main)$
```

##### Creating a new branch

When a new branch is created, Backlog Items should be assigned to it.

*Figure (text version):* Azure DevOps "Create a branch" dialog: Name `feature/module/1118-create-app`, Based on `develop`, Work items to link: the backlog item (1 linked).

### 8.2. Pull Requests

#### 8.2.1. Creating a Pull Request for a feature branch

Rules that should be followed when creating a Pull Request:

- Title
  - Must clearly indicate what this PR is for
  - Name for the PR should follow the pattern:

    `[<<backlog-item-number>>] <<feature or manager name>>: <<name of the pull request>>`

    Examples:
    - *[1118] Module Manager: command create_app*
    - *[1118, 2343, 2345] Module Manager: commands create_app, delete_app, get_status*
- Description
  - Should indicate what was done for the User Story that will be merged with this PR
- Reviewers
  - Optional reviewers: the whole team should be added
  - Required: **two reviewers must be added**
- Work items to link
  - Related items from the backlog must be added
- Tags
  - Checkpoint tag must be added

#### 8.2.2. Published Pull Request vs. Draft Pull Request

Draft PRs have the following differences from published PRs:

- Build validation policies don't run automatically. You can queue build validations manually by selecting the more options menu in the PR.
- Voting is disabled while in draft mode.
- Required reviewers aren't automatically added. Notifications are sent only to reviewers you add to the draft PR.
- Draft PRs display in the PR list with a Draft badge.

Rules that should be followed when creating a Published PR and Draft PR:

- When the User Story is still being worked on (testing is still ongoing, and features are still to be added) but the current state is enough to start a code review, a Draft PR should be created
  - When work is done, Draft PR must be Published
- When all the work on the User Story is done at the time the PR is created, a Published PR should be created.

*Figure (text version):* Azure DevOps "New pull request" form, `feature/module/1118-create-app` into `develop`:

- Title: `[1118] Command - create_app`
- Description (PR template):

  ```markdown
  Before submitting this PR into the default branch, please make sure:

  - [ ] Assumption of User Story are met
  - [ ] New Unit Tests are written and passing
  - [ ] Existing Unit Tests are passing
  - [ ] Code review was performed and approved
  - [ ] Project builds without errors
  - [ ] Reference design and documentation was updated
  - [ ] Static analysis was done
  ```

- Optional reviewers, Required reviewers, Work items to link (the backlog item), Tags (empty in the example).

#### 8.2.3. Reviewing a Pull Request

Rules that should be followed when reviewing a PR

- Comments can be added by all team members
- All comments must be resolved before a PR can be marked as Completed (this is enforced by the branch policy)
- Required reviewers must Approve PR before it can be marked as Completed (this is enforced by the branch policy)
- PR should be Completed by the Author

#### 8.2.4. Adding comments to the PR

Comments can be added on the main page for the PR or in files. All added comments are visible on the main page.

#### 8.2.5. Completing a Pull Request for a feature branch

Rules that should be followed when completing a PR for a feature branch

- Merge type - should be set to Squash commits

*A single commit from the branch will be created on the develop branch*

- Associated work items should be completed
- Feature branch should be deleted
- Merge commit message should not be changed if PR was set properly

*Figure (text version):* Azure DevOps "Complete pull request" dialog:

- Merge type: **Squash commit**
- [x] Complete associated work items after merging
- [x] Delete `feature/module/1118-create-app` after merging
- [x] Customize merge commit message: `Merged PR 5: [1118] Command - create_app`, followed by the description with the checklist ticked (`- [X] ...`) and `Related work items: #4`.

Example of linear commit history on the target branch after PR is completed:

Example branch ***feature/module/1118-create-app*** with three commits added:

*Note: commit "Added README.md: existed on the parent branch*

*Figure (text version):* history of `develop` after the PR: `Merged PR 5: [1118] Command - create_app` directly on top of `Added README.md`, a single linear line (the three feature commits are not there).

Note: Even though all the commits from the feature branch were squashed into a single commit on the develop branch, the information about all the original commits is preserved in the PR details:

#### 8.2.6. Creating a Pull Request for a release branch

Creating a PR for a release branch is mostly the same as in case of the feature branch. The difference is in the **Merge Type** that should be done when PR is completed. Rules that should be followed when completing a PR for a release branch:

- **Merge type** - should be set to **Rebase and fast-forward**

*Commit history from the release branch will be preserved as it is. This is the desired behavior in this case, as the release branch, which was created from the develop branch, will have a linear commit history created by the PRs done with Squash Merges.*

- Associated work items should be completed
- Merge commit message should not be changed if PR was set properly.

*Figure (text version):* "Complete pull request" dialog: Merge type **Rebase and fast-forward**; [x] Complete associated work items after merging; "Delete main after merging" disabled; info "Rebase uses existing messages from commits".

Example of non-linear commit history on the target branch after PR is completed:

*Figure (text version):* commits of `main`: `Merged PR 7: [0000] Release - 1.0` on top of `Merged PR 5: [1118] Command - create_app` and `Added README.md`; the graph shows two lines (not linear). The release PR title is `[0000] Release - 1.0`.

## 9. Key Changes from Previous Releases

### 9.1. No Per-Feature Delivery Dates

We no longer commit delivery dates for individual features to the business. Instead:

- We commit a release delivery date for the project.
- During Business Update meetings we report percentage completion per feature and overall release progress per team.
- Completing a feature is a goal managed by the Team Lead and the team internally.

This allows teams to choose the most effective order of work during sprints without being locked to a sequence dictated by feature-level dates.

### 9.2. Short Planning Horizon

Detailed sprint planning covers only 2–3 sprints ahead. This gives teams better visibility into available capacity (especially where developers are shared) and avoids wasted planning effort for distant sprints that inevitably change.

### 9.3. Monthly Goals

At the beginning of each month, Team Leads define high-level monthly goals for their team. At the end of the month, results are shared with the business.

**Purpose:**

- Give the business a heads-up on what each team plans to accomplish in the near term.
- Provide small, visible wins that demonstrate steady progress.
- Help teams focus on the most important work for that period.

**Rules:**

- Monthly goals typically reflect features the team aims to deliver, but the Team Lead decides what is appropriate.
- Monthly goals are not commitments with penalties — they are directional targets.
- Results are reported honestly: achieved, partially achieved, or deferred (with reason).

### 9.4. Park and Switch on Blocked Work

If a dependency or blocker prevents progress on a backlog item, the developer must:

- Inform the Team Lead.
- Park the item (status and reason tracked in the backlog).
- Switch to another ready item from the team's backlog.

The Team Lead is responsible for tracking parked items and driving dependency resolution. When the blocker is cleared, the developer returns to the original item.

**Important:** The decision to park and switch is always made in consultation with the Team Lead. Developers do not independently decide to change focus.

### 9.5. Stricter Backlog Discipline

- Developers do not create new backlog items without Team Lead consultation.[^c42][^c43]
- Any item added after the release start is classified as scope creep.[^c44][^c45][^c46][^c47]
  - If there is an integration blocker (unplanned) then it should be planned under separate backlog item.
  - If there is a need for rework due to additional feedback, this is also counted as a scope creep.
- Tasks must be created when work on a backlog item starts.
- Items must be closed on time or explicitly stretched with remaining effort and reason (Scope Creep Policy applies).

### 9.6. Delivery Monitoring

We are introducing monitoring tools that use Azure DevOps data to detect delivery drift early. These tools are in development and will be gradually introduced in the upcoming weeks.

Tracked signals will include:

- Backlog item aging and stretch frequency.
- Pull Request open duration.
- Sprint closure and carry-over trends.
- Bug inflow versus closure.
- Allocation pressure for shared developers.
- Feature completion trend.
- Individual velocity across teams.

**Fair-use principle:** Metrics are used for improvement, planning correction, and coaching. They are not for punitive ranking. Trends and context matter more than individual outliers.

### 9.7. AI Tools

Approved AI tools will be used in Release 3 to increase development velocity. The expectation is that AI assistance will result in more story points closed per sprint and fewer bugs introduced. A separate document provides details on the tools evaluated and their expected use.

### 9.8. Meeting Discipline

- Daily standups are limited to 15 minutes.
- All recurring meetings will be reviewed; unnecessary ones will be removed.
- Bug triage and planning meetings must be prepared by the Team Lead before the meeting.
- Direct developer-to-developer communication[^c51][^c52] is encouraged for implementation discussions instead of scheduling meetings for the entire team.
  - The discussion results should be documented (meeting notes, bullet points, etc.) and shared on relevant teams channel, email, document or in the backlog item.

### 9.9. UI Work Without Final Mockups

UI work must not stop completely while waiting for final UX mockups.

Release 3 rule:

- If the requirement intent is clear, teams begin staged UI implementation.
- Finalize UI details when mockups are delivered.
- UX and UI maintain tight communication to minimize rework.

### 9.10. Backward compatibility

Backward compatibility is not a priority for the Release 3. If breaking changes need to be introduced developers can make the decision on their own. The change needs to be communicated to the Platform Team to increase the minor version of the Image.

## 10. Developer Responsibilities

**Before Starting a Backlog Item**

- Confirm scope and acceptance criteria.
- Confirm dependencies and known risks.
- Determine whether an architectural discussion with the Team Lead or System Lead is needed.
- Create tasks under the backlog item.

**During Execution**

- Keep status, tasks, and effort updated in the backlog daily.
- Escalate blockers quickly — do not wait for the next standup.
- Do not add work beyond the item scope without Team Lead approval (refactoring requires approval).
- Keep PRs small and moving. Do not let branches stay open longer than necessary.

**Pull Request Rules**

- Every PR must have **two required reviewers**. Additional optional reviewers may be added.
- Every PR must be **linked to a backlog item**.
- **Required reviewers are responsible for verifying that the acceptance criteria of the backlog item/ bugare met.**
- **Reviewers must review promptly** — the next working day is the maximum acceptable delay. Do not block your colleagues' merges.
- **Review for correctness and sufficient quality**, not perfection. The goal is code that works, is tested, and is maintainable. Gold-plating during review is not acceptable.

**Before Marking Complete**

- Implementation is finished.
- Unit tests and functional/end-to-end tests are included and passing.
- Build Notes comments are added.
- PR is reviewed and merged.
- Backlog item state reflects reality.

**Rules That Apply at All Times**

| **Rule** | **Rationale** |
|---|---|
| No new backlog items without Team Lead consultation | Controls scope creep |
| No custom architecture without Team Lead + System Lead approval | Ensures maintainability and simplicity |
| No "done" without tests | Maintains quality for a sellable release |
| No hidden carry-over — stretch must be explicit | Keeps planning honest |
| "Good enough" is good enough — no gold-plating | Prevents uncontrolled rework and scope creep |
| Park-and-switch only after Team Lead consultation | Ensures tracking and priority alignment |

## 11. Team Lead Responsibilities

**Every Sprint**

- Plan only 2–3 sprints ahead.
- Protect developer focus — minimize unnecessary context switching for shared developers.[^c57][^c58]
- Drive delivery of complete features where possible.
- Prepare planning and bug triage meetings[^c61][^c62] in advance.[^c59][^c60]
- Review carry-over, open PR aging, blocked items, and parked work.
- Ensure stretched items are properly split and the reason is known.
- One-on-one conversations with developers as needed to discuss issues, plans, and progress.

**Every Business Update**

- Report overall release progress for the team.
- Report percentage completion of epics.[^c63][^c64]
- Report scope creep intake and its impact on delivery confidence.
- Report quality trend [^c65][^c66](bug inflow, closure, reopen rate).
- Report key blockers and risks.

**Ongoing**

- Review monitoring data as tools become available.
- Identify anomalies (velocity drops, excessive carry-over, long-open PRs) and address them through coaching and support.
- Ensure architectural decisions go through proper review.
- Ensure developers understand the purpose and value of their assigned work.

## 12. Addressing Missing Requirements

During implementation, developers will encounter situations where requirements are incomplete or ambiguous. The developer assigned to the backlog item is responsible for identifying these gaps and driving resolution.

### 12.1. Channels

| **Channel** | **When to Use** |
|---|---|
| **Weekly Product Team meeting** | Complex topics that benefit from discussion, where context and the Product Team's vision need to be understood in depth. |
| **Email** | Straightforward questions where a quick written answer is sufficient. |

The developer and the Team Lead decide together which channel is appropriate for each question.

### 12.2. Process for Weekly Meetings

1. The Team Lead adds the question or topic to the dedicated Product Team meeting document.
1. During the meeting, the topic is presented and discussed with the Product Team.
1. The answer is logged in the same document for future reference.
1. The answer is copied to the backlog items (add as a comment).
1. The Team Lead is responsible for maintaining the meeting document and ensuring items are added in advance, so meetings stay efficient.

### 12.3. Process for Email

1. The developer or Team Lead sends the question directly to the Product Team.
1. The answer is documented in the backlog item.

### 12.4. General Rules

- Do not wait silently for answers. If a response is overdue, follow up.
- If the missing requirement blocks progress, apply the park-and-switch rule (Section 7.4). **[Conversion note]** The section is now 9.4, [Park and Switch on Blocked Work](#94-park-and-switch-on-blocked-work); the reference was not updated when sections 7 and 8 were added. Add the **Requirements** tag to the blocked backlog item so it can be tracked and filtered.
- Once the answer is received, update the backlog item description or acceptance criteria if relevant, and remove the Requirements tag.

## 13. Scope Creep Policy

Scope creep is expected and must be visible. It was planned for in the release forecast.

### 13.1. Allowed Categories

- Demo and review feedback.
- Customer feedback.
- Product Team–requested additions.
- Defect-driven work.
- Previously unknown technical work discovered during implementation.

### 13.2. Required Behavior

- Every added item must be classified into one of the categories above.[^c75][^c76][^c77]
- Impact on schedule and delivery confidence must be tracked by the Program Manager and the System Lead.
- Prioritization is by product value and release risk.
- Team Leads are responsible for keeping scope creep within the planned reserve.
- Future backlog items are added to future epics in the backlog.

### 13.3. Effort and Stretch Rules

These rules standardize how effort and stretched items are handled. Follow them exactly.

1. If actual effort is less than planned — do not update the estimate. Leave the original story points as-is. This reduces tracking variables. The resulting velocity increase is expected and intentional.
1. If scope increases for a backlog item — stretch it, even within the same sprint. Copy the existing backlog item, assign the additional scope to the new item, and tag it with the reason. Add prefix **[Stretched]** to the title of the new backlog item. This applies regardless of whether you finish both in the same sprint.
1. If a backlog item is not finished by sprint end — adjust and stretch. Update the original item's effort to reflect what was completed. Create a new item for the next sprint with the remaining effort. Add prefix **[Stretched]** to the title of the new backlog item. Tag with the reason for the stretch.
1. If the scope of the backlog item changed – update the description and the acceptance criteria, document the changes in the comments section of the backlog item and provide justification for the changes. If the scope change extends the effort, create additional liked backlog items to cover the additional effort. Fallow **2**. for creating the backlog item.

### 13.4. Stretch Tags

Use these tags in Azure DevOps to classify every stretched item:

| **Tag** | **Use When** |
|---|---|
| stretch-scope-increase | Scope of the original item grew beyond initial definition |
| stretch-incomplete | Work was not finished within the sprint |
| stretch-dependency | Blocked by an external dependency |
| stretch-feedback | New work from demo/review/customer feedback |
| stretch-defect | Bug or defect discovered that requires additional work |
| stretch-technical-discovery[^c80][^c81] | Previously unknown technical work surfaced during implementation |

Every stretched item must have exactly one stretch tag. If multiple reasons apply, use the primary driver.

### 13.5. Effort and Stretch Examples

**Example 1 — Finished early (Rule 1)**

> A backlog item was estimated at 5 story points. The developer finishes it in less effort than expected.

> **Action:** Close the item as-is with 5 story points. Do not reduce the effort. Velocity for the sprint counts 5 points.

**Example 2 — Scope increase within the same sprint (Rule 2)**

> A backlog item "[Platform] Tag Filtering" is estimated at 3 story points. During implementation the developer discovers that an additional filter type is needed that was not in the original scope.

> **Action:**

1. Complete the original item (3 SP) with the originally defined scope.
1. Create a new item "[Platform] Tag Filtering — Additional Filter Type" with its own estimate (e.g., 2 SP).
1. Tag the new item with stretch-scope-increase.
1. Both items can be completed in the same sprint.

**Example 3 — Not finished by sprint end (Rule 3)**

> A backlog item "[Platform] Dashboard Persistence" is estimated at 5 story points. By sprint end, the developer has completed roughly 3 points worth of work but the item is not done.

> **Action:**

1. Update the original item's effort to 3 SP (reflecting the work actually completed). Close it.
1. Create a new item "[Platform] Dashboard Persistence — Stretch" in the next sprint with 2 SP for the remaining work.
1. Tag the new item with stretch-incomplete.

## 14. Team Health and Communication

The Release 2 retrospective revealed that many team members were reluctant to share feedback openly. This is a delivery risk. People who do not raise concerns early allow problems to grow.

**Actions for Release 3**

- **Retrospective action items** will be tracked and closed visibly.
- **Non-retaliation expectation** is explicit: raising concerns is expected behavior, not a risk.
- **One-on-one conversations** between Team Leads and developers will be used to address issues, discuss plans, and provide support. These are not recurring meetings — they happen as needed.[^c84][^c85]
- **Direct communication** between developers is encouraged. Problems should be discussed and resolved quickly, not deferred to formal meetings.

## 15. Acknowledged Risks Not Fully Addressed in Release 3

The following issues were identified but are not fully resolved by the planned changes. They are acknowledged as areas for future improvement:

| **Risk** | **Current Mitigation** |
|---|---|
| MRD quality and on-time delivery | Feedback during review process; no formal gate added yet |
| TRS author assignment by capability | Acknowledged; future tooling and better assignment planned |
| Developers shared across multiple teams | Monitoring allocation; structural change not possible with current headcount |

## 16. How We Report to the Business

Previous releases used per-feature timeline bars, which were misleading when features had long idle stretches. Release 3 reporting changes to:

| **What We Report** | **How** |
|---|---|
| Release delivery confidence | Percentage and trend |
| Feature completion | Percentage of features fully done per team |
| Scope creep | Categorized intake and impact on delivery |
| Quality | Bug inflow, closure, severity trends |
| Key blockers | Named risks with owners and resolution plans |

## 17. Success Criteria

Release 3 is on track when:

- Delivery confidence remains stable or improves over time.
- Backlog carry-over trend decreases.
- Feature completion progresses steadily.
- Scope creep remains visible and within the planned reserve.
- Quality remains stable through continuous testing, regression, and security checks.
- Teams surface risks earlier and resolve blockers faster.
- Developer engagement in retrospectives and feedback improves.

## 18. Immediate Rollout Actions

This document is approved at leadership level.

- This document is shared with all teams and walked through once.
- Release baseline and scope-creep reserve are defined.
- 2–3 sprint planning horizon begins immediately.
- Monitoring tools are introduced as they become available.
- Anonymous survey process starts before the first sprint retrospective.
- Meeting audit is completed and unnecessary recurring meetings are removed.

## 19. Additional Information

### 19.1. Listing of related documents

*(The table is empty in the document.)*

## 20. Addendum

*(Empty in the document.)*

## 21. Revisions

| Rev. | Page (P) Chapt. (C) | Description | Date Dept./Init. |
|---|---|---|---|
| AA |  | Initial version. | 6/12/2026 [redacted] |
| AB | Git Strategies | Added Git Strategies from the previous release. | 10/1/2026 [redacted] |

---

## Review comments in the document

[^c11]: **Reviewer A** (2026-06-12): Is this retrospective per team?
[^c12]: **Document owner** (2026-06-15): No, let’s continue what we were doing so far. One retrospective for everyone.
[^c20]: **Reviewer A** (2023-03-10): Change this to Main to be consistent with the rest of the document.
[^c21]: **Document owner** (2023-03-30): Updated.
[^c22]: **Reviewer A** (2023-03-10): delete
[^c23]: **Document owner** (2023-03-30): Deleted.
[^c42]: **Reviewer A** (2026-06-12): Should we create PBI’s for bug fixes that require more than a day’s worth of work to fix?  Or do we just continue to do those fixes without PBI/effort?
[^c43]: **Document owner** (2026-06-15): It depends. By default, do the entire work in the scope of the Bug. If the bug is a result of missing feature, then a backlog may be required. The Team Leads can decide. This will be counted as a Scope Creep.
[^c44]: **Reviewer A** (2026-06-12): Are we going to track this with a tag, scope creep?  Or a label in the title?  Or just PBI creation date?
[^c45]: **Document owner** (2026-06-15): This will be tracked using the “Created Date” property from the backlog item.
[^c46]: **Reviewer B** (2026-06-18): If there is an integration blocker (unplanned) then it should be planned under separate feature. Also if we need to rework on something due to additional feedback, it should be counted as scope creep.
[^c47]: **Document owner** (2026-06-18): Updated
[^c51]: **Reviewer B** (2026-06-18): For any such communication b/w 2 or 3 developers, we should create a post of the discussion result and share it with other relevant team members (across team, if applicable) on relevant teams channel.
[^c52]: **Document owner** (2026-06-18): Updated
[^c57]: **Reviewer A** (2026-06-12): Should bugs only be planned and stop the practice of adding bugs to sprints during the sprint?
[^c58]: **Document owner** (2026-06-15): Yes, bugs need to be planned. You still can them to the current sprint if the priority is very high, but the default approach should be planning the work for the future sprints.
[^c61]: **Reviewer B** (2026-06-18): Can we priortize the bug fix while delivering features in case the bug is critical/ high or is blocking another feature? This might cause some developer not to deliver their defined story points.
[^c62]: **Document owner** (2026-06-18): This is up to the Team Leads to decide. If you think the bug is more important, you can do it.
[^c59]: **Reviewer A** (2026-06-12): Should bug triage be via meetings or assigned to developers for investigation in a sprint with understanding that no work other than investigation and guidance for fix added as a comment.
[^c60]: **Document owner** (2026-06-15): Let’s not waist time for investigations that do not result in bug fixes. If bug can be fixed by the developer, it needs to be fixed. If it turns out it belongs to another team, a comment can be left and bug needs to be passed to the correct team. In short: if this is your bug, just fix it.
[^c63]: **Reviewer B** (2026-06-18): The percentage completion is driven from the new tool created by using each feature?
[^c64]: **Document owner** (2026-06-18): I updated to “epics”. We are not showing features there. The tools track the % items completed under the epic.
[^c65]: **Reviewer B** (2026-06-18): Are we planning to create a dashboard for each team to review such data?
[^c66]: **Document owner** (2026-06-18): The thing we the DevOps dashboards is that they are very limited. Let’s not make any commitments to the dashboards today. Maybe we can find a better solution.
[^c75]: **Reviewer A** (2026-06-12): How do we do the classification?  Tag?
[^c76]: **Document owner** (2026-06-15): Yes, I will extend this instruction.
[^c77]: **Document owner** (2026-06-15): Done.
[^c80]: **Reviewer B** (2026-06-18): This tag is also applicable to backlog items discovered during integration phase or only for stretched backlogs?
[^c81]: **Document owner** (2026-06-18): Any kind of backlog item that adds work to the Feature can have this assigned.
[^c84]: **Reviewer B** (2026-06-18): Do we plan to have at least 1 discussion per quarter to ensure that every team member is able to express in 1-1 meetings or we just address everyone to discuss as and when needed?
[^c85]: **Document owner** (2026-06-18): This is up to the Team Leads to decide.
