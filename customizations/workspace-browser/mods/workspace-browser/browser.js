import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme } from "herdr";
import Files from "./files.js";
import Changes from "./changes.js";
import { resolve } from "./context.js";
import { folderControl } from "./folder-controls.js";

// Own the mode and shared chrome; the existing views retain previews and Git writes.
export default class Browser {
  init(_props, cx) {
    this.mode = "files";
    this.files = new Files(); this.changes = new Changes();
    this.files.init({ embedded: true }, cx); this.changes.init({ embedded: true }, cx);
    this.refreshBranch(cx);
    cx.timer.every(10000, cx => this.refreshBranch(cx));
  }

  refreshBranch(cx) {
    const { key, cwd, on } = resolve();
    if (this.branchKey !== key) this.branch = null;
    this.branchKey = key;
    if (!cwd) return;
    cx.spawn(async cx => {
      let label = null;
      try {
        const branch = await exec("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd, on });
        if (branch.code === 0 && branch.stdout.trim()) label = `Branch · ${branch.stdout.trim()}`;
        else {
          const head = await exec("git", ["rev-parse", "--short", "HEAD"], { cwd, on });
          if (head.code === 0 && head.stdout.trim()) label = `Detached HEAD · ${head.stdout.trim()}`;
        }
      } catch { /* Branch context is optional, including offline/non-Git folders. */ }
      if (this.branchKey === key && resolve().key === key) { this.branch = label; cx.notify(); }
    });
  }

  render(cx) {
    const context = resolve(), t = theme();
    if (context.key !== this.branchKey && !this.scheduled) {
      this.scheduled = true;
      cx.spawn(async cx => { this.scheduled = false; this.refreshBranch(cx); cx.notify(); });
    }
    // Keep both views synchronized across folder/tab switches without losing previews.
    const files = this.files.render(cx), changes = this.changes.render(cx);
    return v_flex().id("workspace-files").size_full().min_h(0).overflow_hidden().rounded(10).bg(t.background).text_color(t.foreground)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center()
        .child(div().font_semibold().child("Files")).child(div().flex_1())
        .children([["files", "All files"], ["changes", "Changes"]].map(([mode, label]) =>
          div().id(`files-mode-${mode}`).px(8).py(4).rounded(6).text_size(12).cursor_pointer()
            .bg(this.mode === mode ? t.selected : t.background).hover(s => s.bg(t.hover))
            .on_click((_e, cx) => { this.mode = mode; cx.notify(); }).child(label))))
      .child(h_flex().px(6).pb(4).min_w(0).flex_none().child(folderControl()))
      .when(this.branchKey === context.key && Boolean(this.branch), el => el.child(
        div().id("files-branch").px(14).pb(6).flex_none().truncate().text_size(11).text_color(t.dim).child(this.branch)))
      .child(this.mode === "changes" ? changes : files);
  }

  close(cx) { this.files.close(cx); this.changes.close(cx); }
}
