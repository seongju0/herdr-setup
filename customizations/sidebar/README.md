# Minimal sidebar

An activity-first native Herdr sidebar: task names are the headline, workspace context is quieter, and idle sessions stay available without dominating the list. Compact defaults use 12px task names, 10px metadata and 46px agent rows; terminal fonts and app zoom are unchanged.

## Layout

- **Agents first:** Pinned, Needs you, Working, Done, Current session when needed, then Idle. Empty sections disappear; Idle starts folded. Grouped by space remains available from the sort menu.
- **Task-first rows:** explicitly named tab, meaningful title from that agent's own terminal, then program name. Workspace, remote machine and any required disambiguation sit underneath.
- **Selected idle stays visible:** it appears once under Current session, outside the folded Idle section. Inspecting a finished agent keeps it in Done until you leave it. Native next/previous order does not change just because the selected idle row is promoted.
- **Compact Spaces:** workspace names above repository/branch details, native worktree nesting and machine groups, independently scrollable. Spaces takes its content height, capped at 240px or 38% of the available body height.
- **Recognizable rail:** workspace avatars and aggregate state, not numbered agents. Select a workspace while collapsed, or expand for agent details. All workspaces remain scrollable.

The sidebar starts at 312px and collapses to 76px, leaving macOS window controls clear. It uses Geist UI text and your theme's colors; it does not change terminal typography, the global theme, or keyboard bindings. Native agent next/previous shortcuts and tab search remain available.

Elapsed times describe the agent's **last observed state change**, not task duration or an ETA. Child attention is reflected in the parent's presentation. Real child terminals open with Herdr's native peek; no transcript-derived progress bars are added.

## Requirements and access

macOS, Herdr **0.1.13**, and a base layout with the shipped sidebar structure. Installer/tests use Node **26**; the mod itself uses native GPUI JavaScript, without Node, React, a webview or a server.

The mod reads native agents, terminals, spaces and focus. The adapted Spaces implementation retains local/remote read-only Git commands, local Git-folder watching, machine inventory and the shipped worktree-order correction. User actions can select/reorder spaces, pin agents, peek children, open native menus or explicitly reconnect a rebuilt machine. It does not read agent transcripts, contact an API, publish Pi metadata, or calculate context, cost or completion estimates.

## Install separately from activation

Choose the **latest combined layout**, including any GitHub, Linear or Files/Changes customizations you want to retain:

```sh
node scripts/setup.mjs plan sidebar --base-layout YOUR-COMBINED-LAYOUT
node scripts/setup.mjs install sidebar --base-layout YOUR-COMBINED-LAYOUT
node scripts/setup.mjs check sidebar --base-layout YOUR-COMBINED-LAYOUT
```

`--base-layout` is required. `--home PATH` selects a different Herdr home; `HERDR_APP_HOME` is also supported. No team/workspace flags or config file are needed. Installation previews its plan and asks before copying; `--yes` approves unattended copying.

The installer creates `mods/sidebar/` and `layouts/herdr-setup-sidebar.json`. It clones your selected layout and changes **only the supported sidebar subtree**, leaving the terminal area, top-right buttons/panels and floating entries intact. It never edits the base, shipped mods, settings, keys or credentials. A fresh generated layout has separate Herdr click-state; transient layout clicks are not copied.

Custom or already-transformed sidebars are refused rather than guessed at. Conflicting files and directory symlinks are refused before copying; identical installation repeats are a no-op. Source updates or a changed base require deliberate comparison/merge, not forced overwrites. A failed write can leave partial files/directories: inspect the reported paths before retrying.

Check native loading, then activate **only when ready**:

```sh
herdr-app check customizations/sidebar/mods/sidebar
herdr-app do layout.switch '{"name":"herdr-setup-sidebar"}'
```

The first command loads the source package once; it is not a visual or async integration check. For another checkout/home, pass the matching mod path and Herdr instance. Installation does not activate the layout. To return, switch to your previous layout by name; that layout remains unchanged.

## Verification

```sh
node --test tests/sidebar.test.mjs tests/setup.test.mjs
npm test
```

The native-host flow suite runs the actual local module graph with GPUI/Herdr/process/watch boundaries stubbed. Installer tests use temporary homes. Neither proves real native layout, scrolling or async integration: verify the activated sidebar at expanded/rail widths, short window height, both appearances, long names and many sessions. Check pinning, completion/idle behavior, children, worktrees, menus, native agent navigation and existing right-panel access. No live installation or native screenshot is implied by the source package.

## Source and license

Adapted from Herdr v0.1.13, commit `93b097f6e29fcb2d90a30dea2f03ce4e5dee7981`: [upstream source](https://github.com/herdrdev/herdr-app/tree/93b097f6e29fcb2d90a30dea2f03ce4e5dee7981/defaults/mods). See the installed mod's `LICENSE-HERDR`, `LICENSE-ICONS-LUCIDE.txt` and `NOTICE` for Apache-2.0 code and Lucide/Feather ISC/MIT icon attribution. New code is MIT licensed. [Crew](https://github.com/h4ckm1n-dev/herdr-mods/tree/main/crew) inspired the visual hierarchy; its code and transcript scanners are not included.
