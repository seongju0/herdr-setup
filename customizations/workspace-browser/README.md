# Files and Changes

One **Files** tab with an **All files / Changes** toggle. All files is the default; switching modes preserves the open file/diff and shared folder selection. Below the folder control, the current Git branch is shown when available (or a short commit ID for detached HEAD). Branch reads use the selected directory and machine, including pinned folders and worktrees; non-Git/unavailable folders have no branch label.

Follow your current Pi session directory in Herdr, or pin a folder for both panels. **macOS · Herdr 0.1.13**. [Recipe](RECIPE.md)

## Follow or pin a folder

The folder control inside the unified Files header opens a native, keyboard-first directory finder. Both panels share one selection, remembered independently for each Herdr tab; no extra tab-bar control is added.

- **Follow session** uses Pi's actual session directory. `/move` and session resume update both panels. Focusing a shell leaves the Pi selection alone; with multiple Pi panes, focusing another Pi makes it current.
- **Choose a folder** to pin both panels. Later Pi directory changes leave the pin intact. Choose Follow session to immediately return to Pi's latest directory.
- **Search directories** with case-insensitive fuzzy matching and space-separated terms, then use Up/Down and Enter to select, or Esc to cancel. There is no OS Browse dialog.
- **Complete a local path** by typing an absolute or `~/` path: `~/Wo` offers matching directories in your home, and `~/Work/` lists directories inside Work—even outside your search roots. Append `/` to browse inside a suggested directory. “Use path” still lets you select the entered folder directly.

Folder selection leaves your terminals where they are. The picker shows full paths and machine context. An unreadable or offline pin stays selected with an error rather than silently switching to a different folder.

**Files** browses the exact selected directory, with expandable folders and bounded read-only text previews. **Changes** resolves the containing Git repository/worktree root and shows that scope explicitly. Its **Commit** action stages and commits **all changes in that repository** (`git add -A`, then `git commit`), not just changes beneath a selected subfolder. A valid non-Git folder works in Files; Changes displays “Not a git repository.”

## Find a file

In **All files**, use **Search files…** to find filenames and paths beneath the directory Files is currently following or pinned to—similar to Zed's Go to File. This searches names, not file contents.

- An empty search shows the normal expandable tree. Typing shows a flat fuzzy-ranked list, with relative paths to distinguish duplicate filenames. Try a path fragment such as `src/app` or shorthand such as `apphdr`.
- Use Up/Down and Enter while the search field is focused, or click a result, to open the existing read-only preview. Back returns to the results; typing another query searches again. Escape clears the search and returns to the tree.
- The scope is the selected folder on the selected machine, not the containing Git root and not the folder picker's `searchRoots`. A session move or different pin resets the search for the new scope.
- File discovery uses `fd` to list regular files, respects ignore rules, includes otherwise-hidden files, excludes `.git` and `node_modules`, and does not follow symlinks. Ignored files and symlinked entries remain available through the ordinary tree.
- Each search takes a bounded snapshot of up to 20,000 file paths, then filters it in memory rather than launching a process per keystroke. At most 50 matches are shown. Clear and start again to refresh the snapshot; incomplete scans, limits and failures are shown explicitly.
- On a remote machine, `fd` must be available there. A missing/offline remote search reports an error rather than searching your local files. Missing file-search tooling does not prevent browsing the tree.

## Directory search and scoped roots

