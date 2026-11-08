import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { issueFilter, VIEWS } from '../customizations/linear/mods/linear-panel/model.js';
import { demoView } from '../customizations/linear/mods/linear-panel/demo.js';
import { loadView, CONTEXT_QUERY } from '../customizations/linear/mods/linear-panel/api.js';
import { issueGroups, validateConfig, linearUrl } from '../customizations/linear/mods/linear-panel/model.js';

const config = validateConfig({ team: 'eng', workspace: 'example' });
const viewer = { id: 'me', name: 'Alex' };
const cycle = { id: 'cycle-1', name: 'Polish', number: 8, startsAt: '2026-11-02', endsAt: '2026-11-16' };
const state = { id: 'review', name: 'In Review', type: 'started', color: '#888888', position: 2 };
const issue = (id, extra = {}) => ({ id, identifier: `ENG-${id}`, title: `Issue ${id}`, url: `https://linear.app/example/issue/ENG-${id}`, updatedAt: '2026-11-07T12:00:00Z', state, project: null, assignee: viewer, ...extra });
const json = data => ({ status: 200, ok: true, json: async () => ({ data }) });

function vendor({ selectedCycle = cycle, onIssues } = {}) {
  return async (url, request) => {
    assert.equal(url, 'https://api.linear.app/graphql');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers.Authorization, 'test-key');
    const { query, variables } = JSON.parse(request.body);
    if (query === CONTEXT_QUERY) {
      assert.equal(variables.team, 'ENG');
      return json({ viewer, teams: { nodes: [{ id: 'team-eng', key: 'ENG', name: 'Engineering', activeCycle: selectedCycle }] } });
    }
    assert.match(query, /project\s*\{[^}]*\bid\b/s, 'Project grouping needs stable project IDs');
    return onIssues(variables);
  };
}

test('personal views constrain the configured team; active cycle uses assigned OR created, paginates and deduplicates', async () => {
  const expected = {
    assigned: { team: { id: { eq: 'team-eng' } }, assignee: { id: { eq: 'me' } } },
    created: { team: { id: { eq: 'team-eng' } }, creator: { id: { eq: 'me' } } },
    cycle: { team: { id: { eq: 'team-eng' } }, cycle: { id: { eq: 'cycle-1' } }, or: [{ assignee: { id: { eq: 'me' } } }, { creator: { id: { eq: 'me' } } }] },
  };
  for (const view of ['assigned', 'created', 'cycle']) {
    let calls = 0;
    const other = issue(2, { assignee: { id: 'someone-else', name: 'Sam' } });
    const result = await loadView(vendor({ onIssues: async variables => {
      assert.deepEqual(variables.filter, expected[view]);
      calls++;
      if (!variables.after) return json({ issues: { nodes: [issue(1)], pageInfo: { hasNextPage: true, endCursor: 'page-2' } } });
      assert.equal(variables.after, 'page-2');
      return json({ issues: { nodes: [issue(1), other], pageInfo: { hasNextPage: false, endCursor: null } } });
    } }), 'test-key', config, view);
    assert.equal(calls, 2);
    assert.deepEqual(result.issues.map(i => i.id), [1, 2]);
    assert.equal(result.issues[1].assignee.name, 'Sam');
  }
});

test('cycle refresh resolves new active cycle, and no active cycle does not query unrelated issues', async () => {
  for (const id of ['cycle-1', 'cycle-2']) {
    const result = await loadView(vendor({ selectedCycle: { ...cycle, id }, onIssues: async ({ filter }) => {
      assert.equal(filter.cycle.id.eq, id);
      return json({ issues: { nodes: [], pageInfo: { hasNextPage: false } } });
    } }), 'test-key', config, 'cycle');
    assert.equal(result.cycle.id, id);
  }
  const result = await loadView(vendor({ selectedCycle: null, onIssues: () => assert.fail('No cycle must not fetch all team issues') }), 'test-key', config, 'cycle');
  assert.equal(result.cycle, null);
  assert.deepEqual(result.issues, []);
});

test('failed page/auth requests reject rather than return partial or empty success', async () => {
  const pageFailure = vendor({ onIssues: ({ after }) => after
    ? Promise.resolve({ ok: false, status: 503 })
    : Promise.resolve(json({ issues: { nodes: [issue(1)], pageInfo: { hasNextPage: true, endCursor: 'next' } } })) });
  await assert.rejects(loadView(pageFailure, 'test-key', config, 'assigned'), /HTTP 503/);
  await assert.rejects(loadView(async () => ({ ok: false, status: 401 }), 'test-key', config, 'assigned'), /access denied/);
});

