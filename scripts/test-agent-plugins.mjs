import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageAgentPlugin } from './package-agent-plugin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const version = (await readJson(join(root, 'package.json'))).version;
const temp = await mkdtemp(join(tmpdir(), 'tracevista-plugin-test-'));
try {
  const output = await packageAgentPlugin(join(temp, 'tracevista'));
  for (const directory of ['.claude-plugin', '.codex-plugin', '.cursor-plugin']) {
    const manifest = await readJson(join(output, directory, 'plugin.json'));
    assert.equal(manifest.name, 'tracevista');
    assert.equal(manifest.version, version, `${directory}: bump the plugin version with package.json`);
    assert.equal(manifest.license, 'MIT');
    assert.equal(manifest.hooks, undefined, 'Skill delivery must not install startup hooks');
    assert.equal(manifest.mcpServers, undefined, 'Skill delivery does not require a server');
    if (manifest.skills) {
      assert.equal(manifest.skills, './skills/');
      assert.ok((await stat(join(output, manifest.skills, 'tracevista-skill/SKILL.md'))).isFile());
    }
  }
  const gemini = await readJson(join(output, 'gemini-extension.json'));
  assert.equal(gemini.name, 'tracevista');
  assert.equal(gemini.version, version);
  assert.equal(gemini.mcpServers, undefined);
  const claudeMarket = await readJson(join(output, '.claude-plugin/marketplace.json'));
  const codexMarket = await readJson(join(output, '.agents/plugins/marketplace.json'));
  assert.equal(claudeMarket.name, codexMarket.name);
  assert.equal(claudeMarket.plugins.length, 1);
  assert.equal(claudeMarket.plugins[0].source, './');
  assert.equal(codexMarket.plugins.length, 1);
  assert.deepEqual(codexMarket.plugins[0].source, { source: 'local', path: './' });
  assert.equal(codexMarket.plugins[0].policy.installation, 'AVAILABLE');
  const pi = await readJson(join(output, 'package.json'));
  assert.deepEqual(pi.pi.skills, ['./skills/tracevista-skill']);
  assert.equal(pi.dependencies, undefined, 'Skill package must not install viewer dependencies');
  assert.equal(pi.devDependencies, undefined);
  assert.equal(pi.scripts, undefined, 'Installation must not execute lifecycle scripts');
  assert.equal(
    await readFile(join(output, 'skills/tracevista-skill/SKILL.md'), 'utf8'),
    await readFile(join(root, 'skills/tracevista-skill/SKILL.md'), 'utf8'),
    'Installed skill must match the shared source',
  );
  for (const script of ['extract_timeline.py', 'build_state_graph.py', 'validate_trace.py']) {
    assert.deepEqual(
      await readFile(join(output, 'skills/tracevista-skill/scripts', script)),
      await readFile(join(root, 'skills/tracevista-skill/scripts', script)),
    );
  }
  assert.deepEqual(
    (await readdir(output)).sort(),
    ['.agents', '.claude-plugin', '.codex-plugin', '.cursor-plugin', 'LICENSE', 'LICENSES', 'README.md', 'THIRD_PARTY_NOTICES.md',
      'gemini-extension.json', 'package.json', 'skills'].sort(),
    'Bundle must contain only explicitly selected distribution files',
  );
  assert.deepEqual(await readFile(join(output, 'LICENSES/ThoughtDAG-MIT.txt')),
    await readFile(join(root, 'LICENSES/ThoughtDAG-MIT.txt')));
  await writeFile(join(output, 'keep.txt'), 'existing install');
  await assert.rejects(() => packageAgentPlugin(output), { code: 'EEXIST' });
  assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'existing install');
  console.log('Agent plugin packaging checks passed.');
} finally {
  await rm(temp, { recursive: true, force: true });
}
