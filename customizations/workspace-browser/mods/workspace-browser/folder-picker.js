import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, home, pickFolder, closeOverlay } from "herdr";
import { absolute, candidates, pin, follow, exists } from "./context.js";
import { directory } from "./directories.js";

function rank(text, query) {
  text = text.toLowerCase(); query = query.toLowerCase();
  if (text.startsWith(query)) return 0;
  if (text.includes(query)) return 1;
  let i = 0;
  for (const c of text) if (c === query[i]) i++;
  return i === query.length ? 2 : -1;
}

export default class FolderPicker {
  init(props, cx) {
    this.scope = { space: props.space, tab: props.tab, on: props.on ?? null };
    this.overlay = props.overlay; this.filter = ""; this.at = 0;
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search directories or paste an absolute path…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.error = null; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.choose(this.rows()[this.at], cx));
    this.input.focus();
  }
  close() { this.closed = true; this.input.release(); }
  dismiss() { this.closed = true; closeOverlay(this.overlay); }
  pasted() {
    const path = this.filter.trim();
    return !this.scope.on && path.startsWith("~/") ? `${home()}/${path.slice(2)}` : path;
  }
  rows() {
    const query = this.filter.slice(0, 4096);
    const rows = candidates(this.scope).map((r, order) => ({ ...r, order, rank: rank(`${r.cwd} ${r.on ?? ""}`, query) }))
      .filter(r => r.rank >= 0).sort((a, b) => a.rank - b.rank || a.order - b.order);
    if (query && absolute(this.pasted())) rows.unshift({ cwd: this.pasted(), on: this.scope.on, label: "Use path" });
    return rows.slice(0, 50);
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
      } catch (e) { this.error = `Cannot pin folder: ${e}`; }
      finally { this.busy = false; cx.notify(); }
    });
    cx.notify();
  }
  browse(cx) {
    if (this.busy) return;
    if (this.scope.on) { this.error = "Browse is local only · paste an absolute path on the remote machine"; cx.notify(); return; }
    this.busy = true;
    cx.spawn(async cx => {
      try {
        const path = await pickFolder({ prompt: "Pin a folder" });
        if (this.closed) return;
        this.busy = false;
        if (path) this.choose({ cwd: path, on: null }, cx);
      } catch (e) { this.busy = false; this.error = String(e); cx.notify(); }
      finally { cx.notify(); }
    });
  }
  render() {
    const t = theme(), rows = this.rows();
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
      .child(h_flex().gap(12)
        .child(div().id("folder-follow").cursor_pointer().on_click((_e, cx) => { if (!this.busy && follow(this.scope)) this.dismiss(); }).child("Follow session"))
        .child(div().id("folder-browse").cursor_pointer().text_color(this.scope.on ? t.dim : t.muted).on_click((_e, cx) => this.browse(cx)).child(this.scope.on ? "Browse unavailable (remote)" : "Browse…")))
      .child(v_flex().id("folder-results").max_h(320).overflow_y_scrollbar().children(rows.map((r, i) =>
        h_flex().id(`folder-choice-${i}`).px(8).py(6).gap(8).rounded(6).when(i === this.at, el => el.bg(t.selected)).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.choose(r, cx)).child(div().text_color(t.dim).child(r.label))
          .child(div().flex_1().min_w(0).truncate().child(r.cwd)).child(div().text_color(t.dim).child(r.on ?? "local")))))
      .when(Boolean(this.error) || this.busy, el => el.child(div().id("folder-error").text_color(t.dim).child(this.busy ? "Checking folder…" : this.error)));
  }
}
