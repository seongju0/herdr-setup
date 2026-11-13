import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { validateConfig } from '../customizations/linear/mods/linear-panel/model.js';
import { validateConfig as validateGithubConfig } from '../customizations/github/mods/github-panel/model.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const layoutName = 'herdr-setup-linear';
export const activationCommand = `herdr-app do layout.switch '{"name":"${layoutName}"}'`;
export const workspaceLayoutName = 'herdr-setup-workspace-browser';
export const githubLayoutName = 'herdr-setup-github';
export const sidebarLayoutName = 'herdr-setup-sidebar';
const activationFor = (name) => `herdr-app do layout.switch '${JSON.stringify({ name })}'`;
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function layoutNodes(layout) {
  const nodes = [];
  function walk(node, parent) {
    nodes.push({ node, parent });
    for (const child of [...(node.children ?? []), ...(node.floating ?? [])]) walk(child, node);
  }
  walk(layout);
  return (id) => nodes.find(({ node }) => node.id === id);
}

function addTabButton(tabs, find, button) {
  if (tabs.parent.id === 'tab-bar' && tabs.parent.type === 'row') {
    tabs.parent.children.push(button);
  } else {
    if (find('tab-bar')) throw new Error('Unsupported existing tab-bar; merge the layout manually.');
    const index = tabs.parent.children.indexOf(tabs.node);
    const size = tabs.node.size;
    tabs.node.size = { weight: 1 };
    tabs.parent.children[index] = { id: 'tab-bar', type: 'row', ...(size ? { size } : {}), resizable: false, children: [tabs.node, button] };
  }
}

export function makeLayout(main) {
  const layout = structuredClone(main);
  const find = layoutNodes(layout);
  const tabs = find('tabs');
  const body = find('panel-body')?.node;
  if (!tabs?.parent || tabs.node.type !== 'block' || body?.type !== 'stack' || !find('panel')) {
    throw new Error('Unsupported main layout: expected tabs block, panel and panel-body stack. No files changed.');
  }
  if (find('linear-panel') || find('linear-button')) throw new Error('Main layout already contains Linear IDs.');
  const button = { id: 'linear-button', type: 'block', size: { px: 86 }, content: { mod: 'linear-panel', props: { button: true } } };
  addTabButton(tabs, find, button);
  body.children.push({ id: 'linear-panel', type: 'block', content: { mod: 'linear-panel' } });
  return layout;
}

export function makeWorkspaceLayout(base) {
  const layout = structuredClone(base);
  const find = layoutNodes(layout);
  const tabs = find('tabs');
  const body = find('panel-body')?.node;
  if (!tabs?.parent || tabs.node.type !== 'block' || body?.type !== 'stack' || !find('panel')) {
    throw new Error('Unsupported base layout: expected tabs block, panel and panel-body stack. No files changed.');
  }
  if (find('workspace-folder-button') || find('workspace-folder-observer')) {
    throw new Error('Base layout already contains workspace folder IDs; merge the layout manually. No files changed.');
  }
  if (tabs.node.content?.mod !== 'tabs') {
    throw new Error('Unsupported base layout: expected shipped tabs content; merge custom tabs manually. No files changed.');
  }
  for (const view of ['files', 'changes']) {
    const panel = body.children?.find((node) => node.id === view);
    if (panel?.type !== 'block' || panel.content?.mod !== view) {
      throw new Error(`Unsupported base layout: expected shipped ${view} block in panel-body; merge custom content manually. No files changed.`);
    }
    panel.content = { ...panel.content, mod: 'workspace-browser', props: { ...panel.content.props, view } };
  }
  tabs.node.content = { ...tabs.node.content, mod: 'workspace-browser', props: { ...tabs.node.content.props, view: 'tabs' } };
  body.children = body.children.filter(node => node.id !== 'changes');
  if (body.active === 'changes') body.active = 'files';
  layout.floating = [...(layout.floating ?? []), {
    id: 'workspace-folder-observer', content: { mod: 'workspace-browser', props: { view: 'observer' } },
  }];
  return layout;
}

export function makeGithubLayout(base) {
  const layout = structuredClone(base);
  const find = layoutNodes(layout);
  const tabs = find('tabs');
  const panel = find('panel')?.node;
  const body = find('panel-body');
  if (tabs?.node.type !== 'block' || !tabs.parent?.children?.includes(tabs.node)
    || panel?.type !== 'column' || body?.parent !== panel || body.node.type !== 'stack' || !Array.isArray(body.node.children)) {
    throw new Error('Unsupported base layout: expected tabs block, panel column and panel-body stack. No files changed.');
  }
  if (find('github-panel') || find('github-button')) throw new Error('Base layout already contains GitHub IDs. No files changed.');
  addTabButton(tabs, find, { id: 'github-button', type: 'block', size: { px: 86 }, content: { mod: 'github-panel', props: { button: true } } });
  body.node.children.push({ id: 'github-panel', type: 'block', content: { mod: 'github-panel' } });
  return layout;
}

