import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { loadView, loadStack, VIEWER_QUERY, QUEUE_QUERY, STACK_QUERY } from '../customizations/github/mods/github-panel/api.js';
import { validateConfig, githubPrUrl, prGroups, reasonLabel, VIEWS } from '../customizations/github/mods/github-panel/model.js';
import { demoView, demoStack } from '../customizations/github/mods/github-panel/demo.js';

const config = validateConfig({ organization: 'example-org' });
const stack = { id: 'stack-a', number: 7, size: 4 };
const pr = (number, extra = {}) => ({ id: `pr-${number}`, number, title: `Synthetic change ${number}`,
  url: `https://github.com/example-org/example-api/pull/${number}`, state: 'OPEN', isDraft: false,
  updatedAt: '2026-11-07T09:42:00Z', repository: { nameWithOwner: 'example-org/example-api' },
  author: { login: 'alex-example' }, stack: null, stackEntry: null, ...extra });
const response = (data, errors, code = errors?.length ? 1 : 0) => ({ code, stdout: JSON.stringify({ data, ...(errors ? { errors } : {}) }) });
const page = (nodes, { next = null, count = nodes.length } = {}) => ({ nodes, issueCount: count, pageInfo: { hasNextPage: next !== null, endCursor: next } });
const stackPage = (nodes, next = null) => ({ node: { ...stack, entries: { nodes, totalCount: stack.size, pageInfo: { hasNextPage: next !== null, endCursor: next } } } });

function vendor(handler, login = () => 'alex-example') {
  return async (command, args, options) => {
    assert.equal(command, config.ghPath);
    assert.equal(options, undefined, 'The inbox must not inherit cwd or remote machine selection');
    assert.deepEqual(args.slice(0, 4), ['api', '--hostname', 'github.com', 'graphql']);
    const vars = Object.fromEntries(args.filter((_, index) => index >= 5 && index % 2 === 1).map(arg => {
      const index = arg.indexOf('='); return [arg.slice(0, index), arg.slice(index + 1)];
    }));
    const query = vars.query;
    if (query === VIEWER_QUERY) return response({ viewer: { login: login() } });
    assert.ok(query === QUEUE_QUERY || query === STACK_QUERY);
    assert.ok(args.includes('-F') === (vars.after === 'null'));
    return handler({ ...vars, after: vars.after === 'null' ? null : vars.after });
  };
}

