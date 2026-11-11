import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const sourceRoot = new URL('../customizations/workspace-browser/mods/workspace-browser/', import.meta.url);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ok = stdout => ({ code: 0, stdout, stderr: '' });

// Retained native-host pattern: load the actual local module graph. Only GPUI,
// native snapshots/storage and process/read/watch/dialog boundaries are replaced.
async function nativeHost() {
  let rendering = false;
  const queue = [], failures = [], shared = new Map(), modules = new Map();
  const storage = new Map();
  const state = {
    branch: 'feature/synthetic', shown: true, calls: [], overlays: [], hook: null, config: null, discoveries: new Map(),
    layout: { id: 'root', children: [{ id: 'panel', hidden: true, children: [{ id: 'panel-body', active: 'files' }] }] },
    spaces: [{ id: 's', active: true, machine: null, folder: '/space', tabs: [{ id: 'a', active: true }, { id: 'b' }] }],
    panes: [{ pane: 'pi-pane', tab: 'a', terminal: 't1', cwd: '/shell-old' }, { pane: 'shell-pane', tab: 'a', terminal: 't2', cwd: '/shell' }],
    terminals: [{ address: 't1', state: 'live', report: { app: 'pi' }, labels: { 'pi.session-id': 'session-1', 'pi.session-cwd': '/repo/pkg' } },
      { address: 't2', state: 'live', report: null, labels: {} }],
    agents: [], focus: { space: 's', tab: 'a', pane: 'pi-pane', terminal: 't1' },
  };
  function element() {
    const node = { children: [] };
    const add = child => { if (child != null) node.children.push(child?.node ?? child); };
    const proxy = new Proxy({}, { get: (_target, method) => {
      if (method === 'node') return node;
      return (...args) => {
        if (method === 'id') node.id = args[0];
        else if (method === 'child') add(args[0]);
        else if (method === 'children') args[0].forEach(add);
        else if (method === 'on_click') node.click = args[0];
        else if (method === 'on_key_down') node.keydown = args[0];
        else if (method === 'h') node.height = args[0];
        else if (method === 'tooltip') node.tooltip = args[0];
        else if (method === 'border_1') node.bordered = true;
        else if (method === 'max_h') node.maxHeight = args[0];
        else if (method === 'flex_shrink_0') node.shrink = false;
        else if (method === 'overflow_y_scrollbar') node.scrollbar = true;
        else if (method === 'when' && args[0]) args[1](proxy);
        return proxy;
      };
    } });
    return proxy;
  }
  const cx = {
    notify() { assert.equal(rendering, false, 'notify during render'); },
    spawn(task) { queue.push(task); },
    timer: { every() {} },
    focus_handle() { assert.equal(rendering, false); return { focus() {}, release() {} }; },
    stop_propagation() {},
  };
  const external = {
    View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
    InputState: { new() {
      assert.equal(rendering, false, 'InputState must belong to init');
      const events = new Map(); let value = '';
      const input = { on: (name, fn) => events.set(name, fn), value: () => value,
        set_value(next) { assert.equal(rendering, false); value = next;
          if (state.programmaticChanges) queue.push(async cx => events.get('change')?.({}, cx));
        },
        focus() {}, release() { input.released = true; }, emit(name, next) { if (next !== undefined) value = next; events.get(name)?.({}, cx); } };
      return input;
    } },
    ScrollHandle: { new: () => ({ scroll_to_item() {}, release() {} }) },
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    layout: () => state.layout,
    run(command, args) { state.calls.push({ command, ...args });
      const panel = state.layout.children[0], body = panel.children[0];
      if (command === 'layout.show') panel.hidden = false;
      if (command === 'layout.hide') panel.hidden = true;
      if (command === 'layout.select') body.active = args.child;
    },
    Input: { new: element }, Editor: { new: element },
    EditorState: { new: options => ({ ...options, release() {} }) },
    Scrollbar: { vertical: element }, v_virtual_list: element,
    spaces: () => state.spaces, panes: () => state.panes, terminals: () => state.terminals,
    agents: () => state.agents, focused: () => state.focus, props: () => state.copyProps,
    theme: () => ({}), settings: () => ({}), window: () => ({ platform: 'macos' }), home: () => '/home/synthetic', appHome: () => '/app',
    shared: key => shared.get(key), setShared(key, value) { assert.equal(rendering, false, 'shared write during render'); shared.set(key, value); },
    openOverlay(options) { state.overlays.push(options); return 'overlay'; },
    closeOverlay() { picker?.close(cx); picker = null; },
    watchFolder: () => new Promise(() => {}),
    readTextFile: async (path, options) => { state.calls.push({ read: path, ...options }); return state.readHook?.(path, options) ?? (path === '/app/config/workspace-browser.json' ? state.config : 'sample text\n'); },
    exec: async (cmd, args, options = {}) => {
      const call = { cmd, args: Array.from(args), ...options }; state.calls.push(call);
      const intercepted = state.hook?.(call);
      if (intercepted) return intercepted;
      if (cmd === 'fd' || cmd === '/home/synthetic/.pi/agent/bin/fd') return ok(state.discoveries.get(args.at(-1)) ?? '');
      if (cmd === 'sh') return args.at(-1) === '/missing' ? { code: 1, stdout: '', stderr: 'Not a directory' } : ok('f\0sample.txt\0');
      assert.equal(cmd, 'git', 'No real processes');
      if (args.includes('--show-toplevel')) {
        if (options.cwd === '/plain') return { code: 128, stdout: '', stderr: 'not git' };
        return ok(options.cwd.replace(/\/(pkg|sub)$/, '') + '\n');
      }
      if (args.includes('symbolic-ref')) return state.branch === null || options.cwd === '/plain' ? { code: 1, stdout: '', stderr: '' } : ok(state.branch + '\n');
      if (args.includes('--short')) return options.cwd === '/plain' ? { code: 128, stdout: '', stderr: 'not git' } : ok('a1b2c3d\n');
      if (args.includes('status')) return ok(' M sample.txt\0');
      if (args.includes('--numstat')) return ok('2\t1\tsample.txt\0');
      if (args.includes('diff')) return ok('@@ -1 +1 @@\n-old\n+new\n');
      return ok('');
    },
  };
  const sandbox = vm.createContext({ ...external });
  async function load(name) {
    if (modules.has(name)) return modules.get(name);
    let source = await readFile(new URL(name, sourceRoot), 'utf8');
    const bindings = {};
    for (const match of source.matchAll(/^import (.+) from "(.+)";$/gm)) {
      const dependency = match[2].startsWith('./') ? await load(match[2].slice(2)) : external;
      if (match[1].startsWith('{')) for (const id of match[1].slice(1, -1).split(',').map(s => s.trim())) bindings[id] = dependency[id];
      else bindings[match[1]] = dependency.default;
    }
    source = source.replace(/^import .*;\n/gm, '');
    const exports = [...source.matchAll(/export (?:async )?(?:const|function) (\w+)/g)].map(m => m[1]);
    source = source.replace(/export default class (\w+)/, 'const Default = class $1').replace(/export (async )?(const|function)/g, '$1$2');
    const body = `(function(${Object.keys(bindings).join(',')}) { ${source}\nreturn { ${[...exports, ...(source.includes('const Default =') ? ['default: Default'] : [])].join(',')} }; })`;
    const result = new vm.Script(body, { filename: name }).runInContext(sandbox)(...Object.values(bindings));
    modules.set(name, result); return result;
  }
  const { default: Main } = await load('main.js');
  // Herdr exposes layout/overlay props through props(), not the root init argument.
  const mount = copyProps => { state.copyProps = copyProps; const view = new Main(); view.init(undefined, cx); return view; };
  const observer = mount({ view: 'observer' }), files = mount({ view: 'files' }), changes = mount({ view: 'changes' }), tabs = mount({ view: 'tabs' });
  let picker = null, trees = {};
  const find = (node, id) => node?.id === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
  const render = () => {
    rendering = true;
    try {
      trees.observer = observer.render(cx).node;
      trees.tabs = tabs.render(cx).node;
      if (state.shown) { trees.files = files.render(cx).node; trees.changes = changes.render(cx).node; }
      if (picker) trees.picker = picker.render(cx).node;
    } finally { rendering = false; }
  };
  const settle = async () => {
    // Native watch promises intentionally remain pending. Drain finite process
    // continuations without clocks or filesystem/network activity.
    for (let i = 0; i < 80; i++) {
      while (queue.length) Promise.resolve(queue.shift()(cx)).catch(e => failures.push(e));
      await Promise.resolve(); render();
    }
    if (failures.length) throw failures.shift();
  };
  const click = (view, id) => { const node = find(trees[view], id); assert.ok(node?.click, `${view}: missing ${id}`); node.click({}, cx); render(); };
  const open = (panel = 'files') => { click(panel, 'workspace-folder'); picker = mount({ ...state.overlays.at(-1).props, overlay: 'overlay' }); render(); return picker.implementation; };
  const text = node => typeof node === 'string' ? node : (node?.children ?? []).map(text).join(' ');
  return { state, render, settle, click, open,
    enablePanels(value) { shared.set('workspace.panels', value); render(); },
    get browser() { return files.implementation; }, get files() { return files.implementation.files; }, get changes() { return changes.implementation; }, get picker() { return picker?.implementation; },
    async runNextTask() { assert.ok(queue.length); await queue.shift()(cx); render(); },
    text: view => text(trees[view]), node: (view, id) => find(trees[view], id),
    key(key) { trees.picker.keydown({ key }, cx); render(); },
    type(value) { picker.implementation.input.emit('change', value); render(); },
    submit() { picker.implementation.input.emit('submit'); render(); },
    fileType(value) { files.implementation.files.input.emit('change', value); render(); },
    fileKey(key) { find(trees.files, 'files-search').keydown({ key }, cx); render(); },
    fileSubmit() { files.implementation.files.input.emit('submit'); render(); },
    closeFiles() { files.close(cx); },
    async pin(path) { open(); this.type(path); this.submit(); await settle(); },
    saved(tab = 'a', space = 's') { return shared.get('herdr-setup.workspace-browser.v1')?.[JSON.stringify([space, tab])]; },
  };
}

