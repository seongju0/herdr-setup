import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, home, spaces, panes, focused, knownAgents, run, closeOverlay } from "herdr";
import { directory } from "./directories.js";
import { searchRoots, discover, withinRoots } from "./directory-search.js";

const absolute = path => typeof path === "string" && !path.includes("\0") && (/^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path));
const machine = value => value || null;

function rank(text, query) {
  text = text.toLowerCase();
  let score = 0;
  for (const term of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (text.startsWith(term)) continue;
    if (text.includes(term)) { score++; continue; }
    let i = 0;
    for (const c of text) if (c === term[i]) i++;
    if (i !== term.length) return -1;
    score += 2;
  }
  return score;
}

// Ordinary retained owner: the routed sidebar View owns initialization and cleanup.
export default class CreateSpace {
  init(config, cx) {
    this.on = machine(config.machine);
    this.overlay = config.overlay ?? props()?.overlay;
    this.closed = false; this.busy = false; this.at = 0;
    this.roots = []; this.rootsResolved = false; this.discovered = []; this.messages = [];
    this.pathListings = new Map(); this.programs = []; this.launcher = null;
    this.launchersLoading = true;
    const allSpaces = spaces(), allPanes = panes(), f = focused();
    const targetSpaces = allSpaces.filter(s => machine(s.machine) === this.on);
    const tabs = new Set(targetSpaces.flatMap(s => s.tabs.map(t => t.id)));
    const seen = new Set();
    this.known = [
      ...targetSpaces.filter(s => absolute(s.folder)).map(s => ({ cwd: s.folder, label: "Space" })),
      ...allPanes.filter(p => tabs.has(p.tab) && absolute(p.cwd)).map(p => ({ cwd: p.cwd, label: "Pane" })),
    ].filter(r => { if (seen.has(r.cwd)) return false; seen.add(r.cwd); return true; });
    const focusedSpace = targetSpaces.find(s => s.id === f?.space);
    const focusedPane = focusedSpace && allPanes.find(p => p.pane === f?.pane && tabs.has(p.tab));
    const defaultFolder = (absolute(focusedPane?.cwd) ? focusedPane.cwd : null)
      ?? (focusedSpace && absolute(f?.cwd) ? f.cwd : null)
      ?? (absolute(focusedSpace?.folder) ? focusedSpace.folder : null)
      ?? targetSpaces.find(s => absolute(s.folder))?.folder;
    this.filter = defaultFolder ?? "";
    this.handle = cx.focus_handle();
    this.nameInput = InputState.new({ placeholder: "Name (optional)" });
    this.folderInput = InputState.new({ placeholder: "Search directories or paste an absolute path…" });
    this.folderInput.set_value(this.filter);
    this.nameInput.on("change", (_e, cx) => { this.error = null; cx.notify(); });
    this.nameInput.on("submit", () => this.folderInput.focus());
    this.folderInput.on("change", (_e, cx) => {
      this.filter = this.folderInput.value(); this.at = 0; this.error = null;
      this.completePath(cx); cx.notify();
    });
    this.folderInput.on("submit", (_e, cx) => this.select(this.rows()[this.at], cx));
    this.nameInput.focus();
    cx.spawn(async cx => {
      try {
        const programs = await knownAgents({ on: this.on });
        if (this.closed) return;
        this.programs = programs.filter(p => p.installed);
        if (this.launcher === null) this.launcher = this.programs.find(p => p.key === "pi")?.key ?? "terminal";
      } catch (error) {
        if (!this.closed) {
          this.messages.push(`Cannot check installed launchers: ${error} · Terminal is available`);
          if (this.launcher === null) this.launcher = "terminal";
        }
      } finally {
        if (!this.closed) { this.launchersLoading = false; cx.notify(); }
      }
    });
    if (this.on) this.messages.push("Automatic directory discovery is local only · use known folders or enter an absolute remote path");
    else {
      this.loading = true;
      cx.spawn(async cx => {
        try {
          const roots = await searchRoots(defaultFolder);
          if (this.closed) return;
          this.roots = roots; this.rootsResolved = true;
          if (!this.roots.length) this.messages.push("Configure searchRoots in workspace-browser.json or enter an absolute path");
          cx.notify();
          await Promise.all(this.roots.map(async root => {
            try {
              const result = await discover(root);
              if (this.closed) return;
              this.discovered.push(...result.paths.map(cwd => ({ cwd, label: "Directory" })));
              if (result.limited) this.messages.push(`Partial results: ${root} reached the 20,000-directory limit · enter a path for other folders`);
              if (result.warning) this.messages.push(`Partial results for ${root}: ${result.warning}`);
            } catch (error) {
              if (!this.closed) this.messages.push(`Cannot search ${root}: ${error}`);
            }
            if (!this.closed) cx.notify();
          }));
        } catch (error) {
          if (!this.closed) this.messages.push(`Directory search configuration error: ${error}`);
        } finally {
          if (!this.closed) { this.loading = false; cx.notify(); }
        }
      });
    }
  }

