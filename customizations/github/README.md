# GitHub PR panel

A native, read-only GitHub inbox beside Files, Changes and Linear in Herdr's existing right panel. It spans accessible repositories in your configured organization, independently of the current terminal folder or machine. Click a PR to open it in your browser; there are no GitHub write actions.

## Queues and stacks

- **Authored:** your open PRs, including drafts.
- **For me:** directly assigned to you **or** requesting your personal review (`user-review-requested:@me`). Team review requests alone do not qualify.

Each queue deduplicates PR node IDs and keeps every matching reason. Queues may overlap. Authored is the default; only the selected queue name is remembered. Unvisited queues load on selection, with no fabricated count badges.

Repository headers and the footer count **matching PRs only**. Native GitHub stacks are expanded by default, ordered foundation-first using native positions. Other stack members are labelled Context and may be closed or merged; they do not inflate queue counts or reorder a group by unrelated activity. Stack headers collapse/expand, while individual rows open their own URLs. Inaccessible layers are nonclickable placeholders. Matching rows appear before context loads and survive context failures; use the group's Retry control.

Refresh on initial display, reopening or explicit Refresh; no polling. A fully failed refresh retains the last snapshot and successful timestamp with a stale banner. Partial results are labelled incomplete, with failed sources named and counts shown as PRs loaded. An incomplete empty result is not an all-clear. Each GitHub search source can return at most 1,000 results; the panel marks this limit incomplete rather than partitioning repositories or dates. GitHub search indexing and permissions bound visibility and freshness.

## Requirements and access

- macOS and Herdr with the native `exec`/GPUI APIs and GitHub's native `PullRequest.stack`, `stackEntry`, and `PullRequestStack.entries` GraphQL fields.
- Existing local `gh` installation and GitHub.com authentication. The panel resolves the viewer with that same executable. It does not install tools, change authentication, request scopes, enumerate memberships or read credentials from another application.
- Node 26 for the optional copy installer and tests. The mod itself uses no Node, webview, server or build pipeline.

**Access disclosure:** the mod reads `config/github-panel.json`, executes local `gh api --hostname github.com graphql` with fixed read-only queries, and executes `/usr/bin/open` with a validated GitHub PR URL. Native execution inherits the real user's HOME/PATH/auth and environment credential/debug/prompt behavior; the host provides no environment or stdin options. Commands are argument arrays, without a shell, cwd or remote-machine selection. Herdr bounds each process to 30 seconds and 8 MiB output. Raw process/GraphQL output and credentials are not displayed or persisted. The panel is read-only; an existing credential may have broader permissions.

Only matching-queue selection persists in per-copy localStorage. PR snapshots, stack context and viewer/config scope remain in memory. Config or account changes clear scoped caches. No CI/check rollup, merge readiness, local checkout, gh-stack extension, dependency inference or stack editing is involved.

## Install

Installation and activation are separate decisions. Copying resources does not switch your active layout; Git pulls do not hot-update installed copies. Do not run these commands against a live home without approving that installation.

Choose an **explicit existing base layout** that already contains tabs, panel and panel-body. For example, use `herdr-setup-workspace-browser` if you have composed Files/Changes and Linear there:

```sh
node scripts/setup.mjs plan github --base-layout herdr-setup-workspace-browser \
  --organization example-org
node scripts/setup.mjs install github --base-layout herdr-setup-workspace-browser \
  --organization example-org
node scripts/setup.mjs check github --base-layout herdr-setup-workspace-browser
```

The target defaults to `~/.config/herdr-app` (or `HERDR_APP_HOME`); use `--home /path/to/disposable-home` to select another. `install` asks for confirmation, or accepts explicit `--yes`. It copies only the owned mod files, creates missing config and generates a **new** `layouts/herdr-setup-github.json`. It preserves the base, settings, Files/Changes/Linear variants, floating workspace observer and existing active/hidden state. It refuses duplicate GitHub IDs, unsupported layouts, symlinks and conflicting files before writing. Repeating an unchanged installation is a no-op; updates require deliberate comparison/merge, never automatic overwrite. Inspect reported paths after any partial write failure before retrying.

A missing config requires `--organization`. `--gh-path /absolute/path/to/gh` selects a local executable when the app's PATH lacks gh; otherwise the default is literal `gh`. Existing valid config is preserved byte-for-byte, including optional demo settings; omit options to reuse it. Explicit conflicting organization/executable options are rejected.

Equivalent local config (see [config.example.json](config.example.json)):

```json
{"organization":"example-org","ghPath":"gh","demo":false}
```

Only these three keys are accepted; `ghPath` and `demo` are optional. Organization must be a slug, never a search expression or path. `ghPath` must be literal `gh` or an absolute executable path (spaces are allowed). Never put a token or username in this file. Missing/invalid config is a setup error, never broader discovery. Changes take effect on Refresh or reopen, without restart.

For a manual copy, copy `mods/github-panel/` into a new, unused home mod folder and adapt a copy of your layout as described in [RECIPE.md](RECIPE.md). Do not symlink to this repository or replace shipped mods.

After separately approving activation, inspect the generated layout and check the copied mod:

```sh
herdr-app check ~/.config/herdr-app/mods/github-panel
# Separate activation, only when ready:
herdr-app do layout.switch '{"name":"herdr-setup-github"}'
```

For a custom home, select the corresponding Herdr instance and mod path. Source-only validation is `herdr-app check customizations/github/mods/github-panel`; it checks eager loading, **not** rendered geometry, deferred rows or async interactions.

## Demo and verification

Set `demo:true` in an otherwise valid local config for conspicuously labelled synthetic queues/stacks. Demo skips gh/auth/network entirely; clicking a synthetic PR still opens its safe synthetic URL. Keep workplace config, real PR metadata and screenshots out of this repository.

Run `npm test` with Node 26; no `npm install` is needed. Tests exercise real model/API/view collaborators with external vendor/native builders, config, storage and browser effects stubbed, plus actual-source copying into disposable homes. No real GitHub requests occur in tests.

After explicit live install/UI permission, verify 280/368/900px widths (wide columns start at 620), dark/light themes, empty/setup/stale/incomplete states, real authenticated reads, PR versus collapse clicks, group retry, hide/reopen and per-space restoration alongside Files, Changes, Linear and running sessions. Mocked tests and the eager source check do not establish native rendered acceptance or universal repository access.