test('native directory picker and Files/Changes follow live Pi sessions, pin/unpin and persist per tab even with hidden panels', async () => {
  const host = await nativeHost(); host.render(); await host.settle();
  assert.equal(host.files.root, '/repo/pkg'); assert.equal(host.changes.root, '/repo');
  assert.equal(host.browser.mode, 'files');
  assert.ok(host.node('tabs', 'panel-files'));
  assert.equal(host.node('tabs', 'panel-changes'), undefined);
  assert.equal(host.state.layout.children[0].hidden, true, 'Fresh tab-bar storage preserves the initial closed panel');
  host.click('tabs', 'panel-files'); assert.equal(host.state.layout.children[0].hidden, false);
  host.click('tabs', 'panel-files'); assert.equal(host.state.layout.children[0].hidden, true);
  host.enablePanels(['files', 'changes', 'linear-panel', 'github-panel']);
  host.state.spaces.push({ id: 'other', active: false, machine: null, folder: '/other', tabs: [{ id: 'other-tab', active: true }] });
  const initialFocus = host.state.focus, panel = host.state.layout.children[0], body = panel.children[0];
  for (const child of ['linear-panel', 'github-panel']) {
    panel.hidden = false; body.active = child; host.render(); await host.settle();
    host.state.spaces[0].active = false; host.state.spaces[1].active = true;
    host.state.focus = { space: 'other', tab: 'other-tab', pane: null, terminal: null };
    host.render(); await host.settle();
    assert.equal(panel.hidden, true);
    const beforeReturn = host.state.calls.length;
    host.state.spaces[0].active = true; host.state.spaces[1].active = false;
    host.state.focus = initialFocus; host.render(); await host.settle();
    assert.equal(panel.hidden, false, `${child} is restored when returning to its space`);
    assert.equal(body.active, child);
    assert.ok(host.state.calls.slice(beforeReturn).some(c => c.command === 'layout.select' && c.child === child));
  }
  host.state.spaces.pop();
  panel.hidden = true; body.active = 'files'; host.render(); await host.settle();
  host.enablePanels(['changes']); assert.ok(host.node('tabs', 'panel-files'), 'Changes-only preference still opens Files');
  host.enablePanels([]); assert.equal(host.node('tabs', 'panel-files'), undefined);
  host.enablePanels(['files', 'changes']);
  assert.match(host.text('files'), /All files Changes/);
  assert.match(host.text('files'), /feature\/synthetic/);
  assert.ok(host.node('files', 'files-tree'));
  host.click('files', 'files-mode-changes'); await host.settle();
  assert.ok(host.node('files', 'changes-list'));
  assert.equal(host.node('files', 'files-tree'), undefined);
  assert.equal(host.browser.changes.root, '/repo');
  host.click('files', 'files-mode-files'); await host.settle();
  assert.equal(host.text('observer'), '', 'The always-mounted observer paints no chrome');
  assert.match(host.node('files', 'workspace-folder').tooltip, /Session · \/repo\/pkg/);
  assert.equal(host.node('files', 'files-context-header').height, 52);
  assert.equal(host.node('files', 'files-preview-header'), undefined, 'The tree has no duplicate folder-name header');
  assert.equal(host.node('files', 'workspace-files').bordered, true);
  assert.equal(host.node('files', 'files').bordered, undefined, 'Embedded content has no nested card border');
  assert.equal(host.node('files', 'files-search').height, 30);
  assert.match(host.text('changes'), /\/repo · All repository changes/);
  host.click('files', 'file-sample.txt'); await host.settle();
  assert.equal(host.files.code.value, 'sample text\n');
  assert.equal(host.node('files', 'files-preview-header').height, 28, 'Preview retains a compact back/path header');
  host.click('files', 'files-mode-changes'); host.click('files', 'files-mode-files');
  assert.equal(host.files.file, 'sample.txt', 'Mode toggling preserves the selected preview');
  assert.ok(host.state.calls.some(c => c.read === '/repo/pkg/sample.txt' && c.on === null));
  assert.equal(host.changes.rows.at(-1).text, 'new');

  host.state.focus = { space: 's', tab: 'a', pane: 'shell-pane', terminal: 't2', cwd: '/shell' };
  host.render(); await host.settle(); assert.equal(host.files.root, '/repo/pkg', 'Shell focus cannot steal a Pi directory');
  // Session replacement models the publisher updating both labels on /move.
  Object.assign(host.state.terminals[0].labels, { 'pi.session-id': 'session-2', 'pi.session-cwd': '/next/sub' });
  host.state.branch = 'feature/next';
  host.render(); assert.equal(host.node('files', 'files-branch'), undefined, 'Never show a previous directory branch while switching');
  await host.settle(); assert.equal(host.files.root, '/next/sub'); assert.equal(host.changes.root, '/next');
  assert.match(host.text('files'), /feature\/next/);
  host.state.config = JSON.stringify({ searchRoots: ['/next', '~/Projects', '/next/'] });
  host.state.discoveries.set('/next', '/next/unknown deep/sub/\0/next/another/\0');
  host.state.discoveries.set('/home/synthetic/Projects', '/home/synthetic/Projects/hidden worktree/\0');
  const picker = host.open(); await host.settle();
  assert.ok(host.state.calls.some(c => c.read === '/app/config/workspace-browser.json'));
  const scans = host.state.calls.filter(c => c.cmd === 'fd');
  assert.deepEqual(scans.map(c => c.args.at(-1)), ['/next', '/home/synthetic/Projects']);
  assert.deepEqual(scans[0].args.slice(0, -1), ['--type', 'd', '--relative-path', '--show-errors', '--color', 'never', '--print0', '--hidden', '--no-ignore', '--exclude', '.git', '--exclude', 'node_modules', '--max-results', '20001', '']);
  assert.equal(picker.rows().some(r => r.cwd === '/space' || r.cwd === '/shell'), false, 'Known history cannot broaden configured roots');
  host.type('NxT'); assert.ok(picker.rows().some(r => r.cwd === '/next/sub'), 'Case-insensitive subsequence search uses real candidates');
  host.type(''); host.key('down'); assert.equal(picker.at, 1); host.key('up'); assert.equal(picker.at, 0);
  host.type('UnKn Dp');
  assert.deepEqual(Array.from(picker.rows(), r => r.cwd), ['/next/unknown deep/sub'], 'All fuzzy terms match a discovered directory absent from history');
  const beforeTyping = host.state.calls.filter(c => c.cmd === 'fd').length;
  host.type('unknown deep'); host.submit(); await host.settle();
  assert.equal(host.files.root, '/next/unknown deep/sub'); assert.equal(host.changes.root, '/next/unknown deep');
  assert.equal(host.state.calls.filter(c => c.cmd === 'fd').length, beforeTyping, 'Fuzzy typing never starts another discovery process');
  host.state.config = JSON.stringify({ searchRoots: ['/only-root'] });
  host.open('changes'); await host.settle();
  assert.equal(host.picker.rows().some(r => r.cwd.startsWith('/next/')), false, 'Confirmed recents outside the new roots are excluded');
  host.key('escape');
  assert.equal(host.state.calls.filter(c => c.cmd === 'fd').at(-1).args.at(-1), '/only-root', 'One configured root stays one root');
  assert.equal(host.files.root, '/next/unknown deep/sub', 'Esc leaves the pin alone');
  host.open(); host.click('picker', 'folder-follow'); await host.settle();
  for (const config of [null, JSON.stringify({ searchRoots: [] })]) {
    host.state.config = config;
    host.state.terminals[0].labels['pi.session-cwd'] = '/captured/sub';
    host.render(); await host.settle();
    host.open();
    // Capture scope at opening, not after a subsequent session movement.
    host.state.terminals[0].labels['pi.session-cwd'] = '/later-move';
    await host.settle(); host.key('escape');
    assert.equal(host.state.calls.filter(c => c.cmd === 'fd').at(-1).args.at(-1), '/captured/sub');
    assert.equal(host.files.root, '/later-move');
  }
  await host.pin('/pinned/sub');
  assert.equal(host.saved().pin.cwd, '/pinned/sub'); assert.equal(host.files.root, '/pinned/sub');
  Object.assign(host.state.terminals[0].labels, { 'pi.session-id': 'session-3', 'pi.session-cwd': '/latest/sub' });
  host.render(); await host.settle(); assert.equal(host.files.root, '/pinned/sub');
  assert.equal(host.saved().recents.length, 2, 'Only confirmed selections populate recents');

  host.state.focus = { space: 's', tab: 'b', pane: null, terminal: null };
  host.render(); await host.settle(); assert.equal(host.files.root, '/space');
  await host.pin('/tab-b'); assert.equal(host.saved('b').pin.cwd, '/tab-b');
  host.state.focus = { space: 's', tab: 'a', pane: null, terminal: null };
  host.render(); await host.settle(); assert.equal(host.files.root, '/pinned/sub');
  host.open(); host.click('picker', 'folder-follow'); await host.settle();
  assert.equal(host.files.root, '/latest/sub', 'Unpin resolves latest live metadata, not a saved cwd');

  await host.pin('/hidden-pin');
  host.state.shown = false;
  host.state.terminals.push({ address: 't3', state: 'live', report: { app: 'pi' }, labels: { 'pi.session-id': 'second', 'pi.session-cwd': '/second/sub' } });
  host.state.agents.push({ address: 't3', space: 's', tab: 'a' });
  host.state.focus = { space: 's', tab: 'a', pane: null, terminal: 't3', agent: 't3' };
  host.render(); await host.settle(); assert.equal(host.saved().followPi, 't3');
  host.state.focus = { space: 's', tab: 'a', pane: 'shell-pane', terminal: 't2', cwd: '/shell' };
  host.render(); await host.settle(); assert.equal(host.text('observer'), '');
  assert.equal(host.saved().followPi, 't3', 'Pi focus is observed even while pinned and panels are hidden');
  host.state.shown = true; host.render(); await host.settle(); assert.equal(host.files.root, '/hidden-pin');
  host.open(); host.click('picker', 'folder-follow'); await host.settle(); assert.equal(host.files.root, '/second/sub');
  host.state.focus = { space: 's', tab: 'a', pane: 'pi-pane', terminal: 't1', shown: 't3', agent: 't3' };
  host.render(); await host.settle();
  assert.equal(host.files.root, '/second/sub', 'A shown Pi takes priority over the underlying Pi terminal');
  host.state.terminals[2].labels = {}; host.render(); await host.settle();
  assert.equal(host.files.root, undefined); assert.equal(host.changes.root, null);
  assert.match(host.text('files'), /integration unavailable/);
  host.state.terminals[2].report = null; host.state.terminals[0].report = null;
  host.state.focus = { space: 's', tab: 'a', pane: 'shell-pane', terminal: 't2', cwd: '/shell' };
  host.render(); await host.settle(); assert.equal(host.files.root, '/shell');
  assert.match(host.node('files', 'workspace-folder').tooltip, /Pane · \/shell/);

  const slowPath = deferred();
  host.state.config = null;
  host.state.hook = c => c.cmd !== 'sh' ? null
    : c.args.at(-1) === '/home/synthetic' ? Promise.resolve(ok('d\0Work\0d\0Other\0f\0Work-file\0'))
    : c.args.at(-1) === '/home/synthetic/Work' ? Promise.resolve(ok('d\0Cartwheel\0d\0Other project\0f\0Cartwheel-file\0d\0.git\0d\0node_modules\0'))
    : c.args.at(-1) === '/home/synthetic/Slow' ? slowPath.promise : null;
  host.open(); await host.settle();
  assert.equal(host.node('picker', 'folder-results').height, 32, 'A single result has a full visible row, not a flex-shrunk viewport');
  assert.equal(host.node('picker', 'folder-results').shrink, false);
  assert.equal(host.node('picker', 'folder-picker').children.some(n => n.scrollbar && !n.children.length), false, 'Empty messages cannot reserve a scroll region above results');
  const scansBeforeCompletion = host.state.calls.filter(c => c.cmd === 'fd').length;
  host.type('~/Wo'); await host.settle();
  assert.ok(host.picker.rows().some(r => r.cwd === '/home/synthetic/Work'), 'Tilde paths expand before matching parent directory choices');
  host.type('~/Wor'); await host.settle();
  assert.equal(host.state.calls.filter(c => c.cmd === 'sh' && c.args.at(-1) === '/home/synthetic').length, 1, 'Typing a component reuses one parent listing');
  host.type('~/Work/'); await host.settle();
  assert.deepEqual(Array.from(host.picker.rows(), r => r.cwd), ['/home/synthetic/Work/', '/home/synthetic/Work/Cartwheel', '/home/synthetic/Work/Other project'], 'Explicit directories outside the default root offer child directories, not files or dependency internals');
  assert.equal(host.node('picker', 'folder-results').height, 96);
  assert.equal(host.node('picker', 'folder-choice-0').height, 32);
  host.type('~/Slow/'); await host.settle();
  host.type('~/Work/Car'); await host.settle();
  slowPath.resolve(ok('d\0Old result\0')); await host.settle();
  assert.deepEqual(Array.from(host.picker.rows(), r => r.cwd), ['/home/synthetic/Work/Car', '/home/synthetic/Work/Cartwheel'], 'A late listing cannot replace the current path results');
  assert.equal(host.state.calls.filter(c => c.cmd === 'sh' && c.args.at(-1) === '/home/synthetic/Work').length, 1, 'Returning to a parent uses its per-dialog snapshot');
  assert.equal(host.state.calls.filter(c => c.cmd === 'fd').length, scansBeforeCompletion, 'Explicit path completion never starts a recursive scan');
  host.key('down'); host.submit(); await host.settle();
  assert.equal(host.saved().pin.cwd, '/home/synthetic/Work/Cartwheel');
  assert.equal(host.files.root, '/home/synthetic/Work/Cartwheel', 'A completed directory follows normal validation and shared selection');
  host.state.hook = null;
});

