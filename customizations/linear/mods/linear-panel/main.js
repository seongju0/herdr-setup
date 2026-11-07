import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, exec, layout, nextCommand, props, readTextFile, run, setShared, shared, theme } from "herdr";
import { loadView } from "./api.js";
import { issueGroups, linearUrl, validateConfig, VIEWS } from "./model.js";
import { demoView } from "./demo.js";

const LABELS = { assigned: "Assigned", created: "Created", cycle: "Current cycle" };
const ICON = "mods/linear-panel/icons/linear.svg";
const find = (node, id) => node?.id === id ? node : (node?.children ?? []).map(n => find(n, id)).find(Boolean);
function visible() {
  const root = layout(), panel = find(root, "panel"), body = find(root, "panel-body");
  return !panel || (!panel.hidden && body?.active === "linear-panel");
}
const pad = n => String(n).padStart(2, "0");
const timestamp = time => { const d = new Date(time); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const cycleDate = value => { const d = new Date(value); return `${d.getMonth() + 1}/${d.getDate()}`; };

export default class LinearPanel extends View {
  init(_props, cx) {
    this.button = props()?.button === true;
    if (this.button) {
      this.wasVisible = visible();
      const panels = shared("workspace.panels") ?? ["files", "changes"];
      if (!panels.includes("linear-panel")) setShared("workspace.panels", [...panels, "linear-panel"]);
      return;
    }
    this.view = VIEWS.includes(localStorage.getItem("view")) ? localStorage.getItem("view") : "assigned";
    this.includeClosed = localStorage.getItem("includeClosed") === "true";
    this.snapshots = {};
    this.loading = false;
    this.error = null;
    this.wide = false;
    this.handle = cx.focus_handle();
    this.refreshRequest = shared("linear-panel.reopen") ?? 0;
    if (visible()) this.refresh(cx);
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else if (VIEWS.includes(command)) this.select(command, cx);
        else if (command === "refresh") this.refresh(cx);
        else if (command === "toggle-closed") this.toggleClosed(cx);
        cx.notify();
      }
    });
  }

  select(view, cx) {
    if (this.loading || view === this.view) return;
    this.view = view;
    this.error = null;
    localStorage.setItem("view", view);
    if (!this.snapshots[view]) this.refresh(cx);
    cx.notify();
  }

  toggleClosed(cx) {
    this.includeClosed = !this.includeClosed;
    localStorage.setItem("includeClosed", String(this.includeClosed));
    cx.notify();
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    const view = this.view;
    cx.spawn(async cx => {
      try {
        const raw = await readTextFile(`${appHome()}/config/linear-panel.json`);
        if (!raw) throw new Error("Create config/linear-panel.json with your team key and workspace slug. See the Linear panel README.");
        let value;
        try { value = JSON.parse(raw); } catch { throw new Error("config/linear-panel.json is not valid JSON."); }
        const config = validateConfig(value);
        if (JSON.stringify(config) !== JSON.stringify(this.config)) this.snapshots = {};
        this.config = config;
        let snapshot;
        if (config.demo) snapshot = demoView(config, view);
        else {
          const key = await exec("/usr/bin/security", ["find-generic-password", "-s", "herdr-linear", "-a", "api-key", "-w"]);
          if (key.code !== 0 || !key.stdout.trim()) {
            throw new Error("Add your read-only Linear API key in Keychain Access: item herdr-linear, account api-key. Then press Refresh. Never put the key in the config file.");
          }
          try { snapshot = await loadView(fetch, key.stdout.trim(), config, view); }
          catch (error) {
            // API errors are deliberately sanitized in api.js; native network errors may include request details.
            if (error instanceof Error && /^(Linear |Team )/.test(error.message)) throw error;
            throw new Error("Could not reach Linear. Check your connection and press Refresh.");
          }
        }
        this.snapshots[view] = snapshot;
      } catch (error) {
        this.error = error?.message ?? "Unable to load Linear. Check configuration and credentials.";
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
    cx.notify();
  }

  open(url, cx) {
    const safe = linearUrl(url);
    if (!safe) return;
    cx.spawn(async cx => {
      try {
        const result = await exec("/usr/bin/open", [safe]);
        if (result.code !== 0) this.error = "Could not open the Linear link.";
      } catch { this.error = "Could not open the Linear link."; }
      cx.notify();
    });
  }

  toolbar(t, cx) {
    const on = visible();
    const reopened = on && !this.wasVisible;
    this.wasVisible = on;
    // The toolbar stays rendered when the panel is hidden; the panel itself does not.
    if (reopened) cx.spawn(async () => {
      setShared("linear-panel.reopen", (shared("linear-panel.reopen") ?? 0) + 1);
    });
    return h_flex().size_full().pr(10).items_center().justify_end().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().id("linear-toggle").h(26).px(8).gap(5).items_center().rounded(6).cursor_pointer()
        .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).text_size(12)
        .hover(s => s.bg(t.hover)).on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click(() => {
          if (on) run("layout.hide", { id: "panel" });
          else { run("layout.select", { stack: "panel-body", child: "linear-panel" }); run("layout.show", { id: "panel" }); }
        }).child(svg(ICON).size(14)).child("Linear"));
  }

  tab(view, t) {
    return div().id(`linear-view-${view}`).px(9).py(6).rounded(6).cursor_pointer().text_size(12)
      .bg(this.view === view ? t.selected : t.background).text_color(this.view === view ? t.foreground : t.muted)
      .hover(s => s.bg(t.hover)).on_click((_e, cx) => this.select(view, cx)).child(LABELS[view]);
  }

  status(state, t) {
    return h_flex().flex_none().gap(5).items_center()
      .child(div().size(6).rounded_full().bg(/^#[a-fA-F0-9]{6}$/.test(state.color ?? "") ? state.color : t.muted))
      .child(div().text_size(11).text_color(t.muted).child(state.name));
  }

  project(issue, t) {
    if (!issue.project) return div();
    return div().id(`linear-project-${issue.id}`).min_w(0).text_size(11).text_color(t.dim).truncate()
      .cursor_pointer().hover(s => s.text_color(t.accent))
      .on_click((e, cx) => { cx.stop_propagation(); this.open(issue.project.url, cx); })
      .child(`◇ ${issue.project.name}`);
  }

  row(issue, snapshot, t) {
    const showAssignee = this.view !== "assigned";
    const assignee = issue.assignee?.id === snapshot.viewer.id ? "You" : issue.assignee?.name ?? "Unassigned";
    const row = (this.wide ? h_flex() : v_flex()).id(`linear-issue-${issue.id}`).flex_none().min_w(0).px(10).py(10).gap(this.wide ? 12 : 5)
      .rounded(7).cursor_pointer().hover(s => s.bg(t.hover)).on_click((_e, cx) => this.open(issue.url, cx));
    if (this.wide) {
      return row.items_start()
        .child(div().w(84).flex_none().text_size(11).text_color(t.dim).child(issue.identifier))
        .child(v_flex().flex_1().min_w(0).gap(5)
          .child(div().whitespace_normal().child(issue.title)).child(this.project(issue, t)))
        .child(v_flex().w(112).flex_none().gap(5).child(this.status(issue.state, t))
          .when(showAssignee, el => el.child(div().text_size(11).text_color(t.dim).whitespace_normal().child(assignee))));
    }
    return row
      .child(h_flex().gap(8).items_center().justify_between()
        .child(div().text_size(11).text_color(t.dim).child(issue.identifier)).child(this.status(issue.state, t)))
      .child(div().whitespace_normal().child(issue.title))
      .child(this.project(issue, t))
      .when(showAssignee, el => el.child(div().text_size(11).text_color(t.dim).child(`Assignee: ${assignee}`)));
  }

  render(cx) {
    const t = theme();
    if (this.button) return this.toolbar(t, cx);
    const request = shared("linear-panel.reopen") ?? 0;
    if (request !== this.refreshRequest) {
      this.refreshRequest = request;
      // Native notify() is illegal during render. Use the task's fresh context.
      cx.spawn(async cx => this.refresh(cx));
    }
    const snapshot = this.snapshots[this.view];
    const { groups, hidden, total } = issueGroups(snapshot?.issues ?? [], this.includeClosed);
    const root = v_flex().id("linear-panel-root").size_full().min_w(0).min_h(0).rounded(10).overflow_hidden()
      .border_1().border_color(t.border).bg(t.background).text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_size_change((size, cx) => {
        const wide = size.width >= 620;
        if (wide !== this.wide) { this.wide = wide; cx.notify(); }
      });
    const refresh = h_flex().id("linear-refresh").h(27).px(8).gap(5).items_center().rounded(6)
      .border_1().border_color(t.border).cursor_pointer().hover(s => s.bg(t.hover)).text_size(11).text_color(t.muted)
      .on_click((_e, cx) => this.refresh(cx));
    if (this.loading) refresh.child(svg("mods/workspace-chrome/spinner.svg").size(12).spin(900)).child("Loading");
    else refresh.child("↻ Refresh");
    root.child(h_flex().flex_none().flex_wrap().px(12).py(9).gap(8).items_center().justify_between().border_b(1).border_color(t.border)
      .child(h_flex().gap(7).items_center().child(svg(ICON).size(14).text_color(t.accent))
        .child(div().font_semibold().child("Linear"))
        .child(div().text_size(11).text_color(t.dim).child(this.config?.team ?? "Setup")))
      .child(refresh));
    root.child(h_flex().flex_none().flex_wrap().p(7).gap(3).border_b(1).border_color(t.border).children(VIEWS.map(view => this.tab(view, t))));
    if (this.config?.demo) root.child(div().flex_none().px(12).py(6).bg(t.raised).text_size(11).text_color(t.accent).child("DEMO · Synthetic issues · No Linear connection"));
    if (this.view === "cycle" && snapshot?.cycle) {
      const cycle = snapshot.cycle;
      root.child(v_flex().flex_none().px(12).py(10).gap(4).border_b(1).border_color(t.border)
        .child(div().id("linear-cycle-link").font_semibold().whitespace_normal().cursor_pointer().hover(s => s.text_color(t.accent))
          .on_click((_e, cx) => this.open(`https://linear.app/${this.config.workspace}/team/${this.config.team}/cycle/active`, cx))
          .child(`${cycle.name || `Cycle ${cycle.number}`} ↗`))
        .child(div().text_size(11).text_color(t.dim).child(`${cycleDate(cycle.startsAt)} – ${cycleDate(cycle.endsAt)} · Assigned to or created by you`)));
    }
    if (this.error) root.child(v_flex().flex_none().px(12).py(10).gap(4).bg(t.raised)
      .when(Boolean(snapshot), el => el.child(div().text_size(11).font_semibold().text_color(t.blocked).child("Couldn’t refresh · Showing last loaded data")))
      .child(div().text_size(12).text_color(t.muted).whitespace_normal().child(this.error)));
    const list = v_flex().id("linear-issue-list").flex_1().min_h(0).min_w(0).overflow_y_scrollbar().p(5);
    for (const group of groups) {
      list.child(h_flex().px(10).pt(12).pb(5).gap(6).items_center()
        .child(div().font_semibold().text_size(10).text_color(t.dim).child(group.state.name.toUpperCase()))
        .child(div().text_size(10).text_color(t.dim).child(String(group.issues.length))))
        .children(group.issues.map(issue => this.row(issue, snapshot, t)));
    }
    if (!groups.length && !this.error) {
      let empty = this.loading ? "Loading your issues…" : "No issues in this view.";
      if (snapshot && this.view === "cycle" && !snapshot.cycle) empty = "This team has no active cycle.";
      else if (snapshot && hidden > 0 && !this.includeClosed) empty = "No open issues. Enable Include closed to see the rest.";
      list.child(v_flex().px(15).py(26).gap(10)
        .child(div().text_color(t.muted).whitespace_normal().child(empty))
        .when(Boolean(snapshot && this.config), el => el.child(div().id("linear-team-link").text_size(12).text_color(t.accent).cursor_pointer()
          .on_click((_e, cx) => this.open(`https://linear.app/${this.config.workspace}/team/${this.config.team}/overview`, cx)).child("Open team in Linear ↗"))));
    }
    root.child(list);
    return root.child(v_flex().flex_none().px(12).py(9).gap(5).border_t(1).border_color(t.border)
      .child(div().id("linear-include-closed").text_size(11).text_color(t.muted).cursor_pointer()
        .on_click((_e, cx) => this.toggleClosed(cx)).child(`${this.includeClosed ? "☑" : "☐"} Include closed${snapshot ? ` · ${hidden} closed` : ""}`))
      .child(div().text_size(10).text_color(t.dim).child(snapshot ? `${total} issues · Updated ${timestamp(snapshot.loadedAt)}` : "Not loaded")));
  }
}
