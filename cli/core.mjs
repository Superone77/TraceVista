import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const skill = join(root, 'skills/tracevista-skill');
let selectedPython;
export function pythonExecutable() {
  if (selectedPython) return selectedPython;
  const candidates = process.env.TRACEVISTA_PYTHON ? [process.env.TRACEVISTA_PYTHON]
    : ['python3', 'python', 'python3.14', 'python3.13', 'python3.12', 'python3.11', 'python3.10'];
  for (const candidate of candidates) {
    const check = spawnSync(candidate, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)'], { stdio: 'ignore' });
    if (!check.error && check.status === 0) return selectedPython = candidate;
  }
  throw new Error('Python 3.10+ is required. Set TRACEVISTA_PYTHON to its executable.');
}
export function runPython(args, input) {
  const result = spawnSync(pythonExecutable(), args, { input, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.error?.code === 'ENOENT') throw new Error('Python 3.10+ is required. Set TRACEVISTA_PYTHON to its executable.');
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Python command failed.').trim());
  return result.stdout.trim();
}
export async function freshDirectory(path, action) {
  const folder = resolve(path);
  await mkdir(dirname(folder), { recursive: true, mode: 0o700 });
  try { await mkdir(folder, { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Destination already exists: ${folder}. Choose a new --out directory; existing work is preserved.`);
    throw error;
  }
  try { return await action(folder); }
  catch (error) { await rm(folder, { recursive: true, force: true }); throw error; }
}
export const writePrivate = (path, content) => writeFile(path, content, { flag: 'wx', mode: 0o600 });
export const json = value => JSON.stringify(value, null, 2) + '\n';
export async function inputFile(input, extensions = ['.agent-state.json']) {
  const path = resolve(input);
  if (!(await stat(path)).isDirectory()) return path;
  const entries = (await readdir(path, { withFileTypes: true }))
    .filter(e => e.isFile() && extensions.some(ext => e.name.endsWith(ext)));
  if (entries.length !== 1) throw new Error(`Expected one matching file in ${path}; found ${entries.length}. Select a file explicitly (or use --manifest for multiple sessions).`);
  return join(path, entries[0].name);
}
export async function readGraph(input) {
  const file = await inputFile(input);
  // Use the existing validator, including reference and original-record coverage checks.
  const validation = JSON.parse(runPython([join(root, 'cli/validate.py'), file]));
  const raw = await readFile(file);
  if (createHash('sha256').update(raw).digest('hex') !== validation.sha256) throw new Error('Input changed during validation; retry after the writer finishes.');
  return { file, raw, graph: JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')), ...validation };
}
export const entities = graph => [
  ...graph.states.map(value => ({ level: 'state', value })),
  ...graph.branches.map(value => ({ level: 'phase', value })),
  ...graph.actions.map(value => ({ level: 'action', value })),
  ...graph.timeline.timeline.map(value => ({ level: 'record', value })),
];
