# herdr-setup

Reusable native [Herdr](https://herdr.dev) customizations.

## Customizations

- **[Linear panel](customizations/linear/README.md)** — your assigned issues, created issues, and personal cycle work in a responsive side panel beside your terminals. [Recipe](customizations/linear/RECIPE.md) · [Narrow preview](customizations/linear/preview.png) · [Wide preview](customizations/linear/preview-wide.png)

**Requirements:** macOS and Herdr 0.1.13. The optional installer and tests use Node 26; the mod runs in Herdr's native GPUI runtime.

## Install

Choose [manual installation](customizations/linear/README.md#manual-install) or use the installer:

```sh
git clone https://github.com/seongju0/herdr-setup.git
cd herdr-setup
node scripts/setup.mjs plan linear --team ENG --workspace example-workspace
node scripts/setup.mjs install linear --team ENG --workspace example-workspace
node scripts/setup.mjs check linear
```

Replace `ENG` and `example-workspace` with your Linear team key and workspace URL slug. `install` shows a plan and asks for confirmation; `--yes` approves unattended installation.

The target is `~/.config/herdr-app`, or `HERDR_APP_HOME` if set. Override it with `--home /path/to/herdr-home`. The target must contain `layouts/main.json`.

The installer copies the mod, creates missing config, and generates `layouts/herdr-setup-linear.json` from your installed `main.json`. It preserves shipped files, settings, and valid existing config. Conflicting files or options are rejected before copying; an unchanged installation is a no-op.

`plan` and `check` report paths and status without exposing config or credentials. `check` exits nonzero for missing or conflicting files and verifies packaging only. For updates, compare and merge changed files deliberately. If a write fails, inspect the reported files before retrying; partial files or directories may remain.

Set up [Keychain credentials](customizations/linear/README.md#credentials), review the generated layout, then check and activate it:

```sh
herdr-app check ~/.config/herdr-app/mods/linear-panel
herdr-app do layout.switch '{"name":"herdr-setup-linear"}'
```

For a custom home, use its mod path and matching Herdr instance. Activation is separate from installation.

## Develop and verify

Edit source under `customizations/`, then compare and copy changes into your installed mod. Git pulls leave installed copies unchanged; the installer refuses to overwrite edits.

```sh
npm test
```

Tests use Node's native runner, temporary install homes, and stubbed host/network calls. Run them directly; `npm install` is unnecessary. Check native rendering and Keychain/API integration separately in Herdr.

Keep local settings and credentials out of Git. Use synthetic data for examples and previews, and a dedicated API key rather than tokens from another application's MCP cache.

[MIT](LICENSE).
