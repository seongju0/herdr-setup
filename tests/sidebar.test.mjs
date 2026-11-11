import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sourceRoot = new URL('../customizations/sidebar/mods/sidebar/', import.meta.url);
const ok = stdout => ({ code: 0, stdout, stderr: '' });

// Load the real routed package, following workspace-browser.test.mjs. Only
// GPUI/native snapshots, storage, clock and external process/watch are replaced.
async function nativeHost(fixture = {}) {
  const modules = new Map(), shared = new Map(), storage = new Map(fixture.storage ?? []), queue = [], failures = [], timers = [];
  const state = {
    now: 1000000, windowActive: true, width: 312, calls: [], overlays: [], orders: [], notifications: 0, stopped: 0,
    agents: [], terminals: [], panes: [], focus: {}, knownAgents: [], configText: null,
    spaces: [{ id: 's', name: 'Synthetic workspace', folder: '/repo', active: true, tabs: [{ id: 'tab', name: '1', named: false }] }],
    machines: [], inventory: [], ...fixture,
  };
  function element(asset) {
    const node = { children: [], asset, styles: {} };
    const add = child => { if (child != null) node.children.push(child?.node ?? child); };
    const proxy = new Proxy({}, { get: (_target, method) => {
      if (method === 'node') return node;
      return (...args) => {
        if (method === 'id') node.id = args[0];
        else if (method === 'child') add(args[0]);
        else if (method === 'children') args[0].forEach(add);
        else if (method === 'when') { if (args[0]) args[1](proxy); }
        else if (method.startsWith('on_')) {
          node[method] = args.at(-1);
          if (typeof args[0] === 'string') node[`${method}_${args[0]}`] = args.at(-1);
        }
        else if (method === 'tooltip' || method === 'accessibility_label') node[method] = args[0];
        else node.styles[method] = args.length ? args[0] : true;
        return proxy;
      };
    } });
    return proxy;
  }
  const cx = {
    notify() { state.notifications++; }, stop_propagation() { state.stopped++; },
    spawn(task) { queue.push(task); }, timer: { every(ms, fn) { timers.push({ ms, fn }); }, after(_ms, fn) { queue.push(fn); } },
    focus_handle() { return { focus() {} }; },
  };
  const external = {
    View: class {}, div: element, svg: element, image: element, v_flex: element, h_flex: element,
    InputState: { new(options = {}) {
      let value = options.value ?? ''; const handlers = new Map();
      return { value: () => value, set_value(next) { value = next; },
        on(event, handler) { handlers.set(event, handler); }, focus() {}, release() {},
        set_selected_range() {},
        change(next) { value = next; handlers.get('change')?.({}, cx); },
        submit() { handlers.get('submit')?.({}, cx); } };
    } },
    Input: { new(input) { return element(input); } },
    home: () => '/home/synthetic', appHome: () => '/app',
    readTextFile: async path => { state.calls.push({ read: path }); return state.configText; },
    knownAgents: async options => { state.calls.push({ knownAgents: options }); if (state.launcherError) throw new Error(state.launcherError); return state.knownAgents; },
    spaces: () => state.spaces, agents: () => state.agents, panes: () => state.panes, terminals: () => state.terminals,
    machines: () => state.machines, focused: () => state.focus, props: () => state.props,
    theme: () => ({ selected: '#333333', hover: '#222222', border: '#444444', muted: '#888888', dim: '#777777', foreground: '#eeeeee', accent: '#aacc44', blocked: '#cc8800', working: '#4488cc', done: '#44aa77', idle: '#999999' }),
    window: () => ({ platform: 'macos', active: state.windowActive }), updates: () => ({ app: { ready: true } }),
    layout: () => ({ id: 'sidebar', size: { px: state.width } }),
    shared: key => shared.get(key), setShared: (key, value) => shared.set(key, value),
    setAgentOrder(order) { state.orders.push(Array.from(order)); },
    run(command, args) {
      state.calls.push({ command, args });
      if (command === 'layout.resize') state.width = args.px;
    },
    openOverlay(options) { state.overlays.push(options); return 'overlay'; }, closeOverlay(id) { state.closedOverlay = id; },
    watchFolder(path) { state.calls.push({ watch: path }); return new Promise(() => {}); },
    hc: async args => {
      state.calls.push({ hc: Array.from(args) });
      assert.deepEqual(Array.from(args), ['machine', 'ls', '--json'], 'Rendering may only list machine inventory');
      return ok(JSON.stringify({ machines: state.inventory }));
    },
    exec: async (command, args, options = {}) => {
      const call = { process: command, args: Array.from(args), ...options }; state.calls.push(call);
      if (state.processHandler && command !== 'git') return state.processHandler(command, Array.from(args), options);
      assert.equal(command, 'git', 'Only controlled process boundaries, no actual scanners or network');
      if (args.includes('status')) {
        assert.equal(args[0], '--no-optional-locks');
        return ok('# branch.head feature/synthetic-long-branch\n# branch.ab +2 -3\n');
      }
      if (args.includes('--show-toplevel')) return ok(options.cwd + '\n');
      if (args.includes('--git-common-dir')) return ok('/repo/.git\n');
      assert.fail(`Unexpected git invocation: ${args.join(' ')}`);
    },
  };
  const sandbox = vm.createContext({ ...external,
    Date: class extends Date { static now() { return state.now; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  });
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let source = await readFile(new URL(name, sourceRoot), 'utf8');
    const bindings = {};
    for (const match of source.matchAll(/^import (.+) from "(.+)";$/gm)) {
      const dependency = match[2].startsWith('./') ? await load(match[2].slice(2)) : external;
      if (match[1].startsWith('{')) for (const id of match[1].slice(1, -1).split(',').map(s => s.trim())) {
        assert.ok(id in dependency, `${name}: missing boundary ${id}`); bindings[id] = dependency[id];
      } else bindings[match[1]] = dependency.default;
    }
    source = source.replace(/^import .*;\n/gm, '');
    const exports = [...source.matchAll(/export (?:async )?(?:const|function) (\w+)/g)].map(m => m[1]);
    source = source.replace(/export default class (\w+)/, 'const Default = class $1').replace(/export (async )?(const|function)/g, '$1$2');
    const body = `(function(${Object.keys(bindings).join(',')}) { ${source}\nreturn { ${[...exports, ...(source.includes('const Default =') ? ['default: Default'] : [])].join(',')} }; })`;
    const result = new vm.Script(body, { filename: name }).runInContext(sandbox)(...Object.values(bindings));
    modules.set(name, result); return result;
  }
  const { default: Main } = await load('main.js');
  const views = {}, trees = {}, configs = {};
  function mount(role, config = {}) {
    state.props = configs[role] = { ...config, view: role, overlay: 'overlay' };
    const view = new Main(); view.init(undefined, cx); views[role] = view;
    return view;
  }
  mount('body'); mount('brand'); mount('footer');
  const render = () => { for (const [role, view] of Object.entries(views)) { state.props = configs[role]; trees[role] = view.render(cx).node; } };
  const find = (node, id) => node?.id === id ? node : node?.children?.map(n => find(n, id)).find(Boolean);
  const all = node => [node, ...(node?.children ?? []).flatMap(all)];
  const text = node => typeof node === 'string' ? node : (node?.children ?? []).map(text).join(' ');
  const node = (id, role = 'body') => find(trees[role], id);
  const click = (id, role = 'body') => { const n = node(id, role); assert.ok(n?.on_click, `Missing click ${role}:${id}`); n.on_click({}, cx); render(); };
  const settle = async () => {
    for (let i = 0; i < 100; i++) {
      while (queue.length) Promise.resolve(queue.shift()(cx)).catch(error => failures.push(error));
      await Promise.resolve();
    }
    if (failures.length) throw failures.shift();
    render();
  };
  render();
  return { state, storage, shared, timers, render, settle, click, node, mount,
    create(config = {}) { const view = mount('create', config); render(); return view.implementation; },
    closeCreate() { views.create.close(cx); },
    text: (id, role = 'body') => text(id ? node(id, role) : trees[role]),
    nodes: (role = 'body') => all(trees[role]),
    order: () => state.orders.at(-1),
    focus(address) {
      state.agents.forEach(a => { a.focused = a.address === address; });
      const a = state.agents.find(a => a.address === address);
      state.focus = a ? { agent: address, terminal: address, pane: a.pane, space: a.space, tab: a.tab } : {};
      render();
    },
    rowIds() { return all(trees.body).map(n => n?.id).filter(id => /^(space-|ag-)/.test(id ?? '')); },
    measure(width, height) { node('sidebar-body').on_size_change({ width, height }, cx); render(); },
    async tick(ms) { timers.filter(t => t.ms === ms).forEach(t => t.fn(cx)); await settle(); },

  };
}

const agent = (address, status, extra = {}) => ({ address, status, pane: `pane-${address}`, space: 's', tab: 'tab', space_name: 'Synthetic workspace', program: { name: 'Pi', key: 'pi' }, seq: 1, ...extra });

test('U1 unified space hierarchy retains identity, pins, child urgency and native addresses', async () => {
  const host = await nativeHost({
    spaces: [
      { id: 's', name: 'Synthetic workspace', folder: '/repo', tabs: [{ id: 'tab', name: '1', named: false }, { id: 'named', name: 'Ship synthetic task', named: true }] },
      { id: 'shell', name: 'Terminal only', folder: '/scratch', tabs: [] },
      { id: 'remote/s', name: 'Remote workspace', machine: 'remote', folder: '/srv/repo', tabs: [{ id: 'remote/tab', name: '2', named: false }] },
    ],
    agents: [
      agent('a', 'working', { title: 'Fix retry logic' }), agent('b', 'working', { title: 'Check release' }),
      agent('c', 'idle', { tab: 'named', title: 'Different title' }), agent('generic', 'working', { title: '12' }),
      agent('duplicate', 'working', { title: 'Fix retry logic' }), agent('done', 'done', { title: 'Completed task' }),
      agent('pinned', 'idle', { pinned: true, title: 'Pinned task' }),
      agent('remote/root', 'working', { space: 'remote/s', tab: 'remote/tab', title: 'Remote task' }),
    ],
    terminals: [
      { address: 'remote/child', parent: 'remote/root', state: 'live', status: 'error', name: 'Synthetic child' },
      { address: 'remote/old', parent: 'remote/root', state: 'dead', status: 'error' },
    ],
  });
  const ids = host.rowIds(), position = id => ids.indexOf(id);
  assert.match(host.text('ag-a'), /Fix retry logic.*Synthetic workspace.*1.*a/);
  assert.match(host.text('ag-b'), /Check release.*Synthetic workspace/);
  assert.match(host.text('ag-generic'), /Pi.*Synthetic workspace.*1/);
  assert.match(host.text('ag-c'), /Ship synthetic task/);
  assert.doesNotMatch(host.text('ag-c'), /Different title/);
  assert.ok(position('space-s') < position('ag-done'));
  assert.ok(position('ag-done') < position('ag-pinned'));
  assert.ok(position('ag-pinned') < position('ag-a'));
  assert.ok(position('ag-a') < position('ag-c'));
  assert.ok(position('ag-c') < position('space-shell'));
  assert.ok(position('space-shell') < position('space-remote/s'));
  assert.ok(position('space-remote/s') < position('ag-remote/root'));
  for (const a of host.state.agents) assert.equal(host.nodes().filter(n => n?.id === 'ag-' + a.address).length, 1);
  assert.match(host.text('ag-attention'), /2 need attention/);
  assert.match(host.node('ag-remote/root').tooltip, /working.*blocked/);
  assert.ok(host.node('unread-done')); assert.ok(host.node('space-unread-s'));
  host.click('ag-remote/root');
  assert.equal(host.state.calls.at(-1).command, 'pane.focus');
  assert.equal(host.state.calls.at(-1).args.pane, 'pane-remote/root');
  host.click('fold-remote/root'); assert.equal(host.node('sub-remote/child'), undefined);
  host.click('fold-remote/root'); host.click('sub-remote/child');
  assert.equal(host.state.calls.at(-1).command, 'terminal.peek');
  assert.equal(host.state.calls.at(-1).args.terminal, 'remote/child');
  assert.equal(host.node('sub-remote/old'), undefined);
  const before = host.state.calls.length, stopped = host.state.stopped;
  host.click('pin-remote/root');
  assert.equal(host.state.calls.length, before + 1);
  assert.equal(host.state.calls.at(-1).command, 'terminal.pin');
  assert.equal(host.state.calls.at(-1).args.terminal, 'remote/root');
  assert.equal(host.state.stopped, stopped + 1);
  assert.equal(host.state.calls.some(c => c.command === 'terminal.pin' && c.args.terminal === 'pinned'), false);
  // Folding hides only the visual subtree: no native selection, focus/ack or traversal changes.
  const canonical = [...host.order()], callsBeforeFold = host.state.calls.length;
  const foldControl = host.node('space-fold-s'), stoppedBeforeFold = host.state.stopped;
  foldControl.on_mouse_down_left({}, { stop_propagation() { host.state.stopped++; } });
  foldControl.on_mouse_up_left({}, { stop_propagation() { host.state.stopped++; } });
  host.click('space-fold-s');
  assert.equal(host.state.stopped, stoppedBeforeFold + 3);
  assert.equal(host.state.calls.length, callsBeforeFold);
  assert.equal(host.node('ag-done'), undefined);
  assert.ok(host.node('space-s')); assert.ok(host.node('ag-remote/root'));
  assert.ok(host.node('space-unread-s'), 'Folded spaces retain unread aggregate');
  assert.deepEqual(host.order(), canonical);
  assert.deepEqual(JSON.parse(host.storage.get('spaces.folded')), ['s']);
  host.click('space-fold-s');
  assert.ok(host.node('ag-done')); assert.ok(host.node('unread-done'));
  assert.equal(host.node('space-agents-s').styles.ml, 30);
  host.focus('done');
  assert.equal(host.node('ag-done').styles.bg, '#333333');
  assert.equal(host.node('space-s').styles.bg, undefined, 'Space and agent must not share selected fill');
  host.focus('remote/root'); host.click('space-pin-remote/s');
  const focusedRows = host.rowIds();
  assert.ok(focusedRows.indexOf('space-s') < focusedRows.indexOf('space-remote/s'), 'Pinned remote spaces cannot escape their machine group');
  const shell = host.node('space-shell'); shell.on_mouse_down_left({}, {});
  shell.on_mouse_up_left({}, { notify() {} });
  assert.equal(host.state.calls.at(-1).command, 'space.select');
  assert.equal(host.state.calls.at(-1).args.id, 'shell');
  assert.deepEqual([...host.order()].sort(), host.state.agents.map(a => a.address).sort());
  assert.equal(new Set(host.order()).size, host.state.agents.length);
});

test('U2 focus acknowledges unread without masking live blocking or reordering native traversal', async () => {
  const host = await nativeHost({ agents: [
    agent('done', 'working'), agent('idle-a', 'idle'), agent('idle-b', 'idle'), agent('pin', 'idle', { pinned: true }),
  ] });
  const canonical = [...host.order()];
  host.state.agents[0].status = 'done'; host.render();
  assert.ok(host.node('unread-done'));
  const observed = JSON.parse(host.storage.get('changed')).done.at;
  host.state.now += 120000;
  host.state.agents[0].status = 'idle'; host.render();
  assert.ok(host.node('unread-done'), 'Native viewing from elsewhere does not acknowledge this instance');
  assert.equal(JSON.parse(host.storage.get('changed')).done.at, observed);
  assert.match(host.text('ag-done'), /2m/);
  host.state.agents[0].status = 'working'; host.render();
  assert.ok(host.node('unread-done'), 'Later work must not silently erase unacknowledged attention');
  assert.match(host.node('ag-done').tooltip, /working/);
  host.click('pin-done');
  assert.ok(host.node('unread-done'), 'Pin action does not fake focus');
  host.focus('done'); assert.equal(host.node('unread-done'), undefined);
  host.state.agents[0].status = 'done'; host.render();
  assert.equal(host.node('unread-done'), undefined, 'Focused completion is already seen');
  host.focus('idle-a');
  host.state.agents[0].status = 'working'; host.render();
  host.state.agents[0].status = 'done'; host.render();
  assert.ok(host.node('unread-done'), 'A later observed completion re-arms');
  host.state.agents[0].status = 'blocked'; host.render(); host.focus('done');
  assert.equal(host.node('unread-done'), undefined);
  assert.match(host.text('ag-attention'), /1 need attention/, 'Real blocked remains urgent after acknowledgement');
  assert.match(host.node('ag-done').tooltip, /blocked/);
  host.focus('idle-b'); host.render();
  assert.equal(host.node('unread-done'), undefined, 'Unchanged blocking does not immediately relatch');
  host.state.agents[0].status = 'working'; host.render();
  host.state.agents[0].status = 'blocked'; host.render();
  assert.ok(host.node('unread-done'), 'A new blocked transition re-arms');
  for (const direction of [1, -1]) {
    let address = canonical[0]; const visited = new Set();
    for (let i = 0; i < canonical.length * 3; i++) {
      host.focus(address); visited.add(address);
      assert.deepEqual(host.order(), canonical, 'Focus/pending changes cannot bounce native traversal');
      address = canonical[(canonical.indexOf(address) + direction + canonical.length) % canonical.length];
    }
    assert.equal(visited.size, canonical.length);
  }
  host.state.agents = []; host.render();
  assert.match(host.text(), /No agent status yet/);
  assert.ok(host.node('space-s'), 'No-agent state must not hide space navigation');
});

test('U3 unified scroll, worktree/machine controls and rail retain native navigation', async () => {
  const host = await nativeHost({
    storage: [['herdr-setup.spaces.recent', '["s2"]']],
    spaces: Array.from({ length: 12 }, (_, i) => ({ id: 's' + i, name: 'Synthetic long workspace ' + i, folder: i === 1 ? '/worktree' : '/repo', status: 'idle', active: i === 0, tabs: [{ id: 'tab' + i, name: '1' }] })),
    machines: [{ name: 'loading', layout: 'loading' }, { name: 'ready', layout: 'ready' }],
    inventory: [{ name: 'loading', state: 'connected' }, { name: 'ready', state: 'connected' }, { name: 'offline', state: 'unreachable', why: 'Synthetic offline machine' }, { name: 'rebuilt', state: 'unreachable', why: 'a different core answers there ("new-core")' }],
    agents: [
      agent('a', 'done', { space: 's0', tab: 'tab0', title: 'Sizing task' }),
      agent('tree', 'idle', { space: 's1', tab: 'tab1' }),
      agent('other', 'idle', { space: 's2', tab: 'tab2' }),
    ],
    panes: [{ pane: 'p0', tab: 'tab0', cwd: '/repo', terminal: 'a', program: { agent: true }, status: 'done' }],
  });
  await host.tick(250); host.measure(312, 300);
  const notify = host.state.notifications;
  host.measure(312, 300); assert.equal(host.state.notifications, notify);
  assert.equal(host.node('spaces-scroll').styles.overflow_y_scrollbar, true);
  assert.equal(host.node('spaces-section').styles.flex_1, true, 'Unified list fills the body');
  assert.equal(host.node('spaces-section').styles.h, undefined, 'No bottom companion height cap');
  assert.equal(host.node('ag-list'), undefined, 'There is no second independently scrolling agent list');
  assert.equal(host.node('space-s0').styles.h, 38);
  assert.equal(host.node('ag-a').styles.h, 46);
  assert.equal(host.nodes().find(n => n?.children?.includes('Sizing task')).styles.text_size, 12);
  assert.match(host.text('space-s0'), /feature\/synthetic-long-branch.*↑2.*↓3/);
  assert.ok(host.node('space-s1').children.some(n => n?.children?.some(c => c?.asset === 'mods/sidebar/icons/branch.svg')));
  assert.match(host.text('machine-loading-loading'), /Loading/);
  assert.match(host.text('machine-offline'), /unreachable/);
  assert.match(host.text('machine-rebuilt'), /Connect/);
  host.click('machine-add-ready');
  assert.equal(host.state.overlays.at(-1).props.view, 'create');
  assert.equal(host.state.overlays.at(-1).props.machine, 'ready');
  host.click('space-create', 'brand');
  assert.equal(host.state.overlays.at(-1).props.machine, '');
  host.click('search', 'brand'); assert.equal(host.state.calls.at(-1).args.name, 'picker');
  host.click('settings', 'footer'); assert.equal(host.state.calls.at(-1).command, 'app.settings');
  host.click('machine', 'footer'); assert.equal(host.state.calls.at(-1).args.name, 'machine-add');
  const canonical = [...host.order()];
  const spaceRows = () => host.rowIds().filter(id => /^space-s\d+$/.test(id));
  const moves = host.state.calls.filter(c => c.command === 'space.move').length;
  assert.equal(spaceRows()[0], 'space-s0', 'Legacy recency history must not influence stable order');
  host.focus('other');
  host.state.now += 60000; await host.tick(250);
  host.state.agents[0].status = 'working'; host.render();
  host.state.agents[0].status = 'done'; host.render();
  host.state.windowActive = false; await host.tick(250);
  host.state.windowActive = true; await host.tick(250);
  assert.equal(spaceRows()[0], 'space-s0', 'Focus, elapsed time, status and window return do not reorder spaces');
  assert.equal(host.storage.get('herdr-setup.spaces.recent'), '["s2"]', 'Unused old history is left untouched');
  host.click('space-fold-s2');
  const beforePinCalls = host.state.calls.length, stoppedBeforePin = host.state.stopped;
  const control = host.node('space-pin-s2');
  control.on_mouse_down_left({}, { stop_propagation() { host.state.stopped++; } });
  control.on_mouse_up_left({}, { stop_propagation() { host.state.stopped++; } });
  host.click('space-pin-s2');
  assert.equal(host.state.stopped, stoppedBeforePin + 3);
  assert.equal(host.state.calls.length, beforePinCalls, 'Space pin must not select, focus, drag or pin an agent');
  assert.equal(host.state.focus.space, 's2');
  assert.equal(host.node('ag-other'), undefined, 'Pinning preserves the space fold');
  assert.ok(host.node('space-unread-s0'), 'Pinning leaves unread markers alone');
  assert.deepEqual(spaceRows().slice(0, 3), ['space-s2', 'space-s0', 'space-s1'], 'Explicit pin promotes the chosen space');
  assert.deepEqual(JSON.parse(host.storage.get('herdr-setup.spaces.pinned')), ['s2']);
  host.click('space-pin-s1');
  assert.deepEqual(spaceRows().slice(0, 3), ['space-s0', 'space-s1', 'space-s2'], 'Pinned worktree families remain intact and use native relative order');
  host.click('space-pin-s1'); host.click('space-pin-s2');
  assert.deepEqual(spaceRows().slice(0, 3), ['space-s0', 'space-s1', 'space-s2'], 'Unpinning restores native order');
  host.click('space-pin-s2');
  host.mount('body'); await host.tick(250);
  assert.deepEqual(spaceRows().slice(0, 3), ['space-s2', 'space-s0', 'space-s1'], 'Explicit pins survive sidebar recreation');
  assert.equal(host.state.calls.filter(c => c.command === 'space.move').length, moves, 'Pins are display priority, not native reorder writes');
  assert.deepEqual(host.order(), canonical);
  host.click('sidebar-toggle', 'brand');
  assert.equal(host.state.calls.at(-1).args.px, 76);
  host.measure(76, 300); assert.deepEqual(host.order(), canonical);
  assert.ok(host.node('sidebar-expand'));
  assert.equal(host.node('spaces-rail-scroll').styles.overflow_y_scrollbar, true);
  assert.equal(host.node('spaces-rail-scroll').children[0].id, 'space-s2', 'Rail keeps explicit space-pin priority');
  assert.deepEqual(host.node('spaces-rail-scroll').children.map(n => n.id).sort(), host.state.spaces.map(s => 'space-' + s.id).sort());
  assert.ok(host.node('space-unread-s0'), 'Rail retains unread independently from live aggregate status');
  host.click('space-s1'); assert.equal(host.state.calls.at(-1).args.id, 's1'); assert.equal(host.state.width, 76);
  host.node('space-s1').on_mouse_down_right({}, {});
  assert.equal(host.state.overlays.at(-1).props.target.id, 's1');
  host.click('sidebar-expand'); assert.equal(host.state.calls.at(-1).args.px, 312);
  assert.ok(host.state.calls.some(c => c.process === 'git'));
  assert.ok(host.state.calls.filter(c => c.process).every(c => c.process === 'git'));
  assert.ok(host.state.calls.some(c => c.watch === '/repo/.git'));
  assert.ok(host.state.calls.every(c => !c.hc || c.hc[1] === 'ls'));
});

test('U4 routed creation validates folder and dispatches one native space with the installed launcher', async () => {
  const pi = { key: 'pi', name: 'Pi', installed: true, run: ['pi'] };
  const other = { key: 'other', name: 'Other harness', installed: true, run: ['other', '--interactive'] };
  const processHandler = (command, args) => {
    if (command === 'fd') return ok('/repo/project\0');
    if (command === 'sh') return args.at(-1) === '/missing' ? { code: 1, stdout: '', stderr: 'Not a directory' } : ok('');
    assert.fail('Unexpected process ' + command);
  };
  const host = await nativeHost({ knownAgents: [other, pi], processHandler });
  const dialog = host.create({ machine: '' }); await host.settle();
  dialog.nameInput.change('Named work');
  dialog.folderInput.change('project'); host.render();
  host.click('create-folder-0', 'create');
  assert.equal(host.state.calls.filter(c => c.command === 'space.new').length, 0, 'Selection fills the field only');
  host.click('create-submit', 'create'); await host.settle();
  const created = host.state.calls.filter(c => c.command === 'space.new');
  assert.equal(created.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].args)), { name: 'Named work', folder: '/repo/project', machine: '', argv: ['pi'] });
  assert.equal(host.state.closedOverlay, 'overlay');
  assert.ok(host.state.calls.some(c => c.read === '/app/config/workspace-browser.json'));

  const alternative = await nativeHost({ knownAgents: [pi, other], processHandler });
  const alternativeDialog = alternative.create(); await alternative.settle();
  alternativeDialog.folderInput.change('/repo/project');
  alternative.click('launcher-other', 'create');
  alternative.click('create-submit', 'create'); await alternative.settle();
  assert.deepEqual(Array.from(alternative.state.calls.find(c => c.command === 'space.new').args.argv), other.run);

  const terminal = await nativeHost({ knownAgents: [other], processHandler });
  const terminalDialog = terminal.create(); await terminal.settle();
  terminalDialog.nameInput.change('bad\0name');
  terminalDialog.folderInput.change('/repo');
  terminal.click('create-submit', 'create'); await terminal.settle();
  assert.equal(terminal.state.calls.some(c => c.command === 'space.new'), false, 'Malformed name is rejected before native dispatch');
  terminalDialog.nameInput.change('');
  terminalDialog.folderInput.change('/missing');
  terminal.click('create-submit', 'create'); await terminal.settle();
  assert.equal(terminal.state.calls.some(c => c.command === 'space.new'), false);
  assert.match(terminal.text(null, 'create'), /Not a directory/);
  terminalDialog.folderInput.change('/repo');
  terminal.click('create-submit', 'create'); await terminal.settle();
  const shell = terminal.state.calls.find(c => c.command === 'space.new');
  assert.deepEqual(JSON.parse(JSON.stringify(shell.args)), { folder: '/repo', machine: '' });

  const remote = await nativeHost({ knownAgents: [pi], processHandler });
  const remoteDialog = remote.create({ machine: 'remote' }); await remote.settle();
  remoteDialog.folderInput.change('/srv/repo'); remote.render();
  remote.click('create-submit', 'create'); await remote.settle();
  assert.equal(remote.state.calls.some(c => c.process === 'fd'), false);
  assert.ok(remote.state.calls.some(c => c.process === 'sh' && c.on === 'remote' && c.args.at(-1) === '/srv/repo'));
  assert.equal(remote.state.calls.find(c => c.command === 'space.new').args.machine, 'remote');

  const scopedSpaces = [
    { id: 'work', name: 'Work', folder: '/work', tabs: [] },
    { id: 'personal', name: 'Personal', folder: '/personal/project', tabs: [] },
  ];
  const scoped = await nativeHost({ spaces: scopedSpaces, configText: '{"searchRoots":["/work"]}',
    processHandler(command, args, options) {
      return command === 'fd' ? ok('/work/project\0') : processHandler(command, args, options);
    } });
  const scopedDialog = scoped.create(); await scoped.settle();
  scopedDialog.folderInput.change('project'); scoped.render();
  assert.match(scoped.text(null, 'create'), /\/work\/project/);
  assert.doesNotMatch(scoped.text(null, 'create'), /\/personal\/project/, 'Resolved roots constrain ordinary known-folder suggestions too');
  scopedDialog.folderInput.change('/personal/project');
  scoped.click('create-submit', 'create'); await scoped.settle();
  assert.equal(scoped.state.calls.find(c => c.command === 'space.new').args.folder, '/personal/project', 'Explicit paths may leave search roots');

  const badConfig = await nativeHost({ spaces: scopedSpaces, configText: '{invalid', processHandler });
  const badConfigDialog = badConfig.create(); await badConfig.settle();
  badConfigDialog.folderInput.change('project'); badConfig.render();
  assert.match(badConfig.text(null, 'create'), /configuration error/i);
  assert.match(badConfig.text(null, 'create'), /\/personal\/project/, 'Configuration failure retains known-folder access');
  assert.equal(badConfig.state.calls.some(c => c.process === 'fd'), false, 'Invalid configuration does not widen recursive discovery');

  let resolveFolder;
  const cancelled = await nativeHost({ processHandler(command) {
    if (command === 'fd') return ok('');
    if (command === 'sh') return new Promise(resolve => { resolveFolder = resolve; });
    assert.fail('Unexpected process');
  } });
  const cancelledDialog = cancelled.create(); await cancelled.settle();
  cancelledDialog.folderInput.change('/repo');
  cancelled.click('create-submit', 'create'); await cancelled.settle();
  assert.equal(typeof resolveFolder, 'function');
  cancelled.closeCreate(); resolveFolder(ok('')); await cancelled.settle();
  assert.equal(cancelled.state.calls.some(c => c.command === 'space.new'), false);

  for (const file of ['directory-search.js', 'directories.js']) {
    assert.equal(await readFile(new URL(file, sourceRoot), 'utf8'), await readFile(new URL('../customizations/workspace-browser/mods/workspace-browser/' + file, import.meta.url), 'utf8'), 'Independent mod helper stays identical to its tested owner');
  }
});
