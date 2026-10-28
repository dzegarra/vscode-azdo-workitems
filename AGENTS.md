# Totalflow X devtools for Azure DevOps — guide for developers and AI agents

VS Code extension (ID `abb-totalflowx.vscode-azdo-workitems`, display name "Totalflow X devtools for Azure Devops") that brings the team's Azure DevOps work into the editor: work items of the current sprints, branches, pull requests, reviews, CI runs, dependencies, and the team rules (alerts, warnings).

- **Seven blocks** organize the documentation (README, RULES, DECISIONS) and the design canvas (one page per block, plus an Archive page): 1. General rules (states, stations, PR rules, alerts, actions and flows, the data shared by the Whole team views, look, fun, settings), 2. Sidebar, 3. Work Item Details panel, 4. Track board, 5. Sprint timeline, 6. Dependency map, 7. Status bar & notifications. A rule goes to General rules when more than one view uses it; how a view shows it goes to that view's block. Each view keeps its own Whole team part. The code is not organized by block.
- Design canvas (Claude Design, private to its owner): <https://claude.ai/artifact/DMR5fwa1qJBSPC5p5L8vJL>. Changes start there: see [Design first](#design-first).
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

The full file map (every module, its role and its `Rules` IDs) is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): read the part you need, do not guess file names. The graph tools (`codebase-memory`) also answer structural questions.

- `src/extension.ts` activates everything (store, watchers, views, status bar items, commands); `src/workItemsStore.ts` holds the data; panels and views redraw on store events.
- `src/requestRecorder.ts` is the ONLY place that calls `fetch`; everything else goes through `AzdoClient` (`src/azdoClient.ts`). Anything that can run at startup awaits `whenRepositoryReady` (`src/repositoryGate.ts`) before `resolveContext`.
- **Pure modules** (no `vscode` import) hold the logic and have a `*.test.ts` next to them. The `vscode`-facing files are thin wrappers. Keep it that way: new logic goes into a pure module with tests.
- The webviews (`src/webview/*.ts`, bundled to `dist/*.js`, styles in `media/*.css`) receive a serialisable model (`ViewModel`, `DependencyMapUpdate`) and post back typed messages (`WebviewMessage`); the extension does all Azure DevOps and git work.
- State: settings (`totalflowx.*`, user-level for personal choices like filters/layouts), `context.globalState` (notification baselines, coverage records — keys are internal, some keep the old `azdoWorkItems.` prefix on purpose), webview `getState/setState` (UI-only: collapsed boxes, expanded cards).

## Conventions (follow them; reviews check them)

