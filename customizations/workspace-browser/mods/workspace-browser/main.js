import { View, div } from "gpui-kit";
import Files from "./files.js";
import Changes from "./changes.js";
import FolderToolbar from "./folder-toolbar.js";
import FolderPicker from "./folder-picker.js";
import { observe } from "./context.js";

// One native View owns all retained input/focus state and invalidation.
export default class WorkspaceBrowser extends View {
  init(props = {}, cx) {
    const Implementation = new Map([
      ["files", Files], ["changes", Changes], ["toolbar", FolderToolbar], ["picker", FolderPicker],
    ]).get(props.view ?? "files");
    if (!Implementation) { this.error = `Unknown workspace-browser view: ${props.view}`; return; }
    this.implementation = new Implementation();
    this.implementation.init(props, cx);
  }
  render(cx) {
    if (this.error) return div().child(this.error);
    observe(this, cx);
    return this.implementation.render(cx);
  }
  close(cx) { return this.implementation?.close?.(cx); }
}