test('actual status grouping, closed toggle and URL/config boundary', () => {
  const backlog = { id: 'backlog', name: 'Backlog', type: 'backlog', position: 0 };
  const done = { id: 'done', name: 'Done', type: 'completed', position: 0 };
  const newer = issue(2, { updatedAt: '2026-11-07T13:00:00Z' });
  const issues = [issue(1), newer, newer, issue(3, { state: backlog }), issue(4, { state: done })];
  const open = issueGroups(issues, false);
  assert.equal(open.total, 4);
  assert.equal(open.hidden, 1);
  assert.deepEqual(open.groups.map(g => g.state.name), ['In Review', 'Backlog']);
  assert.deepEqual(open.groups[0].issues.map(i => i.id), [2, 1]);
  assert.equal(issueGroups(issues, true).groups.at(-1).state.name, 'Done');
  assert.throws(() => validateConfig({ team: '../ENG', workspace: 'example' }));
  assert.throws(() => validateConfig({ team: 'ENG', workspace: 'evil.test/path' }));
  assert.equal(linearUrl('https://linear.app/example/issue/ENG-1'), 'https://linear.app/example/issue/ENG-1');
  assert.equal(linearUrl('https://linear.app.evil.test/issue/1'), null);
  assert.equal(linearUrl('file:///etc/passwd'), null);
});

test('project groups use project identity, flat recent-first lists, and a final No project bucket', () => {
  const project = { id: 'alpha', name: 'Roadmap' };
  const newer = issue(2, { project, updatedAt: '2026-11-07T13:00:00Z' });
  const issues = [
    issue(1, { project }), newer, newer,
    issue(3, { project: { id: 'beta', name: 'Roadmap' } }),
    issue(4, { project: { id: 'gamma', name: 'Activity' } }),
    issue(5),
    issue(6, { project, state: { id: 'done', name: 'Done', type: 'completed' } }),
  ];
  const result = issueGroups(issues, false, 'project');
  assert.equal(result.total, 6);
  assert.equal(result.hidden, 1);
  assert.deepEqual(result.groups.map(g => [g.name, g.issues.length]), [
    ['Activity', 1], ['Roadmap', 2], ['Roadmap', 1], ['No project', 1],
  ]);
  assert.deepEqual(result.groups[1].issues.map(i => i.id), [2, 1]);
  assert.deepEqual(issueGroups(issues, true, 'project').groups[1].issues.map(i => i.id), [2, 1, 6]);
});

