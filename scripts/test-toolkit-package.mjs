import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtemp, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { packageToolkit } from './package-toolkit.mjs';
import { pythonExecutable } from '../cli/core.mjs';
import { parseSinglePackResult } from './npm-pack-result.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = await mkdtemp(join(tmpdir(), 'tracevista-package-'));
const npm = process.env.TRACEVISTA_NPM_CLI ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(command, args, cwd = temp) {
  if (command === npm && process.env.TRACEVISTA_NPM_CLI && ['pack', 'install'].includes(args[0])) args = [process.env.TRACEVISTA_NPM_CLI, ...args];
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
  return result.stdout;
}
try {
  const output = await packageToolkit(join(temp, 'package'));
  const pkg = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts, undefined);
  assert.equal(pkg.private, true);
  await assert.rejects(() => packageToolkit(output), { code: 'EEXIST' });
  const packed = parseSinglePackResult(run(npm, ['pack', '--json', '--ignore-scripts', '--cache', join(temp, 'cache')], output), pkg.name);
  for (const entry of packed.files) {
    assert.ok(!/(^|\/)(node_modules|tests|\.git|\.env|local-data|examples|auth\.json|credentials\.json)(\/|$)/.test(entry.path), entry.path);
    assert.ok(!entry.path.endsWith('.agent-state.json'), entry.path);
  }
  run(npm, ['install', '--global', '--prefix', join(temp, 'prefix'), '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--cache', join(temp, 'cache'), join(output, packed.filename)]);
  const installed = process.platform === 'win32' ? join(temp, 'prefix/node_modules/tracevista-toolkit') : join(temp, 'prefix/lib/node_modules/tracevista-toolkit');
  assert.equal((await lstat(installed)).isSymbolicLink(), false, 'The documented tarball install must be independent of the package directory.');
  // Remove both source package and tarball before running any installed commands.
  await rm(output, { recursive: true });
  const binary = join(installed, 'cli/tracevista.mjs');
  const doctor = JSON.parse(run(process.execPath, [binary, 'doctor']));
  assert.equal(doctor.viewer, 'ready');
  const fixture = run(pythonExecutable(), ['-c', 'import sys,json;sys.path.insert(0,sys.argv[1]);from test_view import graph_fixture;print(json.dumps(graph_fixture()))', join(root, 'skills/tracevista-skill/tests')]);
  const input = join(temp, 'fixture.agent-state.json');
  await writeFile(input, fixture);
  const result = JSON.parse(run(process.execPath, [binary, 'build', input, '--out', join(temp, 'workspace')]));
  assert.equal(result.status, 'ready');
  assert.equal(await readFile(join(result.directory, 'trace.agent-state.json'), 'utf8'), fixture);
  const inspected = JSON.parse(run(process.execPath, [binary, 'inspect', 'a', '--in', result.directory]));
  assert.deepEqual(inspected.evidence.map(event => event.id), ['E1', 'E2']);
  const { startViewer, DEFAULT_VIEWER_PORT } = await import(pathToFileURL(join(installed, 'cli/viewer.mjs')));
  assert.equal(DEFAULT_VIEWER_PORT, 8877);
  const { server, url } = await startViewer(result.directory, { port: 0 });
  const port = Number(new URL(url).port);
  try {
    const handoff = await fetch(url);
    assert.equal(handoff.status, 200);
    const page = await handoff.text();
    assert.match(page, /tracevista:import/);
    const data = page.match(/<script id="trace-data" type="application\/octet-stream">(.*?)<\/script>/s)[1];
    assert.equal(Buffer.from(data, 'base64').toString('utf8'), fixture);
    const origin = new URL(url).origin;
    assert.equal((await fetch(origin + '/viewer/')).status, 200);
    assert.equal((await fetch(url + 'trace.json')).status, 200);
    assert.equal((await fetch(origin + '/trace.json')).status, 404);
    assert.equal((await fetch(origin + '/package.json')).status, 404);
    assert.equal((await fetch(origin + '/viewer/../../package.json')).status, 404);
    const wrongHost = await new Promise((done, reject) => {
      const req = request(url, { headers: { Host: 'untrusted.example' } }, res => { res.resume(); done(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 403);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    await assert.rejects(() => startViewer(result.directory, { port }), /already in use/);
  } finally { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  const reopened = await startViewer(result.directory, { port });
  try {
    assert.equal(new URL(reopened.url).origin, new URL(url).origin, 'Restart must retain the browser storage origin.');
    assert.notEqual(new URL(reopened.url).pathname, new URL(url).pathname, 'Keep per-launch trace routes unguessable.');
    assert.equal((await fetch(url)).status, 404, 'The previous private route must expire.');
    assert.equal((await fetch(reopened.url)).status, 200);
  } finally { reopened.server.closeAllConnections(); await new Promise(done => reopened.server.close(done)); }
  const installedSkill = JSON.parse(run(process.execPath, [binary, 'install', '--agent', 'codex', '--project', join(temp, 'project')]));
  assert.match(await readFile(join(installedSkill.directory, 'SKILL.md'), 'utf8'), /name: tracevista/);
  console.log(`PASS: source-independent tarball install, doctor, build, viewer restart/origin, port conflict, evidence lookup and skill installation (${packed.files.length} files, ${packed.size} bytes compressed)`);
} finally { await rm(temp, { recursive: true, force: true }); }
