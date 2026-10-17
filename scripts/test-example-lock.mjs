import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temp = mkdtempSync(join(tmpdir(), 'tracevista-example-lock-'));
try {
  const tool = join(temp, 'viewer');
  const library = join(temp, 'library');
  mkdirSync(join(tool, 'scripts'), { recursive: true });
  for (const name of ['examples', 'example-thumbnails', 'LICENSES']) mkdirSync(join(library, name), { recursive: true });
  copyFileSync(new URL('lock-examples.mjs', import.meta.url), join(tool, 'scripts/lock-examples.mjs'));
  writeFileSync(join(library, 'examples/index.json'), JSON.stringify([{ id: 'tiny', file: 'tiny.agent-state.json' }]));
  writeFileSync(join(library, 'examples/tiny.agent-state.json'), '{}');
  writeFileSync(join(library, 'example-thumbnails/tiny.png'), 'synthetic thumbnail');
  writeFileSync(join(library, 'THIRD_PARTY_NOTICES.md'), 'synthetic sources');
  writeFileSync(join(library, 'LICENSES/test.txt'), 'synthetic license');
  const git = args => execFileSync('git', args, { cwd: library, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=TraceVista test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Synthetic library']);
  const run = () => spawnSync(process.execPath, [join(tool, 'scripts/lock-examples.mjs'), '--', library], { encoding: 'utf8' });
  const ok = run();
  assert.equal(ok.status, 0, ok.stderr);
  const initial = readFileSync(join(tool, 'examples.lock.json'), 'utf8');
  assert.ok(JSON.parse(initial).files['LICENSES/test.txt']);
  rmSync(join(library, 'LICENSES/test.txt'));
  const deletedLicense = run();
  assert.notEqual(deletedLicense.status, 0);
  assert.match(deletedLicense.stderr, /Commit all tracked/);
  assert.equal(readFileSync(join(tool, 'examples.lock.json'), 'utf8'), initial);
  git(['restore', 'LICENSES/test.txt']);
  writeFileSync(join(library, 'examples/tiny.agent-state.json'), 'uncommitted evidence');
  assert.notEqual(run().status, 0);
  assert.equal(readFileSync(join(tool, 'examples.lock.json'), 'utf8'), initial);
  console.log('PASS: lock CLI argument separator, committed provenance and deleted-license protection');
} finally { rmSync(temp, { recursive: true, force: true }); }