// External GPUI builders retain the tree/click handlers; real View, grouping and
// demo collaborators run unchanged. Hidden panel copies deliberately do not render.
async function nativePanel() {
  const source = (await readFile(new URL('../customizations/linear/mods/linear-panel/main.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default class LinearPanel', 'this.Panel = class LinearPanel');
  function element() {
    const node = { children: [] };
    const add = child => node.children.push(child?.node ?? child);
    const proxy = new Proxy({}, { get: (_target, method) => {
      if (method === 'node') return node;
      return (...args) => {
        if (method === 'id') node.id = args[0];
        else if (method === 'child') add(args[0]);
        else if (method === 'children') args[0].forEach(add);
        else if (method === 'on_click') node.click = args[0];
        else if (method === 'when' && args[0]) args[1](proxy);
        return proxy;
      };
    } });
    return proxy;
  }
  const state = { shown: false, configReads: 0, fail: false };
  let rendering = false, buttonProps = false, root;
  const queue = [], storage = new Map(), sharedState = new Map();
  const nativeCx = {
    notify() { assert.equal(rendering, false, 'notify must never run during render'); },
    spawn(task) { queue.push(task); },
    focus_handle() { return { focus() {} }; },
  };
  const context = {
    View: class {}, div: element, svg: element, h_flex: element, v_flex: element,
    layout: () => ({ children: [{ id: 'panel', hidden: !state.shown }, { id: 'panel-body', active: 'linear-panel' }] }),
    props: () => ({ button: buttonProps }), theme: () => ({}), appHome: () => '/synthetic-home',
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    nextCommand: () => new Promise(() => {}), run() {},
    setShared: (key, value) => sharedState.set(key, value), shared: key => sharedState.get(key),
    readTextFile: async () => { state.configReads++; if (state.fail) throw new Error('Synthetic read failure'); return JSON.stringify({ team: 'ENG', workspace: 'example', demo: true }); },
    exec: () => assert.fail('Demo must not read Keychain or open links'),
    loadView, issueGroups, linearUrl, validateConfig, VIEWS, demoView,
  };
  vm.runInNewContext(source, context);
  buttonProps = true;
  const toolbar = new context.Panel();
  toolbar.init({}, nativeCx);
  buttonProps = false;
  const mount = () => {
    const panel = new context.Panel();
    panel.init({}, nativeCx);
    queue.shift(); // The host-owned command listener waits independently, with no timer.
    return panel;
  };
  let panel = mount();
  const render = () => {
    rendering = true;
    try { toolbar.render(nativeCx); if (state.shown) root = panel.render(nativeCx).node; }
    finally { rendering = false; }
  };
  const settle = async () => {
    while (queue.length) { await queue.shift()(nativeCx); render(); }
  };
  const find = (node, id) => node?.id === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
  const texts = node => typeof node === 'string' ? [node] : node.children.flatMap(texts);
  return {
    state, render, settle, get panel() { return panel; }, get: id => find(root, id),
    click(id) { const node = find(root, id); assert.ok(node?.click, `Missing clickable ${id}`); node.click({}, nativeCx); render(); },
    headings: () => find(root, 'linear-issue-list').children.filter(node => !node.id).map(texts),
    reload() { assert.equal(state.shown, false); panel = mount(); },
  };
}

test('hide → reopen schedules refresh outside render and a failed refresh retains the last list', async () => {
  const host = await nativePanel();
  host.render();
  host.state.shown = true;
  host.render();
  assert.equal(host.state.configReads, 0, 'No async work starts inside render');
  await host.settle();
  assert.equal(host.state.configReads, 1);
  const previous = host.panel.snapshots.assigned;
  assert.ok(previous.issues.length > 0);
  host.render();
  assert.equal(host.state.configReads, 1, 'A normal render does not poll');
  host.state.shown = false; host.render();
  host.state.fail = true;
  host.state.shown = true; host.render();
  await host.settle();
  assert.equal(host.state.configReads, 2);
  assert.equal(host.panel.snapshots.assigned, previous);
  assert.match(host.panel.error, /Synthetic read failure/);
});

test('grouping clicks regroup cached issues, persist per tab, and leave cycle status groups unchanged', async () => {
  const host = await nativePanel();
  host.state.shown = true; host.render(); await host.settle();
  assert.equal(host.panel.grouping.assigned, 'status');
  assert.equal(host.panel.grouping.created, 'status');
  assert.equal(host.headings()[0][0], 'IN PROGRESS');
  const snapshot = host.panel.snapshots.assigned;
  host.click('linear-group-project'); await host.settle();
  assert.deepEqual(host.headings(), [['Workspace improvements', '2'], ['No project', '1']]);
  assert.ok(host.get('linear-issue-demo-102'), 'Issue rows are retained');
  assert.equal(host.panel.snapshots.assigned, snapshot);
  assert.equal(host.state.configReads, 1, 'Grouping does not refetch');
  host.click('linear-view-created'); await host.settle();
  assert.equal(host.headings()[0][0], 'IN REVIEW', 'Created defaults independently to status');
  host.click('linear-group-project'); await host.settle();
  assert.deepEqual(host.headings(), [['Workspace improvements', '2'], ['No project', '1']]);
  host.click('linear-view-assigned');
  host.click('linear-group-status'); await host.settle();
  assert.equal(host.state.configReads, 2, 'Loaded tabs and grouping switches reuse their data');
  host.click('linear-view-cycle'); await host.settle();
  assert.equal(host.get('linear-grouping'), undefined);
  assert.equal(host.headings()[0][0], 'IN PROGRESS');
  host.state.shown = false; host.render(); host.reload();
  host.state.shown = true; host.render(); await host.settle();
  host.click('linear-view-assigned'); await host.settle();
  assert.equal(host.headings()[0][0], 'IN PROGRESS', 'Assigned remembers status after reload');
  host.click('linear-view-created'); await host.settle();
  assert.deepEqual(host.headings(), [['Workspace improvements', '2'], ['No project', '1']], 'Created remembers project after reload');
});
