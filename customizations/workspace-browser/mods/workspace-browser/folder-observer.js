import { div } from "gpui-kit";

// The native root observes live context even while both panels are hidden.
export default class FolderObserver {
  init() {}
  render() { return div().w(0).h(0); }
}
