import { div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { openOverlay, theme } from "herdr";
import { currentScope, resolve } from "./context.js";

export function folderControl({ compact = false, branch = null } = {}) {
  const scope = currentScope(), context = resolve(scope), t = theme();
  const label = context.cwd ?? context.error ?? "No folder";
  const detail = `${context.source} · ${label}${context.on ? ` · ${context.on}` : ""}`;
  const name = context.cwd?.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || label;
  const control = compact
    ? v_flex().flex_1().min_w(0).gap(3).px(4).py(4)
      .child(h_flex().min_w(0).gap(6).items_center()
        .child(svg("mods/workspace-browser/icons/folder.svg").size(13).flex_none().text_color(t.muted))
        .child(div().min_w(0).truncate().text_size(12).font_semibold().child(name)))
      .child(h_flex().min_w(0).gap(5).text_size(10).text_color(t.dim)
        .when(Boolean(branch), el => el.child(div().id("files-branch").min_w(0).truncate().child(branch.replace(/^Branch · /, ""))))
        .child(div().flex_none().child(`${branch ? "· " : ""}${context.source}${context.on ? ` · ${context.on}` : ""}`)))
    : div().min_w(0).truncate().px(8).py(4).text_size(11).text_color(t.muted).child(detail);
  return control.id("workspace-folder").rounded(6).tooltip([detail, branch].filter(Boolean).join("\n"))
    .accessibility_label([detail, branch].filter(Boolean).join(" · "))
    .cursor_pointer().hover(s => s.bg(t.hover))
    .on_click(() => openOverlay({ mod: "workspace-browser", kind: "dialog", width: 600,
      props: { view: "picker", space: scope.space, tab: scope.tab, on: context.on } }));
}
