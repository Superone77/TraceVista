import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export async function packageToolkit(destination) {
  await access(join(root, 'dist/tracevista-export.html'));
  const output = resolve(destination);
  if (output === root || ['cli', 'skills', 'viewer', 'dist', 'scripts'].some(name => output === join(root, name) || output.startsWith(join(root, name) + '/'))) {
    throw new Error('Choose a fresh output outside the source/runtime directories.');
  }
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // Never replace an existing package.
  const filter = source => !['__pycache__', '.DS_Store', 'tests'].includes(basename(source)) && !source.endsWith('.pyc');
  for (const path of ['cli', 'skills/tracevista-skill',
    'dist', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSES/ThoughtDAG-MIT.txt']) {
    await mkdir(dirname(join(output, path)), { recursive: true });
    await cp(join(root, path), join(output, path), { recursive: true, filter });
  }
  // npm-installed modules cannot use Node's TypeScript stripping. Compile the same
  // shared renderer once, retaining one source of truth and no runtime dependencies.
  await writeFile(join(output, 'cli/html-export.mjs'), stripTypeScriptTypes(
    await readFile(join(root, 'viewer/src/trajectory/html-export.ts'), 'utf8')));
  const workspace = join(output, 'cli/workspace.mjs');
  await writeFile(workspace, (await readFile(workspace, 'utf8')).replace(
    "'../viewer/src/trajectory/html-export.ts'", "'./html-export.mjs'"));
  const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  await writeFile(join(output, 'package.json'), JSON.stringify({
    name: 'tracevista-toolkit', version, private: true, type: 'module', license: 'MIT',
    description: 'Local TraceVista CLI, conversion skill and offline viewer.',
    engines: { node: '>=24' }, bin: { tracevista: 'cli/tracevista.mjs' },
    files: ['cli', 'skills', 'dist', 'LICENSES', 'THIRD_PARTY_NOTICES.md'],
  }, null, 2) + '\n');
  await cp(join(root, 'docs/LOCAL-TOOLKIT.md'), join(output, 'README.md'));
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter(arg => arg !== '--');
  if (args.length && (args.length !== 2 || args[0] !== '--out')) {
    console.error('Usage: node scripts/package-toolkit.mjs [--out NEW_DIRECTORY]'); process.exitCode = 1;
  } else {
    try { console.log(await packageToolkit(args[1] || '.work/tracevista-toolkit')); }
    catch (error) { console.error(`Toolkit packaging failed: ${error.message}. Build the viewer first with pnpm build.`); process.exitCode = 1; }
  }
}
