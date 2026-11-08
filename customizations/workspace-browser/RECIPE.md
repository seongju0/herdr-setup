# Files and Changes that follow Pi

A native Herdr folder control shared by Files and Changes. Follow the current Pi session directory, including `/move`, or pin another folder per tab. Keep the existing file browser, diff viewer and repository-wide commit action. [Installation and access](README.md)

## Appearance

- A compact 160px folder block sits beside the tab controls. Show Session/Pin plus a truncated folder name; keep the full path and machine readable in the picker.
- Files and Changes headers identify mode and chosen path and open the same selector. Changes also identifies the resolved Git repository/worktree root and “All repository changes.”
- Use Herdr theme colors and existing panel sizing, borders, scrolling, previews and diff treatment. Keep the Files/Changes buttons and layout block IDs.
- The native dialog has a focused search field, selectable known directories, a pasted-path action, Follow session and local Browse. Support Up/Down, Enter and Esc.

## Folder behavior

- One persisted tab record, keyed by exact space/tab IDs, owns the pin, remembered Pi terminal and up to ten explicit recent choices. Use shared key `herdr-setup.workspace-browser.v1`, not per-copy localStorage.
- Follow a live, Pi-reporting terminal associated with this tab: focused Pi, otherwise remembered eligible Pi, otherwise first Pi pane. Shell focus must not steal selection; do not discover sessions by scanning background children or other tabs.
- The always-visible toolbar observes focused Pi even while panels are hidden. Read `pi.session-id` and absolute `pi.session-cwd` from native terminal labels. Publish changed preferences from task/event contexts, never during render.
- A pin overrides directory changes but not observation. Clear it to use the latest session label immediately. Switching tabs restores independent preferences.
- Missing Pi metadata is an explicit unavailable state, not an excuse to use shell cwd as Pi cwd. With no Pi in the tab, identify the usual pane/terminal/space-folder fallback.
- Search session, pane, space and recent paths with bounded case-insensitive subsequence matching. Do not run fzf or index the disk. Accept absolute pasted paths and local `~/`; reject relative paths and NUL.
- Validate on the captured machine before pinning. A failed choice preserves the old selection; Browse cancellation is a no-op. Local system Browse is unavailable for remote targets. Keep the captured tab/machine through async work, and never apply a result to a newly focused tab.
- Files uses the exact selected directory. Changes resolves its containing Git root without changing that shared selection. A non-Git folder remains browsable. Unreadable/offline pins keep their own error rather than switching targets.

## Native implementation

- Package one `mods/workspace-browser/` directory. Host imports cannot cross a mod directory, so keep shared context and helpers inside it.
- `main.js` is the sole native View. Select a plain implementation object using `props.view` (`files`, `changes`, `toolbar`, `picker`), forward init/render/optional close with the root's current context, and return the implementation's element. Default to files; reject unknown views. Do not cache a Context or depend on retained-child invalidation behavior.
- `context.js` owns the policy and IO key (space/tab/machine/directory). `folder-toolbar.js`, `folder-picker.js` and `folder-controls.js` consume it. `files.js` and `changes.js` adapt the shipped views; `directories.js` retains the existing bounded Unix/Windows folder operation. Copy required icons into the customization.
- Retain context checks on async directory/file/Git reads, old-result rejection, local watchers, remote polling and existing refresh interval. Never display or commit an old repository as if it belonged to a new selection.
- Preserve Changes' commit guard and captured root/machine for both `git add -A` and `git commit`. An in-flight commit finishes against that captured repository; do not redirect, add locks or retry writes automatically.
- Pi owns the metadata transport: extend pi-setup's existing `herdr-session` publisher to label the current session ID/cwd on interactive startup and replacement session_start. Publish independently of research restoration; preserve copied-worker ownership rejection. No Pi core patch or session-record reader.

## Packaging

Generate `herdr-setup-workspace-browser.json` from installed `main` or an explicitly named Linear base. Replace only the expected Files/Changes content; preserve their IDs, existing buttons, sizing, panel state and Linear. Add `workspace-folder-button` with props `{ "view": "toolbar" }`. Reject custom content that needs a manual merge.

Keep the existing installer's read-only preview, conflict/symlink checks, exclusive copies, partial-write reporting and separate activation. Workspace installation leaves Linear config and Pi setup alone. Preserve upstream modification notices and both licenses (`LICENSE`, `LICENSE-HERDR`) plus `NOTICE` with the installed mod.

## Verification

Use Node 26 and the repository's existing native-host/temporary-home test patterns. Cover the real toolbar/picker/panel flow: follow/move, pin/move/unpin, shell focus, tab persistence and focused second Pi while panels are hidden. Cover wrong-target write prevention, stale reads, bad/non-Git folders and remote routing at the external process/host boundary. Keep existing Linear coverage and verify installer composition and conflict refusal.

Check native source with `herdr-app check`. Separately, when authorized, verify actual Pi startup/resume/move, folder selection, hide/reopen, tab transitions, non-Git messaging, narrow/default layouts and light/dark appearance. Use an owned synthetic repository for any commit check. Source checks and mocked flows do not establish live label-to-render behavior. Public previews must contain only synthetic data.
