import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, home, closeOverlay, spaces } from "herdr";
import { absolute, candidates, pin, follow, exists, resolve, targetKey } from "./context.js";
import { directory } from "./directories.js";
import { searchRoots, discover, withinRoots } from "./directory-search.js";

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

export default class FolderPicker {
  init(props, cx) {
    this.scope = { space: props.space, tab: props.tab, on: props.on ?? null };
    this.overlay = props.overlay; this.filter = ""; this.at = 0;
    this.roots = []; this.discovered = []; this.messages = [];
    this.pathListings = new Map();
    this.known = candidates(this.scope);
    const defaultFolder = resolve(this.scope).cwd ?? spaces().find(s => s.id === this.scope.space)?.folder;
    if (this.scope.on) this.messages = ["Automatic directory discovery is local only · use known folders or enter an absolute remote path"];
    else {
      this.loading = true;
      cx.spawn(async cx => {
        try {
          const roots = await searchRoots(defaultFolder);
          if (this.closed) return;
          this.roots = roots;
          if (!this.roots.length) this.messages.push("Configure searchRoots in workspace-browser.json or enter an absolute path");
          cx.notify();
          await Promise.all(this.roots.map(async root => {
            try {
              const result = await discover(root);
              if (this.closed) return;
              this.discovered.push(...result.paths.map(cwd => ({ cwd, on: null, label: "Directory" })));
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
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search directories or paste an absolute path…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value(); this.at = 0; this.error = null;
      this.completePath(cx); cx.notify();
    });
    this.input.on("submit", (_e, cx) => this.choose(this.rows()[this.at], cx));
    this.input.focus();
  }
  close() { this.closed = true; this.input.release(); }
  dismiss() { this.closed = true; closeOverlay(this.overlay); }
  pasted() {
    const path = this.filter.trim();
    if (!this.scope.on && path === "~") return `${home()}/`;
    return !this.scope.on && path.startsWith("~/") ? `${home()}/${path.slice(2)}` : path;
  }
  completionParent() {
    const path = this.pasted();
    if (this.scope.on || !path.startsWith("/") || !absolute(path)) return null;
    return path.slice(0, path.lastIndexOf("/")) || "/";
  }
  completePath(cx) {
    const parent = this.completionParent();
    if (!parent || this.pathListings.has(parent)) return;
    // Explicit path completion lists one parent, not a recursive fd search.
    // Reuse its bounded snapshot while typing the last path component.
    const listing = { paths: [], loading: true };
    this.pathListings.set(parent, listing);
    cx.spawn(async cx => {
      try {
        const entries = await directory(parent, null);
        if (this.closed) return;
        listing.limited = entries.length > 500;
        listing.paths = entries.slice(0, 500)
          .filter(entry => entry.dir && ![".git", "node_modules"].includes(entry.name))
          .map(entry => ({ cwd: `${parent === "/" ? "" : parent}/${entry.name}`, on: null, label: "Directory" }));
      } catch (error) {
        if (!this.closed) listing.error = `Cannot complete ${parent}: ${error}`;
      } finally {
        if (!this.closed) { listing.loading = false; cx.notify(); }
      }
    });
  }
  rows() {
    // Unrelated live Herdr updates also render this view. Re-rank the snapshot
    // only when the query, resolved roots or discovered candidates change.
    const parent = this.completionParent(), completion = this.pathListings.get(parent)?.paths;
    const cached = this.rowCache;
    if (cached?.filter === this.filter && cached.roots === this.roots && cached.count === this.discovered.length && cached.completion === completion) return cached.rows;
    const query = (parent ? this.pasted() : this.filter).slice(0, 4096);
    const seen = new Set();
    const rows = (parent ? completion ?? [] : [...this.known, ...this.discovered])
      .filter(r => r.on === this.scope.on && (parent || this.scope.on || withinRoots(r.cwd, this.roots)))
      .filter(r => { const key = targetKey(r); if (seen.has(key)) return false; seen.add(key); return true; })
      .map(r => ({ ...r, rank: parent ? (r.cwd.toLowerCase().startsWith(query.toLowerCase()) ? 0 : -1) : rank(`${r.cwd} ${r.on ?? ""}`, query) }))
      .filter(r => r.rank >= 0).sort((a, b) => a.rank - b.rank || (a.cwd < b.cwd ? -1 : a.cwd > b.cwd ? 1 : 0));
    if (query && absolute(this.pasted())) {
      const path = this.pasted(), index = rows.findIndex(r => r.cwd === path && r.on === this.scope.on);
      if (index >= 0) rows.splice(index, 1);
      rows.unshift({ cwd: path, on: this.scope.on, label: "Use path" });
    }
    const visible = rows.slice(0, 50);
    this.rowCache = { filter: this.filter, roots: this.roots, count: this.discovered.length, completion, rows: visible };
    return visible;
  }
  choose(target, cx) {
    if (this.busy) return;
    if (!target || !absolute(target.cwd)) { this.error = "Enter an absolute directory path (no NUL characters)"; cx.notify(); return; }
    this.busy = true; this.error = null;
    cx.spawn(async cx => {
      try {
        await directory(target.cwd, target.on);
        if (this.closed) return;
        if (!exists(this.scope)) throw new Error("The original tab is no longer available");
        if (pin(this.scope, target)) this.dismiss();
      } catch (e) { if (!this.closed) this.error = `Cannot pin folder: ${e}`; }
      finally { if (!this.closed) { this.busy = false; cx.notify(); } }
    });
    cx.notify();
  }
  render() {
    const t = theme(), rows = this.rows(), parent = this.completionParent(), listing = this.pathListings.get(parent);
    const loading = parent ? listing?.loading : this.loading;
    const messages = parent
      ? listing?.error ? [listing.error] : listing?.limited ? [`Partial results: ${parent} exceeded 500 entries · enter a path for other folders`] : []
      : this.messages;
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    return v_flex().id("folder-picker").track_focus(this.handle).p(16).gap(8).bg(t.popover).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") { this.dismiss(); return; }
        if (e.key === "down") this.at = (this.at + 1) % Math.max(1, rows.length);
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % Math.max(1, rows.length);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(div().font_semibold().child(`Folder${this.scope.on ? ` on ${this.scope.on}` : ""}`))
      .child(div().h(36).px(10).border_1().border_color(t.accent).rounded(8).child(Input.new(this.input).size_full()))
      .child(div().id("folder-follow").cursor_pointer().on_click((_e, cx) => { if (!this.busy && follow(this.scope)) this.dismiss(); }).child("Follow session"))
      .when(loading, el => el.child(div().text_color(t.dim).child(parent ? "Listing directories…" : "Discovering directories…")))
      .when(messages.length > 0, el => el.child(v_flex().id("folder-messages").max_h(80).overflow_y_scrollbar().children(messages.map(message => div().text_color(t.dim).child(message)))))
      .when(!loading && !rows.length, el => el.child(div().text_color(t.dim).child("No matching directories")))
      .child(v_flex().id("folder-results").h(Math.min(320, rows.length * 32)).flex_shrink_0().overflow_y_scrollbar().children(rows.map((r, i) =>
        h_flex().id(`folder-choice-${i}`).h(32).flex_shrink_0().items_center().px(8).py(6).gap(8).rounded(6).when(i === this.at, el => el.bg(t.selected)).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(r, cx)).child(div().text_color(t.dim).child(r.label))
          .child(div().flex_1().min_w(0).truncate().child(r.cwd)).child(div().text_color(t.dim).child(r.on ?? "local")))))
      .when(Boolean(this.error) || this.busy, el => el.child(div().id("folder-error").text_color(t.dim).child(this.busy ? "Checking folder…" : this.error)));
  }
}
