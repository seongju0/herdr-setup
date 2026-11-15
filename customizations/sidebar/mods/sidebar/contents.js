// Native tabs and panes own membership; reporting agents only decorate their pane.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run, openOverlay } from "herdr";
import { statusGlyph, unreadGlyph } from "./ui.js";

export default class SpaceContents {
  constructor(agents) {
    this.agents = agents;
  }

  prepare(snapshot, _agentModel) {
    const agentsByPane = new Map(snapshot.agents.map(agent => [agent.pane, agent]));
    const panesByTab = new Map();
    for (const pane of snapshot.panes) {
      if (!panesByTab.has(pane.tab)) panesByTab.set(pane.tab, []);
      panesByTab.get(pane.tab).push(pane);
    }
    const bySpace = new Map(), paneTerminals = new Set();
    for (const space of snapshot.spaces) {
      bySpace.set(space.id, space.tabs.map(tab => ({
        space, tab,
        panes: (panesByTab.get(tab.id) ?? []).map(pane => {
          if (pane.terminal) paneTerminals.add(pane.terminal);
          return { pane, agent: agentsByPane.get(pane.pane) ?? null };
        }),
      })));
    }
    return { bySpace, paneTerminals };
  }

  tabRow(t, { space, tab, panes }, agentModel) {
    const program = panes[0]?.pane.program?.name || panes[0]?.pane.mod;
    const title = tab.named && tab.name?.trim() ? tab.name : `Tab ${tab.index}${program ? ` · ${program}` : ""}`;
    const status = agentModel.statusByTab.get(tab.id) ?? tab.status;
    const tip = [title, tab.id, tab.name, tab.settled ? "Put away" : null].filter(Boolean).join(" · ");
    return h_flex().id(`tab-${tab.id}`).h(26).flex_none().pl(8).pr(8).gap(6).rounded(7).items_center()
      .cursor_pointer().hover(el => el.bg(t.hover)).tooltip(tip).accessibility_label(tip)
      .on_click(() => run("tab.select", { id: tab.id }))
      .on_mouse_down("right", (_event, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 200,
          props: { tab: "tab", target: { id: tab.id, space: space.id } } });
      })
      .child(div().flex_1().min_w(0).truncate().text_size(11).font_medium().text_color(t.muted).child(title))
      .when(tab.settled, el => el.child(div().flex_none().text_size(10).text_color(t.dim).child("Put away")))
      .when(agentModel.pendingTabIds.has(tab.id), el => el.child(unreadGlyph(t, `tab-unread-${tab.id}`)))
      .child(statusGlyph(t, status));
  }

  paneRow(t, pane, tab) {
    const title = pane.title?.trim() || pane.program?.name || pane.mod || (pane.terminal ? "Terminal" : "Pane");
    const secondary = [tab.name?.trim(), tab.settled ? "Put away" : null].filter(Boolean).join(" · ");
    const tip = [title, secondary, pane.pane, `Tab ${pane.tab}`, pane.program?.name, pane.cwd].filter(Boolean).join(" · ");
    return h_flex().id(`pane-${pane.pane}`).h(secondary ? 46 : 28).flex_none().px(8).gap(8).rounded(7).items_center()
      .when(pane.focused, el => el.bg(t.selected)).hover(el => el.bg(t.hover)).cursor_pointer()
      .tooltip(tip).accessibility_label(tip)
      .on_click(() => run("pane.focus", { pane: pane.pane }))
      .on_mouse_down("right", (_event, cx) => {
        cx.stop_propagation();
        openOverlay({ mod: "menu", kind: "popup", width: 220, height: 320,
          props: { tab: "pane", target: { pane: pane.pane, ...(pane.terminal ? { terminal: pane.terminal } : {}) } } });
      })
      .child(svg(`mods/workspace-chrome/${pane.terminal ? "terminal" : "square"}.svg`).size(14).flex_none().text_color(t.muted))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().text_size(12).text_color(t.foreground).child(title))
        .when(secondary, el => el.child(div().truncate().text_size(10).text_color(t.muted).child(secondary))))
      .child(statusGlyph(t, pane.status));
  }

  rows(t, spaceId, contentsModel, agentModel) {
    return (contentsModel.bySpace.get(spaceId) ?? []).flatMap(group => group.panes.length
      ? group.panes.flatMap(({ pane, agent }) => agent
        ? this.agents.rowsForPane(t, agent, agentModel, contentsModel.paneTerminals)
        : [this.paneRow(t, pane, group.tab)])
      : [this.tabRow(t, group, agentModel)]);
  }
}
