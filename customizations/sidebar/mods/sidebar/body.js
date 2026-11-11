// One snapshot/model and one scrolling hierarchy; native behavior stays with its owners.
import { v_flex, h_flex } from "gpui-base";
import { agents, terminals, panes, spaces, focused, setAgentOrder, theme, openOverlay } from "herdr";
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
    const ordered = this.spaces.ordered(snapshot.spaces, snapshot.panes);
    const present = new Set(ordered.map(r => r.w.id));
    const spaceIds = [...present, ...snapshot.spaces.filter(s => !present.has(s.id)).map(s => s.id)];
    const model = this.agents.prepare(snapshot, spaceIds);
    setAgentOrder(model.canonicalOrder);
    const collapsed = isRail(this.size?.width ?? sidebarWidth());
    const openCreate = machine => openOverlay({ mod: "sidebar", kind: "dialog", width: 520, height: 600, props: { view: "create", machine: machine ?? "" } });
    return v_flex().id("sidebar-body").size_full().min_h(0).min_w(0).overflow_hidden().bg(t.chrome)
      .on_size_change((size, cx) => {
        if (this.size?.width === size.width && this.size?.height === size.height) return;
        this.size = size;
        cx.notify();
      })
      .when(!collapsed, el => el.child(this.agents.header(t, model)))
      .child(this.spaces.render(cx, {
        collapsed, ordered: this.spaces.pinnedOrder(ordered), snapshotSpaces: snapshot.spaces,
        statusBySpace: model.statusBySpace, pendingSpaceIds: model.pendingSpaceIds,
        below: id => this.agents.rows(t, id, model), openCreate,
      }))
      .when(collapsed, el => el.child(h_flex().h(34).flex_none().items_center().justify_center()
        .child(button(t, "sidebar-expand", "sidebar", "Expand sidebar", toggleSidebar))));
  }

  async close(cx) {
    await this.agents.close?.(cx);
    await this.spaces.close?.(cx);
  }
}
