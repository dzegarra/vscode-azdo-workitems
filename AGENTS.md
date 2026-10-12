# Totalflow X devtools for Azure DevOps — guide for developers and AI agents

VS Code extension (ID `abb-totalflowx.vscode-azdo-workitems`, display name "Totalflow X devtools for Azure Devops") that brings the team's Azure DevOps work into the editor: work items of the current sprints, branches, pull requests, reviews, CI runs, dependencies, and the team rules (alerts, warnings).

- What it does, for users: [README.md](README.md).
- Why things are the way they are: [docs/DECISIONS.md](docs/DECISIONS.md). **Read it before changing behaviour.**
- What we learned about the Azure DevOps REST API (verified on our organization): [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md).

## Context

- Organization `ABB-PAMA-BVL`, project `Flow Digital Architecture`, main repository `User_Interface` (others exist, e.g. `Common_Translations`, `Communication-Interface`). Organization / project / repository are detected from the `origin` remote; settings can override them.
- The team works in Scrum, 2-week sprints, several teams in parallel (Platform, Measurement Apps, Interface Apps, Automation Apps, UX…). Iterations are `<Project>\<Release>\<Sprint>`, e.g. `Flow Digital Architecture\MVP R3\Platform Sprint 122`.
- Team rules enforced by the extension are listed in [docs/DECISIONS.md](docs/DECISIONS.md#team-rules).
- Today the project lives in an Nx monorepo (`tools/vscode-azdo-workitems`); it may move to its own repository. Keep everything it needs inside this folder.

## Commands

From the monorepo root (prefix Nx with the package manager):

```sh
npm exec nx -- run-many -p vscode-azdo-workitems -t typecheck,test,build,lint   # must pass, 0 lint errors (warnings tolerated)
npm exec nx -- run vscode-azdo-workitems:package                                  # builds vscode-azdo-workitems-0.1.0.vsix
npx prettier --write tools/vscode-azdo-workitems/src tools/vscode-azdo-workitems/media
```

- Targets (`project.json`): `build` (esbuild, 3 bundles: `dist/extension.js` for Node, `dist/webview.js` for the sidebar, `dist/dependencies.js` for the dependency map), `watch`, `typecheck` (`tsc --noEmit`), `test` (vitest, `vitest.config.mts`), `package` (`vsce package --no-dependencies …`). `lint` comes from the monorepo's `@nx/eslint` plugin: if the project moves out, bring an ESLint config with the same rules (see Conventions).
- Debug: launch configuration **Run Azure Work Items Extension** (F5) in the monorepo's `.vscode/launch.json` (`--extensionDevelopmentPath=${workspaceFolder}/tools/vscode-azdo-workitems`).
- Install: `code --install-extension tools/vscode-azdo-workitems/vscode-azdo-workitems-0.1.0.vsix`, then reload the window.

## Architecture

```
src/extension.ts          activation: creates the store, watchers, views, status bar items; registers commands
src/repositoryGate.ts     startup gate (whenRepositoryReady on the store): await it before resolveContext in anything that can run at startup
src/azdoClient.ts         REST client (fetch + bearer token from the VS Code Microsoft sign-in, src/auth.ts)
src/requestRecorder.ts    the ONLY place that calls fetch: records every request (src/requestStats.ts, src/diagnostics.ts)
src/requestContext.ts     AsyncLocalStorage "feature" attribution of requests (withFeature)
src/pullRequestTasks.ts    pure rules of the PR tasks (reusable tasks, which move on publish / completion, branch of a task row)
src/taskMenu.ts            pure: the pill of a task row (branches + PRs) and the actions menu behind it
src/workItemsStore.ts     work items of the current sprints + branches, PRs, CI runs, alerts, dependencies, worktrees
src/*Watcher.ts           pollers: reviewRequestsWatcher (PRs to review), myPullRequestsWatcher (my PRs),
                          pipelineWatcher (CI runs, via src/runsPolling.ts), pullRequestNotifier (events on my PRs)
src/summaryView.ts        native "Summary" tree view; owns the activity bar badge (rows/badge logic, pure: src/summaryRows.ts)
src/workItemsView.ts      sidebar webview provider: builds the ViewModel (src/viewModel.ts) and handles messages
src/webview/main.ts       sidebar webview (cards, PR boxes, filters); src/webview/dependencies.ts: dependency map
src/workItemDetails.ts    Work Item Details panel (one editor tab per work item); HTML in src/detailsHtml.ts
src/dependencyMap.ts      dependency map panel; graph/layout in src/dependencyGraph.ts, iteration model in src/schedule.ts
src/commands/*.ts         user flows (create branch / PR, checkout + worktrees, delete branch, publish, retarget, …); base branch rules: src/baseBranch.ts (pure)
src/*StatusBar.ts         status bar items (CI runs, reviews, current work item)
media/*.css               styles of the webviews (webview.css shared by the sidebar and the details panel)
```

- **Pure modules** (no `vscode` import) hold the logic and have a `*.test.ts` next to them: naming, alerts, reviews, PR shaping (`myPullRequests.ts`, `reviewCard.ts`, `prCompactSignals.ts`), timeline, coverage, runs, worktrees, schedule/graph, build notes, branches, working-on, fix links… The `vscode`-facing files are thin wrappers. Keep it that way: new logic goes into a pure module with tests.
- The webviews receive a serialisable model (`ViewModel`, `DependencyMapUpdate`) and post back typed messages (`WebviewMessage`); the extension does all Azure DevOps and git work.
- State: settings (`totalflowx.*`, user-level for personal choices like filters/layouts), `context.globalState` (notification baselines, coverage records — keys are internal, some keep the old `azdoWorkItems.` prefix on purpose), webview `getState/setState` (UI-only: collapsed boxes, expanded cards).

## Conventions (follow them; reviews check them)

- **Strict webview CSP**: no inline `style="…"`, no inline event handlers. Dynamic sizes/positions are set through CSSOM after rendering (`data-box` + `applyBoxes`, `sizeReviewBars`, `data-elapsed`/`data-progress`). `src/webview/csp.test.ts` fails on inline styles. The details panel allows `'unsafe-inline'` styles and `img-src https: data:` only because it embeds work item rich text.
- **Pure logic + tests**: vitest; in new test files import `describe/it/expect/vi` explicitly from `vitest` (globals will be disabled).
- **Lint rules that bite**: `no-use-before-define` (define functions before using them), switch exhaustiveness, no nested ternaries, max-statements (extract helpers). Magic-number warnings are tolerated.
- **Naming**: settings and commands are `totalflowx.*` (declare them in `package.json`; read them through `SECTION` in `src/config.ts`); command category "Totalflow X". User-facing name of the per-work-item tab: **Work Item Details panel**.
- **Requests**: always through `AzdoClient` → `recordedFetch`. Wrap new entry points (pollers, panels, commands) in `withFeature(...)` so the usage report attributes them. Keep the request budget low (batch, cache by immutable keys such as build id or last pushed commit; never poll faster than needed).
- **Theme-friendly colours**: use VS Code theme variables and the tokens of `media/webview.css`; check dark and light. Solid pills with fixed colour pairs (priority, due soon) are deliberate for contrast.
- **Documentation**: user-visible changes update [README.md](README.md); decisions with a "why" go to [docs/DECISIONS.md](docs/DECISIONS.md); new API findings to [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md).

## Verifying changes

1. `typecheck,test,build,lint` (above) and `package`.
2. **Rendering**: the webviews can be rendered without VS Code. Build, then load `dist/webview.js` (or `dist/dependencies.js`) and `media/*.css` in a static HTML page with the same CSP meta, a stub of `acquireVsCodeApi` (records `postMessage`), CSS variables for the VS Code theme tokens, and a script that posts a `{ type: 'state', model }` (or `{ type: 'graph', graph }`) message. Drive it with Playwright (installed in the monorepo) in dark and light, at 260–340 px for the sidebar, and look at the screenshots.
3. **Real data, read-only**: `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798 --url "<GET url>"` (the Azure DevOps resource id), or an Azure DevOps MCP server's read tools. Bundle the pure modules with esbuild into a small Node script to run them on real responses.
4. Things that need a real VS Code (dialogs, QuickPicks, notifications, status bar, git API calls, new windows) must be tried with F5 or the installed `.vsix` before calling a feature done.

## Keeping these documents current

These files are the project's memory: conversations with AI agents are not shared, so anything not written here is lost. **Agents and developers must update them as part of the same change**, not later:

- [README.md](README.md): every user-visible change (features, settings, commands, texts).
- [docs/DECISIONS.md](docs/DECISIONS.md): every decision with a "why" (a team rule, a trade-off, something that looks like a bug but is intended). Correct or remove entries that the change makes wrong.
- [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md): every new or corrected fact about the API (endpoints, versions, quirks), only once verified.
- This file (AGENTS.md): when the architecture, commands, conventions, verification steps or safety rules change, or when a convention turns out to be missing.

Before finishing a task, check that these four files still describe the code; say in the summary of the change which ones were updated.

## Safety rules (for humans and agents)

- When testing, **never write to Azure DevOps** (no POST/PATCH/PUT/DELETE): only GET requests. Write paths (publish PR, add tag, delete branch, update work items) are tested with stubs.
- **Never create/delete branches, worktrees or stashes, never push, in the real repository** while testing git flows: use a throwaway repository (bare origin + clone) in a temp folder.
- Never print, log or store tokens; the request log records only method, shortened URL, status, duration, feature and rate-limit headers.
- Do not commit unless asked; end commit messages with the reason of the change.
