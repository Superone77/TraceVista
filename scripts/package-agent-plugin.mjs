import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const metadataFiles = [
  '.claude-plugin/plugin.json',
  '.claude-plugin/marketplace.json',
  '.codex-plugin/plugin.json',
  '.agents/plugins/marketplace.json',
  '.cursor-plugin/plugin.json',
  'gemini-extension.json',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  'LICENSES/ThoughtDAG-MIT.txt',
];

// Copy only the shared skill and install metadata, never the viewer, local logs,
// dependency trees, or Git history. All installed platforms use the same skill.
export async function packageAgentPlugin(outputDirectory) {
  const output = resolve(outputDirectory);
  if (output === repoRoot || output.startsWith(join(repoRoot, 'skills') + '/')) {
    throw new Error('Choose an output directory outside the skill source.');
  }
  const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'));
  await mkdir(dirname(output), { recursive: true });
  await mkdir(output); // An existing destination is an error; never replace an install.
  for (const file of metadataFiles) {
    await mkdir(dirname(join(output, file)), { recursive: true });
    await cp(join(repoRoot, file), join(output, file));
  }
  await cp(join(repoRoot, 'skills/tracevista-skill'), join(output, 'skills/tracevista-skill'), {
    recursive: true,
    filter: (source) => !['__pycache__', '.DS_Store'].includes(basename(source)) && !source.endsWith('.pyc'),
  });
  await writeFile(join(output, 'package.json'), JSON.stringify({
    name: 'tracevista-agent-plugin',
    version: pkg.version,
    private: true,
    description: 'The shared TraceVista trajectory conversion skill.',
    license: 'MIT',
    keywords: ['pi-package', 'agent', 'trajectory'],
    pi: { skills: ['./skills/tracevista-skill'] },
  }, null, 2) + '\n');
  await writeFile(join(output, 'README.md'), `# TraceVista agent plugin

Use tracevista-skill to convert an agent log into a complete .agent-state.json,
then open https://tracevista.pages.dev/ and import the file.

The scripts require Python 3.10+. The invoking agent authors the interpretation.
This package contains the shared skill and platform manifests, with no viewer
runtime dependencies. No accounts or API keys are configured by installation.

Install instructions: https://github.com/Superone77/TraceVista/blob/main/docs/AGENT-INTEGRATIONS.md
`);
  return output;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== '--out') {
    console.error('Usage: node scripts/package-agent-plugin.mjs --out /path/to/new-plugin-directory');
    process.exitCode = 1;
  } else {
    try {
      console.log(await packageAgentPlugin(process.argv[3]));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
