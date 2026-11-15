# Minimal sidebar

A native Herdr sidebar listing every tab and pane under its space, with agent status where available and focus-acknowledged attention. Compact defaults use 12px task names, 10px metadata and 46px agent rows; terminal fonts and app zoom are unchanged.

## Layout

- **One complete list:** space → pane, including plain terminals, startup agents, editors and mod panes. Rows follow top-bar tab order, then native pane order; reporting status never determines membership. Tab names appear as muted metadata within each row, not separate group headings. Tabs awaiting pane metadata retain a standalone selectable row. The active space has a slim accent, while the focused pane gets the selected-row fill. Machine headers, Git/worktree metadata, native menus and same-machine space drag ordering stay available.
- **Collapsible spaces:** a separate leading chevron folds that space’s tabs and panes and remembers the choice locally—even when no agents report status. Disclosure and pin controls are siblings of the space-name selection/drag region, not nested inside its pointer handlers. Folding never focuses, acknowledges attention or changes native next/previous order. Folded headers retain aggregate status and unread marks; rail navigation stays independent.
- **Stable order, explicit space pins:** spaces stay in native order, with pinned spaces first within each machine. Use the pin beside a space name to pin/unpin it; this does not select the space or change its agent pins. Worktree families stay together: pinning any member promotes the family. Both priority groups retain native relative order, and unpinning restores the underlying native position. Pins are remembered locally and also prioritize the rail; manage them in the expanded sidebar. Focus, elapsed time, app switching and background activity never reorder spaces.
- **Stable tabs and panes:** status, focus and agent pins do not shuffle this tree. Status/unread summaries stay visible at space headers and the attention jump still visits reporting agents needing you. Agent pins remain native and affect stable agent keyboard traversal, not visual tab/pane priority. Put-away tabs remain listed and selectable with a muted label.
- **Task-first identity:** agent panes prefer meaningful own-terminal titles, then program names. Workspace, remote machine and tab name (when present) sit underneath, with an address only when needed to distinguish panes. Neutral panes also retain their tab name and put-away label as muted metadata. Neutral panes show native title/program/mod identity, with no fabricated idle status, unread or elapsed time.
- **Unread is separate from status:** an observed completion or new blocking state adds a small unread marker. Focusing that root agent by sidebar, pane or native keyboard navigation acknowledges it. Genuine blocking remains urgent until resolved. Folding and pinning do not themselves acknowledge.
- **Recognizable rail:** workspace avatars, truthful aggregate state and separate unread marks. Every workspace remains reachable while collapsed; expand for tabs and panes.

The sidebar starts at 312px and collapses to 76px, leaving macOS window controls clear. Its minimal header reads **herdr** in lowercase with no logo; the collapsed header shows an expand control instead. This does not rename the macOS app or change its app icon. It uses Geist UI text and your theme's colors. Search, Settings and Add machine remain native; terminal typography is unchanged. The `sidebar.toggle-sidebar` command performs the same collapse/expand action as the header button, restoring your saved expanded width (260–480px). To bind **⌘B** in your personal `my-herdr` layout, add `"cmd-b": "sidebar.toggle-sidebar"` to the `"layout:my-herdr"` section of Herdr's `keys.json`; this overrides hide/show only in that layout. Installation does not automatically edit personal keybindings. The [portable keybinding fragment and merge guide](../keybindings/README.md) includes this binding and **⌘⇧E** for the Files/right-hand panel.

Native next/previous follows stable native space order (independent of space-pin display priority), then pins/native agent order within each space. It deliberately differs from the native tab/pane tree, so acknowledging an agent does not make traversal revisit it. The header's attention control cycles through agents currently needing attention.

Space pins affect display only; they do not issue native reorder or agent-pin commands, acknowledge unread attention, or change folds. Existing same-machine drag ordering still updates native order beneath the pinned/unpinned grouping. No recency tracking, dwell threshold or reorder-on-return behavior remains. Previously saved recency history is ignored and left untouched.

Elapsed times describe the agent's **last observed state change**, not task duration or an ETA. Live child blocking raises its parent's urgency once; child completion does not create an independent unread history. Child rows open native terminal peek; a child already represented by a native pane appears there instead of being duplicated inline. Focus resulting from any native action acknowledges the actually focused root.

Unread is **per sidebar instance and best effort**: native viewing on another client can clear Done without clearing this window's unread, but turns or repeated states entirely between observations may be missed. Restarting/recreating the layout drops these extra marks. No transcript-derived history, event counter or persistence guarantee is implied. An unacknowledged marker can coexist with a later Working state.

## Right-click actions

- **Pane row (agent, terminal or mod):** click focuses that exact pane; right-click opens Herdr's native pane menu, including **Close pane**, split and zoom. Closing uses Herdr's existing close flow and affects the chosen pane, not every agent in its tab. Opening the menu does not focus the agent or acknowledge unread attention.
- **Tab without panes:** click selects that exact tab; right-click opens the native tab menu for Rename, New tab and Close. Populated tabs have no separate sidebar header; use Herdr’s top bar for their tab-level menu. Pane-row menus remain pane-specific.
- **Space header or rail avatar:** offers **New tab / agent…** alongside Rename, native Git/worktree actions and Close. The launcher offers Terminal and installed agents for the clicked space's machine. Choosing one creates a new tab in that exact space—even if a different space is focused. Program argv comes from Herdr's installed-agent table; no invented shell command or focus-then-launch workaround.

Checking launchers or opening either menu starts/closes no programs. Missing targets and launcher-check failures do not redirect creation to the active space. Native commands own close/launch failures and any confirmation UI; the sidebar does not claim awaited success.

## Create a space