  close() {
    this.closed = true;
    this.nameInput.release(); this.folderInput.release();
  }
  dismiss() { this.closed = true; closeOverlay(this.overlay); }
  pasted() {
    const path = this.filter.trim();
    if (!this.on && path === "~") return `${home()}/`;
    return !this.on && path.startsWith("~/") ? `${home()}/${path.slice(2)}` : path;
  }
  completionParent() {
    const path = this.pasted();
    if (this.on || !path.startsWith("/") || !absolute(path)) return null;
    return path.slice(0, path.lastIndexOf("/")) || "/";
  }
  completePath(cx) {
    const parent = this.completionParent();
    if (!parent || this.pathListings.has(parent)) return;
    const listing = { paths: [], loading: true };
    this.pathListings.set(parent, listing);
    cx.spawn(async cx => {
      try {
        const entries = await directory(parent, null);
        if (this.closed) return;
        listing.limited = entries.length > 500;
        listing.paths = entries.slice(0, 500)
          .filter(entry => entry.dir && ![".git", "node_modules"].includes(entry.name))
          .map(entry => ({ cwd: `${parent === "/" ? "" : parent}/${entry.name}`, label: "Directory" }));
      } catch (error) {
        if (!this.closed) listing.error = `Cannot complete ${parent}: ${error}`;
      } finally {
        if (!this.closed) { listing.loading = false; cx.notify(); }
      }
    });
  }
  rows() {
    const parent = this.completionParent(), completion = this.pathListings.get(parent)?.paths;
    const cached = this.rowCache;
    if (cached?.filter === this.filter && cached.roots === this.roots && cached.count === this.discovered.length && cached.completion === completion) return cached.rows;
    const query = (parent ? this.pasted() : this.filter).slice(0, 4096), seen = new Set();
    // Resolved local scopes constrain ordinary suggestions, not explicit paths.
    // Failed configuration leaves known folders usable without widening discovery.
    const known = this.known.filter(r => this.on || !this.rootsResolved || withinRoots(r.cwd, this.roots));
    const candidates = parent ? completion ?? [] : [...known, ...this.discovered.filter(r => withinRoots(r.cwd, this.roots))];
    const rows = candidates.filter(r => { if (seen.has(r.cwd)) return false; seen.add(r.cwd); return true; })
      .map(r => ({ ...r, rank: parent ? (r.cwd.toLowerCase().startsWith(query.toLowerCase()) ? 0 : -1) : rank(r.cwd, query) }))
      .filter(r => r.rank >= 0).sort((a, b) => a.rank - b.rank || (a.cwd < b.cwd ? -1 : a.cwd > b.cwd ? 1 : 0));
    if (query && absolute(this.pasted())) {
      const path = this.pasted(), index = rows.findIndex(r => r.cwd === path);
      if (index >= 0) rows.splice(index, 1);
      rows.unshift({ cwd: path, label: "Use path" });
    }
    const visible = rows.slice(0, 50);
    this.rowCache = { filter: this.filter, roots: this.roots, count: this.discovered.length, completion, rows: visible };
    return visible;
  }
  select(target, cx) {
    if (this.closed || this.busy || !target) return;
    this.folderInput.set_value(target.cwd);
    this.filter = target.cwd; this.error = null; this.at = 0;
    cx.notify();
  }
  selectLauncher(key, cx) {
    if (this.closed || this.busy) return;
    if (key !== "terminal" && !this.programs.some(p => p.installed && p.key === key)) return;
    this.launcher = key; this.error = null; cx.notify();
  }
  submit(cx) {
    if (this.closed || this.busy || this.launcher === null) return;
    const name = this.nameInput.value().trim(), folder = this.pasted();
    if (name.includes("\0")) { this.error = "Name must not contain NUL characters"; cx.notify(); return; }
    if (!absolute(folder)) { this.error = "Enter an absolute directory path (no NUL characters)"; cx.notify(); return; }
    const program = this.launcher === "terminal" ? null : this.programs.find(p => p.key === this.launcher && p.installed);
    if (this.launcher !== "terminal" && !program) { this.error = "Choose an installed launcher or Terminal"; cx.notify(); return; }
    this.busy = true; this.error = null;
    cx.spawn(async cx => {
      try {
        await directory(folder, this.on);
        if (this.closed) return;
        run("space.new", { ...(name ? { name } : {}), folder, machine: this.on ?? "", ...(program ? { argv: program.run } : {}) });
        this.dismiss();
      } catch (error) {
        if (!this.closed) this.error = `Cannot use folder: ${error}`;
      } finally {
        if (!this.closed) { this.busy = false; cx.notify(); }
      }
    });
    cx.notify();
  }

