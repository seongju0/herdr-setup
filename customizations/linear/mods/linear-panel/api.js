import { issueFilter } from "./model.js";

// Verified against linear/linear packages/sdk/src/schema.graphql, 2026-11-07.
export const CONTEXT_QUERY = `query PanelContext($team: String!) {
  viewer { id name }
  teams(first: 2, filter: { key: { eq: $team } }) {
    nodes { id key name activeCycle { id name number startsAt endsAt } }
  }
}`;
export const ISSUES_QUERY = `query PanelIssues($filter: IssueFilter!, $after: String) {
  issues(first: 100, after: $after, includeArchived: false, orderBy: updatedAt, filter: $filter) {
    nodes {
      id identifier title url updatedAt
      state { id name type color position }
      project { id name url }
      assignee { id name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export async function graphql(fetcher, token, query, variables) {
  const response = await fetcher("https://api.linear.app/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error("Linear access denied. Check your read-only API key and team access in Keychain.");
  }
  if (response.status === 429) throw new Error("Linear rate limit reached. Wait, then Refresh again.");
  if (!response.ok) throw new Error(`Linear request failed (HTTP ${response.status}). Try Refresh again.`);
  const result = await response.json();
  // Do not expose arbitrary remote error payloads or credentials in the UI/logs.
  if (result.errors?.length || !result.data) throw new Error("Linear could not complete the query. Check team/key permissions and try Refresh.");
  return result.data;
}

export async function loadView(fetcher, token, config, view) {
  const data = await graphql(fetcher, token, CONTEXT_QUERY, { team: config.team });
  const teams = data.teams?.nodes;
  if (!data.viewer?.id || !Array.isArray(teams) || teams.length !== 1) {
    throw new Error(`Team ${config.team} was not uniquely found. Check the team key and API key access.`);
  }
  const context = { viewer: data.viewer, team: teams[0], cycle: teams[0].activeCycle };
  const filter = issueFilter(view, context.viewer.id, context.team.id, context.cycle?.id);
  if (!filter) return { ...context, issues: [], loadedAt: Date.now() };
  const issues = new Map();
  let after = null;
  do {
    const page = (await graphql(fetcher, token, ISSUES_QUERY, { filter, after })).issues;
    if (!Array.isArray(page?.nodes) || !page.pageInfo) throw new Error("Linear returned an incomplete issue list. Try Refresh.");
    for (const issue of page.nodes) issues.set(issue.id, issue);
    if (!page.pageInfo.hasNextPage) break;
    const next = page.pageInfo.endCursor;
    if (!next || next === after) throw new Error("Linear pagination did not advance. Try Refresh.");
    after = next;
  } while (true);
  return { ...context, issues: [...issues.values()], loadedAt: Date.now() };
}