test('selection validation, non-Git folders, stale IO/commit guards and remote routing preserve the captured target', async () => {
  const host = await nativeHost(); host.render(); await host.settle();
  await host.pin('/missing'); assert.equal(host.saved()?.pin, null); assert.equal(host.files.root, '/repo/pkg');
  assert.match(host.text('picker'), /Cannot pin folder/);
  host.type('relative'); host.submit(); await host.settle(); assert.equal(host.files.root, '/repo/pkg');
  host.type('/bad\0path'); host.submit(); await host.settle(); assert.equal(host.files.root, '/repo/pkg');
  assert.equal(host.state.calls.some(c => c.cmd === 'sh' && c.args.at(-1).includes('\0')), false);
  host.state.branch = null;
  await host.pin('/detached'); assert.match(host.text('files'), /Detached HEAD · a1b2c3d/);
  await host.pin('/plain'); assert.equal(host.files.root, '/plain'); assert.equal(host.changes.root, null);
  assert.equal(host.node('files', 'files-branch'), undefined, 'Non-Git directories have no invented branch');
  host.state.branch = 'feature/synthetic';
  assert.match(host.text('changes'), /Not a git repository/);
  const writes = () => host.state.calls.filter(c => c.cmd === 'git' && ['add', 'commit'].includes(c.args[0]));
  host.changes.input.emit('change', 'cannot commit'); host.click('changes', 'commit'); await host.settle(); assert.equal(writes().length, 0);

  const oldTop = deferred(), oldBranch = deferred();
  host.state.hook = c => c.cwd !== '/slow' ? null : c.args.includes('--show-toplevel') ? oldTop.promise : c.args.includes('symbolic-ref') ? oldBranch.promise : null;
  await host.pin('/slow');
  await host.pin('/fresh/sub'); assert.equal(host.changes.root, '/fresh');
  oldTop.resolve(ok('/slow-root\n')); oldBranch.resolve(ok('wrong-old-branch\n')); await host.settle(); assert.equal(host.changes.root, '/fresh');
  assert.doesNotMatch(host.text('files'), /wrong-old-branch/);
  assert.equal(host.files.root, '/fresh/sub');
  // Publish the actual picker choice, then click before the scheduled panel
  // refresh can clear the old repository/message.
  host.changes.input.emit('change', 'stale click');
  host.open(); await host.settle(); host.type('/changed/sub'); await host.settle();
  host.submit(); await host.runNextTask();
  host.click('changes', 'commit'); await host.settle(); assert.equal(writes().length, 0, 'Stale repo click must never write');

  const add = deferred();
  host.state.hook = c => c.args[0] === 'add' ? add.promise : null;
  host.click('files', 'files-mode-changes');
  host.browser.changes.input.emit('change', 'captured commit'); host.click('files', 'commit'); await host.settle();
  assert.equal(writes().at(-1).cwd, '/changed');
  await host.pin('/different/sub'); add.resolve(ok('')); await host.settle();
  assert.deepEqual(writes().map(c => [c.args[0], c.cwd, c.on]), [['add', '/changed', null], ['commit', '/changed', null]]);
  assert.equal(host.changes.root, '/different');
  assert.equal(host.browser.changes.root, '/different');
  host.click('files', 'files-mode-files');

  // Publication belongs to the dialog's captured tab, not the tab focused after
  // validation; a removed tab or a dismissed dialog cannot receive a pin.
  const validation = deferred();
  host.state.hook = c => c.cmd === 'sh' && c.args.at(-1) === '/delayed' ? validation.promise : null;
  host.open(); host.type('/delayed'); host.submit(); host.submit(); await host.settle();
  assert.equal(host.state.calls.filter(c => c.cmd === 'sh' && c.args.at(-1) === '/delayed').length, 1, 'Busy validation cannot repeat');
  host.state.focus = { space: 's', tab: 'b', pane: null, terminal: null };
  host.render(); await host.settle(); validation.resolve(ok('')); await host.settle();
  assert.equal(host.saved('a').pin.cwd, '/delayed'); assert.equal(host.saved('b')?.pin, undefined);
  host.state.hook = c => c.cmd === 'sh' && c.args.at(-1) === '/delayed' ? Promise.reject(new Error('offline folder')) : null;
  host.state.focus = { space: 's', tab: 'a', pane: null, terminal: null };
  host.render(); await host.settle();
  assert.equal(host.files.root, '/delayed'); assert.equal(host.changes.root, null);
  assert.match(host.text('files'), /Pinned folder unavailable/); assert.match(host.text('changes'), /Pinned folder unavailable/);
  assert.equal(host.saved('a').pin.cwd, '/delayed', 'Unavailable pins never fall back to another repository');
  host.state.focus = { space: 's', tab: 'b', pane: null, terminal: null };
  host.render(); await host.settle();
  const removed = deferred();
  host.state.hook = c => c.cmd === 'sh' && c.args.at(-1) === '/removed-tab' ? removed.promise : null;
  host.open(); host.type('/removed-tab'); host.submit(); await host.settle();
  host.state.spaces[0].tabs = host.state.spaces[0].tabs.filter(t => t.id !== 'b');
  removed.resolve(ok('')); await host.settle(); assert.equal(host.saved('b')?.pin, undefined);
  host.state.spaces[0].tabs.push({ id: 'b' });
  const cancelled = deferred();
  host.state.hook = c => c.cmd === 'sh' && c.args.at(-1) === '/cancelled' ? cancelled.promise : null;
  host.open(); host.type('/cancelled'); host.submit(); await host.settle(); host.key('escape');
  cancelled.resolve(ok('')); await host.settle(); assert.equal(host.saved('b')?.pin, undefined);
  host.state.hook = null;

  const fdCalls = () => host.state.calls.filter(c => c.cmd === 'fd' || c.cmd?.endsWith('/bin/fd'));
  const beforeInvalid = fdCalls().length;
  for (const config of ['{broken', JSON.stringify({ searchRoots: 'not-an-array' }), JSON.stringify({ searchRoots: ['/valid', 'relative'] })]) {
    host.state.config = config; host.open(); await host.settle();
    assert.match(host.text('picker'), /configuration error/);
    assert.equal(host.picker.rows().length, 0, 'Invalid config cannot leak unscoped known folders');
    host.key('escape');
  }
  assert.equal(fdCalls().length, beforeInvalid, 'Invalid config never starts an unscoped fallback');
  host.open(); host.type('/outside-config/sub'); host.submit(); await host.settle();
  assert.equal(host.files.root, '/outside-config/sub', 'Explicit paths remain available after config errors');
  host.open(); host.click('picker', 'folder-follow'); await host.settle();
  assert.equal(host.files.root, '/space', 'Follow remains available after config errors');

  host.state.config = JSON.stringify({ searchRoots: ['/space', '/broken-root'] });
  const many = Array.from({ length: 20001 }, (_, i) => `/space/dir-${i}/`).join('\0') + '\0';
  host.state.hook = c => c.cmd === 'fd' ? (c.args.at(-1) === '/broken-root'
    ? Promise.resolve({ code: 1, stdout: '', stderr: 'permission denied' })
    : Promise.resolve({ code: 0, stdout: many, stderr: 'incomplete traversal' })) : null;
  host.open(); await host.settle();
  assert.match(host.text('picker'), /Partial results/); assert.match(host.text('picker'), /permission denied/);
  assert.match(host.text('picker'), /incomplete traversal/, 'A successful fd exit can still mean an incomplete scan');
  assert.equal(fdCalls().some(c => c.cmd.endsWith('/bin/fd')), false, 'Root/permission failures never retry through an executable fallback');
  assert.ok(host.picker.rows().some(r => r.cwd === '/space'), 'In-scope known choices survive partial failure');
  assert.equal(host.picker.rows().length, 50, 'Displayed choices stay bounded');
  host.type('dir-20000'); assert.equal(host.picker.rows().length, 0, 'The sentinel is not selectable');
  host.type('dir-19998'); assert.equal(host.picker.rows()[0].cwd, '/space/dir-19998');
  host.type(''); host.click('picker', 'folder-choice-0'); await host.settle();
  assert.equal(host.saved('b').pin.cwd, '/space', 'Known folders still validate and pin after a failed root');
  host.state.config = JSON.stringify({ searchRoots: ['/space'] });
  const fallback = '/home/synthetic/.pi/agent/bin/fd';
  for (const message of ['`herdr.exec`: cannot run fd: No such file or directory (os error 2)', 'cannot start fd: program not found']) {
    const before = fdCalls().length;
    host.state.hook = c => c.cmd === 'fd' ? Promise.reject(new Error(message))
      : c.cmd === fallback ? Promise.resolve(ok('/space/fallback-result/\0')) : null;
    host.open(); await host.settle();
    assert.deepEqual(fdCalls().slice(before).map(c => c.cmd), ['fd', fallback], 'A missing executable invokes the local fallback once');
    host.type('fallback-result');
    assert.equal(host.picker.rows()[0]?.cwd, '/space/fallback-result', 'Fallback discovery produces selectable directory results');
    host.key('escape');
  }
  const beforePermission = fdCalls().length;
  host.state.hook = c => c.cmd === 'fd' ? Promise.reject(new Error('`herdr.exec`: cannot run fd: Permission denied (os error 13)')) : null;
  host.open(); await host.settle();
  assert.deepEqual(fdCalls().slice(beforePermission).map(c => c.cmd), ['fd'], 'Other launch failures must not invoke the fallback');
  assert.match(host.text('picker'), /Permission denied/);
  host.key('escape');

  const scan = deferred();
  host.state.config = JSON.stringify({ searchRoots: ['/space'] });
  host.state.hook = c => c.cmd === 'fd' ? scan.promise : null;
  const dismissed = host.open(); await host.settle();
  assert.ok(dismissed.rows().some(r => r.cwd === '/space'), 'In-scope known folders are usable while discovery is pending');
  assert.match(host.text('picker'), /Discovering directories/);
  host.key('escape');
  assert.equal(dismissed.input.released, true);
  const published = host.saved('b').pin.cwd;
  scan.resolve(ok('/space/after-close/\0')); await host.settle();
  assert.equal(dismissed.discovered.length, 0, 'Late discovery cannot update a closed view');
  assert.equal(host.saved('b').pin.cwd, published, 'Discovery never publishes a selection');
  const closedListing = deferred();
  host.state.hook = c => c.cmd === 'sh' && c.args.at(-1) === '/home/synthetic/Closing' ? closedListing.promise : null;
  const closedPicker = host.open(); host.type('~/Closing/'); await host.settle(); host.key('escape');
  closedListing.resolve(ok('d\0too late\0')); await host.settle();
  assert.equal(closedPicker.pathListings.get('/home/synthetic/Closing').paths.length, 0, 'A closed picker cannot receive completion results');
  assert.equal(host.saved('b').pin.cwd, published);
  host.state.config = null; host.state.hook = null;

  host.state.spaces.push({ id: 'remote/s', active: false, machine: 'remote', folder: '/srv/project', tabs: [{ id: 'remote/a', active: true }] });
  host.state.panes.push({ pane: 'remote/p', tab: 'remote/a', terminal: 'remote/t4', cwd: '/srv/shell' });
  host.state.terminals.push({ address: 'remote/t4', state: 'live', report: { app: 'pi' }, labels: { 'pi.session-id': 'remote-session', 'pi.session-cwd': '/srv/project/sub' } });
  host.state.focus = { space: 'remote/s', tab: 'remote/a', pane: 'remote/p', terminal: 'remote/t4' };
  host.render(); await host.settle();
  assert.equal(host.files.root, '/srv/project/sub'); assert.equal(host.files.on, 'remote');
  assert.equal(host.changes.root, '/srv/project'); assert.equal(host.changes.on, 'remote');
  assert.ok(host.state.calls.some(c => c.args?.includes('symbolic-ref') && c.cwd === '/srv/project/sub' && c.on === 'remote'));
  assert.match(host.text('changes'), /\/srv\/project · remote · All repository changes/);
  const scansBeforeRemote = host.state.calls.filter(c => c.cmd === 'fd').length;
  host.open(); await host.settle();
  assert.match(host.text('picker'), /discovery is local only/);
  assert.equal(host.state.calls.filter(c => c.cmd === 'fd').length, scansBeforeRemote, 'Remote dialog never scans local folders');
  const known = host.picker.rows().findIndex(r => r.cwd === '/srv/project' && r.on === 'remote');
  host.click('picker', `folder-choice-${known}`); await host.settle();
  assert.equal(host.files.root, '/srv/project', 'Known remote choice pins the exact directory');
  host.open(); host.type('/srv/pasted/sub'); host.submit(); await host.settle();
  assert.equal(host.saved('remote/a', 'remote/s').pin.on, 'remote');
  assert.ok(host.state.calls.some(c => c.cmd === 'sh' && c.args.at(-1) === '/srv/pasted/sub' && c.on === 'remote'));
  assert.equal(host.changes.root, '/srv/pasted');
  assert.ok(host.state.calls.filter(c => c.cwd?.startsWith('/srv/') || (c.cmd === 'sh' && c.args.at(-1).startsWith('/srv/'))).every(c => c.on === 'remote'), 'All remote reads/validation stay remote');

  const remoteAdd = deferred(); host.state.hook = c => c.args[0] === 'add' ? remoteAdd.promise : null;
  host.changes.input.emit('change', 'remote commit'); host.click('changes', 'commit'); await host.settle();
  host.state.focus = { space: 's', tab: 'b', pane: null, terminal: null };
  host.render(); await host.settle(); remoteAdd.resolve(ok('')); await host.settle();
  assert.deepEqual(writes().slice(-2).map(c => [c.args[0], c.cwd, c.on]), [['add', '/srv/pasted', 'remote'], ['commit', '/srv/pasted', 'remote']]);
  host.open(); host.key('escape'); await host.settle();
  assert.equal(host.saved('b')?.pin.cwd, '/space', 'Cancellation does not change the existing pin');
});