Directory discovery uses **[fd](https://github.com/sharkdp/fd)**; the native picker filters its results as you type, without launching terminal fzf or running a disk search on every keystroke. Make `fd` available on Herdr's PATH; an existing `~/.pi/agent/bin/fd` is also supported as a local fallback. Setup does not install external tools.

Optional configuration lives in **`~/.config/herdr-app/config/workspace-browser.json`**, or `config/workspace-browser.json` beneath your custom Herdr home:

```json
{
  "searchRoots": ["~/Work", "~/Mine"]
}
```

- Supply **one or multiple roots** to search only beneath those directories. `~` and `~/` expand to your local home; other roots must be absolute paths.
- A missing file/setting or an empty list searches beneath the **current selected folder**, falling back to the active space's folder if no selected folder is available. `~/Work` and `~/Mine` are examples, not defaults.
- Set `"searchRoots": ["~"]` explicitly to search across your home directory. Invalid settings or unreadable roots report errors rather than silently expanding the scope.
- Config is read when the finder opens; close and reopen it to pick up edits or newly created folders. This configuration limits search discovery, not access to an explicitly entered path.

Ordinary fuzzy queries search the scoped discovery snapshot. Explicit local path completion instead reads one parent directory at a time, caching that bounded listing while you type the last component. It does not recursively scan the entered path or change your configured roots. Listings exceeding 500 entries show a partial-result notice; a failed listing still leaves explicit path entry available.

The flat results include nested directories, including hidden and Git-ignored folders, but exclude files, `.git` and `node_modules`. Discovery does not follow directory symlinks recursively. Each opening takes a bounded snapshot of up to 20,000 directories per root; a partial-result notice explains limits or root failures. At most 50 matching choices are shown, deduplicated with in-scope session/pane/space/recent folders.

Automatic discovery is local on macOS. A remote folder finder retains correctly routed known choices and explicit absolute remote paths; it does not search your local home as if it were remote.

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

Setup copies `mods/workspace-browser/` and generates **`layouts/herdr-setup-workspace-browser.json`**. It preserves the base layout, shipped mods, settings, Linear config and other panels/buttons. In the generated layout only, it adapts the shipped tab bar to expose one Files entry, replaces the Files content, removes the separate Changes stack child and maps an active Changes selection to Files. A Files or Changes enabled-panel preference exposes the combined entry; neither enabled hides it. Other enabled panels retain their per-space restoration. The adapted tab bar has its own per-copy storage: it starts without the shipped tab bar's remembered per-space panel choices, then remembers choices made in this layout. Shared folder pins and recent directories are unaffected. Custom tab-bar content is refused rather than overwritten. Conflicting files, directory symlinks and custom Files/Changes content are refused before copying. Repeating an unchanged install is a no-op; changed files require deliberate comparison/merging. `check` verifies packaging, not live Pi integration or native appearance.

Review the generated layout and copied files, check the mod, and activate separately when ready:

```sh
herdr-app check ~/.config/herdr-app/mods/workspace-browser
herdr-app do layout.switch '{"name":"herdr-setup-workspace-browser"}'
```

For a custom home, use its path and matching app instance. Return to your previous layout with `layout.switch`; installation leaves the active layout unchanged.

### Manual install

1. Copy this customization's complete `mods/workspace-browser/` directory into your intended Herdr home's `mods/`. Preserve existing copies and keep `LICENSE`, `LICENSE-HERDR` and `NOTICE` with the mod. Use ordinary copies so source edits do not hot-change the live UI.
2. Copy installed `layouts/main.json` (or your existing Linear layout) to `layouts/herdr-setup-workspace-browser.json`.
3. Keep the `files` block and `panel-body` stack. Remove the `changes` stack child; if `panel-body.active` is `changes`, change it to `files`. Replace the Files content with:

   ```json
   { "mod": "workspace-browser", "props": { "view": "files" } }
   ```

   Replace the shipped `tabs` block content (not its sizing or siblings) with:

   ```json
   { "mod": "workspace-browser", "props": { "view": "tabs" } }
   ```

4. Append this entry to the layout root's `floating` array, preserving any existing entries:

   ```json
   {
     "id": "workspace-folder-observer", "edge": "top", "align": "start",
     "content": { "mod": "workspace-browser", "props": { "view": "observer" } }
   }
   ```

   The observer draws an empty zero-size element, so it takes no tab-bar space. It remembers focused Pi changes even while both panels are closed. Do not set it `hidden` or add a visible folder button. Keep IDs unique, preserve panel visibility/selection and leave the base layout untouched. Merge a substantially customized layout deliberately.
5. Set up the Pi integration above, review and check the copied mod, then activate the new layout separately.

## Access and maintenance

The mod runs trusted native code. It reads its optional local search configuration, discovers directories beneath the resolved local roots, lists folders, reads file previews, and runs Git on the selected machine. Only the explicit Commit action writes Git state; it retains the captured repository and machine for the operation. Review the source before installation.

Pins, recent choices and the remembered Pi terminal are saved in Herdr's shared mod state, under `herdr-setup.workspace-browser.v1`. They are local preferences, not repository configuration. Preserve personal paths and workplace data outside Git; use synthetic data for public examples and previews.

Herdr's folder watchers and the existing refresh timer update file/diff content. Session metadata follows Herdr's live terminal records without a new poller. Compare updates before copying: the installer preserves local edits and reports partial writes for inspection before retrying.

## Source and license

`mods/workspace-browser/main.js` reads native `herdr.props()` and selects the combined browser, adapted tab bar, legacy standalone Changes, observer or picker within one native mod. `browser.js` owns the mode toggle, shared header and branch context; existing file/diff implementations retain their previews and commit lifecycle. `context.js` owns folder selection and persistence; `directory-search.js` owns search configuration and discovery; `directories.js` retains the existing directory listing and choice validation. `file-search.js` owns bounded selected-directory file discovery and fuzzy ranking; Files owns its transient search input, result selection and preview. The remaining files own their views. Installed Herdr API definitions remain the native host authority.

Files, Changes, Tabs, directory-listing code and file-browser icons are adapted from **Herdr 0.1.13**, [herdrdev/herdr-app](https://github.com/herdrdev/herdr-app). Those upstream portions retain [Apache License 2.0](mods/workspace-browser/LICENSE-HERDR) and [attribution](mods/workspace-browser/NOTICE). New herdr-setup code uses the repository's [MIT license](../../LICENSE).
