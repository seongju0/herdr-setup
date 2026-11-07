# Linear panel

A raw native Herdr mod, with no build step. Supported on **macOS with Herdr 0.1.13**. The optional installer/test runner uses Node 26; the mod itself does not use Node. [Recipe](RECIPE.md). Previews are cropped native-app captures using only synthetic demo issues.

![Linear panel, narrow](preview.png)

[Wide responsive view](preview-wide.png).

## Views and refresh

All three views are scoped to your configured team:

- **Assigned:** assigned to you.
- **Created:** created by you, including work assigned to someone else.
- **Current cycle:** in the active cycle and assigned to **or** created by you, without duplicates.

Rows adapt as you resize the panel: stacked details when narrow, aligned identifier/title/status columns when wide. Actual workflow status and project context stay visible. Issue/project links open in Linear; there is no editor or mutation UI. Include closed reveals completed/canceled/duplicate issues.

Load/reopen and explicit Refresh fetch data; a view loads lazily on first selection. There is no polling. A failed refresh retains the last successful list with a stale notice.

For synthetic local testing, set `"demo": true` in the local config and press Refresh. The panel clearly labels demo data and does not contact Linear or read Keychain. Set it back to false (or remove it) for live data.

## Files and native convention

```text
customizations/linear/
  config.example.json          # synthetic non-secret settings
  mods/linear-panel/
    main.js                    # GPUI view, including toolbar mode
    api.js                     # read-only Linear HTTP / cursor pagination
    demo.js                    # explicitly labeled synthetic preview data
    model.js                   # issue presentation and state helpers
    mod.json                   # native manifest
    icons/                     # local native assets
```

Herdr loads `mods/<name>/main.js` using `gpui-kit` and `herdr`, with native mod metadata in `mod.json`. Layout blocks select the mod with `content.mod`; `content.props` selects toolbar mode. It is not a webview or an npm package. Installed API definitions in the Herdr home (`herdr.d.ts`, `gpui-kit.d.ts`) are the API authority.

## Manual install (first-class)

1. Locate the Herdr home for the intended app instance (normally `~/.config/herdr-app`). Inspect for existing `mods/linear-panel`, `config/linear-panel.json` and `layouts/herdr-setup-linear.json`. Preserve them: do not copy over conflicting files. Copy the entire source `mods/linear-panel` directory into that home's `mods/` as an ordinary directory, not a symlink. Git pulls must not hot-change live code.
2. Create `config/` if needed and copy `config.example.json` to `config/linear-panel.json` only if absent. Edit it locally for your team key and workspace URL slug. Use these non-secret fields (optional `"demo": true` enables labeled synthetic data without Keychain or network access):

   ```json
   { "team": "ENG", "workspace": "example-workspace" }
   ```

3. Copy the installed `layouts/main.json` to **`layouts/herdr-setup-linear.json`**, leaving shipped `main.json` untouched. In the new file, wrap the `tabs` block in a row with ID `tab-bar` if it is not already in that row. Move its fixed height to the row and give the tabs block `size: {"weight": 1}`. Append this button block to the row:

   ```json
   {
     "id": "linear-button", "type": "block", "size": { "px": 86 },
     "content": { "mod": "linear-panel", "props": { "button": true } }
   }
   ```

   Keep the existing `panel` column, including its sizing and hidden state. In its `panel-body` **stack**, retain existing children and active selection and append:

   ```json
   {
     "id": "linear-panel", "type": "block",
     "content": { "mod": "linear-panel" }
   }
   ```

   IDs are part of the native contract: `panel` is the containing panel, `panel-body` is the stack, and `linear-panel` is its child. Keep all IDs unique. If your layout differs, merge intentionally rather than replacing its structure.
4. Set up credentials below, then review/check the native files. Activate separately:

   ```sh
   herdr-app check ~/.config/herdr-app/mods/linear-panel
   herdr-app do layout.switch '{"name":"herdr-setup-linear"}'
   ```

   These commands target your running app; do not run them against another home by accident. To return to the shipped layout: `herdr-app do layout.switch '{"name":"main"}'`. Switching layouts is not an uninstall.

Alternatively, use the root [optional installer](../../README.md#install), which performs these copies/layout edits without switching layouts. It preserves valid existing config, refuses differing files, and never merges or updates automatically.

## Credentials

Use **Keychain Access**, not shell commands containing API-key literals:

1. Obtain a personal Linear API key with only the access you need. Do not copy credentials from Pi or another application's MCP caches.
2. Open macOS **Keychain Access**, select the intended login keychain, and create a new password item (File → New Password Item).
3. Set **Keychain Item Name / service** to `herdr-linear`, **Account Name** to `api-key`, and paste the key into the password field. Save. If the item exists, update it in Keychain Access rather than creating ambiguous duplicates.
4. Allow the intended app's Keychain request when appropriate. The mod reads this item locally; the JSON config must never contain a token. Rotate/remove the item through Keychain Access when needed.

Do not put keys in commands, screenshots, Git, config examples or bug reports. Do not print Keychain contents to troubleshoot. A missing/denied credential is an authentication setup issue, not permission to search other credential stores.

## Security and limitations

- Network access is to Linear's GraphQL API (`https://api.linear.app/graphql`) for **read-only queries**. No issue creation, updates or other Linear mutations are part of this customization.
- Native `exec` permission is security-sensitive: credential retrieval uses macOS `security`; opening an issue uses macOS `open`. Review `api.js` and the native mod before installing. Native execution is not a browser sandbox.
- Issue/project URLs returned by Linear are restricted to HTTPS on linear.app; team/cycle links use the configured workspace and team. Treat workspace settings as local configuration; only open intended Linear links.
- Herdr can live-reload personal layout/mod file changes. Review copied code before activation; don't modify shipped files, generated guidance or API definitions.
- Config and Keychain access are local to the machine/app context. Installer `check` verifies packaging, not credentials, real network connectivity or native rendering. Node tests cannot establish GPUI behavior.
- No automatic update, active-layout switch, restart, remote publication or credential migration. To remove: switch away, then remove only the personal files you own after preserving any edits. Do not delete shared directories or the Keychain item if something else uses it.
