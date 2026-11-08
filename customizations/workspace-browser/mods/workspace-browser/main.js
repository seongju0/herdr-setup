import { View, div } from "gpui-kit";
import { props } from "herdr";
import Files from "./files.js";
import Changes from "./changes.js";
import FolderObserver from "./folder-observer.js";
import FolderPicker from "./folder-picker.js";
import { observe } from "./context.js";

// One native View owns all retained input/focus state and invalidation.
export default class WorkspaceBrowser extends View {
  init(_props, cx) {
    const configuration = props() ?? {};
    const Implementation = new Map([
      ["files", Files], ["changes", Changes], ["observer", FolderObserver], ["picker", FolderPicker],
    ]).get(configuration.view ?? "files");
    if (!Implementation) { this.error = `Unknown workspace-browser view: ${configuration.view}`; return; }
    this.implementation = new Implementation();
    this.implementation.init(configuration, cx);
  }
  render(cx) {
    if (this.error) return div().child(this.error);
    observe(this, cx);
    return this.implementation.render(cx);
  }
  close(cx) { return this.implementation?.close?.(cx); }
}
