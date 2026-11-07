// Public-safe synthetic examples. Demo mode never contacts Linear or Keychain.
const viewer = { id: "demo-viewer", name: "Alex Morgan" };
const other = { id: "demo-other", name: "Sam Rivera" };
const states = {
  review: { id: "review", name: "In Review", type: "started", color: "#8b80f9", position: 2 },
  progress: { id: "progress", name: "In Progress", type: "started", color: "#eab308", position: 1 },
  todo: { id: "todo", name: "Todo", type: "unstarted", color: "#94a3b8", position: 0 },
  backlog: { id: "backlog", name: "Backlog", type: "backlog", color: "#94a3b8", position: 0 },
  done: { id: "done", name: "Done", type: "completed", color: "#22c55e", position: 0 },
};
export function demoView(config, view) {
  const cycle = { id: "demo-cycle", name: "Product polish", number: 12, startsAt: "2026-11-02T00:00:00Z", endsAt: "2026-11-16T00:00:00Z" };
  const examples = [
    [101, "Make the activity feed easier to scan", "review", viewer, true, true],
    [102, "Improve keyboard navigation in the project picker", "progress", viewer, false, true],
    [103, "Keep the selected filters when returning to the list", "todo", other, true, true],
    [104, "Explore a simpler empty state for new projects", "backlog", viewer, true, false],
    [105, "Refresh project status labels", "done", viewer, true, true],
  ];
  const issues = examples.filter(([, , , assignee, created, inCycle]) =>
    view === "assigned" ? assignee.id === viewer.id : view === "created" ? created : inCycle && (created || assignee.id === viewer.id))
    .map(([number, title, state, assignee]) => ({
      id: `demo-${number}`, identifier: `${config.team}-${number}`, title, state: states[state], assignee,
      updatedAt: `2026-11-07T${number % 2 ? "12" : "11"}:00:00Z`,
      url: `https://linear.app/${config.workspace}/team/${config.team}/overview`,
      project: number === 104 ? null : { name: "Workspace improvements", url: `https://linear.app/${config.workspace}/team/${config.team}/overview` },
    }));
  return { viewer, team: { id: "demo-team", key: config.team, name: "Demo team" }, cycle, issues, loadedAt: Date.now() };
}
