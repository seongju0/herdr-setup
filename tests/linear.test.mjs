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

// GPUI and Herdr are external host boundaries; execute the actual View/lifecycle,
// model and demo code with a native-contract context, not an internal refresh stub.
test('hide → reopen schedules refresh outside render and a failed refresh retains the last list', async () => {
  const source = (await readFile(new URL('../customizations/linear/mods/linear-panel/main.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default class LinearPanel', 'this.Panel = class LinearPanel');
  const element = new Proxy({}, { get: (_target, method) => method === 'when'
    ? (condition, callback) => { if (condition) callback(element); return element; }
    : () => element });
  let shown = false, rendering = false, configReads = 0, fail = false, buttonProps = false;
  const queue = [];
  const sharedState = new Map();
  const nativeCx = {
    notify() { assert.equal(rendering, false, 'notify must never run during render'); },
    spawn(task) { queue.push(task); },
    focus_handle() { return { focus() {} }; },
  };
  const context = {
    View: class {}, div: () => element, svg: () => element, h_flex: () => element, v_flex: () => element,
    layout: () => ({ children: [{ id: 'panel', hidden: !shown }, { id: 'panel-body', active: 'linear-panel' }] }),
    props: () => ({ button: buttonProps }), theme: () => ({}), appHome: () => '/synthetic-home',
    localStorage: { getItem: () => null, setItem() {} },
    nextCommand: () => new Promise(() => {}), run() {},
    setShared: (key, value) => sharedState.set(key, value), shared: key => sharedState.get(key),
    readTextFile: async () => { configReads++; if (fail) throw new Error('Synthetic read failure'); return JSON.stringify({ team: 'ENG', workspace: 'example', demo: true }); },
    exec: () => assert.fail('Demo must not read Keychain or open links'),
    loadView, issueGroups, linearUrl, validateConfig, VIEWS, demoView,
  };
  vm.runInNewContext(source, context);
  buttonProps = true;
  const toolbar = new context.Panel();
  toolbar.init({}, nativeCx);
  buttonProps = false;
  const panel = new context.Panel();
  panel.init({}, nativeCx);
  queue.shift(); // The host-owned command listener waits independently, with no timer.
  const render = () => {
    rendering = true;
    try { toolbar.render(nativeCx); if (shown) panel.render(nativeCx); }
    finally { rendering = false; }
  };
  const settle = async () => {
    while (queue.length) { await queue.shift()(nativeCx); render(); }
  };
  render();
  shown = true;
  render();
  assert.equal(configReads, 0, 'No async work starts inside render');
  await settle();
  assert.equal(configReads, 1);
  const previous = panel.snapshots.assigned;
  assert.ok(previous.issues.length > 0);
  render();
  assert.equal(configReads, 1, 'A normal render does not poll');
  shown = false; render();
  fail = true;
  shown = true; render();
  await settle();
  assert.equal(configReads, 2);
  assert.equal(panel.snapshots.assigned, previous);
  assert.match(panel.error, /Synthetic read failure/);
});