test('queue operations page and union independent personal legs, preserve drafts and mark partial/capped results honestly', async () => {
  let active = 0, peak = 0;
  const queries = [];
  const personal = await loadView(vendor(async ({ q, after }) => {
    queries.push(q);
    assert.match(q, /^org:example-org is:pr is:open /);
    assert.match(q, / sort:updated-desc$/);
    active++; peak = Math.max(peak, active); await Promise.resolve(); active--;
    if (q.includes('assignee:')) {
      assert.ok(after === null || after === 'assigned-2');
      return response({ search: after ? page([pr(145)]) : page([pr(145)], { next: 'assigned-2' }) });
    }
    assert.match(q, /user-review-requested:@me/);
    assert.equal(after, null);
    return response({ search: page([pr(145), pr(151)]) });
  }), config, 'for-me');
  assert.equal(peak, 2, 'At most two personal source legs run concurrently');
  assert.equal(queries.length, 3, 'Both personal sources and the later assigned page are queried');
  assert.deepEqual(personal.prs.map(row => [row.number, row.reasons]), [[145, ['assigned', 'review-requested']], [151, ['review-requested']]]);
  const authored = await loadView(vendor(({ q, after }) => {
    assert.equal(q, 'org:example-org is:pr is:open author:alex-example sort:updated-desc');
    assert.equal(after, null);
    return response({ search: page([pr(142, { isDraft: true }), pr(143, { state: 'CLOSED' })]) });
  }), config, 'authored');
  assert.deepEqual(authored.prs.map(row => [row.number, row.isDraft]), [[142, true]]);
  await assert.rejects(loadView(() => assert.fail('Unknown views must not run gh'), config, 'teams'), /Unknown GitHub queue/);

  const partial = await loadView(vendor(({ q, after }) => {
    if (q.includes('user-review-requested:')) return { code: 1, stdout: 'private process output' };
    if (after) throw new Error('private native payload');
    return response({ search: page([pr(145)], { next: 'later' }) });
  }), config, 'for-me');
  assert.equal(partial.complete, false);
  assert.equal(partial.prs.length, 1);
  assert.match(partial.warnings.join(' '), /Assigned:.*Personal review:/);
  assert.doesNotMatch(partial.warnings.join(' '), /private/);

  let pages = 0;
  const capped = await loadView(vendor(({ after }) => {
    assert.equal(after, pages === 0 ? null : `cursor-${pages}`);
    pages++;
    return response({ search: page(Array.from({ length: 100 }, (_, index) => pr((pages - 1) * 100 + index + 1)), { count: 1200, next: `cursor-${pages}` }) });
  }), config, 'authored');
  assert.equal(pages, 10);
  assert.equal(capped.prs.length, 1000);
  assert.equal(capped.complete, false);
  assert.match(capped.warnings.join(' '), /1,000/);

  for (const code of [0, 1]) {
    const graphPartial = await loadView(vendor(() => response({ search: page([pr(145)]) }, [{ type: 'FORBIDDEN', message: 'private GraphQL payload' }], code)), config, 'authored');
    assert.equal(graphPartial.complete, false);
    assert.equal(graphPartial.prs.length, 1);
    assert.doesNotMatch(graphPartial.warnings.join(' '), /private/);
  }
  const repeated = await loadView(vendor(() => response({ search: page([pr(145)], { next: 'same' }) })), config, 'authored');
  assert.equal(repeated.complete, false);
  assert.match(repeated.warnings.join(' '), /pagination/);
  for (const bad of [{ code: 1, stdout: 'secret' }, { code: 0, stdout: 'not JSON secret' }, response({ search: null }),
    response({ search: page([pr(145)]) }, undefined, 1), response(null, [{ message: 'secret' }]), response({ search: page([pr(145)]) }, ['secret'])]) {
    await assert.rejects(loadView(vendor(() => bad), config, 'authored'), error => !error.message.includes('secret') && /GitHub/.test(error.message));
  }
  await assert.rejects(loadView(async () => { throw new Error('secret'); }, config, 'authored'), /local gh/);
  await assert.rejects(loadView(vendor(() => response({ search: null, rateLimit: { remaining: 0, resetAt: '2026-11-07T10:00:00Z' } }, [{ type: 'RATE_LIMITED', message: 'private details' }])), config, 'authored'), error => /Wait, then Refresh.*2026-11-07T10:00:00/.test(error.message) && !error.message.includes('private'));
  const empty = await loadView(vendor(() => response({ search: page([]) })), config, 'authored');
  assert.equal(empty.complete, true);
  assert.equal(empty.prs.length, 0);
  for (const bad of [null, [], {}, { ...config, organization: 'example-org is:public' }, { ...config, teams: ['engineering'] }, { ...config, ghPath: 'gh --debug' }, { ...config, token: 'not-supported' }]) assert.throws(() => validateConfig(bad));
  assert.equal(validateConfig({ ...config, ghPath: '/Applications/My Tools/gh' }).ghPath, '/Applications/My Tools/gh');
  assert.deepEqual(config, { organization: 'example-org', ghPath: 'gh', demo: false });
  for (const unsafe of ['http://github.com/example-org/repo/pull/1', 'https://github.com:443/example-org/repo/pull/1', 'https://github.com/other/repo/pull/1', 'https://github.com/example-org/repo/pull/1?x=y', 'https://github.com/example-org/repo/pull/1#fragment', 'https://user@github.com/example-org/repo/pull/1', 'javascript:alert(1)']) assert.equal(githubPrUrl(unsafe, config.organization), null);
  assert.equal(githubPrUrl(pr(145).url, config.organization), pr(145).url);
});

