// Sidebar presentation helpers. New code: MIT; copied SVGs retain their own notices.
import { div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { layout, run, shared, setShared } from "herdr";

export const SIZE = { title: 12, body: 11, meta: 10, micro: 10 };
export const icon = (name, size = 14, color) => svg(`mods/sidebar/icons/${name}.svg`).size(size).flex_none()
  .when(Boolean(color), el => el.text_color(color));

function find(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = find(child, id);
    if (found) return found;
  }
  return null;
}

export function sidebarWidth() {
  return find(layout(), "sidebar")?.size?.px ?? 312;
}

export const isRail = (width = sidebarWidth()) => width < 160;

export function toggleSidebar() {
  const width = sidebarWidth();
  const collapsed = isRail(width);
  if (!collapsed) setShared("herdr-setup.sidebar.width", width);
  const saved = shared("herdr-setup.sidebar.width");
  const restored = Math.max(260, Math.min(480, Number.isFinite(saved) ? saved : 312));
  run("layout.resize", { id: "sidebar", px: collapsed ? restored : 76 });
}

export function button(t, id, name, tip, onClick) {
  return div().id(id).size(24).flex_none().rounded(6).flex().items_center().justify_center()
    .text_color(t.muted).cursor_pointer().tooltip(tip).accessibility_label(tip)
    .hover(el => el.bg(t.hover).text_color(t.foreground))
    .on_mouse_down("left", (_event, cx) => cx.stop_propagation())
    .on_click(onClick).child(icon(name));
}

export function statusGlyph(t, status, size = 12) {
  // A workspace without agent status must not look like an idle agent.
  if (!status) return div().w(16).h(16).flex_none();
  const color = t[status] ?? t.dim;
  const glyph = status === "working" ? icon("spinner", size, color).spin(900)
    : status === "done" ? icon("check", size, color)
    : status === "blocked" ? div().size(size).rounded(size / 2).border(1).border_color(color)
      .text_color(color).text_size(size - 2).font_semibold().flex().items_center().justify_center().child("!")
    : div().size(Math.max(6, size - 5)).rounded_full().border(1.5).border_color(color);
  return h_flex().w(16).h(16).flex_none().items_center().justify_center().child(glyph);
}

export function unreadGlyph(t, id) {
  return div().id(id).size(5).rounded_full().flex_none().bg(t.accent)
    .tooltip("Attention not yet opened here").accessibility_label("Attention not yet opened here");
}

export function avatar(t, space, size = 20) {
  const colors = shared("space.colors") ?? {};
  const palette = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
  const hash = [...space.id].reduce((value, c) => (value * 31 + c.codePointAt(0)) >>> 0, 0);
  const saved = colors[space.id] ?? palette[hash % palette.length];
  const fill = saved.startsWith("#") ? saved : t[saved] ?? t.muted;
  const tint = /^#[a-f\d]{6}$/i.test(fill ?? "") ? `${fill}20` : t.surface;
  return h_flex().size(size).flex_none().rounded(6).bg(tint).text_color(fill)
    .items_center().justify_center().text_size(10).font_semibold()
    .child([...space.name][0]?.toUpperCase() ?? "?");
}
