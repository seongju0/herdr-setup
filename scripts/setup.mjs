import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { validateConfig } from '../customizations/linear/mods/linear-panel/model.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const layoutName = 'herdr-setup-linear';
export const activationCommand = `herdr-app do layout.switch '{"name":"${layoutName}"}'`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function makeLayout(main) {
  const layout = structuredClone(main);
  const nodes = [];
  function walk(node, parent) {
    nodes.push({ node, parent });
    for (const child of node.children ?? []) walk(child, node);
  }
  walk(layout);
  const find = (id) => nodes.find(({ node }) => node.id === id);
  const tabs = find('tabs');
  const body = find('panel-body')?.node;
  if (!tabs?.parent || tabs.node.type !== 'block' || body?.type !== 'stack' || !find('panel')) {
    throw new Error('Unsupported main layout: expected tabs block, panel and panel-body stack. No files changed.');
  }
  if (find('linear-panel') || find('linear-button')) throw new Error('Main layout already contains Linear IDs.');
  const button = { id: 'linear-button', type: 'block', size: { px: 86 }, content: { mod: 'linear-panel', props: { button: true } } };
  if (tabs.parent.id === 'tab-bar' && tabs.parent.type === 'row') {
    tabs.parent.children.push(button);
  } else {
    if (find('tab-bar')) throw new Error('Unsupported existing tab-bar; merge the layout manually.');
    const index = tabs.parent.children.indexOf(tabs.node);
    const size = tabs.node.size;
    tabs.node.size = { weight: 1 };
    tabs.parent.children[index] = { id: 'tab-bar', type: 'row', ...(size ? { size } : {}), resizable: false, children: [tabs.node, button] };
  }
  body.children.push({ id: 'linear-panel', type: 'block', content: { mod: 'linear-panel' } });
  return layout;
}

async function existing(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

async function sourceFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || ['node_modules', 'jsconfig.json', 'gpui-kit.d.ts', 'herdr.d.ts'].includes(entry.name)) continue;
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
    else throw new Error(`Unsupported source entry: ${relative}`);
  }
  return result.sort();
}

// Read-only preflight. Existing local config is preserved unless explicit options disagree.
export async function planInstall({ home = process.env.HERDR_APP_HOME || path.join(os.homedir(), '.config/herdr-app'), team, workspace, root = projectRoot } = {}) {
  home = path.resolve(home);
  const source = path.join(root, 'customizations/linear/mods/linear-panel');
  const files = await sourceFiles(source);
  for (const required of ['main.js', 'api.js', 'model.js', 'mod.json']) {
    if (!files.includes(required)) throw new Error(`Missing source file: ${required}`);
  }
  const main = JSON.parse(await fs.readFile(path.join(home, 'layouts/main.json'), 'utf8'));
  const generated = json(makeLayout(main));
  const entries = [];
  const conflicts = [];
  // Refuse directory symlinks as well as conflicting files; never follow them to write elsewhere.
  const directories = ['mods', 'mods/linear-panel', 'layouts', 'config'];
  for (const relative of directories) {
    const stat = await existing(path.join(home, relative));
    if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) conflicts.push(relative);
  }
  async function add(relative, content) {
    const target = path.join(home, relative);
    const stat = await existing(target);
    let status = 'create';
    if (stat) status = stat.isFile() && !stat.isSymbolicLink() && (await fs.readFile(target)).equals(content) ? 'unchanged' : 'conflict';
    if (status === 'conflict') conflicts.push(relative);
    entries.push({ relative, content, status });
  }
  for (const file of files) {
    // Nested icon directories get the same preflight protection.
    let parent = path.dirname(path.join('mods/linear-panel', file));
    while (parent !== 'mods/linear-panel') {
      const stat = await existing(path.join(home, parent));
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) conflicts.push(parent);
      parent = path.dirname(parent);
    }
    await add(path.join('mods/linear-panel', file), await fs.readFile(path.join(source, file)));
  }
  await add(`layouts/${layoutName}.json`, Buffer.from(generated));
  const configPath = path.join(home, 'config/linear-panel.json');
  const configStat = await existing(configPath);
  if (configStat?.isFile() && !configStat.isSymbolicLink()) {
    let valid = false;
    try {
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      validateConfig(config);
      valid = (team === undefined || team.toUpperCase() === config.team.toUpperCase()) && (workspace === undefined || workspace === config.workspace)
        && Object.keys(config).every((key) => ['team', 'workspace', 'demo'].includes(key));
    } catch { /* Invalid config is a conflict; never print its contents. */ }
    entries.push({ relative: 'config/linear-panel.json', status: valid ? 'preserved' : 'conflict' });
    if (!valid) conflicts.push('config/linear-panel.json');
  } else {
    const config = validateConfig({ team: team ?? 'ENG', workspace: workspace ?? 'example-workspace' });
    await add('config/linear-panel.json', Buffer.from(json({ team: config.team, workspace: config.workspace })));
  }
  return { home, entries, conflicts: [...new Set(conflicts)] };
}

export async function install(options = {}) {
  // Always preflight again at the write boundary; callers cannot pass a stale approved plan.
  const plan = await planInstall(options);
  if (plan.conflicts.length) throw new Error(`Refusing conflicts: ${plan.conflicts.join(', ')}. No files changed.`);
  const created = [];
  let attempted;
  try {
    for (const entry of plan.entries.filter((entry) => entry.status === 'create')) {
      attempted = entry.relative;
      const target = path.join(plan.home, entry.relative);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.content, { flag: 'wx' });
      created.push(entry.relative);
    }
  } catch (error) {
    throw new Error(`Install stopped (${error.code ?? 'write failure'}). Files created: ${created.join(', ') || 'none'}. Last attempted: ${attempted}; that file may be partial and parent directories may also have been created. Inspect before retrying.`, { cause: error });
  }
  return { ...plan, created };
}

export async function cli(args = process.argv.slice(2)) {
  const [command, customization, ...flags] = args;
  if (!['plan', 'install', 'check'].includes(command) || customization !== 'linear') throw new Error('Usage: node scripts/setup.mjs <plan|install|check> linear [--home PATH] [--team ENG] [--workspace example-workspace] [--yes]');
  const options = {};
  let yes = false;
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--yes') { yes = true; continue; }
    if (!['--home', '--team', '--workspace'].includes(flag) || !flags[index + 1] || flags[index + 1].startsWith('--')) throw new Error(`Invalid option: ${flag}`);
    options[flag.slice(2)] = flags[++index];
  }
  const plan = await planInstall(options);
  console.log(`Target: ${plan.home}`);
  console.log('Access: local config and Keychain via security; read-only api.linear.app requests; Linear links via open. No credentials copied by setup.');
  for (const { relative, status } of plan.entries) console.log(`${status}: ${relative}`);
  for (const conflict of plan.conflicts) console.log(`conflict: ${conflict}`);
  if (plan.conflicts.length) return 1;
  if (command === 'check') return plan.entries.some(({ status }) => status === 'create') ? 1 : 0;
  if (command === 'plan') return 0;
  if (!yes && plan.entries.some(({ status }) => status === 'create')) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Install requires interactive approval or explicit --yes. No files changed.');
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    try { if ((await prompt.question('Copy these files? [y/N] ')).trim().toLowerCase() !== 'y') return 1; }
    finally { prompt.close(); }
  }
  const result = await install(options);
  console.log(`Created ${result.created.length} files. Active layout unchanged.`);
  console.log(`Activate separately: ${activationCommand}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
