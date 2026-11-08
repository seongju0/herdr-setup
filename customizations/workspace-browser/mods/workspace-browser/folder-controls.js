import { div } from "gpui-kit";
import { openOverlay, theme } from "herdr";
import { currentScope, resolve } from "./context.js";

export function folderControl({ compact = false } = {}) {
  const scope = currentScope(), context = resolve(scope), t = theme();
  const name = context.cwd?.split(/[\\/]/).filter(Boolean).at(-1) || context.cwd;
  const label = (compact ? name : context.cwd) ?? context.error ?? "No folder";
  return div().id("workspace-folder").min_w(0).truncate().px(8).py(4).rounded(6).text_size(11).text_color(t.muted)
    .cursor_pointer().hover(s => s.bg(t.hover))
    .on_click(() => openOverlay({ mod: "workspace-browser", kind: "dialog", width: 600,
      props: { view: "picker", space: scope.space, tab: scope.tab, on: context.on } }))
    .child(`${context.source} · ${label}${context.on ? ` · ${context.on}` : ""}`);
}
