// Adapted from Herdr v0.1.13 agents, commit 93b097f6e29fcb2d90a30dea2f03ce4e5dee7981.
// Upstream Apache-2.0 (see LICENSE-HERDR and NOTICE). Modified for task-first
// identity, child-aware presentation, per-space ordering and focus acknowledgement.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, openOverlay } from "herdr";
import { icon, statusGlyph, unreadGlyph } from "./ui.js";

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const STATE = { 4: "blocked", 3: "done", 2: "working", 1: "idle" };
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
  init(_config, cx) {
    this.folded = new Set();
    this.pending = new Set();
    this.last = new Map();
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

  tree(all, address, lead = []) {
    const kids = all.filter(k => k.parent === address && k.state === "live");
    return kids.flatMap((k, i) => {
      const last = i === kids.length - 1;
      return [{ t: k, lines: [...lead, last ? "└" : "├"] }, ...this.tree(all, k.address, [...lead, last ? "" : "│"])];
    });
  }

  prepare(snapshot, spaceIds) {
    const { agents: list, terminals, spaces, focused, now } = snapshot;
    this.track(list, now);
    const listed = new Map(list.map(a => [a.address, a.status]));
    const descendants = new Map(list.map(a => [a.address, this.tree(terminals, a.address)]));
    const effective = new Map(list.map(a => [a.address, STATE[Math.max(RANK[a.status] ?? 0, ...descendants.get(a.address).map(s => RANK[kidStatus(s.t, listed)] ?? 0))] ?? "idle"]));
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
    // Unread is instance-local observation state, independent of live status/age.
    for (const address of this.last.keys()) if (!listed.has(address)) {
      this.last.delete(address);
      this.pending.delete(address);
    }
    for (const a of list) {
      const previous = this.last.get(a.address);
      const effectiveBlocked = effective.get(a.address) === "blocked";
      if ((a.status === "done" && previous?.own !== "done") || (effectiveBlocked && !previous?.effectiveBlocked)) this.pending.add(a.address);
      // Native focus wins even when completion is first observed in this snapshot.
      if (a.focused) this.pending.delete(a.address);
      this.last.set(a.address, { own: a.status, effectiveBlocked });
    }
    const tier = a => {
      const status = effective.get(a.address);
      return status === "blocked" ? 0 : this.pending.has(a.address) || status === "done" ? 1 : a.pinned ? 2 : status === "working" ? 3 : 4;
    };
    const membersBySpace = new Map();
    const canonicalOrder = [], included = new Set();
    for (const id of new Set(spaceIds ?? spaces.map(s => s.id))) {
      const members = list.filter(a => a.space === id);
      membersBySpace.set(id, [...members].sort((a, b) => tier(a) - tier(b)));
      // Keyboard traversal must not bounce as focus or attention changes.
      for (const a of [...members.filter(a => a.pinned), ...members.filter(a => !a.pinned)]) {
        if (!included.has(a.address)) { canonicalOrder.push(a.address); included.add(a.address); }
      }
    }
    for (const a of list) if (!included.has(a.address)) {
      canonicalOrder.push(a.address);
      included.add(a.address);
    }
    const statusBySpace = new Map(), pendingSpaceIds = new Set();
    for (const a of list) {
      if ((RANK[effective.get(a.address)] ?? 0) > (RANK[statusBySpace.get(a.space)] ?? 0)) statusBySpace.set(a.space, effective.get(a.address));
      if (this.pending.has(a.address)) pendingSpaceIds.add(a.space);
    }
    const displayed = [...membersBySpace.values()].flat();
    const displayedAddresses = new Set(displayed.map(a => a.address));
    const attention = [...displayed, ...list.filter(a => !displayedAddresses.has(a.address))]
      .filter(a => this.pending.has(a.address) || effective.get(a.address) === "blocked");
    return { membersBySpace, canonicalOrder, pending: new Set(this.pending), descendants, effective, labels, listed, statusBySpace, pendingSpaceIds, attentionCount: attention.length, attention, list, now, shown: focused?.agent };
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
    const tip = `${label.title} · ${label.secondary} · ${a.address} · ${a.status}${status !== a.status ? `; effective ${status} (live child status)` : ""}`;
    const fold = this.folded.has(a.address);
    return h_flex().id(`ag-${a.address}`).h(46).flex_none().px(8).gap(8).rounded(8).items_center()
      .when(a.focused, el => el.bg(t.selected)).hover(el => el.bg(t.hover)).cursor_pointer()
      .tooltip(tip).accessibility_label(tip).on_click(() => run("pane.focus", { pane: a.pane }))
      .on_mouse_down("right", (_event, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 220, height: 320,
          props: { tab: "pane", target: { pane: a.pane, terminal: a.address } } });
      })
      .on_hover((on, cx) => { this.hovered = on ? a.address : null; cx.notify(); })
      .child(statusGlyph(t, status, 14))
      .when(model.pending.has(a.address), el => el.child(unreadGlyph(t, `unread-${a.address}`)))
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
        .tooltip(a.pinned ? "Unpin" : "Pin within this space").accessibility_label(a.pinned ? "Unpin agent" : "Pin agent")
        .on_click((_e, cx) => { cx.stop_propagation(); run("terminal.pin", { terminal: a.address, pinned: !a.pinned }); this.hovered = null; cx.notify(); })
        .child(icon(a.pinned ? "pin-off" : "pin", 13))));
  }

  rows(t, spaceId, model) {
    return (model.membersBySpace.get(spaceId) ?? []).flatMap(a => [
      this.row(t, a, model),
      ...(this.folded.has(a.address) ? [] : model.descendants.get(a.address).map(s => this.subRow(t, s, model))),
    ]);
  }

  header(t, model) {
    return v_flex().id("agents").flex_none().min_w(0).text_size(12)
      .child(h_flex().h(30).flex_none().px(16).gap(8).items_center()
        .child(div().flex_1().text_size(10).text_color(t.dim).child("Agents"))
        .when(model.attentionCount > 0, el => el.child(div().id("ag-attention").text_size(10).text_color(t.accent)
          .tooltip("Focus next agent needing attention").accessibility_label(`${model.attentionCount} need attention`)
          .on_click(() => { const index = model.attention.findIndex(a => a.focused); const next = model.attention[(index + 1) % model.attention.length]; run("pane.focus", { pane: next.pane }); })
          .child(`${model.attentionCount} need attention`))))
      .when(!model.list.length, el => el.child(div().px(16).text_size(11).text_color(t.dim).child("No agent status yet. Agents show up here when they report their status. Older versions and agents inside tmux may not.")))
      .when(model.list.length > 0 && model.attentionCount === 0 && !model.list.some(a => model.effective.get(a.address) === "working"), el => el.child(div().px(16).text_size(11).text_color(t.muted).child("Nothing waiting on you")));
  }
}
