import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { install, planInstall, makeLayout, makeWorkspaceLayout, makeGithubLayout, makeSidebarLayout, cli, workspaceLayoutName, githubLayoutName, sidebarLayoutName } from '../scripts/setup.mjs';

const main = {
  id: 'root', type: 'column', background: 'canvas', children: [
    { id: 'tabs', type: 'block', size: { px: 42 }, content: { mod: 'tabs' } },
    { id: 'panel', type: 'column', hidden: true, children: [
      { id: 'panel-body', type: 'stack', active: 'files', children: [
        { id: 'files', type: 'block', content: { mod: 'files' } },
        { id: 'changes', type: 'block', content: { mod: 'changes' } },
      ] },
    ] },
  ],
};

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'herdr-setup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const home = path.join(directory, 'home');
  const root = path.join(directory, 'repo');
  await fs.mkdir(path.join(home, 'layouts'), { recursive: true });
  await fs.writeFile(path.join(home, 'layouts/main.json'), JSON.stringify(main));
  const source = path.join(root, 'customizations/linear/mods/linear-panel');
  await fs.mkdir(path.join(source, 'icons'), { recursive: true });
  for (const file of ['main.js', 'api.js', 'model.js', 'mod.json', 'icons/linear.svg']) {
    await fs.writeFile(path.join(source, file), file === 'mod.json' ? '{}' : `synthetic ${file}`);
  }
  await fs.writeFile(path.join(source, 'gpui-kit.d.ts'), 'generated, not shipped');
  await fs.writeFile(path.join(source, 'jsconfig.json'), '{}');
  return { home, root };
}

test('plan is read-only; install copies native files, preserves main/config and repeats as a no-op', async (t) => {
  const options = await fixture(t);
  const read = (file) => fs.readFile(path.join(options.home, file), 'utf8');
  const before = await read('layouts/main.json');
  await fs.mkdir(path.join(options.home, 'config'));
  const config = '{"team":"DEMO","workspace":"synthetic-demo","demo":true}\n';
  await fs.writeFile(path.join(options.home, 'config/linear-panel.json'), config);
  const plan = await planInstall(options);
  assert.deepEqual(plan.conflicts, []);
  await assert.rejects(fs.access(path.join(options.home, 'mods')), { code: 'ENOENT' });
  const result = await install(options);
  assert.equal(result.created.length, 6);
  await assert.rejects(fs.access(path.join(options.home, 'mods/linear-panel/gpui-kit.d.ts')), { code: 'ENOENT' });
  assert.equal(await read('layouts/main.json'), before);
  assert.equal(await read('config/linear-panel.json'), config);
  assert.equal(await read('mods/linear-panel/icons/linear.svg'), 'synthetic icons/linear.svg');
  const layout = JSON.parse(await read('layouts/herdr-setup-linear.json'));
  assert.equal(layout.background, 'canvas');
  assert.deepEqual(layout.children[0].size, { px: 42 });
  assert.deepEqual(layout.children[0].children[1], { id: 'linear-button', type: 'block', size: { px: 86 }, content: { mod: 'linear-panel', props: { button: true } } });
  assert.equal(layout.children[1].hidden, true);
  assert.equal(layout.children[1].children[0].active, 'files');
  assert.equal(layout.children[1].children[0].children.at(-1).id, 'linear-panel');
  assert.deepEqual((await install(options)).created, []);
});

