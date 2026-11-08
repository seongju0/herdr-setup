import { appHome, home, readTextFile, exec } from "herdr";

const LIMIT = 20000;
const normalize = path => path.replace(/\/+$/, "") || "/";
const localAbsolute = path => typeof path === "string" && path.startsWith("/") && !path.includes("\0");

// Resolve once per dialog. Invalid configuration never falls back to a wider scope.
export async function searchRoots(defaultFolder) {
  const text = await readTextFile(`${appHome()}/config/workspace-browser.json`);
  const config = text === null ? {} : JSON.parse(text);
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      (config.searchRoots !== undefined && !Array.isArray(config.searchRoots))) {
    throw new Error("workspace-browser.json: searchRoots must be an array of absolute directory paths");
  }
  const configured = config.searchRoots ?? [];
  const paths = configured.length ? configured : (defaultFolder ? [defaultFolder] : []);
  return [...new Set(paths.map(path => {
    if (typeof path === "string" && (path === "~" || path.startsWith("~/"))) path = home() + path.slice(1);
    if (!localAbsolute(path)) throw new Error("workspace-browser.json: every search root must be an absolute or ~/ directory path (no NUL characters)");
    return normalize(path);
  }))];
}

export function withinRoots(path, roots) {
  return roots.some(root => path === root || path.startsWith(root === "/" ? root : `${root}/`));
}

export async function discover(root) {
  // An absolute root still yields absolute paths with --relative-path, without
  // canonicalizing root aliases (e.g. macOS /var or a symlinked search root).
  const args = ["--type", "d", "--relative-path", "--show-errors", "--color", "never", "--print0", "--hidden", "--no-ignore",
    "--exclude", ".git", "--exclude", "node_modules", "--max-results", String(LIMIT + 1), "", root];
  let result;
  try { result = await exec("fd", args); }
  catch (error) {
    if (!String(error).includes("cannot start fd: program not found")) throw error;
    result = await exec(`${home()}/.pi/agent/bin/fd`, args);
  }
  if (result.code !== 0) throw new Error(result.stderr || `Cannot search ${root}`);
  const paths = result.stdout.split("\0").filter(Boolean).map(normalize);
  // The root itself remains selectable, even when fd finds no descendants.
  const unique = [...new Set([root, ...paths.filter(path => localAbsolute(path) && withinRoots(path, [root]))])];
  // fd can report traversal errors on stderr while still exiting successfully.
  return { paths: unique.slice(0, LIMIT), limited: unique.length > LIMIT, warning: result.stderr.trim() };
}
