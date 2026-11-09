# herdr-setup

Reusable native [Herdr](https://herdr.dev) customizations.

## Customizations

- **[Minimal sidebar](customizations/sidebar/README.md)** — activity-first agents with task names, quieter workspace context, compact Spaces and a workspace-avatar rail. Preserves native statuses, pins and navigation. [Recipe](customizations/sidebar/RECIPE.md)
- **[GitHub PR panel](customizations/github/README.md)** — organization-wide Authored and For me queues with native GitHub stack context, using existing local gh authentication. [Recipe](customizations/github/RECIPE.md)
- **[Files and Changes](customizations/workspace-browser/README.md)** — follow the current Pi session directory, including `/move`, or pin a shared folder per Herdr tab. Browse files and repository changes with an in-panel directory-only fuzzy finder and configurable search roots. [Recipe](customizations/workspace-browser/RECIPE.md)
- **[Linear panel](customizations/linear/README.md)** — your assigned issues, created issues, and personal cycle work in a responsive side panel beside your terminals. [Recipe](customizations/linear/RECIPE.md) · [Narrow preview](customizations/linear/preview.png) · [Wide preview](customizations/linear/preview-wide.png)

**Requirements:** macOS and Herdr 0.1.13. The optional installer and tests use Node 26; the mod runs in Herdr's native GPUI runtime.

## Install

Each customization has its own guide: [Sidebar](customizations/sidebar/README.md#install-separately-from-activation), [GitHub](customizations/github/README.md#install), [Files and Changes](customizations/workspace-browser/README.md#install) or [Linear](customizations/linear/README.md#manual-install). The optional installer previews its changes before copying.

**Linear example:**

```sh
git clone https://github.com/seongju0/herdr-setup.git
cd herdr-setup
node scripts/setup.mjs plan linear --team ENG --workspace example-workspace
node scripts/setup.mjs install linear --team ENG --workspace example-workspace
node scripts/setup.mjs check linear
```

Replace `ENG` and `example-workspace` with your Linear team key and workspace URL slug. `install` shows a plan and asks for confirmation; `--yes` approves unattended installation.

The target is `~/.config/herdr-app`, or `HERDR_APP_HOME` if set. Override it with `--home /path/to/herdr-home`. The selected base layout must already exist in that home (`main` by default for Linear and Files/Changes; GitHub and Sidebar require an explicit `--base-layout`).

The Linear installer copies the mod, creates missing config, and generates `layouts/herdr-setup-linear.json` from your installed `main.json`. It preserves shipped files, settings, and valid existing config. Conflicting files or options are rejected before copying; an unchanged installation is a no-op.

`plan` and `check` report paths and status without exposing config or credentials. `check` exits nonzero for missing or conflicting files and verifies packaging only. For updates, compare and merge changed files deliberately. If a write fails, inspect the reported files before retrying; partial files or directories may remain.

Set up [Keychain credentials](customizations/linear/README.md#credentials), review the generated layout, then check and activate it:

```sh
herdr-app check ~/.config/herdr-app/mods/linear-panel
herdr-app do layout.switch '{"name":"herdr-setup-linear"}'
```

For a custom home, use its mod path and matching Herdr instance. Activation is separate from installation.

**Files and Changes:** use `plan`, `install`, and `check` with `workspace-browser`. Add `--base-layout herdr-setup-linear` to keep an existing Linear layout, or omit it to start from `main`. This produces a separate `herdr-setup-workspace-browser` layout. Follow session also requires Pi's session-cwd metadata publisher; see the [setup guide](customizations/workspace-browser/README.md#pi-integration).

**GitHub:** use `plan`, `install`, and `check` with `github --base-layout NAME`. A missing config also requires `--organization example-org`; optional `--gh-path /absolute/path/to/gh` selects the existing local executable. Choose an explicit base such as `herdr-setup-workspace-browser` to preserve composed Linear/Files/Changes and the folder observer. It creates the separate, inactive `herdr-setup-github` layout; activation needs a separate decision. Existing valid local config is preserved, and conflicting options/files or symlinks are refused. See the [access disclosure and setup guide](customizations/github/README.md).

**Sidebar:** use `plan`, `install`, and `check` with `sidebar --base-layout NAME`, choosing your latest combined layout (including GitHub when present). It creates a separate, inactive `herdr-setup-sidebar` layout and copies one native mod without config or credentials. Only the supported shipped sidebar subtree changes; right panels, terminal layout and floats remain intact. Custom/previously transformed sidebars and file conflicts are refused. Installation and activation are separate; see the [setup, access and rollback guide](customizations/sidebar/README.md).

## Develop and verify

Edit source under `customizations/`, then compare and copy changes into your installed mod. Git pulls leave installed copies unchanged; the installer refuses to overwrite edits.

```sh
npm test
```

Tests use Node's native runner, temporary install homes, and stubbed host/process/network calls. Run them directly; `npm install` is unnecessary. Check native rendering, Pi session updates, Linear Keychain/API and GitHub gh/API integration separately in Herdr. `herdr-app check customizations/github/mods/github-panel` verifies eager source loading only, not rendered geometry or async interactions.

Keep local settings and credentials out of Git. Use synthetic data for examples and previews, and a dedicated API key rather than tokens from another application's MCP cache.

New code is [MIT licensed](LICENSE). The Files and Changes customization retains [Herdr's Apache-2.0 attribution](customizations/workspace-browser/README.md#source-and-license) for adapted upstream code and icons. The [Sidebar attribution](customizations/sidebar/README.md#source-and-license) also retains Apache-2.0 code and Lucide/Feather ISC/MIT icon notices.
