import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, layout, nextCommand, props, readTextFile, run, setShared, shared, theme } from "herdr";
import { loadStack, loadView } from "./api.js";
import { githubPrUrl, prGroups, reasonLabel, validateConfig, VIEWS } from "./model.js";
import { demoStack, demoView } from "./demo.js";

const LABELS = { authored: "Authored", "for-me": "For me" };
const ICON = "mods/github-panel/icons/pull-request.svg";
const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map(child => find(child, id)).find(Boolean);
function visible() {
  const root = layout(), panel = find(root, "panel");
  return !panel || (!panel.hidden && find(root, "panel-body")?.active === "github-panel");
}
const timestamp = time => { const date = new Date(time); return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; };

export default class GitHubPanel extends View {
  init(_props, cx) {
    this.button = props()?.button === true;
    if (this.button) {
      this.wasVisible = visible();
      const panels = shared("workspace.panels") ?? ["files", "changes"];
      if (!panels.includes("github-panel")) setShared("workspace.panels", [...panels, "github-panel"]);
      return;
    }
    this.view = VIEWS.includes(localStorage.getItem("view")) ? localStorage.getItem("view") : "authored";
    this.snapshots = {};
    this.contexts = {};
    this.collapsed = new Set();
    this.contextPending = new Set();
    this.contextLoading = null;
    this.generation = 0;
    this.loading = false;
    this.error = null;
    this.wide = false;
    this.handle = cx.focus_handle();
    this.refreshRequest = shared("github-panel.reopen") ?? 0;
    if (visible()) this.refresh(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (VIEWS.includes(command)) this.select(command, cx);
        else if (command === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
  }

  clearScope() {
    this.generation++;
    this.snapshots = {};
    this.contexts = {};
    this.contextPending.clear();
    this.viewer = null;
  }

  select(view, cx) {
    if (this.loading || this.view === view) return;
    this.view = view;
    this.error = null;
    localStorage.setItem("view", view);
    if (!this.snapshots[view]) this.refresh(cx);
    else this.requestContexts(cx);
    cx.notify();
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    this.generation++;
    this.contextPending.clear();
    const view = this.view;
    cx.spawn(async cx => {
      let config;
      try {
        const raw = await readTextFile(`${appHome()}/config/github-panel.json`);
        config = validateConfig(JSON.parse(raw ?? "null"));
      } catch {
        this.clearScope();
        this.config = null;
        this.error = "Create a valid config/github-panel.json with organization. Check the GitHub panel README, then Refresh.";
      }
      if (config) {
        if (JSON.stringify(config) !== JSON.stringify(this.config)) this.clearScope();
        this.config = config;
        try {
          const snapshot = config.demo ? demoView(config, view) : await loadView(exec, config, view);
          if (this.viewer && this.viewer !== snapshot.viewer.login) this.clearScope();
          this.viewer = snapshot.viewer.login;
          this.snapshots[view] = snapshot;
          for (const pr of snapshot.prs) if (pr.stack) delete this.contexts[pr.stack.id];
        } catch (error) {
          if (error.viewer && this.viewer && this.viewer !== error.viewer.login) this.clearScope();
          // api.js exposes fixed, sanitized messages; never display native exception payloads.
          this.error = error.message;
        }
      }
      this.loading = false;
      cx.notify(); // Publish matching rows before context enrichment is scheduled.
      if (!this.error) this.requestContexts(cx);
    });
    cx.notify();
  }

  requestContexts(cx) {
    if (this.loading || !this.config) return;
    for (const pr of this.snapshots[this.view]?.prs ?? []) {
      const id = pr.stack?.id;
      if (id && !this.collapsed.has(id) && !this.contexts[id] && this.contextLoading?.id !== id) this.contextPending.add(id);
    }
    this.pumpContext(cx);
  }

  pumpContext(cx) {
    if (this.loading || this.contextLoading || !this.contextPending.size) return;
    const id = this.contextPending.values().next().value;
    this.contextPending.delete(id);
    const generation = this.generation, config = this.config;
    this.contextLoading = { id, generation };
    cx.spawn(async cx => {
      let context;
      try { context = config.demo ? demoStack(config) : await loadStack(exec, config, id); }
      catch (error) { context = { id, complete: false, entries: [], warnings: [error.message] }; }
      if (generation === this.generation) this.contexts[id] = context;
      this.contextLoading = null;
      cx.notify();
      // A superseded operation cannot refill caches; finish it before starting the current queue's work.
      this.requestContexts(cx);
    });
  }

  retry(id, cx) {
    if (this.contextLoading?.id === id || this.loading) return;
    delete this.contexts[id];
    this.contextPending.add(id);
    this.pumpContext(cx);
    cx.notify();
  }

  toggle(id, cx) {
    if (this.collapsed.has(id)) { this.collapsed.delete(id); this.requestContexts(cx); }
    else { this.collapsed.add(id); this.contextPending.delete(id); }
    cx.notify();
  }

  open(url, cx) {
    const safe = githubPrUrl(url, this.config?.organization);
    if (!safe) return;
    cx.spawn(async cx => {
      try { if ((await exec("/usr/bin/open", [safe])).code !== 0) this.error = "Could not open the GitHub link."; }
      catch { this.error = "Could not open the GitHub link."; }
      cx.notify();
    });
  }

  toolbar(t, cx) {
    const on = visible(), reopened = on && !this.wasVisible;
    this.wasVisible = on;
    if (reopened) cx.spawn(async () => setShared("github-panel.reopen", (shared("github-panel.reopen") ?? 0) + 1));
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("github-toggle").h(24).px(8).gap(5).items_center().rounded(6).cursor_pointer()
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).text_size(11).hover(s => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: "github-panel" }); run("layout.show", { id: "panel" }); }
        }).child(svg(ICON).size(14)).child("GitHub"));
  }

  row(entry, t, stackId = null) {
    const { pr, position } = entry, inStack = stackId !== null;
    if (!pr) return div().id(`github-unavailable-${stackId}-${position}`).flex_none().px(14).py(6).text_color(t.dim).whitespace_normal().child(`Layer ${position} unavailable`);
    const state = pr.state === "OPEN" ? (pr.isDraft ? "Draft" : "Open") : pr.state === "MERGED" ? "Merged" : "Closed";
    const reasons = pr.reasons.length ? pr.reasons.map(reasonLabel).join(" · ") : "Context";
    const row = (this.wide ? h_flex() : v_flex()).id(`github-pr-${pr.id}`).flex_none().min_w(0).px(inStack ? 14 : 8).py(7).gap(this.wide ? 10 : 3)
      .rounded(7).cursor_pointer().hover(s => s.bg(t.hover)).text_color(pr.state === "OPEN" ? t.foreground : t.dim)
      .on_click((_e, cx) => this.open(pr.url, cx));
    const number = div().flex_none().text_size(10).text_color(t.dim).child(`${inStack && position !== null ? `${position}  ` : ""}#${pr.number}`);
    const title = div().min_w(0).whitespace_normal().child(pr.title);
    const metadata = div().text_size(10).text_color(t.muted).whitespace_normal().child(`${state} · ${reasons}`);
    if (this.wide) return row.items_start().child(number.w(90)).child(title.flex_1())
      .child(div().w(72).flex_none().text_size(10).child(state))
      .child(div().w(150).flex_none().text_size(10).text_color(t.muted).whitespace_normal().child(reasons));
    return row.child(number).child(title).child(metadata);
  }

  render(cx) {
    const t = theme();
    if (this.button) return this.toolbar(t, cx);
    const request = shared("github-panel.reopen") ?? 0;
    if (request !== this.refreshRequest) {
      this.refreshRequest = request;
      cx.spawn(async cx => this.refresh(cx));
    }
    const snapshot = this.snapshots[this.view], groups = prGroups(snapshot, this.contexts);
    const root = v_flex().id("github-panel-root").size_full().min_w(0).min_h(0).rounded(10).overflow_hidden()
      .border_1().border_color(t.border).bg(t.background).text_color(t.foreground).text_size(12).track_focus(this.handle)
      .on_size_change((size, cx) => { const wide = size.width >= 620; if (wide !== this.wide) { this.wide = wide; cx.notify(); } });
    root.child(h_flex().flex_none().flex_wrap().px(10).py(6).gap(8).items_center().justify_between().border_b(1).border_color(t.border)
      .child(h_flex().gap(7).items_center().child(svg(ICON).size(14).text_color(t.accent)).child(div().font_semibold().child("GitHub")))
      .child(div().id("github-refresh").px(8).py(4).rounded(6).border_1().border_color(t.border).text_size(10).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.refresh(cx)).child(this.loading ? "Loading…" : "↻ Refresh")));
    root.child(div().flex_none().px(10).py(5).text_size(10).text_color(t.dim).whitespace_normal().child(this.config?.organization ?? "Setup"));
    root.child(h_flex().flex_none().flex_wrap().p(5).gap(3).border_b(1).border_color(t.border).children(VIEWS.map(view =>
      div().id(`github-view-${view}`).px(8).py(4).rounded(6).cursor_pointer().text_size(11)
        .bg(this.view === view ? t.selected : t.background).text_color(this.view === view ? t.foreground : t.muted).hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.select(view, cx)).child(LABELS[view]))));
    if (this.config?.demo) root.child(div().flex_none().px(10).py(4).bg(t.raised).text_color(t.accent).text_size(10).whitespace_normal().child("DEMO · Synthetic PRs · No GitHub connection"));
    if (this.error) root.child(div().id("github-error").flex_none().px(10).py(7).bg(t.raised).text_size(11).text_color(t.muted).whitespace_normal()
      .child(`${snapshot ? "Couldn’t refresh · Showing stale last loaded data. " : ""}${this.error}`));
    if (snapshot && !snapshot.complete) root.child(div().flex_none().px(10).py(6).text_size(10).text_color(t.muted).whitespace_normal()
      .child(`Incomplete results · ${snapshot.warnings.join(" ")}`));
    const list = v_flex().id("github-pr-list").flex_1().min_w(0).min_h(0).overflow_y_scrollbar().p(5);
    for (const group of groups) {
      list.child(h_flex().flex_none().flex_wrap().px(10).py(6).mt(6).gap(6).rounded(6).bg(t.raised).border_1().border_color(t.border)
        .child(div().flex_1().min_w(0).font_semibold().text_size(11).whitespace_normal().child(group.name))
        .child(div().text_size(10).text_color(t.muted).child(`${group.count} PRs${snapshot.complete ? "" : " loaded"}`)));
      for (const unit of group.units) {
        if (!unit.stack) { list.children(unit.entries.map(entry => this.row(entry, t))); continue; }
        const collapsed = this.collapsed.has(unit.id);
        list.child(div().id(`github-stack-${unit.id}`).flex_none().px(10).py(6).text_size(11).font_semibold().whitespace_normal().cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.toggle(unit.id, cx))
          .child(`${collapsed ? "▸" : "▾"} Stack · ${unit.size} PRs${unit.matches.length !== unit.size ? ` · ${unit.matches.length} matches this view` : ""}`));
        if (collapsed) continue;
        if (!unit.context) list.child(div().flex_none().px(14).py(4).text_size(10).text_color(t.dim).child("Loading stack context…"));
        else if (!unit.context.complete) list.child(div().id(`github-retry-${unit.id}`).flex_none().px(14).py(4).text_size(10).text_color(t.muted).whitespace_normal().cursor_pointer()
          .on_click((_e, cx) => this.retry(unit.id, cx)).child(`Stack context unavailable or incomplete · ${unit.context.warnings.join(" ")} · Retry`));
        list.children(unit.entries.map(entry => this.row(entry, t, unit.id)));
      }
    }
    if (!groups.length && !this.error) list.child(div().flex_none().px(15).py(18).text_color(t.muted).whitespace_normal()
      .child(this.loading || !snapshot ? "Loading your PRs…" : snapshot.complete ? "No open PRs in this queue." : "Results unavailable or incomplete. Refresh to try again."));
    root.child(list);
    return root.child(div().flex_none().px(10).py(6).border_t(1).border_color(t.border).text_size(10).text_color(t.dim).whitespace_normal()
      .child(snapshot ? `${snapshot.prs.length} ${snapshot.complete ? "matching PRs" : "PRs loaded"} · Updated ${timestamp(snapshot.loadedAt)}` : "Not loaded"));
  }
}
