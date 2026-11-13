// Adapted from Herdr's menu/new-menu mods (Apache-2.0; see LICENSE-HERDR
// and NOTICE). Native commands retain ownership of prompts and errors.
import { View, div, svg, image } from "gpui-kit";
import { h_flex, v_flex, ScrollHandle } from "gpui-base";
import { props, spaces, panes, exec, knownAgents, run, openOverlay, closeOverlay, theme, keys } from "herdr";

function targetSpace(id) {
  return typeof id === "string" && id.length > 0 ? spaces().find(space => space.id === id) : null;
}

// Match the native space menu: first terminal's live folder, else creation folder.
function place(space) {
  const tabs = new Set(space.tabs.map(tab => tab.id));
  return panes().find(pane => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder;
}

async function checkout(folder, on) {
  const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on });
  const common = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: folder, on });
  if (top.code !== 0 || common.code !== 0) return null;
  return common.stdout.trim() === `${top.stdout.trim()}/.git` ? "main" : "linked";
}

function shortcut(command) {
  return keys().find(binding => binding.section === "global" && binding.action === command)?.keys ?? "";
}

export class SpaceMenu extends View {
  init(config, cx) {
    const p = config ?? props() ?? {};
    this.targetId = p.target?.id;
    this.overlay = p.overlay;
    this.at = 0;
    this.git = null;
    this.checking = false;
    this.failed = false;
    this.closed = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    const space = targetSpace(this.targetId);
    const folder = space && place(space);
    if (!folder) return;
    this.checking = true;
    cx.spawn(async cx => {
      try { this.git = await checkout(folder, space.machine); }
      catch { this.failed = true; }
      if (this.closed) return;
      this.checking = false;
      cx.notify();
    });
  }

  items() {
    if (!targetSpace(this.targetId)) return [];
    const id = this.targetId;
    return [
      ["New tab / agent…", "launcher", {}, "plus"],
      ["Rename", "space.rename", { id }, "square-pen"],
      ...(this.git ? [
        ["New worktree", "worktree", { space: id, action: "new" }, "git-branch"],
        ["Open worktree", "worktree", { space: id, action: "open" }, "git-branch"],
      ] : []),
      ...(this.git === "linked" ? [["Remove worktree", "worktree", { space: id, action: "remove" }, "git-branch"]] : []),
      ["Close", "space.close", { id }, "x"],
    ];
  }

  choose(index) {
    const item = this.items()[index];
    if (!item) return;
    closeOverlay(this.overlay);
    if (item[1] === "launcher") {
      openOverlay({ mod: "sidebar", kind: "popup", width: 260, height: 400,
        props: { view: "tab-launcher", target: { id: this.targetId } } });
    } else if (item[1] === "worktree") {
      openOverlay({ mod: "worktree", kind: "dialog",
        ...(item[2].action === "open" ? { width: 560, height: 480 } : { width: 440, height: 260 }),
        props: item[2] });
    } else run(item[1], item[2]);
  }

  close() { this.closed = true; }

  render() {
    const t = theme();
    const list = this.items();
    this.at = Math.min(this.at, Math.max(0, list.length - 1));
    const status = !list.length ? "Space is no longer available" : this.checking ? "Checking worktree…" : this.failed ? "Could not check worktree" : "";
    return v_flex().id("space-menu").track_focus(this.handle).w_full().min_h(0)
      .p(5).bg(t.popover).text_size(12.8)
      .on_key_down((event, cx) => {
        if (event.key === "escape") closeOverlay(this.overlay);
        else if (!list.length) return;
        else if (event.key === "down") this.at = (this.at + 1) % list.length;
        else if (event.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (event.key === "enter") this.choose(this.at);
        else return;
        cx.notify();
      })
      .children(list.map((item, index) => v_flex()
        .when(item[1] === "space.close", el => el.child(div().mx(7).my(4).h(1).bg(t.border)))
        .child(h_flex().id(`space-menu-${index}`).h(31).px(8).gap(9).rounded(7)
          .items_center().justify_between().text_color(t.foreground)
          .when(index === this.at, el => el.bg(t.selected)).hover(el => el.bg(t.hover))
          .on_click(() => this.choose(index))
          .child(svg(`mods/workspace-chrome/${item[3]}.svg`).size(14).flex_none().text_color(t.muted))
          .child(div().flex_1().child(item[0]))
          .child(div().text_size(11).text_color(t.dim).child(shortcut(item[1]))))))
      .when(Boolean(status), el => el.child(div().px(8).py(6).text_color(t.dim).child(status)));
  }
}

export class TabLauncher extends View {
  init(config, cx) {
    const p = config ?? props() ?? {};
    this.targetId = p.target?.id;
    this.overlay = p.overlay;
    this.at = 0;
    this.agents = [];
    this.checking = false;
    this.failed = false;
    this.closed = false;
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.handle.focus();
    const space = targetSpace(this.targetId);
    if (!space) return;
    this.checking = true;
    cx.spawn(async cx => {
      try { this.agents = (await knownAgents({ on: space.machine })).filter(agent => agent.installed); }
      catch { this.failed = true; }
      if (this.closed) return;
      this.checking = false;
      cx.notify();
    });
  }

  choose(index) {
    if (!targetSpace(this.targetId)) return;
    const program = this.agents[index - 1];
    if (index !== 0 && !program) return;
    closeOverlay(this.overlay);
    if (program) run("tab.new", { space: this.targetId, name: program.name, argv: program.run });
    else run("tab.new", { space: this.targetId });
  }

  close() { this.closed = true; }

  render() {
    const t = theme();
    const available = Boolean(targetSpace(this.targetId));
    const choices = available ? [null, ...this.agents] : [];
    const status = !available ? "Space is no longer available" : this.checking ? "Checking installed agents…"
      : this.failed ? "Could not check installed agents" : !this.agents.length ? "No installed agents" : "";
    this.at = Math.min(this.at, Math.max(0, choices.length - 1));
    return v_flex().id("tab-launcher").track_focus(this.handle).w_full().min_h(0)
      .h(Math.min(400, 10 + choices.length * 31 + (status ? 31 : 0))).p(5).bg(t.popover).text_size(12.8)
      .on_key_down((event, cx) => {
        if (event.key === "escape") closeOverlay(this.overlay);
        else if (!choices.length) return;
        else if (event.key === "down") this.at = (this.at + 1) % choices.length;
        else if (event.key === "up") this.at = (this.at + choices.length - 1) % choices.length;
        else if (event.key === "enter") this.choose(this.at);
        else return;
        this.scroll.scroll_to_item(this.at);
        cx.notify();
      })
      .child(v_flex().flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll)
        .children(choices.map((program, index) => {
          const icon = !program || !program.icon ? svg("icons/shell.svg").size(14)
            : program.tint ? svg(program.icon).size(14).text_color(t.foreground) : image(program.icon).size(14);
          return h_flex().id(`tab-launcher-${index}`).h(31).px(9).gap(10).rounded(7).items_center().flex_none()
            .text_color(t.foreground).when(index === this.at, el => el.bg(t.selected)).hover(el => el.bg(t.hover))
            .on_click(() => this.choose(index)).child(icon.flex_none())
            .child(div().flex_1().child(program ? program.name : "Terminal"));
        }))
        .when(Boolean(status), el => el.child(div().px(9).py(6).text_color(t.dim).child(status))));
  }
}
