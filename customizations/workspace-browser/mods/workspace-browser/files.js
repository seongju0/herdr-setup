// Adapted from Herdr 0.1.13 Files (Apache-2.0; see LICENSE-HERDR and NOTICE).
// Modified to browse the shared selected folder with root-owned lifecycle and controls.
import { div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, Input, InputState, ScrollHandle } from "gpui-base";
import { exec, readTextFile, watchFolder, theme, settings } from "herdr";

import { resolve } from "./context.js";
import { directory } from "./directories.js";
import { folderControl } from "./folder-controls.js";
import { scanFiles, matchFiles } from "./file-search.js";
const location = () => resolve();
const key = () => resolve().key;
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
const PER_FOLDER = 500, TOTAL = 5000;


export default class Files {
  init(props, cx) {
    this.embedded = props.embedded === true;
    this.saved = new Map();
    this.query = ""; this.at = 0;
    this.searchHandle = cx.focus_handle();
    this.searchScroll = ScrollHandle.new();
    this.input = InputState.new({ placeholder: "Search files…" });
    this.input.on("change", (_e, cx) => {
      const value = this.input.value();
      if (value !== this.query) this.search(value, cx);
    });
    this.input.on("submit", (_e, cx) => {
      const path = this.searchRows().paths[this.at];
      if (path && this.current(this.context)) this.show(path, cx);
    });
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (!this.closed && this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return !this.closed && this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    if (this.closed) return;
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.search("", cx); this.input.set_value(""); this.watched = null; this.error = location().error; this.limited = false;
      this.loading = false;
      if (saved?.file) this.show(saved.file, cx);
    }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = `${location().source === "Pin" ? "Pinned folder unavailable: " : ""}${e}`; }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  search(query, cx) {
    if (this.closed) return;
    // A clear ends the episode: neither its scan nor its preview may publish.
    this.query = query; this.at = 0; this.show(null);
    this.searchScroll.scroll_to_item(0);
    if (!query) { this.scan = null; cx.notify(); return; }
    if (!this.current(this.context) || !this.root || this.scan) { cx.notify(); return; }
    const context = this.context;
    const scan = this.scan = { paths: [], loading: true };
    cx.spawn(async cx => {
      try {
        const result = await scanFiles(context);
        if (!this.current(context) || this.scan !== scan) return;
        Object.assign(scan, result);
      } catch (error) {
        if (!this.current(context) || this.scan !== scan) return;
        scan.warning = `Cannot search files: ${error}`;
      } finally {
        if (this.current(context) && this.scan === scan) { scan.loading = false; cx.notify(); }
      }
    });
    cx.notify();
  }

  searchRows() {
    const paths = this.scan?.paths;
    if (this.matches?.query !== this.query || this.matches?.snapshot !== paths) {
      this.matches = { query: this.query, snapshot: paths, ...matchFiles(paths ?? [], this.query) };
    }
    return this.matches;
  }

  searchKey(e, cx) {
    // This handler lives only around the Input, not around the preview Editor.
    if (!this.query || !this.current(this.context)) return;
    if (e.key === "escape") { this.input.set_value(""); this.search("", cx); }
    else if (e.key === "down" || e.key === "up") {
      const count = this.searchRows().paths.length;
      this.at = (this.at + (e.key === "down" ? 1 : count - 1)) % Math.max(1, count);
      this.show(null); this.searchScroll.scroll_to_item(this.at); cx.notify();
    } else return;
    cx.stop_propagation();
  }

  show(path, cx) {
    const preview = this.preview = {};
    this.code?.release(); this.code = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(`${root}/${path}`, { on });
        if (this.preview !== preview || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop() : "txt";
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value: text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text,
          font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.preview === preview && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { if (this.preview === preview && this.current(context)) cx.notify(); }
    });
  }

  close() {
    this.closed = true; this.scan = null; this.preview = null;
    this.code?.release(); this.input.release(); this.searchScroll.release(); this.searchHandle.release();
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .child(entry.dir ? svg(`mods/workspace-browser/icons/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/workspace-browser/icons/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (key() !== this.context?.key && !this.scheduled) {
      this.scheduled = true;
      cx.spawn(async cx => { this.scheduled = false; this.refresh(cx); cx.notify(); });
    }
    const t = theme(), matches = this.searchRows(), scan = this.scan;
    return v_flex().id("files").size_full().min_h(0).overflow_hidden().bg(t.background).text_color(t.foreground).text_size(13)
      .when(!this.embedded, el => el.rounded(10).border_1().border_color(t.border))
      .when(!this.embedded || Boolean(this.file), el => el.child(h_flex().id("files-preview-header").h(this.embedded ? 28 : 42).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .when(!this.embedded, el => el.child(div().font_semibold().child("Files")).child(folderControl()))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? ""))))
      .child(div().id("files-search").track_focus(this.searchHandle).flex_none().h(30).mx(8).my(4).px(8).rounded(6).border_1().border_color(t.border)
        .on_key_down((e, cx) => this.searchKey(e, cx))
        .child(Input.new(this.input).size_full()))
      .when(Boolean(this.query) && !this.file, el => el.child(v_flex().id("files-search-results").flex_1().min_h(0).gap(4).p(6)
        .child(div().flex_none().p(4).text_size(11).text_color(t.dim).child(scan?.loading ? "Searching files…" : !this.root ? "No folder" : `${matches.count} matches${matches.count > 50 ? " · showing first 50" : ""} · ↑↓ select · Enter preview · Esc clear`))
        .when(Boolean(scan?.limited || scan?.warning), el => el.child(div().id("files-search-notice").flex_none().max_h(80).overflow_y_scrollbar().p(4).text_size(11).text_color(t.dim).child([
          scan?.limited ? "Partial results: 20,000-file scan limit reached" : "", scan?.warning ? `Partial or unavailable results: ${scan.warning}` : ""
        ].filter(Boolean).join(" · "))))
        .when(!scan?.loading && !matches.paths.length, el => el.child(div().p(8).text_color(t.dim).child("No matching files")))
        .child(v_flex().id("files-search-list").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.searchScroll).children(matches.paths.map((path, i) =>
          v_flex().id(`files-match-${i}`).h(48).flex_shrink_0().px(8).gap(3).rounded(6).cursor_pointer().hover(s => s.bg(t.hover)).when(i === this.at, el => el.bg(t.selected))
            .on_click((_e, cx) => { if (this.current(this.context)) { this.at = i; this.show(path, cx); cx.notify(); } })
            .child(div().truncate().child(path.slice(path.lastIndexOf("/") + 1)))
            .child(div().truncate().text_size(11).text_color(t.dim).child(path)))))))
      .when(!this.file && !this.query, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
