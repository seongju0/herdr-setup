import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sourceRoot = new URL('../customizations/sidebar/mods/sidebar/', import.meta.url);
const ok = stdout => ({ code: 0, stdout, stderr: '' });

// Load the real routed package, following workspace-browser.test.mjs. Only
// GPUI/native snapshots, storage, clock and external process/watch are replaced.
async function nativeHost(fixture = {}) {
  const modules = new Map(), shared = new Map(), storage = new Map(), queue = [], failures = [], timers = [];
  const state = {
    now: 1000000, width: 312, calls: [], overlays: [], orders: [], notifications: 0, stopped: 0,
    agents: [], terminals: [], panes: [], focus: {},
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
    spawn(task) { queue.push(task); }, timer: { every(ms, fn) { timers.push({ ms, fn }); } },
  };
  const external = {
    View: class {}, div: element, svg: element, image: element, v_flex: element, h_flex: element,
    spaces: () => state.spaces, agents: () => state.agents, panes: () => state.panes, terminals: () => state.terminals,
    machines: () => state.machines, focused: () => state.focus, props: () => state.props,
    theme: () => ({ muted: '#888888', dim: '#777777', foreground: '#eeeeee', blocked: '#cc8800', working: '#4488cc', done: '#44aa77', idle: '#999999' }),
    window: () => ({ platform: 'macos', active: true }), updates: () => ({ app: { ready: true } }),
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
      assert.equal(command, 'git', 'No actual process, scanners or network');
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
  const views = {}, trees = {};
  function mount(role, config = {}) {
    state.props = { ...config, view: role };
    const view = new Main(); view.init(undefined, cx); views[role] = view;
    return view;
  }
  mount('body'); mount('brand'); mount('footer');
  const render = () => { for (const [role, view] of Object.entries(views)) { state.props = { view: role, overlay: 'overlay' }; trees[role] = view.render(cx).node; } };
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
  return { state, storage, shared, timers, render, settle, click, node,
    text: (id, role = 'body') => text(id ? node(id, role) : trees[role]),
    nodes: (role = 'body') => all(trees[role]),
    order: () => state.orders.at(-1),
    focus(address) {
      state.agents.forEach(a => { a.focused = a.address === address; });
      const a = state.agents.find(a => a.address === address);
      state.focus = a ? { agent: address, terminal: address, pane: a.pane, space: a.space, tab: a.tab } : {};
      render();
    },
    group(address) {
      let group;
      for (const n of node('ag-list').children) {
        if (/^(sec-|sp-|pinned$|current$)/.test(n.id ?? '')) group = n.id;
        if (n.id === `ag-${address}`) return group;
      }
    },
    measure(width, height) { node('sidebar-body').on_size_change({ width, height }, cx); render(); },
    async tick(ms) { timers.filter(t => t.ms === ms).forEach(t => t.fn(cx)); await settle(); },
    openSort() { click('ag-sort'); const options = state.overlays.at(-1); assert.equal(options.mod, 'sidebar'); assert.equal(options.props.view, 'agents-sort'); mount('agents-sort', options.props); render(); },
  };
}

const agent = (address, status, extra = {}) => ({ address, status, pane: `pane-${address}`, space: 's', tab: 'tab', space_name: 'Synthetic workspace', program: { name: 'Pi', key: 'pi' }, seq: 1, ...extra });

test('U1 task identity, child attention, native pins and original command addresses through the routed body', async () => {
  const host = await nativeHost({
    spaces: [
      { id: 's', name: 'Synthetic workspace', folder: '/repo', tabs: [{ id: 'tab', name: '1', named: false }, { id: 'named', name: 'Ship synthetic task', named: true }] },
      { id: 'remote/s', name: 'Remote workspace', machine: 'remote', folder: '/srv/repo', tabs: [{ id: 'remote/tab', name: '2', named: false }] },
    ],
    agents: [agent('a', 'working', { title: 'Fix retry logic' }), agent('b', 'working', { title: 'Check release' }),
      agent('c', 'idle', { tab: 'named', title: 'Different title' }), agent('generic', 'working', { title: '12' }),
      agent('duplicate', 'working', { title: 'Fix retry logic' }),
      agent('remote/root', 'working', { space: 'remote/s', tab: 'remote/tab', title: 'Remote task' }),
      agent('done', 'done', { title: 'Completed task' }), agent('pinned', 'idle', { pinned: true, title: 'Pinned task' })],
    terminals: [{ address: 'remote/child', parent: 'remote/root', state: 'live', status: 'error', name: 'Synthetic child' },
      { address: 'remote/old', parent: 'remote/root', state: 'dead', status: 'error' }],
  });
  assert.match(host.text('ag-a'), /Fix retry logic.*Synthetic workspace.*1.*a/);
  assert.match(host.text('ag-b'), /Check release.*Synthetic workspace/);
  assert.match(host.text('ag-generic'), /Pi.*Synthetic workspace.*1/);
  assert.ok(host.node('sec-idle')); host.click('sec-idle');
  assert.match(host.text('ag-c'), /Ship synthetic task/);
  assert.doesNotMatch(host.text('ag-c'), /Different title/);
  host.focus('c');
  assert.equal(host.group('c'), 'current', 'Selected idle remains visible while other agents work');
  assert.equal(host.node('sec-idle'), undefined, 'Idle count excludes the promoted row and native pins');
  assert.equal(host.nodes().filter(n => n?.id === 'ag-c').length, 1);
  assert.equal(host.group('remote/root'), 'sec-blocked');
  assert.equal(host.group('done'), 'sec-done');
  assert.ok(host.order().indexOf('a') < host.order().indexOf('done'), 'Navigation follows Working before Done, like the visible groups');
  assert.equal(host.group('pinned'), 'pinned');
  assert.equal(host.nodes().filter(n => n?.id === 'ag-pinned').length, 1);
  assert.match(host.text('ag-blocked'), /1 need you/);
  assert.match(host.node('ag-remote/root').tooltip, /remote.*working.*blocked/);
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
  assert.deepEqual([...host.order()].sort(), host.state.agents.map(a => a.address).sort());
  assert.equal(new Set(host.order()).size, host.state.agents.length);
  assert.equal(host.state.calls.some(c => c.command === 'terminal.pin' && c.args.terminal === 'pinned'), false, 'No legacy pin migration');
});

test('U2 done hold, normalized observed ages, quiet promotion and stable canonical next traversal', async () => {
  const host = await nativeHost({ agents: [agent('done', 'done', { title: 'Finished task' }), agent('idle-a', 'idle'), agent('idle-b', 'idle'), agent('pin', 'idle', { pinned: true })] });
  host.focus('done');
  const observed = JSON.parse(host.storage.get('changed')).done.at;
  host.state.now += 120000;
  host.state.agents[0].status = 'idle'; host.render();
  assert.equal(host.group('done'), 'sec-done');
  assert.equal(JSON.parse(host.storage.get('changed')).done.at, observed);
  assert.match(host.text('ag-done'), /2m/);
  host.state.agents[0].status = 'working'; host.render();
  assert.equal(host.group('done'), 'sec-working', 'A real transition leaves held Done immediately');
  host.state.agents[0].status = 'done'; host.render(); host.state.agents[0].status = 'idle'; host.render();
  host.focus('idle-a');
  assert.equal(host.node('sec-done'), undefined, 'Leaving releases Done hold');
  assert.equal(host.group('idle-a'), 'current');
  assert.equal(host.node('ag-idle-b'), undefined, 'Idle defaults folded');
  assert.match(host.text('sec-idle'), /Idle 2/);
  assert.match(host.text(), /Nothing waiting on you/);
  const canonical = [...host.order()];
  const visited = [];
  let address = canonical[0];
  for (let i = 0; i < canonical.length * 3; i++) {
    host.focus(address); visited.push(address);
    assert.deepEqual(host.order(), canonical, 'Selection promotion must not reorder next/previous');
    assert.equal(host.nodes().filter(n => n?.id === `ag-${address}`).length, 1);
    address = host.order()[(host.order().indexOf(address) + 1) % canonical.length];
  }
  assert.equal(new Set(visited).size, canonical.length);
  host.click('sec-idle'); assert.ok(host.node('ag-idle-b'));
  host.openSort();
  assert.equal(host.timers.filter(t => t.ms === 30000).length, 1, 'Sort popup starts no body timer');
  host.click('sort-grouped', 'agents-sort');
  assert.equal(host.shared.get('herdr-setup.sidebar.sort'), 'grouped');
  assert.equal(host.shared.has('agents.sort'), false);
  assert.ok(host.node('sp-s')); assert.equal(host.group('pin'), 'pinned');
  host.state.agents = []; host.render(); assert.match(host.text(), /No agent status yet/);
});

test('U3 native body sizing, rail navigation order and independent brand/footer controls', async () => {
  const host = await nativeHost({
    spaces: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `Synthetic long workspace ${i}`, folder: i === 1 ? '/worktree' : '/repo', status: 'idle', active: i === 0, tabs: [{ id: `tab${i}`, name: '1' }] })),
    machines: [{ name: 'loading', layout: 'loading' }],
    inventory: [{ name: 'loading', state: 'connected' }, { name: 'offline', state: 'unreachable', why: 'Synthetic offline machine' }],
    agents: [agent('a', 'working', { space: 's0', tab: 'tab0', title: 'Sizing task' })],
    panes: [{ pane: 'p0', tab: 'tab0', cwd: '/repo', terminal: 'a', program: { agent: true }, status: 'working' }],
  });
  await host.tick(250);
  assert.equal(host.node('agents').styles.flex_1, true);
  assert.equal(host.node('ag-list').styles.overflow_y_scrollbar, true);
  host.measure(312, 300);
  const notify = host.state.notifications;
  host.measure(312, 300); assert.equal(host.state.notifications, notify, 'Unchanged measurement does not invalidate again');
  assert.equal(host.node('spaces-scroll').styles.overflow_y_scrollbar, true, 'Spaces has its own scroll region');
  assert.equal(host.node('spaces-section').styles.h, 114, 'Spaces is capped at 38% of measured body height');
  assert.equal(host.node('spaces-section').styles.flex_none, true);
  assert.equal(host.node('space-s0').styles.h, 46);
  assert.match(host.text('space-s0'), /Synthetic long workspace 0.*feature\/synthetic-long-branch.*↑2.*↓3/);
  assert.ok(host.node('space-s1').children.some(n => n?.children?.some(c => c?.asset === 'mods/sidebar/icons/branch.svg')), 'Worktree retains its nested branch marker');
  assert.match(host.text('machine-loading-loading'), /Loading/);
  assert.match(host.text('machine-offline'), /unreachable/);
  host.click('search', 'brand'); assert.equal(host.state.calls.at(-1).args.name, 'picker');
  host.click('settings', 'footer'); assert.equal(host.state.calls.at(-1).command, 'app.settings');
  host.click('machine', 'footer'); assert.equal(host.state.calls.at(-1).args.name, 'machine-add');
  const canonical = [...host.order()];
  host.click('sidebar-toggle', 'brand');
  assert.equal(host.state.calls.at(-1).command, 'layout.resize'); assert.equal(host.state.calls.at(-1).args.px, 76);
  assert.equal(host.shared.get('herdr-setup.sidebar.width'), 312);
  host.measure(76, 300);
  assert.equal(host.node('agents'), undefined);
  assert.deepEqual(host.order(), canonical, 'Rail still publishes canonical agent order');
  assert.ok(host.node('sidebar-expand'));
  assert.equal(host.node('spaces-rail-scroll').styles.overflow_y_scrollbar, true);
  assert.deepEqual(host.node('spaces-rail-scroll').children.map(n => n.id).sort(), host.state.spaces.map(s => `space-${s.id}`).sort(), 'Every workspace remains reachable in rail');
  assert.match(host.node('space-s0').tooltip, /Synthetic long workspace 0.*working/);
  host.click('space-s1'); assert.equal(host.state.calls.at(-1).command, 'space.select');
  assert.equal(host.state.calls.at(-1).args.id, 's1'); assert.equal(host.state.width, 76);
  host.node('space-s1').on_mouse_down_right({}, { stop_propagation() {}, notify() {} });
  assert.equal(host.state.overlays.at(-1).mod, 'menu'); assert.equal(host.state.overlays.at(-1).props.target.id, 's1');
  assert.ok(host.node('settings', 'footer')); assert.ok(host.node('machine', 'footer'));
  host.click('sidebar-expand'); assert.equal(host.state.calls.at(-1).args.px, 312);
  assert.ok(host.state.calls.some(c => c.process === 'git'));
  assert.ok(host.state.calls.filter(c => c.process).every(c => c.process === 'git' && (c.args.includes('status') || c.args[0] === 'rev-parse')), 'Only read-only Git inspection is requested');
  assert.ok(host.state.calls.some(c => c.watch === '/repo/.git'));
  assert.ok(host.state.calls.every(c => !c.hc || c.hc[1] === 'ls'));
});
