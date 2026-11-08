# Files and Changes

Follow your current Pi session directory in Herdr, or pin a folder for both panels. **macOS · Herdr 0.1.13**. [Recipe](RECIPE.md)

## Follow or pin a folder

The folder control beside the tab buttons opens a native searchable picker. Files and Changes share one selection, remembered independently for each Herdr tab.

- **Follow session** uses Pi's actual session directory. `/move` and session resume update both panels. Focusing a shell leaves the Pi selection alone; with multiple Pi panes, focusing another Pi makes it current.
- **Choose a folder** to pin both panels. Later Pi directory changes leave the pin intact. Choose Follow session to immediately return to Pi's latest directory.
- Search the current session, tab's pane directories, space folder, and recent choices; paste an absolute path or use **Browse…**. Local `~/` paths are supported. Browse uses the local system picker; remote folders use their known paths or a pasted absolute remote path.

Folder selection leaves your terminals where they are. The picker shows full paths and machine context. An unreadable or offline pin stays selected with an error rather than silently switching to a different folder.

**Files** browses the exact selected directory, with expandable folders and bounded read-only text previews. **Changes** resolves the containing Git repository/worktree root and shows that scope explicitly. Its **Commit** action stages and commits **all changes in that repository** (`git add -A`, then `git commit`), not just changes beneath a selected subfolder. A valid non-Git folder works in Files; Changes displays “Not a git repository.”

## Pi integration

Follow session requires the [`herdr-session` extension from pi-setup](https://github.com/seongju0/pi-setup/tree/main/agent/extensions/herdr-session), updated to publish these terminal labels together:

```text
pi.session-id   current Pi session identity
pi.session-cwd  current Pi session's absolute directory
```

Pi must run interactively inside Herdr with `HC_TERMINAL_ID`. The publisher covers ordinary Pi terminals as well as managed sessions, including replacement `session_start` after `/move`. Update/reconcile the extension through [pi-setup's normal workflow](https://github.com/seongju0/pi-setup#use), then reload an idle Pi session or start a new one when convenient. This customization's installer does not install or reload Pi extensions.

The mod reads the labels only while the terminal actively reports Pi. It does not derive the session directory from a terminal title, inspect session files, or assume that `/move` updates shell cwd. A reporting Pi without the metadata shows an integration-unavailable message; choose a folder or update the integration. In a tab without Pi, the controls identify the normal pane/terminal/space-folder fallback.

## Install

Use Node 26 for the optional installer. From the repository root:

```sh
node scripts/setup.mjs plan workspace-browser
node scripts/setup.mjs install workspace-browser
node scripts/setup.mjs check workspace-browser
```

To preserve your existing Linear panel, use its installed layout as the base on **all three commands**:

```sh
node scripts/setup.mjs plan workspace-browser --base-layout herdr-setup-linear
node scripts/setup.mjs install workspace-browser --base-layout herdr-setup-linear
node scripts/setup.mjs check workspace-browser --base-layout herdr-setup-linear
```

The target is `~/.config/herdr-app`, or `HERDR_APP_HOME`; `--home /path/to/herdr-home` overrides it. The named base layout must already exist there. `install` asks for confirmation; `--yes` approves unattended copying.

Setup copies `mods/workspace-browser/` and generates **`layouts/herdr-setup-workspace-browser.json`**. It preserves the base layout, shipped mods, settings, Linear config and existing buttons. Conflicting files, directory symlinks and custom Files/Changes content are refused before copying. Repeating an unchanged install is a no-op; changed files require deliberate comparison/merging. `check` verifies packaging, not live Pi integration or native appearance.

Review the generated layout and copied files, check the mod, and activate separately when ready:

```sh
herdr-app check ~/.config/herdr-app/mods/workspace-browser
herdr-app do layout.switch '{"name":"herdr-setup-workspace-browser"}'
```

For a custom home, use its path and matching app instance. Return to your previous layout with `layout.switch`; installation leaves the active layout unchanged.

### Manual install

1. Copy this customization's complete `mods/workspace-browser/` directory into your intended Herdr home's `mods/`. Preserve existing copies and keep `LICENSE`, `LICENSE-HERDR` and `NOTICE` with the mod. Use ordinary copies so source edits do not hot-change the live UI.
2. Copy installed `layouts/main.json` (or your existing Linear layout) to `layouts/herdr-setup-workspace-browser.json`.
3. Keep block IDs `files` and `changes`, their sizes and the `panel-body` stack. Replace their content with the corresponding view:

   ```json
   { "mod": "workspace-browser", "props": { "view": "files" } }
   ```

   ```json
   { "mod": "workspace-browser", "props": { "view": "changes" } }
   ```

4. Add this block to the `tab-bar` row beside the existing tabs/buttons:

   ```json
   {
     "id": "workspace-folder-button", "type": "block", "size": { "px": 160 },
     "content": { "mod": "workspace-browser", "props": { "view": "toolbar" } }
   }
   ```

   If `tabs` is not already in a `tab-bar` row, wrap it: move its fixed height to the row, give `tabs` a `size` of `{ "weight": 1 }`, then append the folder block. Keep IDs unique, preserve panel visibility/selection and leave the base layout untouched. Merge a substantially customized layout deliberately.
5. Set up the Pi integration above, review and check the copied mod, then activate the new layout separately.

## Access and maintenance

The mod runs trusted native code. It lists folders, reads file previews, and runs Git on the selected machine. Only the explicit Commit action writes Git state; it retains the captured repository and machine for the operation. Review the source before installation.

Pins, recent choices and the remembered Pi terminal are saved in Herdr's shared mod state, under `herdr-setup.workspace-browser.v1`. They are local preferences, not repository configuration. Preserve personal paths and workplace data outside Git; use synthetic data for public examples and previews.

Herdr's folder watchers and the existing refresh timer update file/diff content. Session metadata follows Herdr's live terminal records without a new poller. Compare updates before copying: the installer preserves local edits and reports partial writes for inspection before retrying.

## Source and license

`mods/workspace-browser/main.js` selects Files, Changes, toolbar or picker mode within one native mod. `context.js` owns folder selection and persistence; `directories.js` owns directory listing; the remaining files own their views. Installed Herdr API definitions remain the native host authority.

Files, Changes, directory-listing code and file-browser icons are adapted from **Herdr 0.1.13**, [herdrdev/herdr-app](https://github.com/herdrdev/herdr-app). Those upstream portions retain [Apache License 2.0](mods/workspace-browser/LICENSE-HERDR) and [attribution](mods/workspace-browser/NOTICE). New herdr-setup code uses the repository's [MIT license](../../LICENSE).
