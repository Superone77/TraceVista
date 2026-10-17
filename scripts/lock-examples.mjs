import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (args.length > 1) throw new Error('Usage: pnpm examples:lock [example-repository-directory]');
const library = resolve(args[0] || process.env.TRACEVISTA_EXAMPLES_DIR || resolve(root, '../TraceVista-examples'));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: library }).toString().trim();
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: library }).toString().trim()) {
  throw new Error('Commit all tracked example-library changes before updating the lock, including deleted licenses.');
}
const catalog = JSON.parse(readFileSync(resolve(library, 'examples/index.json')));
if (!Array.isArray(catalog) || !catalog.length) throw new Error('The example catalog is empty.');
const paths = new Set(['examples/index.json', 'THIRD_PARTY_NOTICES.md']);
for (const item of catalog) {
  if (!/^[a-zA-Z0-9_-]+$/.test(item.id) || !/^[a-zA-Z0-9_-]+\.agent-state\.json$/.test(item.file)) throw new Error('Invalid catalog entry.');
  const thumbnail = item.thumbnail || `${item.id}.png`;
  if (!/^[a-zA-Z0-9_.-]+\.(png|webp|jpg)$/.test(thumbnail)) throw new Error('Invalid thumbnail filename.');
  paths.add(`examples/${item.file}`);
  paths.add(`example-thumbnails/${thumbnail}`);
}
for (const name of readdirSync(resolve(library, 'LICENSES'))) {
  if (!/^[a-zA-Z0-9_.-]+\.txt$/.test(name)) throw new Error('Invalid license filename.');
  paths.add(`LICENSES/${name}`);
}
const files = {};
for (const path of [...paths].sort()) {
  const contents = readFileSync(resolve(library, path));
  const committed = execFileSync('git', ['show', `${revision}:${path}`], { cwd: library, maxBuffer: 32 * 1024 * 1024 });
  if (!contents.equals(committed)) throw new Error(`Commit the example changes before updating the lock: ${path}`);
  files[path] = createHash('sha256').update(contents).digest('hex');
}
writeFileSync(resolve(root, 'examples.lock.json'), JSON.stringify({
  version: 1, repository: 'https://github.com/Superone77/TraceVista-examples.git', revision, files,
}, null, 2) + '\n');
console.log(`Pinned ${catalog.length} examples (${paths.size} assets) at ${revision}`);