Use the top-corner **+** for this computer, or a machine header's **+** for that machine:

1. Optionally name the space; blank retains Herdr's automatic folder-based name.
2. Search/select a directory, or enter an absolute path. Choosing a result only fills the field.
3. Choose the first tab's launcher: installed Pi by default, another installed harness, or Terminal. Without Pi, Terminal is the default; a launcher-check failure is shown rather than guessed around.
4. Click **Create**. The directory is checked before one native `space.new` operation. Cancel/Escape creates nothing.

Launcher argv comes from Herdr's installed-program table, not shell interpolation. Directory errors stay in the dialog. Once dispatched, Herdr owns structural/launcher failure reporting; the dialog does not claim transactional success or rollback.

### Directory search

Search reuses the native Files and Changes picker helpers. It reads the same optional local file, `~/.config/herdr-app/config/workspace-browser.json` (or the selected Herdr app home):

```json
{
  "searchRoots": ["~/Work", "~/Projects"]
}
```

No separate sidebar config is created. Without configured roots, discovery uses the captured target space/pane folder when available; it does not silently scan all of home. Invalid config is reported without broadening discovery. Known folders and explicit paths remain usable.

Discovery takes one bounded fd snapshot per root per dialog, includes hidden/ignored directories, excludes `.git` and `node_modules`, retains at most 20,000 directories and displays up to 50 ranked choices. It uses native exec's timeout/output bounds. Existing `fd` is used, with the optional Pi-managed `~/.pi/agent/bin/fd` fallback only when the executable is missing. Nothing is installed. Errors/partial results remain visible.

Local absolute or `~/` paths can complete outside those roots using bounded, cached parent listings. Remote creation offers known remote folders or an explicit absolute path, validated on that machine; recursive discovery, local `~/` expansion and the local system folder picker are not used for remote targets.

## Requirements and access

macOS and native Herdr APIs inspected with **0.1.15**; adapted upstream components originate in **0.1.13**. Installer/tests use Node **26**. The mod uses native GPUI JavaScript without Node, React, a webview or a server.

The mod reads native agent, terminal, space and focus state. Spaces retains local/remote read-only Git, local Git-folder watches, machine inventory and native worktree-order correction. Creation reads the existing roots config, performs bounded directory discovery/listing and checks installed launchers. Explicit actions can create a space/program or a tab in a chosen space, invoke native pane/space close actions, select/reorder spaces, pin agents, peek children, open native menus or reconnect a rebuilt machine. It does not read transcripts, contact an application API, write configuration, publish Pi metadata or calculate context/cost/progress estimates.

## Install separately from activation

Choose the **latest combined layout**, including any GitHub, Linear or Files/Changes customizations you want retained:

```sh
node scripts/setup.mjs plan sidebar --base-layout YOUR-COMBINED-LAYOUT
node scripts/setup.mjs install sidebar --base-layout YOUR-COMBINED-LAYOUT
node scripts/setup.mjs check sidebar --base-layout YOUR-COMBINED-LAYOUT
```

`--base-layout` is required. `--home PATH` overrides the target; `HERDR_APP_HOME` is supported. No team/workspace flags or mandatory config are needed. Installation previews its plan and asks before copying; `--yes` approves unattended copying.

Installation creates `mods/sidebar/` and `layouts/herdr-setup-sidebar.json`, changing **only the supported sidebar subtree** of the selected layout. Terminal layout, right-panel buttons/stacks and floats remain intact. The base, shipped mods, settings, keys and credentials are untouched. Fresh generated layouts have separate native click-state; transient clicks are not copied.

Custom/already-transformed sidebars and conflicting files or directory symlinks are refused before copying; identical repeats are a no-op. Updating an existing installation requires deliberate comparison/merge, not forced overwrite. Failed writes may leave partial files: inspect reported paths before retrying. Git pulls update repository source, not live installed mods.

Check source loading and activate **only when ready**:

```sh
herdr-app check customizations/sidebar/mods/sidebar
herdr-app do layout.switch '{"name":"herdr-setup-sidebar"}'
```

The check loads once; it does not establish visual/async integration. Installation does not activate the layout. Switch to the previous layout by name to return; shared mod folders may still contain updated code.

## Verification

```sh
node --test tests/sidebar.test.mjs tests/setup.test.mjs
npm test
```

The native-host suite exercises the real local module graph, replacing only GPUI/Herdr/process/watch boundaries. Installer tests use temporary homes. Directory-helper parity is checked against Files and Changes, whose existing suite owns detailed fd scenarios. These checks do not prove GPU layout, real native focus/seen effects or a launcher actually starting.

After separately authorized installation/activation, verify focus acknowledgement by row/pane/keyboard, next/previous, the next observed attention event, creation/launcher failures, long labels/many spaces, dialog fit, scrolling, expanded/rail widths, short windows, both appearances, worktrees, machine controls and existing panels. Do not reconnect/remove machines merely to test rendering.

## Source and license

Adapted from Herdr v0.1.13, commit `93b097f6e29fcb2d90a30dea2f03ce4e5dee7981`: [upstream source](https://github.com/herdrdev/herdr-app/tree/93b097f6e29fcb2d90a30dea2f03ce4e5dee7981/defaults/mods). Directory listing/search helpers reuse this repository's workspace-browser customization and retain attribution. See the mod's `LICENSE-HERDR`, `LICENSE-ICONS-LUCIDE.txt` and `NOTICE` for Apache-2.0 code and Lucide/Feather ISC/MIT notices. New code is MIT licensed. [Crew](https://github.com/h4ckm1n-dev/herdr-mods/tree/main/crew) inspired the hierarchy; its code/scanners are not included.
