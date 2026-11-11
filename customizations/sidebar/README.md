# Minimal sidebar

A native Herdr sidebar with agents grouped under their spaces, task-first rows and focus-acknowledged attention. Compact defaults use 12px task names, 10px metadata and 46px agent rows; terminal fonts and app zoom are unchanged.

## Layout

- **One list:** each selectable space header is followed by indented agents along a subtle hierarchy guide. Space names are stronger section labels; the active space has a slim accent, while only the focused agent gets the selected-row fill. Terminal-only spaces remain visible. Machine headers, Git/worktree metadata, native menus and same-machine drag ordering stay available.
- **Collapsible spaces:** the chevron folds only that space’s agents and remembers the choice locally. Clicking the name still selects the space; folding never focuses, acknowledges attention or changes native next/previous order. Folded headers retain aggregate status and unread marks. Rail navigation remains independent of these folds.
- **Recent spaces first:** focusing a space promotes its group within its machine; background agent activity does not reshuffle spaces. Worktrees move with their parent as one family, keeping their native internal order. Recent focus is remembered locally; unvisited groups retain native order. This is display-only and does not issue native reorder commands.
- **Attention within each space:** blocked agents first, then unread/completed agents, pins, working agents and idle agents. Pins remain in their own space. Native order breaks ties.
- **Task-first identity:** explicitly named tab, meaningful own-terminal title, then program name. Workspace, remote machine and necessary tab/address disambiguation sit underneath.
- **Unread is separate from status:** an observed completion or new blocking state adds a small unread marker. Focusing that root agent by sidebar, pane or native keyboard navigation acknowledges it. Genuine blocking remains urgent until resolved. Folding and pinning do not themselves acknowledge.
- **Recognizable rail:** workspace avatars, truthful aggregate state and separate unread marks. Every workspace remains reachable while collapsed; expand for detailed agents.

The sidebar starts at 312px and collapses to 76px, leaving macOS window controls clear. It uses Geist UI text and your theme's colors. Search, Settings and Add machine remain native; no global keybindings or terminal typography change.

Native next/previous follows stable native space order (not the focus-driven recent-space display), then pins/native agent order within each space. It deliberately does not follow the changing attention-first visual order, so acknowledging an agent does not make traversal revisit it. The header's attention control cycles through agents currently needing attention.

Elapsed times describe the agent's **last observed state change**, not task duration or an ETA. Live child blocking raises its parent's urgency once; child completion does not create an independent unread history. Child rows open native terminal peek. Focus resulting from any native action acknowledges the actually focused root.

Unread is **per sidebar instance and best effort**: native viewing on another client can clear Done without clearing this window's unread, but turns or repeated states entirely between observations may be missed. Restarting/recreating the layout drops these extra marks. No transcript-derived history, event counter or persistence guarantee is implied. An unacknowledged marker can coexist with a later Working state.

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

The mod reads native agent, terminal, space and focus state. Spaces retains local/remote read-only Git, local Git-folder watches, machine inventory and native worktree-order correction. Creation reads the existing roots config, performs bounded directory discovery/listing and checks installed launchers. Explicit actions can create a space/program, select/reorder spaces, pin agents, peek children, open native menus or reconnect a rebuilt machine. It does not read transcripts, contact an application API, write configuration, publish Pi metadata or calculate context/cost/progress estimates.

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