test('native stack paging enriches a middle-only match in foundation order without changing queue counts or activity', async () => {
  const snapshot = await loadView(vendor(() => response({ search: page([pr(145, { stack, stackEntry: { position: 2 } }), pr(151)]) })), config, 'authored');
  const context = await loadStack(vendor(({ id, after }) => {
    assert.equal(id, stack.id);
    return response(stackPage(after ? [
      { position: 2, pullRequest: pr(145) }, { position: 3, pullRequest: null }, { position: 4, pullRequest: pr(149, { isDraft: true }) },
    ] : [{ position: 1, pullRequest: pr(142, { state: 'MERGED' }) }], after ? null : 'stack-2'));
  }), config, stack.id);
  assert.equal(context.complete, true);
  const [group] = prGroups(snapshot, { [stack.id]: context });
  assert.equal(group.count, 2);
  const unit = group.units.find(unit => unit.stack);
  assert.equal(unit.matches.length, 1);
  assert.equal(unit.size, 4);
  assert.deepEqual(unit.entries.map(entry => [entry.position, entry.pr?.number ?? null]), [[1, 142], [2, 145], [3, null], [4, 149]]);
  assert.deepEqual(unit.entries[1].pr.reasons, ['authored']);
  assert.equal(unit.entries[0].pr.state, 'MERGED');
  assert.equal(prGroups(snapshot, {})[0].units.find(unit => unit.stack).entries[0].pr.number, 145);
  const nullMatching = { ...context, entries: context.entries.map(entry => entry.position === 2 ? { position: 2, pr: null } : entry) };
  assert.equal(prGroups(snapshot, { [stack.id]: nullMatching })[0].units.find(unit => unit.stack).entries.length, 4);
  const incomplete = await loadStack(vendor(({ after }) => after ? response({ node: null }) : response(stackPage([{ position: 1, pullRequest: pr(142) }], 'next'))), config, stack.id);
  assert.equal(incomplete.complete, false);
  assert.equal(incomplete.entries.length, 1);
  const graphPartial = await loadStack(vendor(() => response(stackPage([{ position: 1, pullRequest: pr(142) }]), [{ type: 'FORBIDDEN', message: 'private GraphQL payload' }])), config, stack.id);
  assert.equal(graphPartial.complete, false);
  assert.equal(graphPartial.entries.length, 1);
  assert.doesNotMatch(graphPartial.warnings.join(' '), /private/);
  await assert.rejects(loadStack(vendor(() => response({ node: null })), config, stack.id), /Stack context unavailable/);
  const contextNewer = { ...context, entries: context.entries.map(entry => entry.pr ? { ...entry, pr: { ...entry.pr, updatedAt: '2099-01-01T00:00:00Z' } } : entry) };
  assert.equal(prGroups(snapshot, { [stack.id]: contextNewer })[0].units[0].id, group.units[0].id, 'Context activity cannot reorder matching units');
  const largeStack = { ...stack, size: 101 };
  const large = await loadStack(vendor(({ after }) => response({ node: { ...largeStack, entries: {
    totalCount: 101, nodes: Array.from({ length: after ? 1 : 100 }, (_, i) => ({ position: after ? 101 : i + 1, pullRequest: pr(after ? 101 : i + 1) })),
    pageInfo: { hasNextPage: !after, endCursor: after ? null : 'last' },
  } } })), config, stack.id);
  assert.equal(large.entries.length, 101, 'Page size is not a native stack size cap');
});

