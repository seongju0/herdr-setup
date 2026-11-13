# Personal-layout keyboard shortcuts

Portable, opt-in bindings for the combined **My Herdr** layout. [keys.json](keys.json) contains only these two shortcuts, not a complete personal keybinding file.

| Shortcut | Action in `my-herdr` |
| --- | --- |
| **⌘B** | Collapse the custom sidebar to its 76px icon rail, or restore its saved expanded width. Does not hide it. |
| **⌘⇧E** | Show/hide the right-hand panel, preserving its selected view. Usually Files; if GitHub or Linear is selected, it toggles that view instead. |

## Apply

1. Install the [sidebar customization](../sidebar/README.md) with its `sidebar.toggle-sidebar` command, and use a combined personal layout named `my-herdr` containing `sidebar` and `panel` nodes. These bindings do not create the layout or install any mods.
2. Back up your existing Herdr `keys.json` under `~/.config/herdr-app` (or your custom Herdr home).
3. **Merge** the `layout:my-herdr` section from this directory's [keys.json](keys.json) into your existing file. If that section already exists, add or update just its `cmd-b` and `cmd-shift-e` entries. Keep its other bindings and all other sections. Do not copy this fragment over your entire file or create duplicate JSON section names.

```json
"layout:my-herdr": {
  "cmd-b": "sidebar.toggle-sidebar",
  "cmd-shift-e": "layout.toggle:panel"
}
```

Herdr applies keybinding edits live; no restart is needed. These layout-specific bindings override the corresponding global bindings only while `my-herdr` is active. Terminal/mod-specific bindings take precedence if you have defined the same shortcut there. If you deliberately use a different layout name with the same custom nodes, change the section name to match it.

The repository's installer does **not** apply these bindings automatically. Pulling the repository also leaves your installed keys unchanged. To undo, restore the previous values for these two entries (or remove the entries if they did not previously exist); keep unrelated bindings intact. Removing the scoped `cmd-b` override lets the existing global hide/show binding apply again.
