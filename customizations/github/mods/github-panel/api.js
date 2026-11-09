import { normalizePr, VIEWS } from "./model.js";

export const VIEWER_QUERY = `query Viewer { viewer { login } }`;
export const QUEUE_QUERY = `query Queue($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      id number title url state isDraft updatedAt
      repository { nameWithOwner }
      author { login }
      stack { id number size }
      stackEntry { position }
    } }
  }
  rateLimit { remaining resetAt }
}`;
export const STACK_QUERY = `query Stack($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequestStack {
    id number size
    entries(first: 100, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { position pullRequest {
        id number title url state isDraft
        repository { nameWithOwner }
      } }
    }
  } }
}`;
const failure = "GitHub request unavailable. Check local gh installation, authentication and repository access, then Refresh.";

async function request(exec, config, query, variables = {}) {
  const args = ["api", "--hostname", "github.com", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) args.push(value === null ? "-F" : "-f", `${key}=${value === null ? "null" : value}`);
  let result, code;
  try {
    const response = await exec(config.ghPath, args);
    result = JSON.parse(response.stdout);
    code = response.code;
  } catch { throw new Error(failure); }
  if (!result || typeof result !== "object" || Array.isArray(result)
    || (result.errors !== undefined && (!Array.isArray(result.errors)
      || result.errors.some(error => !error || typeof error.message !== "string")))) throw new Error(failure);
  // gh also exits nonzero for GraphQL errors; usable partial data is validated by each caller.
  if (code !== 0 && !result.errors?.length) throw new Error(failure);
  let warning = result.errors?.length ? "GitHub returned incomplete query data. Check access and Refresh." : null;
  if (result.errors?.some(error => error?.type === "RATE_LIMITED") || result.data?.rateLimit?.remaining === 0) {
    const reset = result.data?.rateLimit?.resetAt;
    warning = `GitHub rate limit reached. Wait, then Refresh.${typeof reset === "string" && Number.isFinite(Date.parse(reset)) ? ` Reset ${new Date(reset).toISOString()}.` : ""}`;
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error(warning ?? failure);
  return { data: result.data, warning };
}

// Explicit cursors: neither gh --paginate nor a local checkout participates.
function nextCursor(page, seen) {
  if (typeof page?.pageInfo?.hasNextPage !== "boolean") throw new Error("GitHub pagination incomplete. Refresh to try again.");
  if (!page.pageInfo.hasNextPage) return null;
  const next = page.pageInfo.endCursor;
  if (typeof next !== "string" || !next || seen.has(next)) throw new Error("GitHub pagination incomplete. Refresh to try again.");
  seen.add(next);
  return next;
}

async function loadSource(exec, config, source) {
  const prs = new Map(), warnings = [], seen = new Set();
  let after = null, usable = false, fetched = 0;
  try {
    for (;;) {
      const { data, warning } = await request(exec, config, QUEUE_QUERY, { q: source.query, after });
      if (warning) warnings.push(warning);
      const page = data.search;
      if (!Array.isArray(page?.nodes) || !Number.isSafeInteger(page.issueCount) || page.issueCount < 0) throw new Error("GitHub search data incomplete. Refresh to try again.");
      for (const node of page.nodes) {
        const pr = normalizePr(node, config);
        if (!pr) { warnings.push("GitHub returned an unavailable PR. Refresh to try again."); continue; }
        usable = true;
        if (pr.state === "OPEN") prs.set(pr.id, { ...pr, reasons: [source.reason] });
      }
      // An empty valid source is usable; malformed-only or errored empty data is not an all-clear.
      usable ||= prs.size > 0 || (!warning && page.nodes.length === 0 && page.issueCount === 0);
      fetched += page.nodes.length;
      after = nextCursor(page, seen);
      if (after && !page.nodes.length) throw new Error("GitHub search data incomplete. Refresh to try again.");
      if (page.issueCount > 1000 || (after && fetched >= 1000)) {
        warnings.push("GitHub search is limited to 1,000 results per source.");
      }
      if (!after || fetched >= 1000 || warning) break;
    }
  } catch (error) { warnings.push(error.message); }
  return { prs: [...prs.values()], usable, warnings: [...new Set(warnings)].map(message => `${source.label}: ${message}`) };
}

export async function loadView(exec, config, view) {
  if (!VIEWS.includes(view)) throw new Error("Unknown GitHub queue.");
  const viewerResult = await request(exec, config, VIEWER_QUERY);
  const login = viewerResult.data.viewer?.login;
  if (typeof login !== "string" || !/^[A-Za-z0-9-]+$/.test(login)) throw new Error(failure);
  if (viewerResult.warning) {
    const error = new Error(viewerResult.warning);
    error.viewer = { login };
    throw error;
  }
  const sources = view === "authored" ? [{ reason: "authored", label: "Authored", qualifier: `author:${login}` }]
    : [
      { reason: "assigned", label: "Assigned", qualifier: `assignee:${login}` },
      { reason: "review-requested", label: "Personal review", qualifier: "user-review-requested:@me" },
    ];
  for (const source of sources) source.query = `org:${config.organization} is:pr is:open ${source.qualifier} sort:updated-desc`;
  const results = [];
  for (let index = 0; index < sources.length; index += 2) {
    const batch = sources.slice(index, index + 2);
    const settled = await Promise.allSettled(batch.map(source => loadSource(exec, config, source)));
    settled.forEach((result, offset) => results.push(result.status === "fulfilled" ? result.value
      : { prs: [], usable: false, warnings: [`${batch[offset].label}: ${failure}`] }));
  }
  if (!results.some(result => result.usable)) {
    const error = new Error(results.flatMap(result => result.warnings).join(" ") || failure);
    error.viewer = { login }; // Lets the view discard a previous account even when this account's search fails.
    throw error;
  }
  const prs = new Map();
  for (const result of results) for (const pr of result.prs) {
    const previous = prs.get(pr.id);
    prs.set(pr.id, { ...pr, reasons: [...new Set([...(previous?.reasons ?? []), ...pr.reasons])] });
  }
  const warnings = results.flatMap(result => result.warnings);
  return { viewer: { login }, configKey: JSON.stringify(config), view, prs: [...prs.values()], loadedAt: Date.now(), complete: !warnings.length, warnings };
}

export async function loadStack(exec, config, id) {
  const entries = [], ids = new Set(), positions = new Set(), seen = new Set(), warnings = [];
  let after = null, stack = null;
  try {
    for (;;) {
      const { data, warning } = await request(exec, config, STACK_QUERY, { id, after });
      if (warning) warnings.push(warning);
      const node = data.node, page = node?.entries;
      if (node?.id !== id || !Number.isSafeInteger(node.size) || node.size < 1 || !Number.isSafeInteger(node.number)
        || !Array.isArray(page?.nodes) || !Number.isSafeInteger(page.totalCount)) throw new Error("Stack context unavailable. Check access and retry.");
      stack = { id, number: node.number, size: node.size };
      for (const entry of page.nodes) {
        if (!entry || !Number.isSafeInteger(entry.position) || entry.position < 0 || !("pullRequest" in entry)) {
          warnings.push("Stack contains an unavailable layer."); continue;
        }
        const pr = entry.pullRequest === null ? null : normalizePr(entry.pullRequest, config, { stack, position: entry.position, context: true });
        if (entry.pullRequest !== null && !pr) warnings.push("Stack contains an unavailable layer.");
        if (pr ? ids.has(pr.id) : positions.has(entry.position)) continue;
        if (pr) ids.add(pr.id);
        positions.add(entry.position);
        entries.push({ position: entry.position, pr });
      }
      after = nextCursor(page, seen);
      if (after && !page.nodes.length) throw new Error("Stack pagination incomplete. Retry to try again.");
      if (!after || warning) break;
    }
  } catch (error) { warnings.push(error.message); }
  if (!stack) throw new Error(warnings.join(" ") || "Stack context unavailable. Check local gh authentication and access, then retry.");
  return { ...stack, entries, complete: !warnings.length, warnings: [...new Set(warnings)], loadedAt: Date.now() };
}