  render() {
    const t = theme(), rows = this.rows(), parent = this.completionParent(), listing = this.pathListings.get(parent);
    const loading = parent ? listing?.loading : this.loading;
    // Configuration/discovery warnings stay visible during explicit path completion.
    const messages = [...this.messages, ...(listing?.error ? [listing.error] : []),
      ...(listing?.limited ? [`Partial results: ${parent} exceeded 500 entries · enter a path for other folders`] : [])];
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const action = (id, label, callback, selected = false) => div().id(id).px(10).py(6).rounded(6)
      .cursor_pointer().tooltip(label).accessibility_label(label)
      .bg(selected ? t.selected : t.surface).hover(el => el.bg(t.hover)).on_click(callback).child(label);
    return v_flex().id("space-create").w(520).h(600).track_focus(this.handle).p(16).gap(8)
      .bg(t.popover).text_color(t.foreground).text_size(12)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { cx.stop_propagation(); this.dismiss(); return; }
        if (e.key === "down") this.at = (this.at + 1) % Math.max(1, rows.length);
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % Math.max(1, rows.length);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(div().flex_shrink_0().font_semibold().child(`New space${this.on ? ` on ${this.on}` : ""}`))
      .child(div().h(36).flex_shrink_0().px(10).border_1().border_color(t.border).rounded(8).child(Input.new(this.nameInput).size_full()))
      .child(div().flex_shrink_0().child("Folder"))
      .child(div().h(36).flex_shrink_0().px(10).border_1().border_color(t.accent).rounded(8).child(Input.new(this.folderInput).size_full()))
      .child(v_flex().id("create-search").flex_1().min_h(0).gap(4).overflow_y_scrollbar()
        .when(loading, el => el.child(div().text_color(t.dim).child(parent ? "Listing directories…" : "Discovering directories…")))
        .children(messages.map(message => div().text_color(t.dim).child(message)))
        .when(!loading && !rows.length, el => el.child(div().text_color(t.dim).child("No matching directories")))
        .children(rows.map((r, i) => h_flex().id(`create-folder-${i}`).h(32).flex_shrink_0().items_center().px(8).gap(8).rounded(6)
          .when(i === this.at, el => el.bg(t.selected)).cursor_pointer().hover(el => el.bg(t.hover))
          .accessibility_label(`Use folder ${r.cwd}`).on_click((_e, cx) => this.select(r, cx)).child(div().text_color(t.dim).child(r.label))
          .child(div().flex_1().min_w(0).truncate().tooltip(r.cwd).child(r.cwd)))))
      .child(div().flex_shrink_0().child("First launcher"))
      .when(this.launchersLoading, el => el.child(div().flex_shrink_0().text_color(t.dim).child("Checking installed launchers…")))
      .child(h_flex().id("create-launchers").flex_shrink_0().gap(6).flex_wrap()
        .child(action("launcher-terminal", "Terminal", (_e, cx) => this.selectLauncher("terminal", cx), this.launcher === "terminal"))
        .children(this.programs.map(p => action(`launcher-${p.key}`, p.name, (_e, cx) => this.selectLauncher(p.key, cx), this.launcher === p.key))))
      .when(Boolean(this.error) || this.busy, el => el.child(div().id("create-error").flex_shrink_0().text_color(t.dim).child(this.busy ? "Checking folder…" : this.error)))
      .child(h_flex().flex_shrink_0().gap(8).justify_end()
        .child(action("create-cancel", "Cancel", () => this.dismiss()))
        .child(action("create-submit", this.busy ? "Checking…" : "Create", (_e, cx) => this.submit(cx))
          .text_color(this.busy || this.launcher === null ? t.dim : t.accent)));
  }
}
