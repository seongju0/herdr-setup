# Minimal sidebar

A quiet native Herdr left sidebar for overseeing coding agents. Tasks get the headline, agent state determines the default groups, and Spaces is compact navigation below. The rest of the window stays yours.

## What you see

A 312px sidebar on the current theme's `chrome` background, with Geist UI type:

1. **Brand, 76px:** 32px clear for macOS traffic lights, then a 44px Herdr identity/search/collapse row. The existing layout's brand block remains draggable; controls stop the drag press.
2. **Body, flexible:** Agents above Spaces. Agent titles are 13px, metadata 11px, row selection/hover subtle and rounded 6–8px. Fixed status and elapsed-time slots keep columns aligned. Spaces is content-sized, capped at 240px or 38% of body height; both lists scroll independently.
3. **Footer, 44px:** Settings, update-ready indication, Add machine.

Below 160px width, the body becomes one scrollable workspace-avatar rail with state indicators and a persistent Expand control. Collapsing selects 76px to leave macOS controls room; expansion restores the remembered expanded width, clamped to 260–480px, or 312px initially.

No hard-coded global theme, new terminal styling, bordered card around each agent, context meter or fabricated progress bar.

## How it behaves

- Default groups: Pinned, Needs you, Working, Done, optional Current session, Idle. Empty groups disappear; Idle initially folds. Sort menu also offers Grouped by space.
- Agent identity: explicitly named tab, else meaningful own terminal title, else program. Workspace/remote machine beneath; tab/address context disambiguates duplicate names.
- Working uses a native spinning SVG; blocked has an exclamation/attention signal; done a check; idle a ring. Color is supplemented by shape, text and tooltips.
- Native semantic urgency remains blocked > done > working > idle, including child attention; visual group order puts Working before Done.
- Clicking a root agent focuses its pane. Child rows open native terminal peek. Child fold and pin controls stop propagation. Native pins remain authoritative.
- Viewing Done may make core report idle; keep the row in Done until you leave. A selected idle root that is not pinned/held-Done appears once under Current session, not in folded Idle. That promotion must not change canonical next/previous-agent order.
- Elapsed time is since the last observed own-state change. Normalize done/idle when tracking so viewing a result does not reset it. Do not claim exact historical task duration.
- Space rows keep native selection, right-click menus, same-machine drag ordering and worktree nesting. Repository/branch/ahead-behind metadata goes below identity, with counts neutral and nonshrinking.
- Preserve native first-live-folder detection, read-only Git arguments, watch/cache/fallback, machine loading/offline/rebuilt UI, and explicit reconnect behavior. Do not initiate repair just to render.
- Rail click selects a workspace and stays collapsed; right-click keeps its space menu. Expand for detailed agents. All spaces remain scrollable. Existing native agent next/previous order remains registered even in rail mode.
- Search opens native picker; footer opens native settings/machine-add. No new global keybindings.

## Built from

`mods/sidebar/main.js` is one native View routing `props().view` to `brand`, `body`, `footer`, or `agents-sort`. `body.js` owns the actual measured width/height and the two stateful sections. `agents.js` owns agent presentation and canonical navigation order; `spaces.js` adapts shipped Git/worktree/machine behavior; `chrome.js` owns brand/footer controls. `ui.js` holds the single styling/width-helper copy. Native callbacks own their context; never keep a `cx` for later.

A generated layout changes only:

```text
sidebar (312px, min76/max480, ui_font Geist)
  brand (76px, draggable) -> sidebar {view:brand}
  sidebar-lists (flex)    -> sidebar {view:body}
  sidebar-footer (44px)   -> sidebar {view:footer}
```

Generate from an **explicitly selected existing base** with `scripts/setup.mjs`, never a stale whole-window snapshot. Preserve all non-sidebar content: GitHub/Linear buttons and panels, Files/Changes, terminal frames, root floats and unrelated metadata. Reject unsupported sidebar structures/conflicts; no forced overwrite. Installation copies only; activation is separate.

Live native functions: agents/terminals/panes/spaces/focused/theme/layout/shared; setAgentOrder; native run/openOverlay commands. Spaces retains exec Git, watchFolder and hc machine inventory. Shared width/sort state is namespaced `herdr-setup.sidebar.*`; workspace colors use the existing `space.colors` mapping with deterministic nonpersistent fallback. No transcript scanner, API fetch or new metadata publisher.

Code adapts Herdr v0.1.13 at `93b097f6e29fcb2d90a30dea2f03ce4e5dee7981`. Package copied SVGs locally and preserve the Apache-2.0 and Lucide/Feather notices. Keep generated typings, config, credentials and runtime state out of the package.

## Watch out

- HTML design studies are approximations, not native rendering proof. Capture a native synthetic preview only after authorized installation/activation; do not substitute a screenshot of the study.
- Resolve own agent titles, not a shared lead pane's title when multiple agents occupy a tab.
- Compute canonical navigation before promoting selected idle, or repeated next can bounce between sessions.
- Core owns completion/attention; don't create a second status protocol or count a child twice as a root.
- The current active base may change during other work. Re-read it before integration; never erase another owner's GitHub panel.
- New generated layouts have independent Herdr click-state. Do not copy `.state` files or promise to preserve transient clicks.
- Proxy native-host tests cannot prove GPU layout/scrolling. `herdr-app check` renders once, not every deferred/async state.

## Done when

- Focused native-host and installer tests pass; the full repository test suite remains green.
- `herdr-app check customizations/sidebar/mods/sidebar` passes.
- After separately authorized activation, active, quiet, completion, child/pin and grouped views work; long labels and many sessions/spaces remain scrollable at 312px/76px and short height in both appearances.
- Existing right-side panels, native shortcuts, space menus and worktree behavior remain intact.
- No shipped mod, global key, settings or right-panel definition is overwritten; no transcript scanning or live telemetry claim is introduced.
