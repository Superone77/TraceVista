import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const integration = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repository = resolve(integration, '../..');
const output = join(integration, '.build/tracevista');
const result = spawnSync(process.execPath, [join(repository, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'viewer/vite.config.ts', '--mode', 'minimax'], { cwd: repository, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
await rm(output, { recursive: true, force: true });
await mkdir(join(output, '.minimax-plugin'), { recursive: true });
await mkdir(join(output, 'miniapp/node'), { recursive: true });
await cp(join(integration, 'plugin.json'), join(output, '.minimax-plugin/plugin.json'));
await cp(join(integration, 'miniapp.json'), join(output, 'miniapp/miniapp.json'));
await cp(join(integration, 'src/server.mjs'), join(output, 'miniapp/node/server.mjs'));
await cp(join(integration, '.build/viewer'), join(output, 'miniapp/client'), { recursive: true });
for (const name of ['package.json', 'README.md', 'icon.png']) await cp(join(integration, name), join(output, name));
await mkdir(join(output, 'skills'), { recursive: true });
await cp(join(repository, 'skills/tracevista-skill'), join(output, 'skills/tracevista-skill'), {
  recursive: true,
  filter: path => !path.split(/[\\/]/).some(part => part === '__pycache__' || part === 'tests' || part === '.DS_Store') && !path.endsWith('.pyc'),
});
for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSES']) await cp(join(repository, name), join(output, name), { recursive: true });
// Include licenses of runtime dependencies bundled into the viewer, without node_modules.
for (const [name, source] of [
  ['React', 'react/LICENSE'], ['ReactDOM', 'react-dom/LICENSE'], ['ReactFlow', '@xyflow/react/LICENSE'],
  ['XyflowSystem', '@xyflow/system/LICENSE'], ['Inter', '@fontsource-variable/inter/LICENSE'],
]) {
  const path = join(repository, 'node_modules', source);
  // pnpm keeps transitive packages behind their owning dependency.
  let license;
  try { license = await readFile(path); }
  catch (error) { if (name !== 'XyflowSystem') throw error; license = await readFile(join(repository, 'node_modules/@xyflow/react/node_modules/@xyflow/system/LICENSE')).catch(() => null); }
  if (license) await writeFile(join(output, 'LICENSES', `${name}.txt`), license);
}
let files = 0, bytes = 0;
async function inspect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error('MiniApp packages must not contain symlinks.');
    if (entry.isDirectory()) await inspect(child);
    else { const size = (await stat(child)).size; if (size > 16 * 1024 * 1024) throw new Error(`MiniApp file is too large: ${entry.name}`); files++; bytes += size; }
  }
}
await inspect(output);
if (files > 1024 || bytes > 64 * 1024 * 1024) throw new Error('MiniApp exceeds the host package limits.');
console.log(`Built ${output} (${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB).`);