- **Strict webview CSP**: no inline `style="…"`, no inline event handlers. Dynamic sizes/positions are set through CSSOM after rendering (`data-box` + `applyBoxes`, `sizeReviewBars`, `data-elapsed`/`data-progress`). `src/webview/csp.test.ts` fails on inline styles. The details panel allows `'unsafe-inline'` styles and `img-src https: data:` only because it embeds work item rich text.
- **Pure logic + tests**: vitest; in new test files import `describe/it/expect/vi` explicitly from `vitest` (globals will be disabled).
- **Lint rules that bite** (all errors, no warnings: fix them, do not disable them): `no-use-before-define` (define functions before using them), switch exhaustiveness, no nested ternaries, `eqeqeq`, no `any` leaking out (`no-unsafe-*`), no unnecessary conditions, numbers/booleans only in template literals. `tsconfig` has no `noUncheckedIndexedAccess`, so `const [first] = list` is typed as always defined: write `list.at(0)` (or `.at(-1)`) when the array can be empty. Unused names must start with `_`. Test files may use `expect.any(...)` matchers and `!`.
- **Naming**: settings and commands are `totalflowx.*` (declare them in `package.json`; read them through `SECTION` in `src/config.ts`); command category "Totalflow X". A new setting goes into the right category of `contributes.configuration` (an array of categories, see [docs/DECISIONS.md](docs/DECISIONS.md#settings)) with an `order` and a key prefixed like its neighbours (`workItems.*`, `branches.*`, `myPullRequests.*`…), and into the matching table of the README; personal choices get `"scope": "application"`, team settings keep the default scope. User-facing name of the per-work-item tab: **Work Item Details panel**.
- **Requests**: always through `AzdoClient` → `recordedFetch`. Wrap new entry points (pollers, panels, commands) in `withFeature(...)` so the usage report attributes them. Keep the request budget low (batch, cache by immutable keys such as build id or last pushed commit; never poll faster than needed).
- **Theme-friendly colours**: use VS Code theme variables and the tokens of `media/webview.css`; check dark and light. Solid pills with fixed colour pairs (priority, due soon) are deliberate for contrast.
- **Documentation**: user-visible changes update [README.md](README.md); decisions with a "why" go to [docs/DECISIONS.md](docs/DECISIONS.md); new API findings to [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md).

## Verifying changes

1. `typecheck,test,build,lint` (above) and `package`.
2. **Rendering**: the webviews can be rendered without VS Code. Build, then load `dist/webview.js` (or `dist/dependencies.js`) and `media/*.css` in a static HTML page with the same CSP meta, a stub of `acquireVsCodeApi` (records `postMessage`), CSS variables for the VS Code theme tokens, and a script that posts a `{ type: 'state', model }` (or `{ type: 'graph', graph }`) message. Drive it with Playwright (not a dependency of this repo: use `npx playwright`) in dark and light, at 260–340 px for the sidebar, and look at the screenshots.
3. **Real data, read-only**: `az rest --resource 499b84ac-1321-427f-aa17-267ca6975798 --url "<GET url>"` (the Azure DevOps resource id), or an Azure DevOps MCP server's read tools. Bundle the pure modules with esbuild into a small Node script to run them on real responses.
4. Things that need a real VS Code (dialogs, QuickPicks, notifications, status bar, git API calls, new windows) must be tried with F5 or the installed `.vsix` before calling a feature done.

## Design first

The design canvas is the reference of what the extension looks like and does. **Every change follows this order**:

1. **Design**: update the boards of the canvas first (re-read the board and `canvas.json` right before publishing: the owner edits them too). A board that no longer matches goes to the Archive page instead of staying wrong.
2. **Implementation**: then the code, to match the design.
3. **Rules and decisions**: RULES.md and DECISIONS.md describe the same thing as the design and the code, in the same change. When the code had to differ from the design (a limit found while building), the design is updated to what was built, and the reason goes to DECISIONS.md.

## Keeping these documents current

These files are the project's memory: conversations with AI agents are not shared, so anything not written here is lost. **Agents and developers must update them as part of the same change**, not later:

- [README.md](README.md): every user-visible change (features, settings, commands, texts).
- [docs/DECISIONS.md](docs/DECISIONS.md): every decision with a "why" (a team rule, a trade-off, something that looks like a bug but is intended). Correct or remove entries that the change makes wrong.
- [docs/AZURE_DEVOPS.md](docs/AZURE_DEVOPS.md): every new or corrected fact about the API (endpoints, versions, quirks), only once verified.
- [docs/RULES.md](docs/RULES.md): every change to a decision rule (states shown, actions unlocked, thresholds): update its row, its `// Rule <ID>` comment and a test in the same change. `src/rulesDoc.test.ts` enforces that the IDs in the code and in the document match. What is designed but not built yet goes, without IDs, into the "<block>: designed, not implemented yet" list at the end of its block; it becomes table rows (with IDs and code comments) when it is built.
- This file (AGENTS.md): when the commands, conventions, verification steps or safety rules change, or when a convention turns out to be missing. The file map lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): update it when files are added, renamed or change role.

Before finishing a task, check that these files still describe the code; say in the summary of the change which ones were updated.

## Safety rules (for humans and agents)

- When testing, **never write to Azure DevOps** (no POST/PATCH/PUT/DELETE): only GET requests. Write paths (publish PR, add tag, delete branch, update work items) are tested with stubs.
- **Never create/delete branches, worktrees or stashes, never push, in the real repository** while testing git flows: use a throwaway repository (bare origin + clone) in a temp folder.
- Never print, log or store tokens; the request log records only method, shortened URL, status, duration, feature and rate-limit headers.
- Do not commit unless asked; end commit messages with the reason of the change.