// Native builders and host effects are the only substitutes; main/API/model stay real.
// Separate toolbar/panel copies reproduce the host rule that hidden panels do not render.
async function nativePanel(rememberedView = null) {
  const source = (await readFile(new URL('../customizations/github/mods/github-panel/main.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '').replace('export default class GitHubPanel', 'this.Panel = class GitHubPanel');
  function element() {
    const node = { children: [] };
    const add = child => node.children.push(child?.node ?? child);
    const proxy = new Proxy({}, { get: (_target, method) => method === 'node' ? node : (...args) => {
      if (method === 'id') node.id = args[0];
      else if (method === 'child') add(args[0]);
      else if (method === 'children') args[0].forEach(add);
      else if (method === 'on_click') node.click = args[0];
      else if (method === 'on_size_change') node.resize = args[0];
      else if (method === 'when' && args[0]) args[1](proxy);
      return proxy;
    } });
    return proxy;
  }
  const state = { shown: false, reads: 0, ghCalls: 0, calls: [], opens: [], fail: false, contextFail: false, config, login: 'alex-example', hold: null };
  let rendering = false, button = false, root, toolbarRoot;
  const tasks = [], storage = new Map([['view', rememberedView]]), sharedState = new Map([['workspace.panels', ['files', 'changes', 'linear-panel']]]);
  const cx = {
    notify() { assert.equal(rendering, false, 'Native notify is forbidden during render'); },
    spawn(task) { tasks.push(task); }, focus_handle() { return { focus() {} }; }, stop_propagation() {},
  };
  const github = vendor(async vars => {
    state.calls.push(vars);
    if (state.fail) return { code: 1, stdout: 'secret failure' };
    if (vars.query === STACK_QUERY) {
      if (state.hold) await state.hold;
      if (state.contextFail) return response({ node: null });
      return response(stackPage([
        { position: 4, pullRequest: pr(149, { isDraft: true }) }, { position: 3, pullRequest: null },
        { position: 2, pullRequest: pr(145) }, { position: 1, pullRequest: pr(142, { state: 'MERGED' }) },
      ]));
    }
    return response({ search: page([pr(145, { stack, stackEntry: { position: 2 } })]) });
  }, () => state.login);
  const host = {
    View: class {}, div: element, svg: element, h_flex: element, v_flex: element,
    props: () => ({ button }), theme: () => ({}), appHome: () => '/synthetic-home',
    layout: () => ({ children: [{ id: 'panel', hidden: !state.shown }, { id: 'panel-body', active: 'github-panel' }] }),
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    shared: key => sharedState.get(key), setShared: (key, value) => { assert.equal(rendering, false); sharedState.set(key, value); },
    nextCommand: () => new Promise(() => {}),
    run: (name, args) => { if (name === 'layout.hide') state.shown = false; if (name === 'layout.show') state.shown = true; if (name === 'layout.select') assert.equal(args.child, 'github-panel'); },
    readTextFile: async path => { assert.equal(path, '/synthetic-home/config/github-panel.json'); state.reads++; return JSON.stringify(state.config); },
    exec: async (command, args, options) => {
      if (command === '/usr/bin/open') { state.opens.push(args); return { code: 0 }; }
      state.ghCalls++;
      return github(command, args, options);
    },
    loadView, loadStack, validateConfig, githubPrUrl, prGroups, reasonLabel, VIEWS, demoView, demoStack,
  };
  vm.runInNewContext(source, host);
  button = true;
  const toolbar = new host.Panel(); toolbar.init({}, cx);
  button = false;
  const mount = () => { const panel = new host.Panel(); panel.init({ button: true }, cx); tasks.pop(); return panel; };
  let panel = mount();
  const render = () => {
    rendering = true;
    try { toolbarRoot = toolbar.render(cx).node; if (state.shown) root = panel.render(cx).node; }
    finally { rendering = false; }
  };
  const find = (node, id) => node?.id === id ? node : node?.children?.map(child => find(child, id)).find(Boolean);
  const texts = node => typeof node === 'string' ? [node] : node.children.flatMap(texts);
  const step = async () => { assert.ok(tasks.length); await tasks.shift()(cx); render(); };
  return {
    state, render, step, tasks, sharedState, cx, get panel() { return panel; }, get: id => find(root, id),
    text: () => texts(root).join(' '),
    async settle() { for (let i = 0; tasks.length; i++) { assert.ok(i < 30, 'No polling/retry loop'); await step(); } },
    click(id) { const node = find(root, id) ?? find(toolbarRoot, id); assert.ok(node?.click, `Missing clickable ${id}`); node.click({}, cx); render(); },
    reload() { assert.equal(state.shown, false); panel = mount(); },
  };
}

test('native queue publishes before context; expansion, safe clicks, reopen, stale refresh and lazy selection use the real API', async () => {
  const host = await nativePanel('teams');
  assert.equal(host.panel.view, 'authored', 'An obsolete remembered Teams queue falls back to Authored');
  host.render();
  assert.deepEqual(Array.from(host.sharedState.get('workspace.panels')), ['files', 'changes', 'linear-panel', 'github-panel']);
  host.click('github-toggle');
  assert.equal(host.state.reads, 0);
  while (!host.panel.snapshots.authored) await host.step();
  assert.ok(host.get('github-pr-pr-145'));
  assert.equal(host.state.calls.filter(call => call.query === STACK_QUERY).length, 0, 'Matching rows publish before a context operation runs');
  assert.match(host.text(), /Loading stack context/);
  await host.settle();
  assert.match(host.text(), /4 PRs · 1 matches this view/);
  assert.match(host.text(), /1 matching PRs/);
  const ids = host.get('github-pr-list').children.map(child => child.id).filter(id => id?.startsWith('github-pr-') || id?.startsWith('github-unavailable-'));
  assert.deepEqual(ids, ['github-pr-pr-142', 'github-pr-pr-145', 'github-unavailable-stack-a-3', 'github-pr-pr-149']);
  assert.equal(host.get('github-unavailable-stack-a-3').click, undefined);
  host.click('github-stack-stack-a');
  assert.equal(host.get('github-pr-pr-145'), undefined);
  assert.equal(host.state.opens.length, 0);
  host.click('github-stack-stack-a');
  host.click('github-pr-pr-145'); await host.settle();
  assert.deepEqual(host.state.opens.map(args => Array.from(args)), [[pr(145).url]]);
  const old = host.panel.snapshots.authored;
  const calls = host.state.calls.length;
  host.render(); await host.settle();
  assert.equal(host.state.calls.length, calls, 'Redraw does not poll');
  host.click('github-view-for-me'); await host.settle();
  assert.deepEqual(Array.from(host.panel.snapshots['for-me'].prs[0].reasons), ['assigned', 'review-requested']);
  const reads = host.state.reads;
  host.click('github-view-authored'); await host.settle();
  assert.equal(host.state.reads, reads, 'Visited queue reuses its snapshot');
  host.click('github-toggle');
  host.state.fail = true;
  host.click('github-toggle'); await host.settle();
  assert.equal(host.state.reads, reads + 1);
  assert.equal(host.panel.snapshots.authored, old);
  assert.match(host.text(), /stale last loaded data/);
  assert.doesNotMatch(host.text(), /secret/);
  assert.ok(host.get('github-pr-pr-145'));
  host.state.fail = false; host.state.contextFail = true;
  host.click('github-refresh'); await host.settle();
  assert.ok(host.get('github-pr-pr-145'), 'Context failure never removes a matching row');
  assert.ok(host.get('github-retry-stack-a'));
  host.state.contextFail = false;
  host.click('github-retry-stack-a'); await host.settle();
  assert.ok(host.get('github-pr-pr-142'));
  host.get('github-panel-root').resize({ width: 900 }, host.cx); host.render();
  assert.equal(host.panel.wide, true);
  host.get('github-panel-root').resize({ width: 280 }, host.cx); host.render();
  assert.equal(host.panel.wide, false);
  assert.equal(host.get('github-view-teams'), undefined);
  host.click('github-view-for-me'); await host.settle();
  host.click('github-toggle'); host.reload(); host.click('github-toggle'); await host.settle();
  assert.equal(host.panel.view, 'for-me', 'Selection alone persists across copies');
});

test('native account/config generation discards superseded contexts; setup and demo never run gh', async () => {
  const host = await nativePanel();
  host.render(); host.click('github-toggle');
  while (!host.panel.snapshots.authored) await host.step();
  let release;
  host.state.hold = new Promise(resolve => { release = resolve; });
  const oldContext = host.tasks.shift()(host.cx);
  await Promise.resolve();
  const calls = host.state.ghCalls;
  host.state.config = { ...config, organization: 'demo-org', demo: true };
  host.click('github-refresh'); await host.settle();
  assert.equal(host.state.ghCalls, calls, 'Entering demo skips gh including viewer resolution');
  assert.match(host.text(), /DEMO · Synthetic PRs/);
  assert.equal(host.panel.contexts['stack-a'], undefined);
  release(); await oldContext; await host.settle();
  assert.equal(host.panel.contexts['stack-a'], undefined, 'Old identity/config context cannot repopulate the new cache');
  assert.ok(host.panel.contexts['demo-stack']);
  assert.equal(host.state.ghCalls, calls, 'Demo view, viewer resolution and stack enrichment skip gh');
  host.state.config = { ...config, organization: 'bad scope' };
  host.click('github-refresh'); await host.settle();
  assert.match(host.text(), /valid config\/github-panel.json/);
  assert.equal(Object.keys(host.panel.snapshots).length, 0);
  assert.equal(host.state.ghCalls, calls);
  host.state.config = config; host.state.hold = null;
  host.click('github-refresh'); await host.settle();
  assert.ok(host.panel.snapshots.authored);
  host.state.login = 'new-example-user'; host.state.fail = true;
  host.click('github-refresh'); await host.settle();
  assert.equal(Object.keys(host.panel.snapshots).length, 0, 'New viewer search failure must not retain another viewer’s PRs');
  assert.equal(Object.keys(host.panel.contexts).length, 0);
});