test('preflight refuses a conflicting mod before copying anything; local layout and config edits are never overwritten', async (t) => {
  const options = await fixture(t);
  const target = (file) => path.join(options.home, file);
  await fs.mkdir(target('mods/linear-panel'), { recursive: true });
  await fs.writeFile(target('mods/linear-panel/main.js'), 'local work');
  await assert.rejects(install(options), /Refusing conflicts/);
  assert.equal(await fs.readFile(target('mods/linear-panel/main.js'), 'utf8'), 'local work');
  await assert.rejects(fs.access(target('mods/linear-panel/api.js')), { code: 'ENOENT' });
  await assert.rejects(fs.access(target('config')), { code: 'ENOENT' });
  await fs.unlink(target('mods/linear-panel/main.js'));
  await install(options);
  assert.deepEqual(JSON.parse(await fs.readFile(target('config/linear-panel.json'), 'utf8')), { team: 'ENG', workspace: 'example-workspace' });
  await fs.writeFile(target('layouts/herdr-setup-linear.json'), '{"local":true}');
  await assert.rejects(install(options), /layouts\/herdr-setup-linear.json/);
  assert.equal(await fs.readFile(target('layouts/herdr-setup-linear.json'), 'utf8'), '{"local":true}');
  const config = await fs.readFile(target('config/linear-panel.json'), 'utf8');
  assert.ok((await planInstall({ ...options, team: 'DIFFERENT' })).conflicts.includes('config/linear-panel.json'));
  assert.equal(await fs.readFile(target('config/linear-panel.json'), 'utf8'), config);
});

test('layout generation accepts existing tab-bar without mutating the source', () => {
  const input = structuredClone(main);
  input.children[0] = { id: 'tab-bar', type: 'row', size: { px: 42 }, children: [input.children[0]] };
  const before = structuredClone(input);
  assert.equal(makeLayout(input).children[0].children.length, 2);
  assert.deepEqual(input, before);
  assert.throws(() => makeLayout({ id: 'root' }), /Unsupported main layout/);
});

test('CLI rejects unknown options before reading or writing a home', async () => {
  await assert.rejects(cli(['install', 'linear', '--token', 'not-a-key']), /Invalid option/);
  await assert.rejects(cli(['install', 'workspace-browser', '--team', 'ENG']), /Invalid option/);
  await assert.rejects(cli(['plan', 'workspace-browser', '--base-layout', '../main']), /Invalid base layout/);
  await assert.rejects(cli(['plan', 'github', '--token', 'not-a-key']), /Invalid option/);
  await assert.rejects(cli(['plan', 'github', '--teams', 'engineering']), /Invalid option/);
  await assert.rejects(cli(['plan', 'github']), /explicit --base-layout/);
});