test('All files inline finder snapshots recursive filenames, ranks paths and opens the retained preview without reading while typing', async () => {
  const host = await nativeHost(); host.render(); await host.settle();
  const scans = () => host.state.calls.filter(c => c.cmd === 'fd');
  const reads = () => host.state.calls.filter(c => c.read && c.read !== '/app/config/workspace-browser.json');
  const paths = ['src/app/components/Header.tsx', 'src/other/Header.tsx', 'Header.tsx', 'appHeaderNotes.txt', '.hidden/ spaced\nname.txt'];
  host.state.hook = c => c.cmd === 'fd' ? Promise.resolve(ok(paths.join('\0') + '\0/absolute\0../escape\0nested/../escape\0nested\\..\\escape\0C:/absolute\0unfinished')) : null;
  assert.equal(scans().length, 0, 'Opening All files does not scan recursively');
  assert.equal(host.node('files', 'file-src/app/components/Header.tsx'), undefined, 'The nested match is absent from the normal tree');
  host.fileType('apphdr');
  assert.match(host.text('files'), /Searching files/);
  await host.settle();
  assert.ok(Array.from(host.files.searchRows().paths).includes('src/app/components/Header.tsx'), 'Shorthand spans path components');
  assert.equal(host.node('files', 'files-tree'), undefined);
  assert.equal(reads().length, 0, 'Searching does not read file contents');
  assert.deepEqual(scans()[0].args, ['--type', 'f', '--relative-path', '--show-errors', '--color', 'never', '--print0', '--hidden', '--exclude', '.git', '--exclude', 'node_modules', '--max-results', '20001', '']);
  assert.equal(scans()[0].cwd, '/repo/pkg'); assert.equal(scans()[0].on, null);
  host.fileType('Header.tsx');
  assert.deepEqual(Array.from(host.files.searchRows().paths), ['Header.tsx', 'src/other/Header.tsx', 'src/app/components/Header.tsx']);
  assert.match(host.text('files'), /src\/other\/Header.tsx/);
  const cached = host.files.searchRows(); host.render(); assert.equal(host.files.searchRows(), cached, 'Unrelated renders reuse fuzzy results');
  host.fileKey('down'); assert.equal(host.files.at, 1);
  host.fileKey('up'); assert.equal(host.files.at, 0);
  host.fileKey('down'); host.fileSubmit(); await host.settle();
  assert.equal(host.files.file, 'src/other/Header.tsx'); assert.equal(host.files.code.value, 'sample text\n');
  assert.deepEqual(reads().map(c => [c.read, c.on]), [['/repo/pkg/src/other/Header.tsx', null]]);
  assert.ok(host.node('files', 'files-search'), 'Search remains reachable beside the preview');
  // Model deferred programmatic changes too; same-value notifications must not clear restored previews.
  host.state.programmaticChanges = true;
  host.state.terminals[0].labels['pi.session-cwd'] = '/other-scope';
  host.render(); await host.settle();
  host.state.terminals[0].labels['pi.session-cwd'] = '/repo/pkg';
  host.render(); await host.settle();
  assert.equal(host.files.file, 'src/other/Header.tsx', 'Returning to a folder restores its preview despite deferred input notifications');
  assert.equal(host.files.code.value, 'sample text\n');
  host.fileType('Header.tsx'); await host.settle(); host.fileKey('down'); host.fileSubmit(); await host.settle();
  assert.equal(host.node('files', 'files').keydown, undefined, 'Finder keys are scoped to the Input subtree, not the preview Editor');
  host.click('files', 'files-back'); assert.ok(host.node('files', 'files-search-results'));
  host.fileSubmit(); await host.settle(); host.fileType('spaced');
  assert.equal(host.files.file, null, 'Typing from preview returns to results');
  host.click('files', 'files-match-0'); await host.settle();
  assert.equal(reads().at(-1).read, '/repo/pkg/.hidden/ spaced\nname.txt', 'Filename whitespace and NUL record boundaries are preserved');
  host.fileKey('escape'); assert.ok(host.node('files', 'files-tree')); assert.equal(host.files.query, '');
  assert.equal(scans().length, 2, 'Only returning to the folder and restarting search adds a snapshot; typing/selection reuse it');
  host.fileType('escape'); await host.settle();
  assert.equal(scans().length, 3, 'Clear then reenter refreshes discovery');
  assert.equal(host.files.searchRows().paths.length, 0, 'Unsafe paths are never selectable');
  assert.match(host.text('files'), /No matching files/);
});

