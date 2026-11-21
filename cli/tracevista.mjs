#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { root, inputFile, readGraph, runPython, json } from './core.mjs';
import { build, prepare, query, inspect } from './workspace.mjs';
import { install } from './install.mjs';
import { startViewer } from './viewer.mjs';

const help = `TraceVista — install, prepare, build, browse and query agent trajectories

  tracevista install --agent codex|claude|pi [--project DIR | --user]
  tracevista run INPUT [--out DIR] [--images keep|omit] [--manifest]
  tracevista prepare LOG [--out DIR] --images keep|omit [--manifest]
  tracevista build EXPORT.agent-state.json [--out DIR] [--language en|zh]
  tracevista open [WORKSPACE | EXPORT.agent-state.json] [--offline]
  tracevista info [WORKSPACE | EXPORT.agent-state.json]
  tracevista query TEXT [--in WORKSPACE] [--limit 20]
  tracevista inspect ID [--in WORKSPACE]
  tracevista doctor

run: existing export → complete offline workspace; raw log → extracted records
and TASK.md for your agent. Interpretation requires the conversion skill.
query: literal keyword search, not an LLM answer. inspect returns full evidence.
Defaults: tracevista-work (prepare), tracevista-out (build/open/query/inspect).
Existing output/skill directories are never replaced. Use a fresh --out for revisions.
--secret-file FILE can be repeated during extraction; --no-open prints the URL without launching a browser.
open serves the full viewer on loopback until Ctrl+C; --offline opens trace.html.
`;
const optionTypes = { agent: 'string', project: 'string', user: 'boolean', out: 'string', images: 'string', manifest: 'boolean',
  language: 'string', in: 'string', limit: 'string', help: 'boolean', version: 'boolean', 'no-open': 'boolean', offline: 'boolean', 'secret-file': 'string' };
const allowed = {
  install: ['agent', 'project', 'user'], prepare: ['out', 'images', 'manifest', 'secret-file'],
  run: ['out', 'images', 'manifest', 'secret-file', 'language'], build: ['out', 'language'],
  open: ['no-open', 'offline'], info: [], query: ['in', 'limit'], inspect: ['in'], doctor: [],
};
async function main() {
  const { values: options, positionals } = parseArgs({ allowPositionals: true,
    options: Object.fromEntries(Object.entries(optionTypes).map(([key, type]) => [key, { type, ...(key === 'secret-file' ? { multiple: true } : {}) }])) });
  if (options.help || !positionals.length && !options.version) { console.log(help); return; }
  if (options.version) { console.log(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version); return; }
  let [command, argument] = positionals;
  if (!Object.hasOwn(allowed, command)) throw new Error(`Unknown command: ${command}. Run tracevista --help.`);
  for (const key of Object.keys(options)) if (!allowed[command].includes(key)) throw new Error(`--${key} is not supported by ${command}.`);
  if (positionals.length > 2 || ['install', 'doctor'].includes(command) && argument) throw new Error('Unexpected arguments. Run tracevista --help.');
  if (['prepare', 'run', 'build', 'query', 'inspect'].includes(command) && !argument) throw new Error(`${command} requires an input.`);
  if (options.language && !['en', 'zh'].includes(options.language)) throw new Error('Choose --language en or zh.');
  if (command === 'run') {
    const file = await inputFile(argument, ['.agent-state.json', '.json', '.jsonl', '.ndjson']);
    let isGraph = false;
    if (extname(file) === '.json' && !options.manifest) {
      try { const value = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, '')); isGraph = ['coding-agent-state-trajectory', 'thoughtdag-state-trajectory'].includes(value.format); }
      catch { /* The extractor will report malformed raw data. */ }
    }
    argument = file;
    command = isGraph ? 'build' : 'prepare';
    for (const key of Object.keys(options)) if (!allowed[command].includes(key)) throw new Error(`Input requires ${command}; --${key} does not apply.`);
  }
  let result;
  if (command === 'install') result = await install(options);
  if (command === 'prepare') result = await prepare(argument, options);
  if (command === 'build') result = await build(argument, options);
  if (command === 'info') {
    const { graph, counts, quality } = await readGraph(argument || 'tracevista-out');
    result = { title: graph.title, scope: graph.scope, counts, quality };
  }
  if (command === 'query') {
    const limit = Number(options.limit ?? 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be an integer between 1 and 1000.');
    result = await query(options.in || 'tracevista-out', argument, limit);
  }
  if (command === 'inspect') result = await inspect(options.in || 'tracevista-out', argument);
  if (command === 'doctor') {
    const python = runPython(['-c', 'import sys; assert sys.version_info >= (3,10), "Python 3.10+ is required"; print(sys.version.split()[0])']);
    await access(join(root, 'dist/tracevista-export.html'));
    result = { node: process.version, python, viewer: 'ready', root };
  }
  if (command === 'open') {
    let target = resolve(argument || 'tracevista-out');
    let url, running;
    if (options.offline || target.endsWith('.html')) {
      if (!target.endsWith('.html')) target = join(target, 'trace.html');
      await access(target); url = pathToFileURL(target).href;
    } else {
      running = await startViewer(target); url = running.url;
      console.error('Full local viewer is running. Keep this terminal open; Ctrl+C stops it.');
    }
    if (!options['no-open']) {
      const [program, args] = process.platform === 'darwin' ? ['open', [url]]
        : process.platform === 'win32' ? ['explorer.exe', [url]] : ['xdg-open', [url]];
      try { await new Promise((done, reject) => {
        const child = spawn(program, args, { stdio: 'ignore', shell: false });
        child.on('error', reject); child.on('exit', code => code === 0 ? done() : reject(new Error(`Browser launcher failed; open ${url} manually.`)));
      }); } catch (error) { running?.server.close(); throw error; }
    }
    result = { url, mode: running ? 'local-full-viewer' : 'offline-reading' };
  }
  console.log(json(result));
}
main().catch(error => { console.error(`TraceVista: ${error.message}`); process.exitCode = 1; });
