import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'lib');
const skill = resolve(root, '../../skills/tracevista-skill');
const repository = resolve(root, '../..');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const entry of await readdir(join(root, 'src'), { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.mjs')) {
    await cp(join(root, 'src', entry.name), join(output, entry.name));
  }
}
const client = await readFile(join(root, 'src/client.cjs'), 'utf8');
await writeFile(join(output, 'client.js'), [
  `window.__ModuleLoader__.load({id:${JSON.stringify(manifest.name)},factory:(require)=>{`,
  'var module={exports:{}};var exports=module.exports;',
  client,
  'return module.exports;}});',
  '',
].join('\n'));
await mkdir(join(output, 'skill'), { recursive: true });
await cp(join(skill, 'SKILL.md'), join(output, 'skill/SKILL.md'));
for (const directory of ['scripts', 'references']) {
  await cp(join(skill, directory), join(output, 'skill', directory), {
    recursive: true,
    filter: source => !source.split('/').some(part => part === '__pycache__' || part === 'tests')
      && !source.endsWith('.pyc'),
  });
}
for (const relative of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'LICENSES/ThoughtDAG-MIT.txt']) {
  await mkdir(dirname(join(output, relative)), { recursive: true });
  await cp(join(repository, relative), join(output, relative));
}
console.log(`Built ${manifest.name}@${manifest.version} with its bundled conversion skill.`);
