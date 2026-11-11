// Adapted from Herdr v0.1.13 Spaces (Apache-2.0), commit
// 93b097f6e29fcb2d90a30dea2f03ce4e5dee7981.
// https://github.com/herdrdev/herdr-app — see LICENSE-HERDR and NOTICE.
// Modified for a unified agent hierarchy, two-line metadata and workspace avatars.
// Native Git/cache/watch, worktree ordering, machine actions and menus retained.

import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { icon, avatar, statusGlyph, unreadGlyph } from "./ui.js";
import { spaces, machines, panes, run, openOverlay, exec, hc, theme, watchFolder, window } from "herdr";

// Where a space is now: its first terminal's live folder, else where it was made.
// `ps`: panes(), read once by the caller (each read copies every pane).
function place(s, ps) {
  const tabs = new Set((s.tabs ?? []).map((c) => c.id));
  return ps.find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder;
}
const where = (s, ps) => JSON.stringify([s.machine ?? null, place(s, ps)]);
const base = (path) => path.replace(/\/+$/, "").split("/").pop();
// Changes made outside Herdr (an editor's save, a commit in another app): looked
// for this often, in repos the list shows, while the window is in front.
const FALLBACK = 60000;

export default class SpacesSection {
  init(_props, cx) {
    this.git = {}; // where() -> { name, branch, ahead, behind, repo, linked }, null: not a repo
    this.checked = {}; // where() -> when it was last looked at
    this.unsure = new Set(); // where()s git couldn't answer for (a machine away)
    this.pending = new Set(); // where()s to look at next
    this.busy = {}; // pane -> an agent working or a program in front of its shell
    this.ready = {}; // machine -> its layout was readable at the last look
    this.at = {}; // space -> its where() at the last look
    this.watching = new Set(); // local repos' git folders
    // Spaces made while this runs wait (at most a moment) for their git, so a
    // worktree appears under its repo instead of jumping there.
    this.shown = new Set(spaces().map((s) => s.id));
    this.born = {};
    this.pressed = null;
    this.over = null;
    this.machines = [];
    this.reconnecting = JSON.parse(localStorage.getItem("machines.reconnecting") ?? "{}");
    for (const state of Object.values(this.reconnecting)) state.busy = false;
    this.folded = new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
    this.foldedSpaces = new Set(JSON.parse(localStorage.getItem("spaces.folded") ?? "[]"));
    this.recentSpaces = JSON.parse(localStorage.getItem("herdr-setup.spaces.recent") ?? "[]");
    this.lastFocusedSpace = null;
    this.refreshMachines(cx);
    cx.timer.every(15000, cx => this.refreshMachines(cx));
    // `git status` walks the whole tree, on another machine a process there:
    // only when its answer could have changed (see `due`).
    cx.timer.every(250, (cx) => this.checkNew(cx));
  }

  checkNew(cx) {
    const now = Date.now();
    const sp = spaces();
    for (const s of sp) if (!this.shown.has(s.id)) this.born[s.id] ??= now;
    const due = this.due(now, sp, panes());
    if (due.size) this.refreshGit(due, cx);
    if (sp.some((s) => !this.shown.has(s.id)) || this.orderingDue(now)) cx.notify();
  }

