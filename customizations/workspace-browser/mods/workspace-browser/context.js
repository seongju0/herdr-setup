import { spaces, panes, agents, terminals, focused, shared, setShared } from "herdr";

export const SHARED_KEY = "herdr-setup.workspace-browser.v1";
export const absolute = path => typeof path === "string" && !path.includes("\0") && (/^\//.test(path) || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path));
export const targetKey = target => JSON.stringify([target.on ?? null, target.cwd]);
const scopeKey = scope => JSON.stringify([scope.space, scope.tab]);

export function currentScope() {
  const f = focused(), space = spaces().find(s => s.id === f?.space) ?? spaces().find(s => s.active);
  return { space: space?.id, tab: f?.tab ?? space?.tabs.find(t => t.active)?.id, on: space?.machine ?? null };
}
export function exists(scope) {
  return spaces().some(s => s.id === scope.space && s.tabs.some(t => t.id === scope.tab));
}
export function record(scope) {
  return shared(SHARED_KEY)?.[scopeKey(scope)] ?? { pin: null, followPi: null, recents: [] };
}
function publish(scope, update) {
  if (!exists(scope)) return false;
  // Read again at publication: another view/tab may have written during an await.
  const all = shared(SHARED_KEY) ?? {};
  setShared(SHARED_KEY, { ...all, [scopeKey(scope)]: { ...record(scope), ...update } });
  return true;
}
const machine = (address, space) => address?.includes("/") ? address.split("/")[0] : space?.machine ?? null;
function snapshot(scope) {
  const space = spaces().find(s => s.id === scope.space), f = focused();
  const tabPanes = panes().filter(p => p.tab === scope.tab);
  const tabAgents = agents().filter(a => a.space === scope.space && a.tab === scope.tab);
  const live = terminals().filter(t => t.state === "live" && t.report?.app === "pi");
  const byAddress = address => live.find(t => t.address === address);
  const inTab = address => tabPanes.some(p => p.terminal === address) || tabAgents.some(a => a.address === address);
  const focusedAddress = f && f.space === scope.space && f.tab === scope.tab
    ? [f.shown, f.agent, f.terminal].find(a => a && inTab(a) && byAddress(a)) : null;
  const remembered = record(scope).followPi;
  const pi = byAddress(focusedAddress) ?? (inTab(remembered) ? byAddress(remembered) : null)
    ?? tabPanes.map(p => byAddress(p.terminal)).find(Boolean);
  return { space, f, tabPanes, pi, focusedAddress };
}

// Pure live decision. Labels alone never make a shell/background terminal Pi.
export function resolve(scope = currentScope(), ignorePin = false) {
  const { space, f, tabPanes, pi } = snapshot(scope), saved = record(scope);
  let cwd, on = space?.machine ?? null, source, error;
  if (saved.pin && !ignorePin) {
    ({ cwd, on } = saved.pin); source = "Pin";
  } else if (pi) {
    on = machine(pi.address, space); source = "Session";
    if (typeof pi.labels?.["pi.session-id"] === "string" && pi.labels["pi.session-id"].trim() && absolute(pi.labels?.["pi.session-cwd"])) cwd = pi.labels["pi.session-cwd"];
    else error = "Pi folder integration unavailable · session metadata missing";
  } else {
    const here = f && f.space === scope.space && f.tab === scope.tab;
    const pane = here ? tabPanes.find(p => p.pane === f.pane) : null;
    if (pane?.cwd) { cwd = pane.cwd; on = machine(pane.terminal, space); source = "Pane"; }
    else if (here && f.cwd) { cwd = f.cwd; on = machine(f.terminal, space); source = "Terminal"; }
    else { cwd = space?.folder; source = "Space"; }
  }
  return { ...scope, cwd, on: on ?? null, source, error, piTerminal: pi?.address ?? null,
    key: JSON.stringify([scope.space, scope.tab, on ?? null, cwd ?? null]) };
}

// Render only schedules; shared writes happen with the root's task context.
export function observe(owner, cx) {
  const scope = currentScope(), { focusedAddress } = snapshot(scope);
  if (!focusedAddress || record(scope).followPi === focusedAddress || owner.observing) return;
  owner.observing = true;
  cx.spawn(async () => {
    owner.observing = false;
    const live = snapshot(scope);
    if (live.focusedAddress === focusedAddress && record(scope).followPi !== focusedAddress) publish(scope, { followPi: focusedAddress });
  });
}
export function pin(scope, target) {
  const recent = record(scope).recents ?? [];
  return publish(scope, { pin: { cwd: target.cwd, on: target.on ?? null },
    recents: [{ cwd: target.cwd, on: target.on ?? null }, ...recent.filter(r => targetKey(r) !== targetKey(target))].slice(0, 10) });
}
export function follow(scope) {
  // Observe the current live focus even if it changed while the dialog was open.
  const { focusedAddress } = snapshot(scope);
  return publish(scope, { pin: null, ...(focusedAddress ? { followPi: focusedAddress } : {}) });
}
export function candidates(scope) {
  const { space, tabPanes } = snapshot(scope), session = resolve(scope, true);
  const all = [ ...(session.cwd ? [{ cwd: session.cwd, on: session.on, label: session.source }] : []),
    ...tabPanes.filter(p => absolute(p.cwd)).map(p => ({ cwd: p.cwd, on: machine(p.terminal, space), label: "Pane" })),
    ...(absolute(space?.folder) ? [{ cwd: space.folder, on: space.machine ?? null, label: "Space" }] : []),
    ...(record(scope).recents ?? []).map(r => ({ ...r, label: "Recent" })) ];
  const seen = new Set();
  return all.filter(r => { const k = targetKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
}
