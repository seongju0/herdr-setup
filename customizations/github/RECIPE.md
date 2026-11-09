# GitHub PR inbox in the right panel

A native GitHub button beside Linear selects a GitHub child in the same resizable right panel. Clicking the selected button hides the panel. The organization-wide inbox is independent of terminal folders, Git remotes and connected machines. No extra terminal tab or second sidebar is created. See [README.md](README.md) for installation and access boundaries; no native screenshot is supplied or claimed.

## What you see

- An 86px toolbar block contains a 26px GitHub button and original pull-request vector, selected while open.
- Preserve the base panel's geometry/state; the intended base starts at 368px, min 280/max 900. Use theme colors, 10px corners and 13px native text.
- Header: GitHub and Refresh/loading, then wrapping organization and Authored / For me selectors. No inactive queue counts.
- Raised, bordered repository headings show matching PR counts, most recently active matching repository first, ties by name. Within each repository, standalone PRs and native stack units sort by latest matching activity, ties by stable ID.
- PR rows show number, wrapping title, Open/Draft (Closed/Merged for context), and every matching reason or Context. Closed/merged context is muted. Below 620px rows stack content; at 620px and above align 90px number, flexible title, 72px state and 150px reason columns. Keep root/list min_w/min_h 0, list flex_1 with scrollbar, headings/footer/rows flex_none. Do not reserve an empty status viewport.
- A native stack header shows member count and matching count when different. Foundation-first members use ascending native position and a consistent small indent. Unavailable layers are nonclickable. Do not invent a story title, stack URL or position for unknown layers.
- Footer: matching PR count (PRs loaded if incomplete) and last loaded timestamp. Context never adds to queue/repository totals. Demo shows a conspicuous synthetic/no-connection banner.

## How it behaves

- Authored: open by viewer, drafts included. For me: open and directly assigned OR personally review-requested (`user-review-requested:@me`). Team review requests alone do not qualify. Deduplicate node ID within queues, retaining all reasons; overlap across tabs is valid.
- Remember only selected queue, default Authored. Load tabs lazily; cached selection needs no query. Refresh on initial display, reopen and explicit action, never ordinary redraw or a timer.
- Publish matching rows first. Fetch expanded distinct native stack contexts one at a time and cache in memory by viewer/config. Collapse state is in memory by stack ID. Refresh invalidates affected contexts; explicit group Retry retries only that context. No background polling/retry engine.
- Stack header clicks expand/collapse; separate PR row handlers open only that PR's validated HTTPS GitHub.com URL. Group failure never removes matching rows. Null context members become Layer N unavailable unless a matching row already occupies that native position.
- Loading is not empty success. Fully successful empty queues say No open PRs in this queue. Fully failed refresh keeps the prior snapshot/timestamp marked stale; partial fresh results replace rather than silently merge old failed-source data, identify failed sources, and label counts loaded/incomplete. Partial empty is not all-clear. Sanitized setup/CLI/auth/rate guidance never includes raw vendor output.
- Preserve Files/Changes/Linear controls, all base fields, floating workspace-folder observer, per-space panel restoration, settings and running sessions.

## Built from

- `mods/github-panel/main.js`: `GitHubPanel extends View`; `props().button` selects toolbar role, not init args. Register `github-panel` in shared `workspace.panels` without discarding entries. Use `layout`, `layout.select`, `layout.show`/`hide`, `nextCommand`, focus handle, theme and root `on_size_change`.
- Toolbar stays rendered when panel does not. Detect hidden→visible and publish a shared `github-panel.reopen` counter from a task. Panel schedules refresh outside render, using every task/click's own cx; synchronous render notify is forbidden.
- `api.js`: `loadView(exec,config,view)` resolves viewer and runs fixed GraphQL searches; at most two independent source legs at once via simple batches. `loadStack` queries native node(id) PullRequestStack and pages entries. One page per local gh process; explicit nullable cursor variables and cursor guards. Search stops at 1,000 per source and marks incomplete; native stack page size 100 is not a stack-size cap.
- `model.js`: strict config and PR URL boundaries, normalization, dedup/reason/display/count/order rules and `prGroups(snapshot,contexts)`. Queue membership uses only normalized OPEN PRs. Stack IDs/positions come from GitHub, never branches, local checkouts or body markers.
- `demo.js`: public-safe synthetic queue/stack fixtures, bypassing gh/auth/network. `mod.json` has place:none/focusable:true; `icons/pull-request.svg` is an original vector.
- `config/github-panel.json` contains organization, optional ghPath (literal gh or absolute path) and optional demo boolean. Unknown keys or search/path expressions are errors. Resolve viewer through the same local executable; clear scope-specific memory on config/viewer change and reject superseded context generation results. Persist no PRs or credentials.
- Run direct argv `gh api --hostname github.com graphql -f query=FIXED_QUERY -f q=SEARCH -F after=null` (later cursors `-f after=CURSOR`). Stack uses id instead of q; viewer needs neither. All sources use `org:ORG is:pr is:open ... sort:updated-desc`; qualifiers are `author:VIEWER`, `assignee:VIEWER`, or `user-review-requested:@me`. No shell, cwd/on, stdin/env options, --paginate, credential extraction, introspection, membership or check-rollup calls.
- `scripts/setup.mjs makeGithubLayout(base)` clones an explicit base; use existing addTabButton for github-button86px props:{button:true} and append github-panel to panel-body. Copy owned files to a new `herdr-setup-github` layout through existing conflict/symlink preflight and exclusive writer. Preserve valid config and originals. No automatic activation.

## Watch out

Native host APIs, not browser/Node conventions, are authoritative. Exec inherits local auth/environment and has native 30s/8MiB bounds; do not promise to disable inherited debug/prompts or add unsupported stdin/environment options. Sanitize launch/nonJSON/nonzero/GraphQL failures. Preserve valid earlier pages after later source failure, but never call them complete. Use returned union size, not summed issueCounts.

Native stack context may be partial, inaccessible, merged or closed. Keep known matches and native positions; do not fall back to inferred dependencies. Context activity must not promote units or increase counts. One context operation at a time, deduplicated pending IDs, and generation checks protect cleared caches; this is not a scheduler framework or transactional GitHub snapshot.

Only allow canonical `https://github.com/CONFIGURED_ORG/REPO/pull/POSITIVE_NUMBER` without query, fragment, credentials or alternate port/host. Open with `/usr/bin/open` and one URL argument. Vendor strings remain native plain text.

## Done when

- Node 26 `npm test` passes retained Linear/workspace suites, real GitHub API/model/native-class mocked-boundary flows, and actual-source disposable-home composition/conflict/no-op copying.
- `herdr-app check customizations/github/mods/github-panel` passes eager loading. This does not prove later async rows, native geometry or interactions.
- After separately authorized native install/UI checks: 280/368/900 widths and both appearances are readable; stack/null/context/count/collapse/link/loading/error/empty/demo states work; real local gh reads, reopen refresh and per-space selection coexist with existing controls and sessions. Do not claim this acceptance from mocks or source check alone.

No GitHub writes, credential provisioning, automatic membership discovery, branch inference, CI/readiness dashboard, polling, daemon, local checkout or stack editing.
