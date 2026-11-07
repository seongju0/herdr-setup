export const VIEWS = ["assigned", "created", "cycle"];
const CLOSED = new Set(["completed", "canceled", "duplicate"]);
const ORDER = { started: 0, unstarted: 1, backlog: 2, triage: 3, completed: 4, canceled: 5, duplicate: 6 };

export function validateConfig(value) {
  if (!value || typeof value !== "object" || !/^[A-Za-z][A-Za-z0-9_-]{0,49}$/.test(value.team ?? "")) {
    throw new Error("Set a valid team key in config/linear-panel.json (for example ENG).");
  }
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(value.workspace ?? "")) {
    throw new Error("Set your Linear workspace URL slug in config/linear-panel.json.");
  }
  if (value.demo !== undefined && typeof value.demo !== "boolean") throw new Error("Config demo must be true or false.");
  return { team: value.team.toUpperCase(), workspace: value.workspace, demo: value.demo === true };
}

export function issueFilter(view, viewerId, teamId, cycleId) {
  if (!VIEWS.includes(view)) throw new Error("Unknown issue view.");
  const team = { id: { eq: teamId } };
  const assignee = { id: { eq: viewerId } };
  const creator = { id: { eq: viewerId } };
  if (view === "assigned") return { team, assignee };
  if (view === "created") return { team, creator };
  if (!cycleId) return null;
  return { team, cycle: { id: { eq: cycleId } }, or: [{ assignee }, { creator }] };
}

export function issueGroups(issues, includeClosed) {
  const all = [...new Map(issues.map(i => [i.id, i])).values()];
  const hidden = all.filter(i => CLOSED.has(i.state.type)).length;
  const groups = new Map();
  for (const issue of all) {
    if (!includeClosed && CLOSED.has(issue.state.type)) continue;
    if (!groups.has(issue.state.id)) groups.set(issue.state.id, { state: issue.state, issues: [] });
    groups.get(issue.state.id).issues.push(issue);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    (ORDER[a.state.type] ?? 3) - (ORDER[b.state.type] ?? 3) || a.state.position - b.state.position || a.state.name.localeCompare(b.state.name));
  for (const group of sorted) group.issues.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.identifier.localeCompare(b.identifier));
  return { groups: sorted, hidden, total: all.length };
}

// Treat URLs returned by the external API as navigation input, not shell commands.
export function linearUrl(value) {
  return typeof value === "string" && /^https:\/\/linear\.app\/[A-Za-z0-9][^\s]*$/.test(value) ? value : null;
}
