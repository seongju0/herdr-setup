// Adapted from Herdr v0.1.13 workspace-chrome (Apache-2.0; see LICENSE-HERDR).
// Modified for two-row OS clearance and a compact sidebar footer.
import { div, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, updates } from "herdr";
import { button, icon, isRail, toggleSidebar } from "./ui.js";

export default class Chrome {
  init(config) { this.footer = config.view === "footer"; }

  render() {
    const t = theme();
    const collapsed = isRail();
    if (this.footer) {
      const link = (id, glyph, label, action) => h_flex().id(id).h(26).px(4).gap(6).rounded(6)
        .min_w(0).items_center().cursor_pointer().text_color(t.muted)
        .tooltip(label).accessibility_label(label).hover(el => el.bg(t.hover).text_color(t.foreground))
        .on_click(action).child(icon(glyph, 13)).when(!collapsed, el => el.child(label));
      return h_flex().id("sidebar-footer-controls").size_full().min_w(0).px(collapsed ? 8 : 12).gap(4)
        .bg(t.chrome).border_t(1).border_color(t.border).items_center().text_size(10)
        .child(link("settings", "settings", "Settings", () => run("app.settings"))
          .when(Boolean(updates().app.ready), el => el.child(div().size(5).flex_none().rounded_full().bg(t.accent))))
        .child(div().flex_1().min_w(0))
        .child(link("machine", "plus", "Add machine", () => run("mod.open", { name: "machine-add" })));

    }
    // The layout owns the draggable region; controls stop its mouse-down.
    // Top 32px remains clear for macOS traffic lights, including in the rail.
    return v_flex().id("sidebar-brand").size_full().bg(t.chrome)
      .child(h_flex().h(32).flex_none())
      .child(h_flex().h(44).min_w(0).px(collapsed ? 0 : 16).gap(8).items_center()
        .when(collapsed, el => el.justify_center())
        .child(image("frame/welcome/herdr.png").size(22).flex_none().rounded(6))
        .when(!collapsed, el => el
          .child(h_flex().flex_1().min_w(0).font_semibold().text_size(14).text_color(t.foreground).child("Herdr"))
          .child(button(t, "search", "search", "Search tabs", () => run("mod.open", { name: "picker" })))
          .child(button(t, "sidebar-toggle", "sidebar", "Collapse sidebar", toggleSidebar))));
  }
}
