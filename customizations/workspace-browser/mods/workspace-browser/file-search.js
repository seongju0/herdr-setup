import { exec, home } from "herdr";

const LIMIT = 20000;

// fd is scoped by cwd/on, never by the picker's configured roots or Git root.
export async function scanFiles(context) {
  const args = ["--type", "f", "--relative-path", "--show-errors", "--color", "never", "--print0", "--hidden",
    "--exclude", ".git", "--exclude", "node_modules", "--max-results", String(LIMIT + 1), ""];
  const options = { cwd: context.cwd, on: context.on };
  let result;
  try { result = await exec("fd", args, options); }
  catch (error) {
    const missing = /cannot start fd: program not found|cannot run fd: No such file or directory \(os error 2\)/.test(String(error));
    if (!missing) throw error;
    if (context.on) throw new Error("File search unavailable: fd is not installed on the selected machine");
    result = await exec(`${home()}/.pi/agent/bin/fd`, args, options);
  }
  // Only complete NUL-delimited records are candidates. Preserve whitespace,
  // including newlines, and reject paths which could escape the selected cwd.
  const records = result.stdout.split("\0").slice(0, -1);
  const paths = [...new Set(records.slice(0, LIMIT).map(path => path.replace(/^(\.\/)+/, ""))
    .filter(path => path && !path.startsWith("/") && !path.startsWith("\\") && !/^[a-z]:/i.test(path)
      && path.split(/[\\/]/).every(part => part && part !== "." && part !== "..")))];
  const warning = result.stderr.trim() || (result.code !== 0 ? `fd exited with status ${result.code}` : "");
  return { paths, limited: records.length > LIMIT, warning };
}

function score(text, term) {
  const lower = text.toLowerCase();
  if (lower === term) return 0;
  if (lower.startsWith(term)) return 10 + (text.length - term.length) / 1000;
  let at = 0, previous = -1, cost = 30;
  for (const char of term) {
    const next = lower.indexOf(char, at);
    if (next < 0) return Infinity;
    const boundary = next === 0 || /[\/_.\-\s]/.test(text[next - 1]) || /[a-z][A-Z]/.test(text.slice(next - 1, next + 1));
    cost += next === previous + 1 ? 0 : boundary ? 1 : 5;
    cost += (next - at) / 100;
    previous = next; at = next + 1;
  }
  return cost + text.length / 1000;
}

export function matchFiles(paths, query) {
  const terms = query.toLowerCase().slice(0, 4096).split(/\s+/).filter(Boolean);
  const matches = paths.map(path => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return { path, score: terms.reduce((sum, term) => sum + Math.min(score(name, term), score(path, term) + 15), 0) + path.length / 10000 };
  }).filter(row => Number.isFinite(row.score))
    .sort((a, b) => a.score - b.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { paths: matches.slice(0, 50).map(row => row.path), count: matches.length };
}
