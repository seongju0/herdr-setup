import { View, div } from "gpui-kit";
import { props, theme } from "herdr";
import SidebarBody from "./body.js";
import Chrome from "./chrome.js";
import AgentsSection from "./agents.js";

// One native root owns each role's retained state and callback invalidation.
export default class Sidebar extends View {
  init(_props, cx) {
    const config = props() ?? {};
    this.role = config.view ?? "body";
    const Implementation = new Map([
      ["body", SidebarBody], ["brand", Chrome], ["footer", Chrome], ["agents-sort", AgentsSection],
    ]).get(this.role);
    if (!Implementation) { this.error = `Unknown sidebar view: ${this.role}`; return; }
    this.implementation = new Implementation();
    this.implementation.init({ ...config, view: this.role }, cx);
  }

  render(cx) {
    if (this.error) return div().child(this.error);
    if (this.role === "agents-sort") return this.implementation.sortMenu(theme());
    return this.implementation.render(cx);
  }

  close(cx) { return this.implementation?.close?.(cx); }
}
