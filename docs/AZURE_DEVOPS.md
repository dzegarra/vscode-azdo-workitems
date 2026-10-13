# Azure DevOps REST API — what we use and what we learned

Findings verified against our organization (`ABB-PAMA-BVL`, project `Flow Digital Architecture`). API version `7.1` unless noted. All calls go through `AzdoClient` (`src/azdoClient.ts`) → `recordedFetch` (`src/requestRecorder.ts`).

When you use a new endpoint or find that something here is wrong, update this file in the same change (developers and AI agents alike); write down only what you verified.

## Authentication and exploring

- The extension uses the VS Code Microsoft sign-in: `vscode.authentication.getSession('microsoft', ['499b84ac-1321-427f-aa17-267ca6975798/.default'])` (that GUID is the Azure DevOps resource).
- To explore read-only from a terminal: `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798 --url "https://dev.azure.com/ABB-PAMA-BVL/Flow%20Digital%20Architecture/_apis/<path>&api-version=7.1"`. Only GET; never write to production data while testing.
- Signed-in user id: `GET https://dev.azure.com/{org}/_apis/connectionData` → `authenticatedUser.id` (same GUID as reviewers / `System.AssignedTo.id`).

## Work items

- My work items: WIQL `POST wit/wiql` (`[System.AssignedTo] = @Me` and the iteration paths), then `GET wit/workitems?ids=…&$expand=relations` (max 200 ids per call; `fields=` cannot be combined with `$expand`).
- Teams I belong to: `GET {org}/_apis/projects/{project}/teams?$mine=true`; current iteration of a team: `GET {project}/{team}/_apis/work/teamsettings/iterations?$timeframe=current` (404 when none).
- Relations (`src/workItemLinks.ts`): parent/children `System.LinkTypes.Hierarchy-Reverse/Forward`; predecessors/successors `System.LinkTypes.Dependency-Reverse/Forward`; branches `ArtifactLink` `vstfs:///Git/Ref/{projectId}%2F{repoId}%2FGB{branch}`; PRs `vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{prId}`.
- Field names: the form label "Integrated in Build" is the API field "Integration Build" (`Microsoft.VSTS.Build.IntegrationBuild`); `src/alerts.ts` resolves names, form labels and reference names.
- Rich text images are attachments that need the token: the Work Item Details panel downloads them and embeds them as data URIs (only for URLs of the organization).
- Iteration tree with dates: `GET wit/classificationnodes/Iterations?$depth=…` (cached a few minutes). Paths come as `\Project\Iteration\…`; work items use `Project\…`.

## Pull requests