test('inline finder rejects stale scans/previews, bounds partial results and routes selected machine failures honestly', async () => {
  const host = await nativeHost(); host.render(); await host.settle();
  const scans = () => host.state.calls.filter(c => c.cmd === 'fd' || c.cmd?.endsWith('/bin/fd'));
  const slow = deferred();
  host.state.hook = c => c.cmd === 'fd' ? slow.promise : null;
  host.fileType('old'); await host.settle(); host.fileKey('escape');
  host.state.hook = c => c.cmd === 'fd' ? Promise.resolve(ok('fresh.txt\0')) : null;
  host.fileType('fresh'); await host.settle(); slow.resolve(ok('old.txt\0')); await host.settle();
  assert.deepEqual(Array.from(host.files.searchRows().paths), ['fresh.txt'], 'Clearing invalidates the earlier episode');
  const preview = deferred(); host.state.readHook = () => preview.promise;
  host.fileSubmit(); await host.settle(); host.fileKey('escape');
  preview.resolve('stale contents'); await host.settle(); assert.equal(host.files.code, null);
  host.state.readHook = null;
  const oldScope = deferred(); host.state.hook = c => c.cmd === 'fd' ? oldScope.promise : null;
  host.fileType('old'); await host.settle();
  Object.assign(host.state.terminals[0].labels, { 'pi.session-id': 'new', 'pi.session-cwd': '/selected/sub' });
  host.render(); await host.settle(); oldScope.resolve(ok('old.txt\0')); await host.settle();
  assert.equal(host.files.query, ''); assert.equal(host.files.scan, null); assert.equal(host.files.root, '/selected/sub');
  const many = Array.from({ length: 20001 }, (_, i) => `nested/file-${i}.txt`).join('\0') + '\0';
  host.state.hook = c => c.cmd === 'fd' ? Promise.resolve({ code: 1, stdout: many, stderr: Array.from({ length: 100 }, (_, i) => `permission denied in directory ${i}`).join('\n') }) : null;
  host.fileType('file'); await host.settle();
  assert.equal(scans().at(-1).cwd, '/selected/sub', 'Search uses the selection, not Git root or picker searchRoots');
  assert.equal(host.files.searchRows().paths.length, 50); assert.equal(host.files.searchRows().count, 20000);
  assert.match(host.text('files'), /20,000-file scan limit/); assert.match(host.text('files'), /permission denied/); assert.match(host.text('files'), /showing first 50/);
  assert.equal(host.node('files', 'files-search-notice').maxHeight, 80, 'Many scan diagnostics cannot consume the results viewport');
  assert.equal(host.node('files', 'files-search-notice').scrollbar, true);
  host.fileType('file-20000'); assert.equal(host.files.searchRows().paths.length, 0, 'Sentinel is not selectable');
  host.fileKey('escape');
  host.state.hook = c => c.cmd === 'fd' ? Promise.reject(new Error('cannot start fd: program not found'))
    : c.cmd === '/home/synthetic/.pi/agent/bin/fd' ? Promise.resolve(ok('fallback.txt\0')) : null;
  host.fileType('fallback'); await host.settle(); assert.equal(host.files.searchRows().paths[0], 'fallback.txt');
  assert.equal(scans().at(-1).cmd, '/home/synthetic/.pi/agent/bin/fd'); assert.equal(scans().at(-1).cwd, '/selected/sub');
  host.fileKey('escape');
  const beforeFailure = scans().length;
  host.state.hook = c => c.cmd === 'fd' ? Promise.reject(new Error('cannot run fd: Permission denied (os error 13)')) : null;
  host.fileType('x'); await host.settle(); assert.equal(scans().length, beforeFailure + 1); assert.match(host.text('files'), /Permission denied/);
  host.fileKey('escape'); assert.ok(host.node('files', 'files-tree'), 'Missing/broken search cannot break tree navigation');

  host.state.spaces.push({ id: 'remote/s', machine: 'remote', folder: '/srv/project', tabs: [{ id: 'remote/a', active: true }] });
  host.state.focus = { space: 'remote/s', tab: 'remote/a', pane: null, terminal: null };
  host.render(); await host.settle();
  const beforeRemote = scans().length;
  host.state.hook = c => c.cmd === 'fd' ? Promise.reject(new Error('cannot start fd: program not found')) : null;
  host.fileType('file'); await host.settle();
  assert.equal(scans().length, beforeRemote + 1, 'Remote absence never tries a local-home fallback');
  assert.equal(scans().at(-1).cwd, '/srv/project'); assert.equal(scans().at(-1).on, 'remote');
  assert.match(host.text('files'), /fd is not installed on the selected machine/);
  host.fileKey('escape');
  host.state.hook = c => c.cmd === 'fd' ? Promise.resolve(ok('remote/file.txt\0')) : null;
  host.fileType('file'); await host.settle(); host.fileSubmit(); await host.settle();
  assert.ok(host.state.calls.some(c => c.read === '/srv/project/remote/file.txt' && c.on === 'remote'));
  const closedPreview = deferred(); host.state.readHook = () => closedPreview.promise;
  host.fileSubmit(); await host.settle();
  host.closeFiles(); closedPreview.resolve('closed contents'); await host.settle();
  assert.equal(host.files.code, null); assert.equal(host.files.input.released, true);

  const closing = await nativeHost(); closing.render(); await closing.settle();
  const scan = deferred(); closing.state.hook = c => c.cmd === 'fd' ? scan.promise : null;
  closing.fileType('file'); await closing.settle(); closing.closeFiles();
  scan.resolve(ok('file.txt\0')); await closing.settle(); assert.equal(closing.files.scan, null, 'Closed views reject late discovery');
});
