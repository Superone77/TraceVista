import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, stat, rm, symlink } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createExportTemplate } from '../../viewer/src/trajectory/html-export.ts';
import { parseSinglePackResult } from '../../scripts/npm-pack-result.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let temp, runtime, source, graph;
function cli(...args) {
  return spawnSync(process.execPath, [join(runtime, 'cli/tracevista.mjs'), ...args], {
    cwd: temp, encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}
function ok(...args) {
  const result = cli(...args);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'tracevista cli '));
  runtime = join(temp, 'runtime');
  await mkdir(runtime);
  for (const path of ['cli', 'skills/tracevista-skill', 'viewer/src/trajectory/html-export.ts', 'package.json']) {
    await mkdir(dirname(join(runtime, path)), { recursive: true });
    await cp(join(root, path), join(runtime, path), { recursive: true });
  }
  await mkdir(join(runtime, 'dist'));
  await writeFile(join(runtime, 'dist/tracevista-export.html'), createExportTemplate('/* test runtime */', 'body{}'));
  const py = spawnSync(process.env.TRACEVISTA_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c',
    'import sys,json;sys.path.insert(0,sys.argv[1]);from test_view import graph_fixture;print(json.dumps(graph_fixture()))',
    join(root, 'skills/tracevista-skill/tests')], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(py.status, 0, py.stderr);
  graph = JSON.parse(py.stdout);
  graph.timeline.timeline[0].text = 'write source </script><script>alert(1)</script> $& 中文';
  graph.future_extension = { preserve: 'unknown fields' };
  source = join(temp, 'source with spaces.agent-state.json');
  await writeFile(source, ' \n' + JSON.stringify(graph, null, 3) + '\n');
});
after(async () => { await rm(temp, { recursive: true, force: true }); });