- Reviewed history (verified read-only, org ABB-PAMA-BVL, 2026-10): `git/pullrequests?searchCriteria.reviewerId=<id>&searchCriteria.status=all&$top=N` returns `reviewers[]` with `vote` (10, 5, 0, -5, -10, `hasDeclined`) and, for completed/abandoned PRs, `closedDate`. It is ordered by creation date (newest first) and mixes in the user's own PRs (13 of 50). `$top=50` reached back only ~3 weeks (50 PRs from 2026-09-22), `$top=100` ~11 weeks (since 2026-07-27): 43 of those 100 were reviewed by me (39 completed, 2 active, 2 abandoned), 13 closed in the last 30 days. We use 100; a PR created before the oldest listed one but closed within the window is missed.
- Lists: `git/pullrequests?searchCriteria.creatorId=…` / `searchCriteria.reviewerId=…` (also returns the user's own PRs as reviewer), `searchCriteria.status=active|completed|all`, `$top`.
- **Labels (tags) come only in the list response** (`labels: [{ name, active }]`, absent when none); `GET git/pullrequests/{id}` does not return them.
- `completionOptions` (`deleteSourceBranch`, `transitionWorkItems`, `mergeStrategy`) and `autoCompleteSetBy` (auto-complete on) are in both list and single responses.
- Reviewers: `vote` (10 approved, 5 with suggestions, 0 none, -5 waiting for author, -10 rejected), `isRequired` (absent when false), `isContainer` (groups), `hasDeclined`. The author appears as a reviewer.
- **Policy evaluations** (the "what blocks the merge"): `GET policy/evaluations?artifactId=vstfs:///CodeReview/CodeReviewId/{projectId}/{prId}&api-version=7.1-preview.1` — **plain 7.1 is refused**. Fields: `status` (queued, running, approved, rejected, notApplicable, broken), `configuration.isBlocking`, `configuration.type.displayName` (Minimum number of reviewers, Required reviewers, Comment requirements, Work item linking, Require a merge strategy, Build, Status), `configuration.settings` (`minimumApproverCount`, `creatorVoteCounts`, build `displayName`).
- Linked work items of a PR: `git/repositories/{repo}/pullRequests/{id}/workitems` (ids only).
- Retarget a PR: `PATCH git/repositories/{repo}/pullrequests/{id}` `{ "targetRefName": "refs/heads/develop" }` (unverified: implemented from the API reference, to be confirmed in real use). A branch has a completed PR: `GET …/pullrequests?searchCriteria.sourceRefName=refs/heads/<b>&searchCriteria.status=completed&$top=1`.
- Publish a draft: `PATCH git/repositories/{repo}/pullrequests/{id}` `{ "isDraft": false }`. Add a tag: `POST git/repositories/{repo}/pullRequests/{id}/labels` `{ "name": "…" }`; create with tags: `labels: [{ name }]` in the create body (fallback POST if not echoed).

### Threads (`git/repositories/{repo}/pullRequests/{id}/threads`)

- Text comments: first comment `commentType: 'text'`; deleted comments have `isDeleted: true` and no content. Thread `status`: active, pending, fixed, wontFix, closed, byDesign. **Who changes a status is not recorded.**
- System threads (`properties.CodeReviewThreadType.$value`):
  - `IsDraftUpdate` with `CodeReviewIsDraftNowSet` `"0"` = **published** ("X published the pull request."), `"1"` = back to draft. The latest one with "0" is the publication date.
  - `ReviewersUpdate`: actor `CodeReviewReviewersUpdatedByIdentity`, target `…AddedIdentity` / `…RemovedIdentity` / `…ChangedIdentity` (+ `…ChangedToRequired`), referring to keys of the thread's `identities` map; groups have `isContainer: true`. Self-join: Added = By; decline: Removed = By and content "declined".
  - `VoteUpdate` (`CodeReviewVoteResult`), `RefUpdate` (`CodeReviewRefNewCommitsCount`), `AutoCompleteUpdate`, `StatusUpdate` (completed), `PolicyStatusUpdate` (noise, skipped).
- Link to a thread in the browser: `<PR web URL>?discussionId={threadId}`.

## Git refs and diffs

- **`refs?filter=heads/<branch>` matches by prefix** (`heads/feature/a` also returns `heads/feature/ab`): compare names exactly. Each ref has `objectId` and `creator` (the branch owner).
- Delete a remote branch: `POST git/repositories/{repo}/refs` `[{ name, oldObjectId, newObjectId: "0000…0000" }]` (refused if someone pushed since `oldObjectId`).
- **Did a PR change a file?** `GET git/repositories/{repo}/diffs/commits?baseVersion={lastMergeTargetCommit}&baseVersionType=commit&targetVersion={lastMergeSourceCommit}&targetVersionType=commit&diffCommonCommit=true&$top=2000` → `changes[].item.path`, `allChangesIncluded`. The "commits by itemPath" API gave false positives: do not use it.
- Repository by id: `GET git/repositories/{id}` (names of other repositories, cached).

## Builds, tests, coverage

- PR runs: `build/builds?branchName=refs/pull/{id}/merge&$top=…&queryOrder=queueTimeDescending`; keep the latest per pipeline. Web URL in `_links.web.href`; tests tab: `&view=ms.vss-test-web.build-test-results-tab`.
- Why a run failed: `build/builds/{id}/timeline` → failed `Task` records by `order`; ignore tasks named "Publish…" (publishing hiccups are not the cause).
- Test runs: `test/runs?buildUri=vstfs:///Build/Build/{id}`; failed count from `test/runs/{runId}/statistics` (`unanalyzedTests` is not reliable); failing tests `test/runs/{runId}/results?outcomes=Failed&$top=5` (error messages contain ANSI codes and Storybook boilerplate to strip).
- **Coverage summary lives on another host**: `https://vstmr.dev.azure.com/{org}/{project}/_apis/testresults/codecoverage?buildId={id}&api-version=7.1-preview.1` → `coverageData[].coverageStats` ("Lines": covered/total, `delta` = percentage points vs the previous build of the PR, `isDeltaAvailable`); `coverageDetailedSummaryStatus: noModulesFound` = no coverage. Per file: `test/codecoverage?buildId={id}&flags=7&api-version=7.1-preview.1` (`linesNotCovered` absent when 0). Cache only finalized results.

## Packages

- Azure Artifacts has its own host: `https://feeds.dev.azure.com/{org}/{project}/_apis/packaging/Feeds/{feed}/packages?protocolType=UPack&packageNameQuery=…&includeAllVersions=true` (the name query also matches longer names: compare exactly). Used for "Integrated in Build" (`rmc.image.deploy` in feed `bison_deployimage_rmc`).

## Throttling

- Azure DevOps throttles with HTTP 429 and/or `Retry-After`, `X-RateLimit-Resource`, `X-RateLimit-Delay`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers. The recorder flags them; "Show Azure DevOps Usage" reports requests per feature, per minute, errors and throttling.
