import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, planInstall, makeLayout, makeWorkspaceLayout, cli, workspaceLayoutName } from '../scripts/setup.mjs';

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

  const custom = JSON.parse(preserved['layouts/herdr-setup-linear.json']);
  find(custom, 'files').content.mod = 'user-files';
  await fs.writeFile(target('layouts/custom.json'), JSON.stringify(custom));
  await assert.rejects(install({ ...browser, baseLayout: 'custom' }), /expected shipped files/);
  await fs.writeFile(target(layoutPath), '{"local":true}');
  await assert.rejects(install(browser), /Refusing conflicts/);
  assert.equal(await read(layoutPath), '{"local":true}');
  for (const [file, content] of Object.entries(preserved)) assert.equal(await read(file), content);
});
