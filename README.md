# herdr-setup

Reusable native [Herdr](https://herdr.dev) customizations, copied into your own Herdr home. This is not a backup of a user's home directory. No webview, React, server, dependencies or build pipeline.

## Available customization

- **[Linear panel](customizations/linear/README.md)** — a native top-right toolbar button and right-hand issue panel. See its [recipe](customizations/linear/RECIPE.md) for behavior and caveats. [Narrow preview](customizations/linear/preview.png) · [Wide preview](customizations/linear/preview-wide.png), captured from the native app with synthetic data.

Supported target: **macOS, Herdr 0.1.13**. Node **26** is needed only for the optional installer and tests; the installed mod runs in Herdr's GPUI JavaScript runtime.

## Install

[Manual installation](customizations/linear/README.md#manual-install-first-class) is fully supported and needs no Node. The optional installer uses only Node built-ins:

```sh
git clone https://github.com/seongju0/herdr-setup.git
cd herdr-setup
node scripts/setup.mjs plan linear --team ENG --workspace example-workspace
node scripts/setup.mjs install linear --team ENG --workspace example-workspace
node scripts/setup.mjs check linear
```

`install` shows a plan and asks for approval in a terminal. Add `--yes` only when explicitly approving unattended copies. `--home /path/to/herdr-home` overrides `HERDR_APP_HOME`; otherwise the default is `~/.config/herdr-app`. The target must already contain Herdr's `layouts/main.json`.

The installer copies `customizations/linear/mods/linear-panel/` into `mods/linear-panel/`, creates `config/linear-panel.json` if missing, and generates `layouts/herdr-setup-linear.json` from that target's `main.json`. It never edits shipped `main.json`, settings, layout state or the active layout. Existing valid team/workspace config is preserved; explicit options that disagree are conflicts. Defaults are synthetic `ENG` / `example-workspace`: change them locally to match your own team.

`plan` and `check` are read-only and report paths/status, not config contents or credentials. `check` exits nonzero if anything is missing or conflicting; it checks packaging, not authentication or network access. All known conflicts are checked before copying. Differing mod/layout files and invalid config are refused rather than overwritten; an unchanged installation is a no-op. There is no automatic update/merge command. If the source or shipped layout changes, compare and merge deliberately without losing local work. Unexpected write failures report files already created; parent directories may remain. Inspect before retrying.

After reviewing the generated layout and setting up [Keychain credentials](customizations/linear/README.md#credentials), activate it separately:

```sh
herdr-app do layout.switch '{"name":"herdr-setup-linear"}'
```

For a nondefault `--home`, activate only in the Herdr instance using that home. The installer does not execute Herdr commands or restart anything. Run `herdr-app check ~/.config/herdr-app/mods/linear-panel` against your intended mod directory after installation (substitute the correct home if different).

## Develop and verify

Edit source under `customizations/`, not shipped or installed copies. Git pulls do not hot-change installed mods. To try a source change, deliberately compare/copy into an owned target; the installer will not overwrite edits.

```sh
npm test
```

Tests use Node's native test runner, temporary install homes and stubbed external HTTP where needed. They do not invoke external programs or mutate real Linear data. No `npm install` is required. Native rendering and Keychain/network integration still need a separate authorized Herdr check.

Keep local settings and credentials out of Git. Examples and future previews must use synthetic data only. Never reuse tokens extracted from Pi MCP caches. [MIT](LICENSE).