test('build preserves input bytes and evidence; standalone payload escapes HTML', async () => {
  const out = join(temp, 'built');
  const result = ok('build', source, '--out', out, '--language', 'zh');
  assert.equal(result.status, 'ready');
  assert.deepEqual(await readFile(join(out, 'trace.agent-state.json')), await readFile(source));
  const html = await readFile(join(out, 'trace.html'), 'utf8');
  assert.ok(html.includes('<html lang="zh-CN">'));
  assert.ok(!html.includes('</script><script>alert(1)</script>'));
  const payload = JSON.parse(html.match(/<script id="tracevista-data" type="application\/json">(.*?)<\/script>/s)[1]);
  assert.deepEqual(payload.graph, graph);
  assert.equal((await stat(join(out, 'trace.agent-state.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(out)).mode & 0o777, 0o700);
  const report = await readFile(join(out, 'TRACE_REPORT.md'), 'utf8');
  assert.match(report, /System states/);
  assert.match(report, /s0/);
  const query = ok('query', 'write source', '--in', out);
  assert.ok(query.results.some(node => node.id === 'E1'));
  assert.equal(ok('inspect', 'E1', '--in', out).node.text, graph.timeline.timeline[0].text);
  const action = ok('inspect', 'a', '--in', out);
  assert.deepEqual(action.evidence.map(e => e.id), ['E1', 'E2']);
  assert.ok(action.relations.some(link => link.action === 'a'));
  assert.equal(ok('info', out).counts.states, 2);
  assert.ok(ok('open', out, '--offline', '--no-open').url.startsWith('file://'));
  const collision = cli('build', source, '--out', out);
  assert.notEqual(collision.status, 0);
  assert.match(collision.stderr, /already exists/);
  assert.deepEqual(await readFile(join(out, 'trace.agent-state.json')), await readFile(source));
});

test('invalid graph, ambiguous directory, unknown options and unknown IDs fail clearly', async () => {
  const bad = join(temp, 'bad.agent-state.json');
  await writeFile(bad, '{"format":"coding-agent-state-trajectory"}');
  assert.match(cli('build', bad, '--out', join(temp, 'invalid-output')).stderr, /validation failed/);
  await assert.rejects(stat(join(temp, 'invalid-output')), { code: 'ENOENT' });
  assert.match(cli('run', temp).stderr, /found 2/);
  assert.match(cli('build', source, '--images', 'keep').stderr, /not supported/);
  assert.match(cli('inspect', 'missing', '--in', source).stderr, /Unknown ID/);
  assert.match(cli('query', 'x', '--in', source, '--limit', 'NaN').stderr, /integer/);
  assert.match(cli('build', source, '--language', 'xx').stderr, /en or zh/);
});

test('run routes completed exports to build; missing runtime does not create output', async () => {
  assert.equal(ok('run', source, '--out', join(temp, 'routed')).status, 'ready');
  await rm(join(runtime, 'dist/tracevista-export.html'));
  assert.match(cli('build', source, '--out', join(temp, 'missing-runtime')).stderr, /runtime is missing/);
  await assert.rejects(stat(join(temp, 'missing-runtime')), { code: 'ENOENT' });
  await writeFile(join(runtime, 'dist/tracevista-export.html'), createExportTemplate('', ''));
});

test('prepare creates an explicit agent handoff; requires image policy and preserves sources', async () => {
  const log = join(temp, 'session.jsonl');
  const raw = JSON.stringify({ type: 'assistant', message: { model: 'test-model', role: 'assistant', content: [{ type: 'text', text: 'Inspect source before editing.' }] } }) + '\n';
  await writeFile(log, raw);
  assert.match(cli('prepare', log).stderr, /--images/);
  const out = join(temp, 'prepared');
  const prepared = ok('run', log, '--images', 'omit', '--out', out);
  assert.equal(prepared.status, 'awaiting-agent');
  assert.ok(prepared.events > 0);
  assert.match(await readFile(join(out, 'TASK.md'), 'utf8'), /interpretation is still required/);
  assert.equal(await readFile(log, 'utf8'), raw);
  await assert.rejects(stat(join(out, 'trace.html')), { code: 'ENOENT' });
});

test('install copies a self-contained skill and leaves existing installs untouched', async () => {
  const project = join(temp, 'project with spaces');
  const installed = ok('install', '--agent', 'codex', '--project', project);
  assert.equal(installed.directory, join(project, '.agents/skills/tracevista'));
  assert.match(await readFile(join(installed.directory, 'SKILL.md'), 'utf8'), /name: tracevista/);
  const script = 'references/conversion-skill/scripts/build_state_graph.py';
  assert.deepEqual(await readFile(join(installed.directory, script)), await readFile(join(root, 'skills/tracevista-skill/scripts/build_state_graph.py')));
  assert.match(cli('install', '--agent', 'codex', '--project', project).stderr, /already exists/);
  for (const [agent, dir] of [['claude', '.claude/skills'], ['pi', '.pi/skills']]) {
    const result = ok('install', '--agent', agent, '--project', project);
    assert.equal(result.directory, join(project, dir, 'tracevista'));
  }
  assert.match(cli('install', '--agent', 'unknown', '--project', project).stderr, /Choose --agent/);
  assert.match(cli('install', '--agent', 'codex', '--project', project, '--user').stderr, /either/);
});

test('symlink destinations are not followed or replaced', async () => {
  if (process.platform === 'win32') return;
  const link = join(temp, 'linked-output');
  await symlink(join(temp, 'built'), link);
  assert.match(cli('build', source, '--out', link).stderr, /already exists/);
});

test('npm pack metadata supports both npm 11 arrays and npm 12 keyed objects', () => {
  const result = { name: 'tracevista-toolkit', filename: 'tracevista-toolkit-0.1.0.tgz', files: [] };
  for (const output of [[result], { 'tracevista-toolkit': result }]) {
    assert.deepEqual(parseSinglePackResult(JSON.stringify(output), result.name), result);
  }
  for (const output of [null, [], {}, [result, result], { error: { message: 'failed' } }, [{ ...result, files: null }]]) {
    assert.throws(() => parseSinglePackResult(JSON.stringify(output), result.name), /Expected one/);
  }
});

test('open requires a stable valid port and rejects it for offline snapshots', () => {
  for (const port of ['0', '-1', '65536', 'NaN', '1.5']) {
    assert.match(cli('open', `--port=${port}`, '--no-open').stderr, /--port must be an integer/);
  }
  assert.match(cli('open', '--offline', '--port', '8877', '--no-open').stderr, /does not apply/);
  assert.match(cli('open', 'trace.html', '--port', '8877', '--no-open').stderr, /does not apply/);
});
