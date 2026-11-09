export const VIEWS = ["authored", "for-me"];
const orgSlug = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some(key => !["organization", "ghPath", "demo"].includes(key))
    || typeof value.organization !== "string" || !orgSlug.test(value.organization)
    || (value.demo !== undefined && typeof value.demo !== "boolean")
    || (value.ghPath !== undefined && (typeof value.ghPath !== "string"
      || (value.ghPath !== "gh" && !value.ghPath.startsWith("/")) || value.ghPath.includes("\0")))) {
    throw new Error("Set organization and optional absolute ghPath in config/github-panel.json. See the GitHub panel README.");
  }
  return { organization: value.organization.toLowerCase(), ghPath: value.ghPath ?? "gh", demo: value.demo === true };
}

export function githubPrUrl(value, organization) {
  if (typeof value !== "string" || typeof organization !== "string") return null;
  const match = /^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9][0-9]*)$/.exec(value);
  if (!match || match[1].toLowerCase() !== organization.toLowerCase() || [".", ".."].includes(match[2])) return null;
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}

export function normalizePr(value, config, { stack = null, position = null, context = false } = {}) {
  if (!value || typeof value.id !== "string" || !value.id || !Number.isSafeInteger(value.number) || value.number < 1
    || typeof value.title !== "string" || typeof value.isDraft !== "boolean"
    || !["OPEN", "CLOSED", "MERGED"].includes(value.state)
    || !githubPrUrl(value.url, config.organization)
    || typeof value.repository?.nameWithOwner !== "string") return null;
  const parts = value.repository.nameWithOwner.split("/");
  if (parts.length !== 2 || parts[0].toLowerCase() !== config.organization.toLowerCase()
    || value.url.toLowerCase() !== `https://github.com/${value.repository.nameWithOwner}/pull/${value.number}`.toLowerCase()) return null;
  if (!context && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)))) return null;
  if (!context) {
    stack = value.stack;
    position = value.stackEntry?.position ?? null;
    if (stack !== null && (typeof stack?.id !== "string" || !stack.id || !Number.isSafeInteger(stack.size) || stack.size < 1 || !Number.isSafeInteger(stack.number))) return null;
  }
  if (position !== null && (!Number.isSafeInteger(position) || position < 0)) return null;
  return {
    id: value.id, number: value.number, title: value.title, url: value.url, state: value.state, isDraft: value.isDraft,
    updatedAt: value.updatedAt ?? null, repository: { nameWithOwner: value.repository.nameWithOwner },
    author: typeof value.author?.login === "string" ? { login: value.author.login } : null,
    stack, position, reasons: [],
  };
}

export function reasonLabel(reason) {
  if (reason === "authored") return "Authored by you";
  if (reason === "assigned") return "Assigned to you";
  return "Review requested";
}

// Only matching rows determine counts and activity. Context is enrichment, never inbox membership.
export function prGroups(snapshot, contexts = {}) {
  const repositories = new Map();
  for (const pr of new Map((snapshot?.prs ?? []).map(pr => [pr.id, pr])).values()) {
    const name = pr.repository.nameWithOwner;
    if (!repositories.has(name)) repositories.set(name, { name, count: 0, updatedAt: "", units: [] });
    const repo = repositories.get(name);
    repo.count++;
    if (!repo.updatedAt || Date.parse(pr.updatedAt) > Date.parse(repo.updatedAt)) repo.updatedAt = pr.updatedAt;
    const id = pr.stack?.id ?? pr.id;
    let unit = repo.units.find(unit => unit.id === id);
    if (!unit) {
      unit = { id, stack: pr.stack, matches: [], updatedAt: "", entries: [] };
      repo.units.push(unit);
    }
    unit.matches.push(pr);
    if (!unit.updatedAt || Date.parse(pr.updatedAt) > Date.parse(unit.updatedAt)) unit.updatedAt = pr.updatedAt;
  }
  for (const repo of repositories.values()) {
    repo.units.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
    for (const unit of repo.units) {
      const context = unit.stack ? contexts[unit.id] : null;
      const members = new Map();
      for (const entry of context?.entries ?? []) {
        if (entry.pr && entry.pr.repository.nameWithOwner === repo.name) members.set(entry.pr.id, { position: entry.position, pr: entry.pr });
      }
      for (const pr of unit.matches) {
        const known = members.get(pr.id);
        members.set(pr.id, { position: pr.position ?? known?.position ?? null, pr });
      }
      const entries = [...members.values()];
      for (const entry of context?.entries ?? []) {
        if (!entry.pr && !entries.some(known => known.position === entry.position)) entries.push(entry);
      }
      unit.entries = entries.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || (a.pr?.id ?? "").localeCompare(b.pr?.id ?? ""));
      unit.size = context?.size ?? unit.stack?.size ?? 1;
      unit.context = context;
    }
  }
  return [...repositories.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.name.localeCompare(b.name));
}
