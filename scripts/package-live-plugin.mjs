import { cp, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageAgentPlugin } from './package-agent-plugin.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
if (process.argv.length !== 4 || process.argv[2] !== '--out') throw new Error('Usage: node scripts/package-live-plugin.mjs --out NEW_DIRECTORY');
await access(join(root, 'dist/index.html')); // Build before packaging; no install hooks.
const output = await packageAgentPlugin(resolve(process.argv[3]));
await cp(join(root, 'dist'), join(output, 'dist'), { recursive: true });
await cp(join(root, 'integrations/live-session'), join(output, 'integrations/live-session'), {
  recursive: true, filter: p => !['tests', '__pycache__', '.DS_Store'].includes(basename(p)) && !p.endsWith('.pyc'),
});
await writeFile(join(output, 'README.md'), (await readFile(join(output, 'README.md'), 'utf8')) + '\nThis live bundle also includes the built viewer and local session bridge. Invoke tracevista-live-skill to follow a selected session. Claude Code/Codex login stays with the installed CLI; no API key is copied into the browser.\n');
console.log(output);
