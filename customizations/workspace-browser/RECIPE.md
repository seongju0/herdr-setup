# Files and Changes that follow Pi

A native Herdr folder control shared by Files and Changes. Follow the current Pi session directory, including `/move`, or pin another folder per tab. Keep the existing file browser, diff viewer and repository-wide commit action. [Installation and access](README.md)

## Appearance

- Folder controls live only in the Files and Changes headers. Keep the existing tab buttons without adding a global Session control or consuming tab-bar width.
- Both headers identify mode and chosen path and open the same native directory finder. Changes also identifies the resolved Git repository/worktree root and “All repository changes.”
- Use Herdr theme colors and existing panel sizing, borders, scrolling, previews and diff treatment. Keep the Files/Changes buttons and layout block IDs.
- The native dialog has a focused fuzzy-search field, flat directory results, explicit local path completion and Follow session. Support Up/Down, Enter and Esc; do not launch an OS Browse dialog. Do not render an empty status viewport; give each result a non-shrinking 32px row and size the scroll region to its rows, capped at 320px.

## Folder behavior

- One persisted tab record, keyed by exact space/tab IDs, owns the pin, remembered Pi terminal and up to ten explicit recent choices. Use shared key `herdr-setup.workspace-browser.v1`, not per-copy localStorage.
- Follow a live, Pi-reporting terminal associated with this tab: focused Pi, otherwise remembered eligible Pi, otherwise first Pi pane. Shell focus must not steal selection; do not discover sessions by scanning background children or other tabs.
- An empty, zero-size observer hosted in a content-sized floating block observes focused Pi even while panels are hidden. It paints no control and adds no tab-bar width. Read `pi.session-id` and absolute `pi.session-cwd` from native terminal labels. Publish changed preferences from task/event contexts, never during render.
- A pin overrides directory changes but not observation. Clear it to use the latest session label immediately. Switching tabs restores independent preferences.
- Missing Pi metadata is an explicit unavailable state, not an excuse to use shell cwd as Pi cwd. With no Pi in the tab, identify the usual pane/terminal/space-folder fallback.
- Read optional `config/workspace-browser.json` beneath native `appHome()` on each opening. `searchRoots` accepts one or multiple absolute/`~/` roots; missing/empty defaults to the captured effective folder, with the captured space folder as fallback. `~` explicitly opts into home-wide discovery. Invalid configuration must not broaden discovery. Keep personal configuration outside source and preserve it on installation.
- Use `fd` to discover directories once per opening with NUL-delimited output, hidden/ignored directories included, `.git`/`node_modules` excluded and no recursive symlink traversal. Keep up to 20,000 directories per root with an honest partial-result/error notice. Filter the snapshot in-process using case-insensitive fuzzy, multi-term matching; deduplicate with in-scope session/pane/space/recent choices and display at most 50. Do not spawn fzf/fd per keystroke or create an index service.
- Local absolute and `~/` queries complete paths: `~/Wo` matches directory names in home; `~/Work/` lists Work's child directories. Expand home before prefix matching. Reuse `directory(parent, null)`, cache each bounded parent listing for that dialog, exclude files/`.git`/`node_modules`, and surface failures/500-entry limits. Do not launch another fd search or change fuzzy roots. Late results must not replace another parent or update a closed picker.
- Accept absolute pasted paths and local `~/`, including outside the search roots; reject relative paths and NUL. Keep the explicit Use path choice. Validate on the captured machine before pinning. A failed choice preserves the old selection. Keep the captured tab/machine through async work, and never apply a result to a newly focused tab. Closing the dialog prevents late discovery/validation from updating it.
- Automatic discovery is local macOS only. Remote dialogs retain known directories and absolute remote paths with their machine identity; never run a local-home scan for a remote target.
- Files uses the exact selected directory. Changes resolves its containing Git root without changing that shared selection. A non-Git folder remains browsable. Unreadable/offline pins keep their own error rather than switching targets.

## Native implementation

- Package one `mods/workspace-browser/` directory. Host imports cannot cross a mod directory, so keep shared context and helpers inside it.
- `main.js` is the sole native View. Read layout/overlay configuration through `herdr.props()` (the root init argument is not that configuration), then select a plain implementation object using its `view` (`files`, `changes`, `observer`, `picker`), forward init/render/optional close with the root's current context, and return the implementation's element. Default to files; reject unknown views. Do not cache a Context or depend on retained-child invalidation behavior.
- `context.js` owns the policy and IO key (space/tab/machine/directory). `folder-observer.js`, `folder-picker.js` and `folder-controls.js` consume it. `directory-search.js` owns configuration, root scope and fd discovery; picker state owns filtering, status and cached explicit-path parent listings through `directories.js`. `files.js` and `changes.js` adapt the shipped views; `directories.js` retains the existing bounded Unix/Windows folder operation. Copy required icons into the customization.
- Retain context checks on async directory/file/Git reads, old-result rejection, local watchers, remote polling and existing refresh interval. Never display or commit an old repository as if it belonged to a new selection.
- Preserve Changes' commit guard and captured root/machine for both `git add -A` and `git commit`. An in-flight commit finishes against that captured repository; do not redirect, add locks or retry writes automatically.
- Pi owns the metadata transport: extend pi-setup's existing `herdr-session` publisher to label the current session ID/cwd on interactive startup and replacement session_start. Publish independently of research restoration; preserve copied-worker ownership rejection. No Pi core patch or session-record reader.

## Packaging

Generate `herdr-setup-workspace-browser.json` from installed `main` or an explicitly named Linear base. Replace only the expected Files/Changes content; preserve their IDs, existing buttons, sizing, panel state and Linear. Append `workspace-folder-observer` with props `{ "view": "observer" }` to the root's `floating` entries, preserving existing entries. The observer renders an empty zero-size element, not another visible button. Reject ID conflicts/custom content that needs a manual merge.

Keep the existing installer's read-only preview, conflict/symlink checks, exclusive copies, partial-write reporting and separate activation. Workspace installation leaves Linear config and Pi setup alone. Preserve upstream modification notices and both licenses (`LICENSE`, `LICENSE-HERDR`) plus `NOTICE` with the installed mod.

## Verification

Use Node 26 and the repository's existing native-host/temporary-home test patterns. Cover the real header/picker/panel flow: configured one/multiple roots and current-folder default, unknown directory discovery and fuzzy keyboard selection, follow/move, pin/move/unpin, shell focus, tab persistence and focused second Pi while panels are hidden. Keep the native `props()` boundary and real internal modules; replace only host/process/read boundaries. Cover invalid configuration, incomplete/failed scans and late results after close in the existing flow scenarios. Cover wrong-target write prevention, stale reads, bad/non-Git folders and remote routing at the external process/host boundary. Keep existing Linear coverage and verify installer composition and conflict refusal.

Check native source with `herdr-app check`. Extend the existing native scenarios for local path completion outside fuzzy roots, directory-only prefix results, parent-cache reuse/no new fd, normal pin validation, stale/closed listings, and emitted result sizing/no empty status region. Inspect actual native one-row and multi-row dialogs for visibility and spacing; a controlled synthetic prefilled preview proves rendering/listing, not human keyboard behavior. Separately, when authorized, verify actual Pi startup/resume/move, folder selection, hide/reopen, tab transitions, non-Git messaging, narrow/default layouts and light/dark appearance. Use an owned synthetic repository for any commit check. Source checks and mocked flows do not establish live label-to-render behavior. Public previews must contain only synthetic data.
