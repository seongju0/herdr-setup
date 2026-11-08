import { h_flex } from "gpui-base";
import { folderControl } from "./folder-controls.js";

export default class FolderToolbar {
  init() {}
  render() { return h_flex().id("workspace-folder-toolbar").size_full().items_center().min_w(0).child(folderControl({ compact: true })); }
}
