// Adapted from Herdr v0.1.13 agents, commit 93b097f6e29fcb2d90a30dea2f03ce4e5dee7981.
// Upstream Apache-2.0 (see LICENSE-HERDR and NOTICE). Modified for task-first
// identity, child-aware presentation, selected-idle visibility and owned snapshots.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, shared, setShared, openOverlay, closeOverlay, props } from "herdr";
import { icon, statusGlyph, button } from "./ui.js";

const SORT_KEY = "herdr-setup.sidebar.sort";
const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const DISPLAY_RANK = { blocked: 4, working: 3, done: 2, idle: 1 };
const STATE = { 4: "blocked", 3: "done", 2: "working", 1: "idle" };
const SORTS = [{ id: "priority", label: "Priority", icon: "clock" }, { id: "grouped", label: "Grouped by space", icon: "layers" }];
const sortOf = () => SORTS.find(s => s.id === shared(SORT_KEY)) ?? SORTS[0];
const clean = value => (value ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim();
const kidStatus = (child, listed) => {
  const status = listed.get(child.address) ?? child.status;
  return status === "error" ? "blocked" : status === "done" ? "idle" : status;
};
function duration(ms) {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return minutes < 1 ? "<1m" : minutes < 60 ? `${minutes}m` : minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}
function identity(a, space, tab) {
  const generic = value => !value || [a.program?.name, a.program?.key, a.app].filter(Boolean).some(p => value.toLowerCase() === p.toLowerCase());
  const named = tab?.named && tab.name?.trim();
  const own = clean(a.title);
  const meaningful = !generic(own) && !/^\d+$/.test(own) && !/^[~/]|^[A-Za-z]:\\/.test((a.title ?? "").trim()) && !own.includes("@");
  const explicit = named && !generic(named) ? named : null;
  const fallback = !explicit && !meaningful;
  const title = explicit || (meaningful ? own : a.program?.name || a.app || "Agent");
  const machine = space?.machine || (a.address.includes("/") ? a.address.split("/")[0] : null);
  return { title, fallback, tab: tab?.name || a.tab, workspace: space?.name || a.space_name || "Workspace", machine };
}

export default class AgentsSection {
  init(config, cx) {
    if (config?.view === "agents-sort") return;
    this.folded = new Set(["sec-idle"]);
    this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
    cx.timer.every(30000, cx => cx.notify());
  }

  track(list, now) {
    let dirty = false;
    for (const a of list) {
      const s = a.status === "done" ? "idle" : a.status;
      if (this.changed[a.address]?.s === s) continue;
      this.changed[a.address] = { s, at: now };
      dirty = true;
    }
    if (!dirty) return;
    const listed = new Set(list.map(a => a.address));
    for (const [address, c] of Object.entries(this.changed)) if (!listed.has(address) && now - c.at > 30 * 86400000) delete this.changed[address];
    localStorage.setItem("changed", JSON.stringify(this.changed));
  }

  hold(list) {
    const cur = list.find(a => a.focused);
    if (!cur || cur.address !== this.held?.address || cur.status !== "idle") this.held = cur ? { address: cur.address, rank: RANK[cur.status] ?? 0 } : null;
  }

  rank(a) {
    return a.address === this.held?.address && this.held.rank === RANK.done && a.status === "idle" ? RANK.done : RANK[a.status] ?? 0;
  }

  tree(all, address, lead = []) {
    const kids = all.filter(k => k.parent === address && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...this.tree(all, k.address, [...lead, last ? "" : "│"])];
    });
  }

  prepare(snapshot) {
    const { agents: list, terminals, spaces, focused, now } = snapshot;
    this.track(list, now);
    this.hold(list);
    const listed = new Map(list.map(a => [a.address, a.status]));
    const descendants = new Map(list.map(a => [a.address, this.tree(terminals, a.address)]));
    const effective = new Map(list.map(a => [a.address, STATE[Math.max(this.rank(a), ...descendants.get(a.address).map(s => RANK[kidStatus(s.t, listed)] ?? 0))] ?? "idle"]));
    const labels = new Map(list.map(a => {
      const space = spaces.find(s => s.id === a.space);
      return [a.address, identity(a, space, space?.tabs?.find(tab => tab.id === a.tab))];
    }));
    for (const a of list) {
      const label = labels.get(a.address);
      const peers = list.filter(b => b.space === a.space && labels.get(b.address).title === label.title);
      const secondary = [label.workspace, label.machine];
      if (label.fallback || peers.length > 1) secondary.push(label.tab);
      if (peers.filter(b => b.tab === a.tab).length > 1) secondary.push(a.address);
      label.secondary = secondary.filter(Boolean).join(" · ");
    }
    const priority = sortOf().id === "priority";
    const ordered = priority ? [...list].sort((a, b) => DISPLAY_RANK[effective.get(b.address)] - DISPLAY_RANK[effective.get(a.address)] || this.changed[b.address].at - this.changed[a.address].at || (b.seq ?? 0) - (a.seq ?? 0)) : [...list];
    const pinned = ordered.filter(a => a.pinned), rest = ordered.filter(a => !a.pinned);
    // Navigation follows the visible groups, before selected-idle promotion.
    const canonicalOrder = [...pinned, ...rest].map(a => a.address);
    const groups = pinned.length ? [{ id: "pinned", label: "Pinned", members: pinned }] : [];
    let currentSession;
    if (priority) {
      currentSession = rest.find(a => a.focused && effective.get(a.address) === "idle");
      for (const [status, label] of [["blocked", "Needs you"], ["working", "Working"], ["done", "Done"]]) {
        const members = rest.filter(a => effective.get(a.address) === status);
        if (members.length) groups.push({ id: `sec-${status}`, label, status, members });
      }
      if (currentSession) groups.push({ id: "current", label: "Current session", members: [currentSession] });
      const idle = rest.filter(a => effective.get(a.address) === "idle" && a !== currentSession);
      if (idle.length) groups.push({ id: "sec-idle", label: "Idle", status: "idle", members: idle });
    } else {
      for (const a of rest) {
        let group = groups.find(g => g.id === `sp-${a.space}`);
        if (!group) { group = { id: `sp-${a.space}`, label: labels.get(a.address).workspace, members: [] }; groups.push(group); }
        group.members.push(a);
      }
    }
    const statusBySpace = new Map();
    for (const a of list) if ((RANK[effective.get(a.address)] ?? 0) > (RANK[statusBySpace.get(a.space)] ?? 0)) statusBySpace.set(a.space, effective.get(a.address));
    const attention = ordered.filter(a => effective.get(a.address) === "blocked");
    return { canonicalOrder, groups, currentSession, descendants, effective, labels, listed, statusBySpace, attentionCount: attention.length, attention, list, now, shown: focused?.agent, priority };
  }

  sortMenu(t) {
    return v_flex().w_full().p(5).bg(t.popover).text_size(12)
      .child(div().px(8).pt(4).pb(6).text_size(10).text_color(t.dim).child("Sort agents"))
      .children(SORTS.map(s => h_flex().id(`sort-${s.id}`).h(28).px(8).gap(9).rounded(7).items_center()
        .text_color(t.foreground).hover(el => el.bg(t.hover)).on_click(() => { setShared(SORT_KEY, s.id); closeOverlay(props()?.overlay); })
        .child(icon(s.icon)).child(div().flex_1().child(s.label)).when(s.id === sortOf().id, el => el.child(icon("check")))));
  }

  subRow(t, s, model) {
    const k = s.t, status = kidStatus(k, model.listed);
    const label = k.name || k.template || k.program?.name || k.address;
    return h_flex().id(`sub-${k.address}`).pl(32).pr(8).h(24).flex_none().gap(5).rounded(7).items_center()
      .when(k.address === model.shown, el => el.bg(t.raised)).hover(el => el.bg(t.hover))
      .tooltip(`${label} · ${k.address} · ${status}`).accessibility_label(`${label}, ${status}`)
      .on_click(() => run("terminal.peek", { terminal: k.address }))
      .children(s.lines.map(line => div().w(9).flex_none().text_color(t.dim).child(line)))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.muted).child(label))
      .child(statusGlyph(t, status));
  }

  row(t, a, model) {
    const label = model.labels.get(a.address), subs = model.descendants.get(a.address), status = model.effective.get(a.address);
    const tip = `${label.title} · ${label.secondary} · ${a.address} · ${a.status}${status !== a.status ? `; effective ${status} (child attention or retained completion)` : ""}`;
    const fold = this.folded.has(a.address);
    return h_flex().id(`ag-${a.address}`).h(46).flex_none().px(8).gap(8).rounded(8).items_center()
      .when(a.focused, el => el.bg(t.selected)).hover(el => el.bg(t.hover)).cursor_pointer()
      .tooltip(tip).accessibility_label(tip).on_click(() => run("pane.focus", { pane: a.pane }))
      .on_hover((on, cx) => { this.hovered = on ? a.address : null; cx.notify(); })
      .child(statusGlyph(t, status, 14))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(12).font_medium().text_color(t.foreground).child(label.title))
        .child(div().truncate().text_size(10).text_color(t.muted).child(label.secondary)))
      .when(subs.length > 0, el => el.child(div().id(`fold-${a.address}`).flex_none().h(20).px(2).flex().items_center()
        .tooltip(`${fold ? "Expand" : "Fold"} ${subs.length} child agents`).accessibility_label("Toggle child agents")
        .on_click((_e, cx) => { cx.stop_propagation(); fold ? this.folded.delete(a.address) : this.folded.add(a.address); cx.notify(); })
        .child(icon(fold ? "chevron-right" : "chevron-down", 11)).when(fold, el => el.child(String(subs.length)))))
      .child(div().w(30).flex_none().text_right().text_size(10).text_color(t.dim)
        .tooltip("Since last observed agent-state change; not task elapsed time or ETA")
        .child(duration(model.now - this.changed[a.address].at)))
      .child(div().w(20).flex_none().child(div().id(`pin-${a.address}`).p(2).rounded(4)
        .when(!a.pinned && this.hovered !== a.address, el => el.opacity(0))
        .tooltip(a.pinned ? "Unpin" : "Pin to the top").accessibility_label(a.pinned ? "Unpin agent" : "Pin agent")
        .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.pin", { terminal: a.address, pinned: !a.pinned }); this.hovered = null; cx.notify(); })
        .child(icon(a.pinned ? "pin-off" : "pin", 13))));
  }

  render(cx, model) {
    const t = theme();
    const rows = model.groups.flatMap(g => {
      const folded = this.folded.has(g.id);
      const header = h_flex().id(g.id).h(26).flex_none().px(8).gap(6).items_center().text_size(10).text_color(t[g.status] ?? t.dim)
        .tooltip(`${g.label}: ${g.members.length}`).accessibility_label(`${g.label}, ${g.members.length}, ${folded ? "folded" : "expanded"}`)
        .on_click((_e, cx) => { cx.stop_propagation(); folded ? this.folded.delete(g.id) : this.folded.add(g.id); cx.notify(); })
        .child(icon(folded ? "chevron-right" : "chevron-down", 11)).child(g.label).child(String(g.members.length));
      return [header, ...(folded ? [] : g.members.flatMap(a => [this.row(t, a, model), ...(this.folded.has(a.address) ? [] : model.descendants.get(a.address).map(s => this.subRow(t, s, model)))]))];
    });
    return v_flex().id("agents").flex_1().min_h(0).min_w(0).text_size(12)
      .child(h_flex().h(30).flex_none().px(16).gap(8).items_center()
        .child(div().flex_1().text_size(10).text_color(t.dim).child("Agents"))
        .when(model.attentionCount > 0, el => el.child(div().id("ag-blocked").text_size(10).text_color(t.blocked)
          .tooltip("Focus next agent needing you").accessibility_label(`${model.attentionCount} agents need you`)
          .on_click(() => { const index = model.attention.findIndex(a => a.focused); const next = model.attention[(index + 1) % model.attention.length]; run("pane.focus", { pane: next.pane }); })
          .child(`${model.attentionCount} need you`)))
        .child(button(t, "ag-sort", sortOf().icon, `Sort agents: ${sortOf().label}`, () => openOverlay({ mod: "sidebar", kind: "popup", width: 200, height: 140, props: { view: "agents-sort" } }))))
      .when(!model.list.length, el => el.child(div().px(16).text_size(11).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")))
      .when(model.list.length > 0 && model.list.every(a => model.effective.get(a.address) === "idle"), el => el.child(div().px(16).text_size(11).text_color(t.muted).child("Nothing waiting on you")))
      .child(v_flex().id("ag-list").flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always").children(rows));
  }
}
