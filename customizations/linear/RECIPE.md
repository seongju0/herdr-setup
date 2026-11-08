# Linear in the right-hand panel

A responsive native list of your assigned issues, issues you created, and personal work in the team's active cycle. Open it with the Linear button beside Files and Changes; follow links to Linear to edit issues.

![Linear panel with synthetic demo issues](preview.png)

[Wide view](preview-wide.png). Both captures use synthetic data and are cropped to the panel.

## Appearance

- An 86px toolbar block holds a 26px Linear button, selected while the panel is open.
- The existing right panel starts at 368px and resizes from 280–900px. It uses theme colors and 10px corners.
- Header: Linear icon, team key, and Refresh/loading control. Selectors: Assigned, Created, Current cycle. The cycle header shows its returned name or number, dates, and link.
- **Group by: Status | Project** appears in Assigned and Created. Status is the default; each tab remembers its choice. Current cycle uses status groups.
- Status groups put started work first, then unstarted/backlog/triage. Project groups sort alphabetically, with **No project** last. Both grouping modes, including Current cycle, use raised, bordered headers with larger semibold names and count badges. Each heading shows its visible issue count; flat lists sort by most recently updated and retain row statuses. **Include closed** reveals terminal states.
- Below 620 logical pixels, rows stack identifier/status, wrapping title, project, and assignee. Wider rows align an 84px identifier, flexible title/project, and 112px status/assignee column. Created/cycle show the assignee, including You or Unassigned.
- Footer: closed toggle/count, total count, and last successful update time. Counts cover the complete, deduplicated dataset.
- Demo mode labels its synthetic data and skips credentials/network access.

## Behavior

- Assigned = configured team AND viewer is assignee.
- Created = configured team AND viewer is creator, including issues assigned to others.
- Current cycle = configured team AND active cycle AND (viewer is assignee OR creator), deduplicated.
- Group cached issues locally when the grouping changes; preserve the existing closed filter and dataset counts.
- Fetch on initial load, reopen, and Refresh. Tabs load lazily and retain their data until refreshed; cycle refresh resolves the active cycle again. No polling.
- Issue/project links open HTTPS Linear URLs in the system browser. The cycle title opens the team's active cycle.
- Initial failures show errors; failed refreshes retain the last successful list with a stale notice. An absent active cycle has its own empty state.
- Files/Changes and per-space panel visibility are preserved. Issue data follows the configured team and viewer, independently of the selected terminal.

## Implementation

- `mods/linear-panel/`: `main.js` owns rendering, lifecycle, Keychain, and URL actions; `api.js` owns GraphQL/pagination; `model.js` owns config/filter/grouping/navigation checks; `demo.js` supplies synthetic fixtures. `mod.json` and `icons/linear.svg` complete the mod.
- Generate `herdr-setup-linear.json` from installed `main`: wrap tabs in a `tab-bar` row, append a `linear-panel` button with props `{ "button": true }`, and add its panel child. Preserve shipped files and IDs `panel` / `panel-body` / `linear-panel`.
- Register `linear-panel` in shared `workspace.panels`, preserving existing entries. Toggle through `layout.select` and `layout.show`/`hide`; use root `on_size_change` for responsive rows.
- Hidden panels do not render. The toolbar detects reopen transitions and publishes a shared request counter from a task; the panel schedules refresh outside render. Each async callback uses its own context. Never call `notify` synchronously during render; tests must model both copies and skip hidden renders.
- Local `config/linear-panel.json` holds team, workspace slug, and optional demo boolean. Resolve the viewer from the credential. Examples use ENG/example-workspace.
- Read Keychain service `herdr-linear`, account `api-key`, via `security`; query `https://api.linear.app/graphql`; open links via `open`. [Setup details](README.md).

## Maintenance and verification

- Target macOS and Herdr 0.1.13; use Node 26 for installer/tests. Installed API definitions are the host authority and stay outside Git.
- Paginate fully and fetch list metadata only. Keep credentials in Keychain and issue data in memory. Sanitize remote errors before display.
- Review native exec/network access before installation. Copy rather than symlink, preserve conflicting files, and activate the layout explicitly. Source updates leave installed copies unchanged.
- Check the installed mod with `herdr-app check` and inspect `status` for errors. Verify Files/Changes coexistence, tab transitions, external links, per-space restoration, reopen refresh, narrow/default/wide layouts, and light/dark themes in the native app.
- Cover team/actor/cycle filters, pagination/deduplication, rollover/no cycle, status/project grouping and persistence, and refresh failures with synthetic fixtures and host/network stubs. Verify Keychain/API integration separately.
- Herdr's `shot` captures the last rendered frame, which may be stale when the window is covered. Inspect each image. Public previews must be cropped native captures containing only synthetic data.
