// A single owner allocates the sidebar body; no layout mutations for list heights.
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, focused, setAgentOrder, theme } from "herdr";
import AgentsSection from "./agents.js";
import SpacesSection from "./spaces.js";
import { button, isRail, sidebarWidth, toggleSidebar } from "./ui.js";

export default class SidebarBody {
  init(config, cx) {
    this.agents = new AgentsSection();
    this.spaces = new SpacesSection();
    this.agents.init(config, cx);
    this.spaces.init(config, cx);
    this.size = null;
  }

  render(cx) {
    const t = theme();
    const snapshot = { agents: agents(), terminals: terminals(), panes: panes(), spaces: spaces(), focused: focused(), now: Date.now() };
    const model = this.agents.prepare(snapshot);
    setAgentOrder(model.canonicalOrder);
    const collapsed = isRail(this.size?.width ?? sidebarWidth());
    const maxHeight = this.size ? Math.min(240, Math.floor(this.size.height * 0.38)) : 224;
    return v_flex().id("sidebar-body").size_full().min_h(0).min_w(0).overflow_hidden().bg(t.chrome)
      .on_size_change((size, cx) => {
        if (this.size?.width === size.width && this.size?.height === size.height) return;
        this.size = size;
        cx.notify();
      })
      .when(!collapsed, el => el.child(this.agents.render(cx, model)))
      .child(this.spaces.render(cx, { collapsed, statusBySpace: model.statusBySpace, maxHeight }))
      .when(collapsed, el => el.child(h_flex().h(34).flex_none().items_center().justify_center()
        .child(button(t, "sidebar-expand", "sidebar", "Expand sidebar", toggleSidebar))));
  }

  async close(cx) {
    await this.agents.close?.(cx);
    await this.spaces.close?.(cx);
  }
}