test('workspace install composes with Linear, preserves local resources and refuses conflicts before writes', async (t) => {
  const options = await fixture(t);
  const target = (file) => path.join(options.home, file);
  const read = (file) => fs.readFile(target(file), 'utf8');
  const source = path.join(options.root, 'customizations/workspace-browser/mods/workspace-browser');
  await fs.mkdir(path.join(source, 'icons'), { recursive: true });
  for (const file of ['main.js', 'context.js', 'files.js', 'changes.js', 'directories.js', 'directory-search.js', 'folder-observer.js', 'folder-picker.js', 'folder-controls.js', 'mod.json', 'icons/folder.svg', 'LICENSE', 'LICENSE-HERDR', 'NOTICE']) {
    await fs.writeFile(path.join(source, file), file === 'mod.json' ? '{}' : `synthetic ${file}`);
  }
  await fs.writeFile(path.join(source, 'gpui-kit.d.ts'), 'generated, not shipped');
  await fs.writeFile(path.join(source, '.local'), 'synthetic, not shipped');
  const base = structuredClone(main);
  base.floating = [{ id: 'existing-float', content: { mod: 'synthetic-status' }, edge: 'right', align: 'end' }];
  base.children.push({ id: 'files-button', type: 'block', content: { mod: 'files', props: { button: true } } },
    { id: 'changes-button', type: 'block', content: { mod: 'changes', props: { button: true } } });
  await fs.writeFile(target('layouts/main.json'), JSON.stringify(base));
  await fs.mkdir(target('config'));
  await fs.writeFile(target('config/workspace-browser.json'), '{"searchRoots":["~/Synthetic"]}\n');
  await install(options);
  const preserved = Object.fromEntries(await Promise.all(['layouts/main.json', 'layouts/herdr-setup-linear.json', 'config/linear-panel.json', 'config/workspace-browser.json', 'mods/linear-panel/main.js'].map(async (file) => [file, await read(file)])));
  const browser = { ...options, customization: 'workspace-browser', baseLayout: 'herdr-setup-linear' };
  const layoutPath = `layouts/${workspaceLayoutName}.json`;
  const plan = await planInstall(browser);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.entries.some(({ relative }) => relative.startsWith('config/')), false);
  await assert.rejects(fs.access(target('mods/workspace-browser')), { code: 'ENOENT' });
  await assert.rejects(fs.access(target(layoutPath)), { code: 'ENOENT' });

  // A directory symlink must not redirect the copy into another owner's folder.
  const outside = path.join(options.root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, target('mods/workspace-browser'), 'dir');
  await assert.rejects(install(browser), /Refusing conflicts/);
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(fs.access(target(layoutPath)), { code: 'ENOENT' });
  await fs.unlink(target('mods/workspace-browser'));

  await fs.mkdir(target('mods/workspace-browser'));
  await fs.writeFile(target('mods/workspace-browser/main.js'), 'local work');
  await assert.rejects(install(browser), /Refusing conflicts/);
  assert.equal(await read('mods/workspace-browser/main.js'), 'local work');
  await assert.rejects(fs.access(target('mods/workspace-browser/context.js')), { code: 'ENOENT' });
  await fs.unlink(target('mods/workspace-browser/main.js'));

  const result = await install(browser);
  assert.equal(result.layoutName, workspaceLayoutName);
  assert.equal(result.activationCommand, `herdr-app do layout.switch '{"name":"${workspaceLayoutName}"}'`);
  for (const [file, content] of Object.entries(preserved)) assert.equal(await read(file), content);
  assert.equal(await read('mods/workspace-browser/context.js'), 'synthetic context.js');
  assert.equal(await read('mods/workspace-browser/LICENSE'), 'synthetic LICENSE');
  assert.equal(await read('mods/workspace-browser/LICENSE-HERDR'), 'synthetic LICENSE-HERDR');
  assert.equal(await read('mods/workspace-browser/NOTICE'), 'synthetic NOTICE');
  assert.equal(await read('mods/workspace-browser/directory-search.js'), 'synthetic directory-search.js');
  assert.equal(await read('mods/workspace-browser/folder-observer.js'), 'synthetic folder-observer.js');
  for (const file of ['folder-toolbar.js', 'gpui-kit.d.ts', '.local']) await assert.rejects(fs.access(target(`mods/workspace-browser/${file}`)), { code: 'ENOENT' });
  const layout = JSON.parse(await read(layoutPath));
  const find = (node, id) => node.id === id ? node : node.children?.map((child) => find(child, id)).find(Boolean);
  assert.deepEqual(find(layout, 'files').content, { mod: 'workspace-browser', props: { view: 'files' } });
  assert.deepEqual(find(layout, 'changes').content, { mod: 'workspace-browser', props: { view: 'changes' } });
  assert.equal(find(layout, 'workspace-folder-button'), undefined);
  assert.deepEqual(layout.floating, [...base.floating, {
    id: 'workspace-folder-observer', content: { mod: 'workspace-browser', props: { view: 'observer' } },
  }]);
  const expected = JSON.parse(preserved['layouts/herdr-setup-linear.json']);
  for (const view of ['files', 'changes']) find(expected, view).content = { mod: 'workspace-browser', props: { view } };
  expected.floating = layout.floating;
  assert.deepEqual(layout, expected); // No tab-bar wrapper/width/button or other tree changes.
  const plain = makeWorkspaceLayout(main);
  assert.deepEqual(plain.children[0], main.children[0]);
  assert.equal(find(plain, 'tab-bar'), undefined);
  const collision = structuredClone(base);
  collision.floating[0].id = 'workspace-folder-observer';
  await fs.writeFile(target('layouts/collision.json'), JSON.stringify(collision));
  await assert.rejects(install({ ...browser, baseLayout: 'collision' }), /already contains workspace folder IDs/);
  assert.equal(find(layout, 'linear-button').content.mod, 'linear-panel');
  assert.equal(find(layout, 'linear-panel').content.mod, 'linear-panel');
  assert.equal(find(layout, 'panel').hidden, true);
  assert.equal(find(layout, 'panel-body').active, 'files');
  assert.deepEqual((await install(browser)).created, []);

  // Compose the actual GitHub sources on top of both prior customizations.
  // Exercise the same exclusive-copy writer and symlink/conflict preflight, not a fake installer.
  const github = { home: options.home, customization: 'github', baseLayout: workspaceLayoutName,
    root: fileURLToPath(new URL('../', import.meta.url)), organization: 'example-org', ghPath: '/synthetic/bin/gh' };
  const githubPath = `layouts/${githubLayoutName}.json`;
  await fs.writeFile(target('settings.json'), '{"font_size":15,"local":true}\n');
  const browserBefore = await read(layoutPath), settingsBefore = await read('settings.json');
  assert.deepEqual((await planInstall(github)).conflicts, []);
  await assert.rejects(fs.access(target('mods/github-panel')), { code: 'ENOENT' });
  await fs.symlink(outside, target('mods/github-panel'), 'dir');
  await assert.rejects(install(github), /Refusing conflicts/);
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(fs.access(target(githubPath)), { code: 'ENOENT' });
  await fs.unlink(target('mods/github-panel'));
  await fs.mkdir(target('mods/github-panel'));
  await fs.writeFile(target('mods/github-panel/main.js'), 'local GitHub work');
  await assert.rejects(install(github), /Refusing conflicts/);
  await assert.rejects(fs.access(target('mods/github-panel/api.js')), { code: 'ENOENT' });
  await assert.rejects(fs.access(target('config/github-panel.json')), { code: 'ENOENT' });
  await fs.unlink(target('mods/github-panel/main.js'));
  const installedGithub = await install(github);
  assert.equal(installedGithub.layoutName, githubLayoutName);
  assert.deepEqual(JSON.parse(await read('config/github-panel.json')), { organization: 'example-org', ghPath: '/synthetic/bin/gh' });
  for (const file of ['main.js', 'model.js', 'api.js', 'demo.js', 'mod.json', 'icons/pull-request.svg']) {
    assert.equal(await read(`mods/github-panel/${file}`), await fs.readFile(path.join(github.root, 'customizations/github/mods/github-panel', file), 'utf8'));
  }
  const composed = JSON.parse(await read(githubPath));
  const expectedGithub = JSON.parse(browserBefore);
  find(expectedGithub, 'tab-bar').children.push({ id: 'github-button', type: 'block', size: { px: 86 }, content: { mod: 'github-panel', props: { button: true } } });
  find(expectedGithub, 'panel-body').children.push({ id: 'github-panel', type: 'block', content: { mod: 'github-panel' } });
  assert.deepEqual(composed, expectedGithub, 'Only the GitHub button and stack child change; panel state/observer stay untouched');
  assert.equal(await read(layoutPath), browserBefore);
  assert.equal(await read('settings.json'), settingsBefore);
  for (const [file, content] of Object.entries(preserved)) assert.equal(await read(file), content);
  const localGithubConfig = '{"organization":"example-org","ghPath":"/synthetic/bin/gh","demo":true}\n';
  await fs.writeFile(target('config/github-panel.json'), localGithubConfig);
  const unchanged = { home: options.home, customization: 'github', baseLayout: workspaceLayoutName };
  assert.deepEqual((await install(unchanged)).created, []);
  assert.equal(await read('config/github-panel.json'), localGithubConfig);
  for (const explicit of [{ organization: 'different-org' }, { ghPath: '/other/gh' }]) {
    await assert.rejects(install({ ...unchanged, ...explicit }), /config\/github-panel.json/);
  }
  await fs.unlink(target('config/github-panel.json'));
  await assert.rejects(planInstall(unchanged), /Set organization/);
  await fs.symlink(path.join(outside, 'missing-config'), target('config/github-panel.json'));
  await assert.rejects(install(github), /Refusing conflicts/);
  await fs.unlink(target('config/github-panel.json'));
  await fs.writeFile(target('config/github-panel.json'), localGithubConfig);
  const sourceBefore = JSON.parse(browserBefore);
  assert.deepEqual(makeGithubLayout(sourceBefore), composed);
  assert.equal(find(sourceBefore, 'github-button'), undefined, 'Layout generator must not mutate its base');
  assert.throws(() => makeGithubLayout(composed), /already contains GitHub IDs/);
  assert.throws(() => makeGithubLayout({ id: 'root' }), /Unsupported base layout/);
  await fs.writeFile(target(githubPath), '{"local":true}');
  await assert.rejects(install(github), /Refusing conflicts/);
  assert.equal(await read(githubPath), '{"local":true}');

  const custom = JSON.parse(preserved['layouts/herdr-setup-linear.json']);
  find(custom, 'files').content.mod = 'user-files';
  await fs.writeFile(target('layouts/custom.json'), JSON.stringify(custom));
  await assert.rejects(install({ ...browser, baseLayout: 'custom' }), /expected shipped files/);
  await fs.writeFile(target(layoutPath), '{"local":true}');
  await assert.rejects(install(browser), /Refusing conflicts/);
  assert.equal(await read(layoutPath), '{"local":true}');
  for (const [file, content] of Object.entries(preserved)) assert.equal(await read(file), content);
});