export function makeSidebarLayout(base) {
  const layout = structuredClone(base);
  const fail = () => { throw new Error('Unsupported base layout: expected the shipped sidebar with unique IDs; merge sidebar manually. No files changed.'); };
  const nodes = new Map();
  function walk(node, parent) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) fail();
    if (node.id !== undefined) {
      if (typeof node.id !== 'string' || nodes.has(node.id)) fail();
      nodes.set(node.id, { node, parent });
    }
    if (node.content?.mod === 'sidebar') fail();
    for (const key of ['children', 'floating']) {
      if (node[key] !== undefined && !Array.isArray(node[key])) fail();
      for (const child of node[key] ?? []) walk(child, node);
    }
  }
  walk(layout);
  const entry = nodes.get('sidebar'), sidebar = entry?.node;
  if (sidebar?.type !== 'column' || entry.parent?.type !== 'row' || entry.parent.resizable === false
    || !entry.parent.children?.includes(sidebar) || sidebar.children?.length !== 3 || sidebar.floating?.length) fail();
  const [brand, lists, footer] = sidebar.children;
  const only = (object, keys) => Object.keys(object).every(key => keys.includes(key));
  const stock = (node, mod, footer = false) => node?.type === 'block'
    && !node.children?.length && !node.floating?.length && node.content?.mod === mod
    && only(node.content, ['mod', 'props'])
    && only(node.content.props ?? {}, footer ? ['footer'] : [])
    && (!footer || node.content.props?.footer === true);
  if (brand.id !== 'brand' || !stock(brand, 'workspace-chrome') || brand.window_drag !== true
    || lists.id !== 'sidebar-lists' || lists.type !== 'column' || lists.children?.length !== 2
    || !only(lists, ['id', 'type', 'children', 'size', 'min'])
    || footer.id !== 'sidebar-footer' || !stock(footer, 'workspace-chrome', true)) fail();
  for (const mod of ['agents', 'spaces']) {
    const child = lists.children.find(child => child.id === mod);
    if (!stock(child, mod) || !only(child, ['id', 'type', 'size', 'min', 'content'])) fail();
  }
  Object.assign(sidebar, { size: { px: 312 }, min: 76, max: 480, ui_font: 'Geist', resizable: false });
  brand.size = { px: 76 };
  brand.content = { mod: 'sidebar', props: { view: 'brand' } };
  lists.type = 'block';
  lists.content = { mod: 'sidebar', props: { view: 'body' } };
  lists.size = { weight: 1 };
  lists.min = 0;
  delete lists.children;
  footer.size = { px: 44 };
  footer.content = { mod: 'sidebar', props: { view: 'footer' } };
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
export async function planInstall({ home = process.env.HERDR_APP_HOME || path.join(os.homedir(), '.config/herdr-app'), team, workspace, organization, ghPath, root = projectRoot, customization = 'linear', baseLayout } = {}) {
  if (!['linear', 'workspace-browser', 'github', 'sidebar'].includes(customization)) throw new Error(`Unknown customization: ${customization}`);
  const browser = customization === 'workspace-browser', github = customization === 'github', sidebar = customization === 'sidebar';
  if ((github || sidebar) && baseLayout === undefined) throw new Error(`${github ? 'GitHub' : 'Sidebar'} requires an explicit --base-layout NAME.`);
  if (baseLayout === undefined) baseLayout = 'main';
  if (typeof baseLayout !== 'string' || !baseLayout.trim() || /[/\\\0]/.test(baseLayout) || ['.', '..'].includes(baseLayout)) {
    throw new Error('Invalid base layout: use a layout name, not a path.');
  }
  if (!browser && !github && !sidebar && baseLayout !== 'main') throw new Error('--base-layout is only supported for workspace-browser, github or sidebar.');
  if ((browser || github || sidebar) && (team !== undefined || workspace !== undefined)) throw new Error(`${customization} does not use team or workspace options.`);
  if (!github && [organization, ghPath].some(value => value !== undefined)) throw new Error('GitHub options require the github customization.');
  home = path.resolve(home);
  const mod = browser ? 'workspace-browser' : github ? 'github-panel' : sidebar ? 'sidebar' : 'linear-panel';
  const targetLayoutName = browser ? workspaceLayoutName : github ? githubLayoutName : sidebar ? sidebarLayoutName : layoutName;
  const source = path.join(root, 'customizations', customization, 'mods', mod);
  const files = await sourceFiles(source);
  const requiredFiles = browser
    ? ['main.js', 'browser.js', 'tabs.js', 'context.js', 'files.js', 'file-search.js', 'changes.js', 'directories.js', 'directory-search.js', 'folder-observer.js', 'folder-picker.js', 'folder-controls.js', 'mod.json', 'LICENSE', 'LICENSE-HERDR', 'NOTICE']
    : sidebar
      ? ['main.js', 'body.js', 'ui.js', 'chrome.js', 'agents.js', 'spaces.js', 'create.js', 'context-menu.js', 'directory-search.js', 'directories.js', 'mod.json', 'LICENSE', 'LICENSE-HERDR', 'LICENSE-ICONS-LUCIDE.txt', 'NOTICE',
        ...['search', 'sidebar', 'settings', 'plus', 'branch', 'spinner', 'check', 'pin', 'pin-off', 'clock', 'layers', 'chevron-right', 'chevron-down', 'monitor', 'server'].map(name => `icons/${name}.svg`)]
      : ['main.js', 'api.js', 'model.js', 'mod.json'];
  for (const required of requiredFiles) {
    if (!files.includes(required)) throw new Error(`Missing source file: ${required}`);
  }
  const base = JSON.parse(await fs.readFile(path.join(home, 'layouts', `${baseLayout}.json`), 'utf8'));
  const generated = json(browser ? makeWorkspaceLayout(base) : github ? makeGithubLayout(base) : sidebar ? makeSidebarLayout(base) : makeLayout(base));
  const entries = [];
  const conflicts = [];
  // Refuse directory symlinks as well as conflicting files; never follow them to write elsewhere.
  const directories = ['mods', `mods/${mod}`, 'layouts', ...(!browser && !sidebar ? ['config'] : [])];
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
    let parent = path.dirname(path.join('mods', mod, file));
    while (parent !== path.join('mods', mod)) {
      const stat = await existing(path.join(home, parent));
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) conflicts.push(parent);
      parent = path.dirname(parent);
    }
    await add(path.join('mods', mod, file), await fs.readFile(path.join(source, file)));
  }
  await add(`layouts/${targetLayoutName}.json`, Buffer.from(generated));
  const plan = () => ({ home, entries, conflicts: [...new Set(conflicts)], layoutName: targetLayoutName, activationCommand: activationFor(targetLayoutName) });
  if (browser || sidebar) return plan();
  if (github) {
    const relative = 'config/github-panel.json';
    const stat = await existing(path.join(home, relative));
    if (stat) {
      let valid = false;
      if (stat.isFile() && !stat.isSymbolicLink()) {
        try {
          const config = validateGithubConfig(JSON.parse(await fs.readFile(path.join(home, relative), 'utf8')));
          const requested = validateGithubConfig({
            organization: organization === undefined ? config.organization : organization,
            ghPath: ghPath === undefined ? config.ghPath : ghPath, demo: config.demo,
          });
          valid = config.organization === requested.organization && config.ghPath === requested.ghPath;
        } catch { /* Never expose local config contents. */ }
      }
      entries.push({ relative, status: valid ? 'preserved' : 'conflict' });
      if (!valid) conflicts.push(relative);
    } else {
      const config = validateGithubConfig({ organization, ...(ghPath === undefined ? {} : { ghPath }) });
      await add(relative, Buffer.from(json({ organization: config.organization, ghPath: config.ghPath })));
    }
    return plan();
  }
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
  return plan();
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
  if (!['plan', 'install', 'check'].includes(command) || !['linear', 'workspace-browser', 'github', 'sidebar'].includes(customization)) {
    throw new Error('Usage: node scripts/setup.mjs <plan|install|check> <linear|workspace-browser|github|sidebar> [--home PATH] [--yes]; linear: [--team ENG] [--workspace example-workspace]; workspace-browser/github/sidebar: [--base-layout NAME]; github: --organization ORG [--gh-path /absolute/gh]');
  }
  const options = { customization };
  const flagsFor = customization === 'linear'
    ? { '--home': 'home', '--team': 'team', '--workspace': 'workspace' }
    : customization === 'github'
      ? { '--home': 'home', '--base-layout': 'baseLayout', '--organization': 'organization', '--gh-path': 'ghPath' }
      : { '--home': 'home', '--base-layout': 'baseLayout' };
  let yes = false;
  for (let index = 0; index < flags.length; index++) {
    const flag = flags[index];
    if (flag === '--yes') { yes = true; continue; }
    if (!Object.hasOwn(flagsFor, flag) || !flags[index + 1] || flags[index + 1].startsWith('--')) throw new Error(`Invalid option: ${flag}`);
    options[flagsFor[flag]] = flags[++index];
  }
  const plan = await planInstall(options);
  console.log(`Target: ${plan.home}`);
  console.log(customization === 'linear'
    ? 'Access: local config and Keychain via security; read-only api.linear.app requests; Linear links via open. No credentials copied by setup.'
    : customization === 'github'
      ? 'Access: local GitHub config; existing gh authentication and read-only github.com GraphQL queries via exec; validated PR links via open. Setup copies files only; no credentials copied.'
      : customization === 'sidebar'
        ? 'Access: native agent/workspace state; read-only Git, local watchers and machine inventory; shared workspace-browser searchRoots config, bounded directory search/listing and installed-launcher checks; explicit space/program creation, selection/pins and worktree-order correction; reconnect only on explicit action. No transcript scanners or config writes. Setup copies files only.'
        : 'Access: folder listings/previews and Git status/diffs; explicit Commit stages and commits all repository changes. Setup copies files only.');
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
  console.log(`Activate separately: ${result.activationCommand}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
