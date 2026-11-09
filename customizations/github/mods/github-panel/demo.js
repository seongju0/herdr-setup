// Synthetic examples only. Demo bypasses gh, credentials and network access.
const stack = { id: "demo-stack", number: 7, size: 3 };
function pr(config, number, title, position, extra = {}) {
  return { id: `demo-${number}`, number, title, url: `https://github.com/${config.organization}/example-api/pull/${number}`,
    repository: { nameWithOwner: `${config.organization}/example-api` }, author: { login: "alex-example" },
    state: "OPEN", isDraft: false, updatedAt: "2026-11-07T09:42:00Z", stack: position === null ? null : stack, position, reasons: [], ...extra };
}
export function demoView(config, view) {
  const reason = view === "authored" ? "authored" : "review-requested";
  return { viewer: { login: "alex-example" }, configKey: JSON.stringify(config), view, complete: true, warnings: [], loadedAt: Date.now(), prs: [
    pr(config, 145, "Add validation API", 2, { reasons: [reason] }),
    pr(config, 151, "Fix notification timing", null, { reasons: [view === "for-me" ? "assigned" : reason], isDraft: view === "authored" }),
  ] };
}
export function demoStack(config) {
  return { ...stack, complete: true, warnings: [], loadedAt: Date.now(), entries: [
    { position: 1, pr: pr(config, 142, "Shared validation types", 1) },
    { position: 2, pr: pr(config, 145, "Add validation API", 2) },
    { position: 3, pr: pr(config, 149, "Add validation UI", 3, { isDraft: true }) },
  ] };
}