function sidebarBase() {
  const work = makeGithubLayout(makeWorkspaceLayout(makeLayout(main)));
  const floating = work.floating;
  delete work.floating;
  work.id = 'work';
  work.terminal_frame = { border: 'synthetic-frame', padding: [3, 7] };
  return {
    id: 'root', type: 'row', background: 'canvas', traffic_lights: [12, 16], custom_root_field: 'preserved',
    floating: [...floating, { id: 'existing-float', content: { mod: 'synthetic-status' }, edge: 'right' }],
    children: [{
      id: 'sidebar', type: 'column', size: { px: 268 }, min: 44, max: 480, background: 'chrome', resizable: false,
      children: [
        { id: 'brand', type: 'block', size: { px: 46 }, window_drag: true, content: { mod: 'workspace-chrome' } },
        { id: 'sidebar-lists', type: 'column', children: ['spaces', 'agents'].map(mod => ({ id: mod, type: 'block', size: { weight: 1 }, min: 90, content: { mod } })) },
        { id: 'sidebar-footer', type: 'block', size: { px: 69 }, content: { mod: 'workspace-chrome', props: { footer: true } } },
      ],
    }, work],
  };
}

test('sidebar composition changes only its shipped subtree, preserves combined panels/floats and refuses unsupported bases', () => {
  const base = sidebarBase(), before = structuredClone(base);
  const result = makeSidebarLayout(base), sidebar = result.children[0];
  assert.deepEqual(base, before, 'Generator must not mutate its selected base');
  const outside = layout => ({ ...layout, children: layout.children.filter(node => node.id !== 'sidebar') });
  assert.deepEqual(outside(result), outside(base), 'GitHub/Linear/FilesChanges, frame, root fields and floats are untouched');
  assert.equal(sidebar.background, 'chrome');
  assert.deepEqual(sidebar.size, { px: 312 });
  assert.equal(sidebar.min, 76); assert.equal(sidebar.max, 480);
  assert.equal(sidebar.ui_font, 'Geist'); assert.equal(sidebar.resizable, false);
  assert.deepEqual(sidebar.children.map(node => node.id), ['brand', 'sidebar-lists', 'sidebar-footer']);
  for (const [index, view, height] of [[0, 'brand', 76], [1, 'body', null], [2, 'footer', 44]]) {
    const node = sidebar.children[index];
    assert.equal(node.type, 'block');
    assert.deepEqual(node.content, { mod: 'sidebar', props: { view } });
    assert.deepEqual(node.size, height ? { px: height } : { weight: 1 });
    assert.equal(node.children, undefined);
  }
  assert.equal(sidebar.children[0].window_drag, true);
  assert.equal(sidebar.children[1].min, 0);
  const reversed = structuredClone(base);
  reversed.children[0].children[1].children.reverse();
  assert.deepEqual(makeSidebarLayout(reversed), result, 'Both shipped list orders are supported');
  assert.throws(() => makeSidebarLayout(result), /merge sidebar manually/);
  for (const customize of [
    layout => { layout.resizable = false; },
    layout => { layout.children[0].children.pop(); },
    layout => { layout.children[0].children[1].children.push({ id: 'extra', type: 'block' }); },
    layout => { layout.children[0].children[1].children[0].content.mod = 'custom-spaces'; },
    layout => { layout.children[0].children[1].children[0].content.props = { custom: true }; },
    layout => { layout.children[0].children[0].content.props = { custom: true }; },
    layout => { layout.floating.push({ id: 'brand', content: { mod: 'synthetic-status' } }); },
    layout => { layout.floating.push({ id: 'other-sidebar', content: { mod: 'sidebar' } }); },
  ]) {
    const unsupported = structuredClone(base); customize(unsupported);
    assert.throws(() => makeSidebarLayout(unsupported), /merge sidebar manually.*No files changed/);
  }
});

