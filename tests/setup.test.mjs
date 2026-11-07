import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, planInstall, makeLayout, cli } from '../scripts/setup.mjs';

const main = {
  id: 'root', type: 'column', background: 'canvas', children: [
    { id: 'tabs', type: 'block', size: { px: 42 }, content: { mod: 'tabs' } },
    { id: 'panel', type: 'column', hidden: true, children: [
      { id: 'panel-body', type: 'stack', active: 'files', children: [
        { id: 'files', type: 'block', content: { mod: 'files' } },
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
});
