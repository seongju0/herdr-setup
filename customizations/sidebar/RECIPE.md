# Minimal sidebar

A native agent overview grouped by space, with focus-acknowledged unread attention and named space creation. Repository source is authoritative; installation and activation are separate actions.

## Shape

```text
sidebar (312px, min76/max480, Geist UI)
  brand (76px, draggable) -> sidebar {view:brand}
    32px OS clearance; logo, create +, search, collapse
  sidebar-lists (flex)    -> sidebar {view:body}
    Agents / attention header
    one scroll list: machine > space > agent > child
  sidebar-footer (44px)   -> sidebar {view:footer}
    Settings / update indication / Add machine
```

At widths below160px, show the existing workspace-avatar rail and Expand control. Collapse selects76px; restoration clamps saved width260–480px, default312px. Terminal fonts, zoom, global theme and shortcuts remain unchanged. Compact roots46px, children24px, titles12px and metadata10px.

## Policy and ownership

- `main.js` is the one native View routing body/brand/footer/create. Each role owns its lifecycle; callbacks use their delivered context, not a saved `cx`.
- `body.js` captures native state, prepares space ordering once, asks Agents for its model and registers stable native next/previous order in expanded and rail modes.
- `spaces.js` retains Git/cache/watch, automatic worktree ordering, machine loading/offline/rebuilt UI and explicit reconnect, menus, drag ordering and rail navigation. Expanded space rows have agent rows directly beneath them; no lower Spaces section or height allocation. Independent space chevrons fold agents, with inset guides and a slim active-space accent distinct from the focused-agent fill.
- Recent-space ranking qualifies a continuous 30-second same-space visit while `window().active`; reading counts, background work/short peeks/time away do not. `recentOrder(rows,snapshot)` observes visits and sorts by a frozen visible rank; the existing 250ms `checkNew` timer also observes focus/window transitions. Persist qualified MRU IDs at `herdr-setup.spaces.recent`; apply them on observed window return or sidebar recreation only. Reuse legacy saved order as the starting point, not reconstructed work history. Rank whole worktree families within each machine, retaining internal native order. No input interception, OS-idle claim, extra polling service or recency-driven `space.move`.
- `agents.js` owns task identity, live child-aware status, per-instance unread observations and agent rows. All spaces remain headers even without reporting agents. Pins stay within each space.
- Display tiers: blocked, unread/done, pinned, working, idle. Native order breaks ties. Keyboard next/previous deliberately uses stable space/pin/native order instead of these changing tiers.
- Unread is a separate marker, never a replacement live status. Observed new Done or effective Blocked arms it; native root focus acknowledges it. Native idle or later working does not erase unread while unfocused. Focus wins in the same snapshot; a focused completion is already seen. Blocking remains urgent after acknowledgement. No seq-based completion counter, persisted history or transcript scan.
- Root rows retain `pane.focus`, children `terminal.peek`, pins `terminal.pin`. Fold/pin do not acknowledge by themselves. Native focus resulting from any command does.
- Keep explicit tab/own-title/program identity, duplicate disambiguation, exact machine-qualified addresses and normalized observed-state ages. Child error raises parent blocking; child done remains idle; count roots once.

## Creation

`chrome.js` top + opens `{view:"create", machine:""}`. Machine + opens the same dialog for that machine. `create.js` owns optional name, directory search/selection, installed-launcher choices and submission. Name blank preserves native automatic naming; Pi is default when installed, otherwise Terminal. Other installed harnesses are explicit alternatives.

Reuse package-local `directory-search.js` and `directories.js` from workspace-browser, with source parity checked in tests. Adapt picker interaction without workspace-browser pin/follow effects. Read shared `config/workspace-browser.json` searchRoots; no sidebar config write or duplicate roots file. Default captured folder, no automatic whole-home scan. fd discovery is bounded/local-only with existing missing-executable-only optional Pi-managed fallback; explicit local paths have bounded cached completion. Remote creation accepts known folders/explicit absolute paths and validates on the target machine.

Selecting a result only fills the directory field. Final Create validates absolute/NUL-free directory and name, checks the folder, then calls one native `space.new` with optional name and program-owned argv. Terminal omits argv. Block duplicate submission; cancellation/closure before validation completes must not create later. Validation errors stay inline; after dispatch native Herdr owns actual structural/launch failures. `run` returns null, not confirmed success or transactional rollback.

## Packaging and effects

The installer recursively copies one standalone mod and required resources, clones an explicitly selected supported base sidebar only, and preserves outside-sidebar JSON, panels, floats, settings and credentials. Directory helpers do not depend on another installed mod. Retain upstream/Files attribution. No force mode, snapshots or generated typing changes.

Access: native snapshots and existing selection/pin/worktree actions; read-only Git/watch/machine inventory; bounded directory discovery/listing; local roots config read; installed-launcher checks and explicit space/program creation. Reconnect remains an explicit user action. Never publish local configuration or private frames.

## Verification and limits

Extend existing `tests/sidebar.test.mjs` U1–U3 and creation U4 with real local modules behind native/GPUI/process boundaries; retain `tests/setup.test.mjs` composition/conflict lifecycle. Workspace-browser tests own detailed discovery cases, sidebar checks helper parity. Run documented Node tests and native source check; no new test framework.

Per-instance unread is best effort and can miss whole turns/repeated events between observations. Focus includes incidental keyboard visits. Headless tests do not establish native focus/seen propagation, GPU scrolling or real launch outcomes. A one-shot `herdr-app check` is not live interactive acceptance.

After separately authorized activation, check root focus by row/pane/keyboard, stable traversal, subsequent attention, creation and failures, scrolling/dialog fit, long/many sessions, expanded/rail/short windows, both appearances and existing worktree/machine/menu/panel access. No actual reconnect or remote removal just for QA.

See [README](README.md) for install/activation commands, roots configuration, effects and licensing. Source changes belong in herdr-setup; do not patch only the live home.