test('sidebar install uses an explicit base, copies complete native package without config, preserves local resources and refuses conflicts', async t => {
  const options = await fixture(t);
  const source = path.join(options.root, 'customizations/sidebar/mods/sidebar');
  await fs.cp(fileURLToPath(new URL('../customizations/sidebar/mods/sidebar', import.meta.url)), source, { recursive: true });
  await fs.writeFile(path.join(source, 'gpui-kit.d.ts'), 'generated');
  await fs.writeFile(path.join(source, '.local'), 'not shipped');
  const target = file => path.join(options.home, file);
  const read = file => fs.readFile(target(file), 'utf8');
  const base = sidebarBase();
  await fs.writeFile(target('layouts/combined.json'), JSON.stringify(base));
  const preserved = {
    'layouts/main.json': await read('layouts/main.json'), 'layouts/combined.json': await read('layouts/combined.json'),
    'settings.json': '{"font_size":15}\n', 'keys.json': '[{"key":"cmd-[","command":"agent.prev"}]\n',
    'config/github-panel.json': '{"organization":"synthetic-org"}\n', 'config/linear-panel.json': '{"team":"DEMO"}\n',
    'config/workspace-browser.json': '{"searchRoots":["~/Synthetic"]}\n',
    'mods/agents/main.js': 'shipped agents', 'mods/spaces/main.js': 'shipped spaces', 'mods/workspace-chrome/main.js': 'shipped chrome',
  };
  for (const [file, content] of Object.entries(preserved)) {
    await fs.mkdir(path.dirname(target(file)), { recursive: true }); await fs.writeFile(target(file), content);
  }
  const sidebar = { ...options, customization: 'sidebar', baseLayout: 'combined' };
  const output = `layouts/${sidebarLayoutName}.json`;
  await assert.rejects(planInstall({ ...sidebar, baseLayout: undefined }), /explicit --base-layout/);
  await assert.rejects(planInstall({ ...sidebar, team: 'ENG' }), /does not use team/);
  await assert.rejects(planInstall({ ...sidebar, organization: 'example' }), /GitHub options/);
  const plan = await planInstall(sidebar);
  assert.deepEqual(plan.conflicts, []);
  assert.equal(plan.entries.some(entry => entry.relative.startsWith('config/')), false);
  await assert.rejects(fs.access(target('mods/sidebar')), { code: 'ENOENT' });
  await assert.rejects(fs.access(target(output)), { code: 'ENOENT' });
  const outside = path.join(options.root, 'outside-sidebar'); await fs.mkdir(outside);
  await fs.symlink(outside, target('mods/sidebar'), 'dir');
  await assert.rejects(install(sidebar), /Refusing conflicts/);
  assert.deepEqual(await fs.readdir(outside), []);
  await fs.unlink(target('mods/sidebar'));
  await fs.mkdir(target('mods/sidebar'));
  await fs.symlink(outside, target('mods/sidebar/icons'), 'dir');
  await assert.rejects(install(sidebar), /Refusing conflicts/);
  assert.deepEqual(await fs.readdir(outside), []);
  await assert.rejects(fs.access(target('mods/sidebar/main.js')), { code: 'ENOENT' });
  await fs.unlink(target('mods/sidebar/icons'));
  await fs.writeFile(target('mods/sidebar/main.js'), 'local sidebar work');
  await assert.rejects(install(sidebar), /Refusing conflicts/);
  await assert.rejects(fs.access(target(output)), { code: 'ENOENT' });
  await fs.unlink(target('mods/sidebar/main.js'));
  // Invalid and duplicate structures fail before the exclusive-copy writer.
  const invalid = structuredClone(base); invalid.floating.push({ id: 'brand' });
  await fs.writeFile(target('layouts/invalid.json'), JSON.stringify(invalid));
  await assert.rejects(install({ ...sidebar, baseLayout: 'invalid' }), /merge sidebar manually/);
  await assert.rejects(fs.access(target('mods/sidebar/main.js')), { code: 'ENOENT' });
  const installed = await install(sidebar);
  assert.equal(installed.layoutName, sidebarLayoutName);
  assert.equal(installed.activationCommand, `herdr-app do layout.switch '{"name":"${sidebarLayoutName}"}'`);
  assert.deepEqual(JSON.parse(await read(output)), makeSidebarLayout(base));
  for (const entry of installed.entries.filter(entry => entry.relative.startsWith('mods/sidebar/'))) {
    assert.deepEqual(await fs.readFile(target(entry.relative)), await fs.readFile(path.join(source, entry.relative.slice('mods/sidebar/'.length))));
  }
  for (const file of ['create.js', 'directory-search.js', 'directories.js']) {
    assert.ok(installed.entries.some(entry => entry.relative === `mods/sidebar/${file}`), `${file} is packaged for independent installation`);
  }
  assert.equal(installed.entries.filter(entry => /icons\/.*\.svg$/.test(entry.relative)).length, 15);
  for (const file of ['gpui-kit.d.ts', '.local']) await assert.rejects(fs.access(target(`mods/sidebar/${file}`)), { code: 'ENOENT' });
  for (const [file, content] of Object.entries(preserved)) assert.equal(await read(file), content);
  assert.deepEqual((await install(sidebar)).created, []);
  const log = t.mock.method(console, 'log', () => {});
  assert.equal(await cli(['plan', 'sidebar', '--home', options.home, '--base-layout', 'combined']), 0);
  assert.equal(await cli(['check', 'sidebar', '--home', options.home, '--base-layout', 'combined']), 0);
  await assert.rejects(cli(['plan', 'sidebar', '--home', options.home]), /explicit --base-layout/);
  await assert.rejects(cli(['plan', 'sidebar', '--team', 'ENG']), /Invalid option/);
  await assert.rejects(cli(['plan', 'sidebar', '--base-layout', '../main']), /Invalid base layout/);
  log.mock.restore();
  const changed = structuredClone(base); changed.children[1].hidden = true;
  await fs.writeFile(target('layouts/changed.json'), JSON.stringify(changed));
  await assert.rejects(install({ ...sidebar, baseLayout: 'changed' }), /Refusing conflicts/);
  assert.deepEqual(JSON.parse(await read(output)), makeSidebarLayout(base));
  await fs.writeFile(target(output), '{"local":true}');
  await assert.rejects(install(sidebar), /Refusing conflicts/);
  assert.equal(await read(output), '{"local":true}');
  // A fresh home gets no config directory at all, nor implicit base selection.
  const fresh = path.join(options.home, 'fresh-home');
  await fs.mkdir(path.join(fresh, 'layouts'), { recursive: true });
  await fs.writeFile(path.join(fresh, 'layouts/combined.json'), JSON.stringify(base));
  await install({ ...sidebar, home: fresh });
  await assert.rejects(fs.access(path.join(fresh, 'config')), { code: 'ENOENT' });
});