  // Places whose git could have changed: new ones (a new space, a cd), where a
  // command or an agent's turn just ended (a checkout, a commit, edits), those on
  // a machine that is back, and repos in view whose fallback is due.
  due(now, sp, ps) {
    // Moved there: what it knew of that place may be old.
    const at = {};
    for (const s of sp) at[s.id] = where(s, ps);
    const keys = new Set(Object.values(at).filter((k) => JSON.parse(k)[1]));
    const due = new Set([...keys].filter((k) => !(k in this.git)));
    for (const [id, k] of Object.entries(at)) if (this.at[id] && this.at[id] !== k && keys.has(k)) due.add(k);
    this.at = at;
    const spaceOf = {};
    for (const s of sp) for (const t of s.tabs ?? []) spaceOf[t.id] = s;
    const busy = {};
    for (const p of ps) {
      if (!p.terminal || !spaceOf[p.tab]) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) this.sameRepo(at[spaceOf[p.tab].id], keys).forEach((k) => due.add(k));
    }
    this.busy = busy;
    for (const m of machines()) {
      const ready = m.layout === "ready";
      if (ready && this.ready[m.name] === false) for (const k of keys) if (JSON.parse(k)[0] === m.name) due.add(k);
      this.ready[m.name] = ready;
    }
    if (window().active) {
      for (const k of keys) {
        const asks = this.git[k] || this.unsure.has(k);
        if (asks && !this.folded.has(JSON.parse(k)[0]) && now - (this.checked[k] ?? 0) > FALLBACK) due.add(k);
      }
    }
    return due;
  }

  // `key` and the other places in its repo (a commit there moves their ahead/behind).
  sameRepo(key, keys) {
    const repo = this.git[key]?.repo;
    return [key, ...(repo ? [...keys].filter((k) => this.git[k]?.repo === repo) : [])];
  }

  refreshMachines(cx) {
    cx.spawn(async cx => {
      try { const r = await hc(["machine", "ls", "--json"]); if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => !m.temporary); } catch {}
      cx.notify();
    });
  }

  rebuilt(machine) {
    return machine?.state === "unreachable" && /^a different core answers there \("[^"]+"\)$/.test(machine.why ?? "");
  }

  reconnect(machine, cx) {
    const name = machine.name;
    if (this.reconnecting[name]?.busy) return;
    const state = this.reconnecting[name] ??= { machine, removed: false };
    state.busy = true;
    state.error = null;
    localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
    cx.notify();
    cx.spawn(async cx => {
      try {
        const ask = async args => {
          const r = await hc([...args, "--json"]);
          if (r.code !== 0) {
            let error;
            try { error = JSON.parse(r.stdout || r.stderr).error?.message; } catch {}
            throw new Error(error || r.stderr || r.stdout || "Couldn't connect.");
          }
        };
        if (!state.removed) {
          await ask(["machine", "rm", name]);
          state.removed = true;
          localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
        }
        const args = ["machine", "add"];
        if (machine.via) args.push("--via", machine.target);
        else args.push(machine.target);
        args.push("--name", name);
        if (machine.session) args.push("--session", machine.session);
        if (machine.temporary) args.push("--temp");
        await ask(args);
        this.folded.delete(name);
        localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
        delete this.reconnecting[name];
      } catch (e) {
        state.error = String(e.message ?? e);
        state.busy = false;
      }
      localStorage.setItem("machines.reconnecting", JSON.stringify(this.reconnecting));
      this.refreshMachines(cx);
      cx.notify();
    });
  }

  // One look at a time, each place once however often it was asked for meanwhile.
  refreshGit(keys, cx) {
    for (const k of keys) this.pending.add(k);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      while (this.pending.size) {
        const keys = [...this.pending];
        this.pending.clear();
        for (const key of keys) await this.check(key, cx);
      }
      const used = new Set(Object.values(this.git).filter(Boolean).map((g) => JSON.parse(g.repo)).filter(([on]) => !on).map(([, repo]) => repo));
      for (const repo of this.watching) if (!used.has(repo)) this.watching.delete(repo);
      this.refreshing = false;
      cx.notify();
    });
  }

  // One place's git: branch, ahead/behind, its repo.
  async check(key, cx) {
    const [on, cwd] = JSON.parse(key);
    this.checked[key] = Date.now();
    this.unsure.delete(key);
    try {
      // No optional locks: a status that touched the index would wake the watch again.
      // Writes nothing under .git (index lock, fsmonitor cookie): watch() would wake on it.
      const r = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v2", "--branch"], { cwd, on });
      if (r.code !== 0) {
        // Only git's own "no" is remembered as no repo; anything else is asked again.
        if (!/not a git repository/i.test(r.stderr)) this.unsure.add(key);
        this.git[key] = null;
        return;
      }
      // The repo's own .git folder names it; a worktree's top differs from it.
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on });
      const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on });
      const repo = common.stdout.trim();
      const name = repo.endsWith("/.git") ? base(repo.slice(0, -5)) : base(repo).replace(/\.git$/, "");
      const info = { name, branch: null, ahead: 0, behind: 0, repo: JSON.stringify([on, repo]), linked: repo !== `${top.stdout.trim()}/.git` };
      for (const line of r.stdout.split("\n")) {
        if (line.startsWith("# branch.head ")) info.branch = line.slice(14);
        else if (line.startsWith("# branch.ab ")) {
          const [a, b] = line.slice(12).split(" ");
          info.ahead = Math.abs(parseInt(a, 10)) || 0;
          info.behind = Math.abs(parseInt(b, 10)) || 0;
        }
      }
      this.git[key] = info;
      if (!on) this.watch(repo, cx);
    } catch {
      // Couldn't ask (the machine is away): keep what it showed, look again later.
      this.git[key] ??= null;
      this.unsure.add(key);
    }
  }

  watch(repo, cx) {
    if (this.watching.has(repo)) return;
    this.watching.add(repo);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(repo)) {
          await watchFolder(repo);
          const mine = JSON.stringify([null, repo]);
          if (this.watching.has(repo)) this.refreshGit(Object.keys(this.git).filter((k) => this.git[k]?.repo === mine), cx);
        }
      } catch { this.watching.delete(repo); }
    });
  }

  menu(w) {
    // A popup is as tall as its items; height is only the most.
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: w.id } } });
  }

  orderingDue(now) {
    return this.ordering && now - this.ordering.at >= 1000
      && this.ordering.machines.every(name => machines().some(m => m.name === name && m.layout === "ready"));
  }

  // Spaces in order, each worktree space moved under its main checkout's.
  ordered(sp = spaces(), ps = panes()) {
    const ready = (w) => this.shown.has(w.id) || where(w, ps) in this.git || Date.now() - (this.born[w.id] ??= Date.now()) > 1500;
    for (const w of sp) if (!this.shown.has(w.id) && ready(w)) this.shown.add(w.id);
    const list = sp.map((w, i) => ({ w, i, g: this.git[where(w, ps)] ?? null }));
    const mains = new Set(list.filter((r) => r.g && !r.g.linked).map((r) => r.g.repo));
    const nested = (r) => r.g?.linked && mains.has(r.g.repo);
    const out = [];
    const placed = new Set(); // repos whose worktrees are listed (under the first of its spaces)
    for (const r of list) {
      if (nested(r)) continue;
      out.push({ ...r, tree: null });
      if (!r.g || r.g.linked || placed.has(r.g.repo)) continue;
      placed.add(r.g.repo);
      const kids = list.filter((k) => nested(k) && k.g.repo === r.g.repo);
      kids.forEach((k, n) => out.push({ ...k, tree: n === kids.length - 1 ? "└─" : "├─" }));
    }
    // Simulate the batch so later indexes include earlier moves. An attempted
    // write can lose a sync conflict: allow the echo to settle before retrying.
    const order = sp.map(w => w.id);
    const target = out.map(r => r.w.id);
    const key = JSON.stringify([order, target, machines()]);
    if (order.every((id, i) => id === target[i])) {
      this.ordering = null;
    } else if (this.ordering?.key !== key || this.orderingDue(Date.now())) {
      const moved = new Set();
      this.ordering = { key, at: Date.now(), machines: [] };
      for (let i = 0; i < out.length; i++) {
        const from = order.indexOf(out[i].w.id);
        if (from === i) continue;
        run("space.move", { id: out[i].w.id, index: i + 1 });
        moved.add(out[i].w.machine ?? null);
        order.splice(i, 0, order.splice(from, 1)[0]);
      }
      this.ordering.machines = [...moved];
    }
    // Match the machine-grouped display without changing native worktree moves.
    return out.filter(r => this.shown.has(r.w.id)).sort((a, b) => {
      const am = a.w.machine || "", bm = b.w.machine || "";
      return am < bm ? -1 : am > bm ? 1 : 0;
    });
  }

  // Display-only MRU: native worktree ordering and agent traversal stay unchanged.
  recentOrder(rows, snapshotSpaces, focusedSpace) {
    const live = new Set(snapshotSpaces.map(s => s.id));
    let recent = this.recentSpaces.filter(id => live.has(id));
    const active = focusedSpace || snapshotSpaces.find(s => s.active)?.id;
    if (active && live.has(active) && active !== this.lastFocusedSpace) {
      recent = [active, ...recent.filter(id => id !== active)];
      this.lastFocusedSpace = active;
    }
    if (JSON.stringify(recent) !== JSON.stringify(this.recentSpaces)) {
      this.recentSpaces = recent;
      localStorage.setItem("herdr-setup.spaces.recent", JSON.stringify(recent));
    }
    const ranks = new Map(recent.map((id, i) => [id, i]));
    const groups = [];
    for (const row of rows) {
      if (!row.tree || !groups.length) groups.push([]);
      groups[groups.length - 1].push(row);
    }
    const rank = group => Math.min(...group.map(r => ranks.get(r.w.id) ?? Infinity));
    return groups.sort((a, b) => {
      const am = a[0].w.machine || "", bm = b[0].w.machine || "";
      return am < bm ? -1 : am > bm ? 1 : rank(a) - rank(b);
    }).flat();
  }

  // The rows, under a header per machine once one isn't this computer.
  grouped(t, rows, statusBySpace, pendingSpaceIds, below, openCreate, snapshotSpaces) {
    const draw = r => {
      const children = below(r.w.id);
      const folded = this.foldedSpaces.has(r.w.id);
      return [v_flex().id(`space-group-${r.w.id}`).min_w(0).flex_none().mb(8)
        .child(this.row(r, t, statusBySpace, pendingSpaceIds, children.length > 0))
        .when(children.length > 0 && !folded, el => el.child(v_flex()
          .id(`space-agents-${r.w.id}`).min_w(0).flex_none().ml(r.tree ? 48 : 30).pl(4)
          .border_l(1).border_color(t.border).children(children)))];
    };
    const remote = [...new Set([...rows.map(r => r.w.machine).filter(Boolean), ...this.machines.map(m => m.name), ...Object.keys(this.reconnecting)])].sort();
    const loading = m => {
      const layout = machines().find(k => k.name === m)?.layout;
      return layout === "loading" || (!layout && this.machines.some(k => k.name === m && k.state === "connected"))
        || snapshotSpaces.some(s => (s.machine ?? null) === m && !this.shown.has(s.id));
    };
    const loadingRow = m => div().id(`machine-loading-${m ?? "local"}`).h(24).flex_none().px(8).text_size(11).text_color(t.dim).child("Loading…");
    if (!remote.length) return loading(null) && !rows.length ? [loadingRow(null)] : rows.flatMap(draw);
    const machineNames = [null, ...remote];
    return machineNames.flatMap((m) => {
      const mine = rows.filter((r) => (r.w.machine ?? null) === m);
      const repair = this.reconnecting[m];
      const machine = this.machines.find(k => k.name === m) ?? repair?.machine;
      const connected = !m || machine?.state === "connected";
      const rebuilt = this.rebuilt(machine) || !!repair;
      const folded = this.folded.has(m);
      const head = h_flex().id(`machine-${m ?? "local"}`).min_w(0)
        .tooltip(`${m ?? "This computer"} · ${machine?.state ?? "connected"}`)
        .accessibility_label(`${folded ? "Expand" : "Fold"} ${m ?? "This computer"}`)
        .h(24).flex_none().px(8).gap(7).items_center().text_size(10).text_color(t.dim)
        .cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => {
          folded ? this.folded.delete(m) : this.folded.add(m);
          localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
          cx.notify();
        })
        .child(svg(`mods/sidebar/icons/${m ? "server" : "monitor"}.svg`).size(13).flex_none())
        .child(div().flex_1().min_w(0).truncate().child(m ?? "This computer"))
          .when(!connected && !rebuilt, el => el.child(div().flex_none().child((machine?.state ?? "asleep").replace(/_/g, " "))))
          .when(rebuilt, el => el.child(h_flex().flex_none().gap(3).items_center()
            .child(div().max_w(140).truncate().child(repair?.error || "rebuilt ·"))
            .child(div().id(`machine-connect-${m}`).accessibility_label(`Reconnect ${m}`).text_color(repair?.error ? t.blocked : t.muted)
              .hover(s => s.text_color(t.foreground))
              .tooltip(repair?.error || "This machine was rebuilt or replaced. Click to connect to the new one.")
              .on_click((_e, cx) => { cx.stop_propagation(); this.reconnect(machine, cx); })
              .child(repair?.busy ? "Connecting…" : "Connect"))))
          .when(connected, el => el.child(div().id(`machine-add-${m ?? "local"}`).tooltip(`New space on ${m ?? "this computer"}`).accessibility_label(`New space on ${m ?? "this computer"}`).flex_none().px(4).rounded(4).hover(s => s.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); openCreate(m); }).child("+")))
          .child(div().size(6).rounded(3).flex_none().bg(connected ? t.ansi2 : t.dim))
          .child(svg(`mods/sidebar/icons/chevron-${folded ? "right" : "down"}.svg`).size(11).flex_none());
      const empty = h_flex().id(`machine-new-${m ?? "local"}`).tooltip(`New space on ${m ?? "this computer"}`).accessibility_label(`New space on ${m ?? "this computer"}`).h(24).flex_none().px(8).gap(7).items_center().rounded(7)
        .text_size(11).text_color(t.dim).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click(() => openCreate(m))
        .child(svg("mods/sidebar/icons/plus.svg").size(12)).child("New space there");
      if (rebuilt) return [head];
      return [head, ...(folded ? [] : mine.length ? mine.flatMap(draw) : [loading(m) ? loadingRow(m) : empty])];
    });
  }

  // Suppress the stock redundant repo/branch labels, not the neutral counts.
  metadata(g, tree, name) {
    if (!g) return "";
    const same = value => value.toLowerCase() === name.toLowerCase();
    const raw = g.branch ?? "detached";
    const branch = same(raw) || raw === "main" || raw === "master" ? "" : raw;
    const repo = tree || same(g.name) ? "" : g.name;
    return [repo, branch].filter(Boolean).join(" · ");
  }

  spaceTip(w, status, g) {
    const git = g ? [g.name, g.branch ?? "detached", g.ahead ? `↑${g.ahead}` : "", g.behind ? `↓${g.behind}` : ""].filter(Boolean).join(" · ") : "";
    return [w.name, w.machine ?? "This computer", status ?? "unknown", git].filter(Boolean).join(" · ");
  }

  gitTail(g, metadata, t) {
    return h_flex().min_w(0).gap(5).items_center().text_size(10).text_color(t.dim)
      .when(Boolean(metadata), el => el.child(div().flex_1().min_w(0).truncate().child(metadata)))
      .when(g.ahead > 0, el => el.child(div().flex_none().text_color(t.muted).child(`↑${g.ahead}`)))
      .when(g.behind > 0, el => el.child(div().flex_none().text_color(t.muted).child(`↓${g.behind}`)));
  }

  row({ w, i, g, tree, metadata, hasMetadata, height }, t, statusBySpace, pendingSpaceIds, hasAgents) {
    const on = w.active;
    const folded = this.foldedSpaces.has(w.id);
    const fromIndex = this.pressed === null ? -1 : spaces().findIndex(s => s.id === this.pressed);
    const status = statusBySpace.get(w.id) ?? w.status;
    const tip = this.spaceTip(w, status, g);
    return v_flex()
      .relative()
      .id(`space-${w.id}`)
      .min_w(0).tooltip(tip).accessibility_label(tip)
      .px(8)
      .h(height)
      .flex_none()
      .justify_center()
      .rounded(8)
      .hover(el => el.bg(t.hover))
      .when(on, el => el.child(div().absolute().left(0).top(6).bottom(6).w(2).rounded(1).bg(t.accent)))
      .when(this.pressed === w.id && this.over !== w.id, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === w.id && this.pressed !== w.id, (el) => el.child(
        div().absolute().left(0).right(0).h(2).bg(t.accent)
          .when(fromIndex < i, line => line.bottom(0))
          .when(fromIndex > i, line => line.top(0)),
      ))
      .on_mouse_down("left", () => {
        this.pressed = w.id;
        this.over = w.id;
      })
      .on_mouse_move((_e, cx) => {
        const source = spaces().find(s => s.id === this.pressed);
        const over = source && (source.machine ?? null) === (w.machine ?? null) ? w.id : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      })
      .on_mouse_up("left", (_e, cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === w.id && from !== w.id) {
          const index = spaces().findIndex(s => s.id === w.id);
          if (index !== -1) run("space.move", { id: from, index: index + 1 });
        } else if (from === w.id) run("space.select", { id: w.id });
        cx.notify();
      })
      .on_mouse_down("right", () => this.menu(w))
      .child(h_flex().min_w(0).gap(6).items_center()
        .child(div().id(`space-fold-${w.id}`).size(16).flex_none().flex().items_center().justify_center()
          .when(hasAgents, el => el.cursor_pointer().rounded(4).hover(s => s.bg(t.hover))
            .tooltip(`${folded ? "Expand" : "Collapse"} agents in ${w.name}`)
            .accessibility_label(`${folded ? "Expand" : "Collapse"} agents in ${w.name}`)
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_mouse_up("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => {
              cx.stop_propagation();
              folded ? this.foldedSpaces.delete(w.id) : this.foldedSpaces.add(w.id);
              localStorage.setItem("spaces.folded", JSON.stringify([...this.foldedSpaces]));
              cx.notify();
            })
            .child(icon(folded ? "chevron-right" : "chevron-down", 12, t.muted))))
        .when(Boolean(tree), el => el.pl(18).child(icon("branch", 13, t.dim)))
        .when(!tree, el => el.child(avatar(t, w, 18)))
        .child(v_flex().flex_1().min_w(0).justify_center()
          .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(w.name))
          .when(hasMetadata, el => el.child(this.gitTail(g, metadata, t))))
        .when(pendingSpaceIds.has(w.id), el => el.child(unreadGlyph(t, `space-unread-${w.id}`)))
        .child(statusGlyph(t, status, 11)));
  }

  compact({ w, g }, t, statusBySpace, pendingSpaceIds) {
    const status = statusBySpace.get(w.id) ?? w.status;
    const tip = this.spaceTip(w, status, g);
    return h_flex().id(`space-${w.id}`).h(36).flex_none().min_w(0).rounded(7)
      .items_center().justify_center().gap(3).cursor_pointer()
      .tooltip(tip).accessibility_label(tip)
      .when(w.active, el => el.bg(t.selected))
      .hover(el => el.bg(t.hover))
      .on_click(() => run("space.select", { id: w.id }))
      .on_mouse_down("right", () => this.menu(w))
      .child(avatar(t, w, 22))
      .when(pendingSpaceIds.has(w.id), el => el.child(unreadGlyph(t, `space-unread-${w.id}`)))
      .child(statusGlyph(t, status, 10));
  }

  render(_cx, { collapsed = false, statusBySpace = new Map(), pendingSpaceIds = new Set(), ordered, snapshotSpaces, below, openCreate }) {
    const t = theme();
    // Body supplies the single prepared order; rendering never repeats its effects.
    if (collapsed) {
      // The expanded readiness delay/fold state must never hide a rail workspace.
      const present = new Set(ordered.map(r => r.w.id));
      const rows = [...ordered, ...snapshotSpaces.filter(w => !present.has(w.id)).map(w => ({ w, g: null }))];
      return v_flex().id("spaces-rail").flex_1().min_h(0).min_w(0).overflow_hidden().bg(t.chrome)
        .child(v_flex().id("spaces-rail-scroll").flex_1().min_h(0).min_w(0).px(8).py(4)
          .overflow_y_scrollbar().mode("always")
          .children(rows.map(r => this.compact(r, t, statusBySpace, pendingSpaceIds))));
    }
    const rows = ordered.map(r => {
      const metadata = this.metadata(r.g, r.tree, r.w.name);
      const hasMetadata = Boolean(metadata || r.g?.ahead || r.g?.behind);
      return { ...r, metadata, hasMetadata, height: hasMetadata ? 38 : r.tree ? 24 : 28 };
    });
    const prepared = this.grouped(t, rows, statusBySpace, pendingSpaceIds, below, openCreate, snapshotSpaces);
    return v_flex().id("spaces-section").flex_1().min_h(0).min_w(0).overflow_hidden().bg(t.chrome)
      .child(v_flex().id("spaces-scroll").flex_1().min_h(0).min_w(0).px(8).pb(6)
        .overflow_y_scrollbar().mode("always")
        .on_mouse_up("left", (_e, cx) => { this.pressed = null; cx.notify(); })
        .children(prepared));
  }
}
